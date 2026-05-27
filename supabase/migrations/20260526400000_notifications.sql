-- ============================================================
-- 20260526400000_notifications.sql
-- ------------------------------------------------------------
-- Sprint 14 — Notificações inteligentes.
--
-- Arquitetura em 3 partes:
--   1. notification_rules: configuração de QUAIS eventos disparam alerta
--      e QUEM recebe (subscribers como array de user_id ou emails)
--   2. notifications: fila de alertas. Generator escreve com status=pending,
--      dispatcher envia (Resend) e move pra sent/failed
--   3. generate_notifications(): RPC SECURITY DEFINER que avalia AP/AR/banco
--      e gera notifications pendentes (idempotente via UNIQUE dedup_key)
--
-- Tipos de alerta cobertos no MVP:
--   - ap_due_soon: AP vencendo em <= N dias
--   - ap_overdue: AP já vencido
--   - ar_overdue: AR já vencido
--   - unmatched_bank_pile_up: muita transação não-conciliada acumulada
--   - cashflow_negative: projeção 30d entrou no vermelho
-- ============================================================

CREATE TABLE IF NOT EXISTS public.notification_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  event_type      TEXT NOT NULL CHECK (event_type IN (
    'ap_due_soon',
    'ap_overdue',
    'ar_overdue',
    'unmatched_bank_pile_up',
    'cashflow_negative'
  )),
  -- Parâmetros do evento. Exemplo pra ap_due_soon: {"days_ahead": 3, "min_amount": 100}
  params          JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Destinatários: array de emails (mais simples e robusto que linkar user_id
  -- — funciona pra contador externo que não tem login)
  recipients      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  channels        TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],

  -- Frequência mínima entre alertas do mesmo tipo (evita spam quando rule_engine
  -- roda 10x por dia). default 1 dia.
  cooldown_hours  INT NOT NULL DEFAULT 24,

  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ,

  -- Não pode ter mais de 1 regra ativa por (group, event_type) — UI configura UMA.
  CONSTRAINT notification_rules_unique_event
    EXCLUDE (group_id WITH =, event_type WITH =) WHERE (active = true AND deleted_at IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_notif_rules_group_active
  ON public.notification_rules(group_id, event_type)
  WHERE active = true AND deleted_at IS NULL;

ALTER TABLE public.notification_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_rules FORCE ROW LEVEL SECURITY;

CREATE POLICY "Members see rules of their group"
  ON public.notification_rules
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));

-- INSERT/UPDATE/DELETE só service_role — UI passa por Server Action.

-- ============================================================
-- notifications: a fila
-- ============================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rule_id         UUID REFERENCES public.notification_rules(id) ON DELETE SET NULL,

  event_type      TEXT NOT NULL,
  -- Subject + body já renderizados pelo generator. Dispatcher só envia.
  subject         TEXT NOT NULL,
  body_text       TEXT NOT NULL,
  body_html       TEXT,
  recipients      TEXT[] NOT NULL,
  channels        TEXT[] NOT NULL DEFAULT ARRAY['email']::TEXT[],

  -- Chave de dedup: identifica o evento concreto pra evitar dupla notificação
  -- no mesmo cooldown. Ex: "ap_due_soon:CAP-2026-00042:2026-05-26"
  dedup_key       TEXT NOT NULL,

  -- Payload pra debug + audit
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,

  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sending', 'sent', 'failed', 'cancelled'
  )),
  attempts        INT NOT NULL DEFAULT 0,
  last_error      TEXT,

  scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Dedup por chave + janela de tempo (cooldown). Multiplas linhas com mesmo
  -- dedup_key são permitidas se sent_at for muito antigo — controlado por query.
  CONSTRAINT notifications_dedup_pending
    EXCLUDE (dedup_key WITH =) WHERE (status IN ('pending', 'sending'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_pending
  ON public.notifications(scheduled_for) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_notifications_group_status
  ON public.notifications(group_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_dedup_recent
  ON public.notifications(dedup_key, created_at DESC);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

CREATE POLICY "Members see notifications of their group"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (public.user_has_org_access_recursive(group_id));


-- ============================================================
-- generate_notifications(group_id): RPC do rule engine
-- Roda via cron. Itera regras ativas, avalia, cria pending notifications.
-- ============================================================
CREATE OR REPLACE FUNCTION public.generate_notifications(p_group_id UUID)
RETURNS TABLE (
  event_type   TEXT,
  generated    INT,
  skipped      INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
  v_today DATE := NOW()::DATE;
  v_gen INT;
  v_skip INT;
BEGIN
  -- Loop nas regras ativas do grupo
  FOR v_rule IN
    SELECT * FROM notification_rules
    WHERE group_id = p_group_id AND active = true AND deleted_at IS NULL
  LOOP
    v_gen := 0;
    v_skip := 0;

    -- ============ AP_DUE_SOON ============
    IF v_rule.event_type = 'ap_due_soon' THEN
      DECLARE
        v_days_ahead INT := COALESCE((v_rule.params->>'days_ahead')::INT, 3);
        v_min_amount NUMERIC := COALESCE((v_rule.params->>'min_amount')::NUMERIC, 0);
        v_ap RECORD;
        v_dedup TEXT;
        v_subj TEXT;
        v_body TEXT;
      BEGIN
        FOR v_ap IN
          SELECT ap.id, ap.reference_number, ap.amount, ap.amount_paid, ap.due_date,
                 ap.description, bp.legal_name AS supplier_name
          FROM accounts_payable ap
          JOIN organizations o ON o.id = ap.organization_id
          LEFT JOIN business_partners bp ON bp.id = ap.supplier_id
          WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
            AND ap.deleted_at IS NULL
            AND ap.status IN ('pending', 'approved', 'scheduled', 'partially_paid')
            AND ap.due_date BETWEEN v_today AND (v_today + (v_days_ahead || ' days')::INTERVAL)
            AND (ap.amount - ap.amount_paid) >= v_min_amount
        LOOP
          v_dedup := 'ap_due_soon:' || v_ap.id::TEXT || ':' || v_ap.due_date::TEXT;
          -- Skip se já tem pendente OU enviada nas últimas cooldown_hours
          IF EXISTS (
            SELECT 1 FROM notifications
            WHERE dedup_key = v_dedup
              AND (status IN ('pending', 'sending')
                OR (status = 'sent' AND sent_at > NOW() - (v_rule.cooldown_hours || ' hours')::INTERVAL))
          ) THEN
            v_skip := v_skip + 1;
            CONTINUE;
          END IF;

          v_subj := format('AP %s vence em %s dia(s) — R$ %s',
            COALESCE(v_ap.reference_number, v_ap.id::TEXT),
            v_ap.due_date - v_today,
            to_char(v_ap.amount - v_ap.amount_paid, 'FM999G999G999D00'));
          v_body := format(
            E'AP %s vence em %s dia(s).\n\nFornecedor: %s\nValor: R$ %s\nVencimento: %s\nDescrição: %s\n\nVer detalhes: /contas-a-pagar/%s',
            COALESCE(v_ap.reference_number, v_ap.id::TEXT),
            v_ap.due_date - v_today,
            COALESCE(v_ap.supplier_name, '—'),
            to_char(v_ap.amount - v_ap.amount_paid, 'FM999G999G999D00'),
            to_char(v_ap.due_date, 'DD/MM/YYYY'),
            COALESCE(v_ap.description, '—'),
            v_ap.id::TEXT
          );

          INSERT INTO notifications (
            group_id, rule_id, event_type, subject, body_text,
            recipients, channels, dedup_key, payload
          ) VALUES (
            p_group_id, v_rule.id, 'ap_due_soon', v_subj, v_body,
            v_rule.recipients, v_rule.channels, v_dedup,
            jsonb_build_object(
              'ap_id', v_ap.id,
              'reference_number', v_ap.reference_number,
              'amount', v_ap.amount - v_ap.amount_paid,
              'due_date', v_ap.due_date,
              'supplier', v_ap.supplier_name
            )
          )
          ON CONFLICT DO NOTHING;
          v_gen := v_gen + 1;
        END LOOP;
      END;

    -- ============ AP_OVERDUE ============
    ELSIF v_rule.event_type = 'ap_overdue' THEN
      DECLARE
        v_min_amount NUMERIC := COALESCE((v_rule.params->>'min_amount')::NUMERIC, 0);
        v_count INT;
        v_total NUMERIC;
        v_dedup TEXT;
      BEGIN
        SELECT COUNT(*), COALESCE(SUM(ap.amount - ap.amount_paid), 0)
          INTO v_count, v_total
          FROM accounts_payable ap
          JOIN organizations o ON o.id = ap.organization_id
          WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
            AND ap.deleted_at IS NULL
            AND ap.status IN ('pending', 'approved', 'scheduled', 'partially_paid')
            AND ap.due_date < v_today
            AND (ap.amount - ap.amount_paid) >= v_min_amount;

        IF v_count > 0 THEN
          v_dedup := 'ap_overdue:' || p_group_id::TEXT || ':' || v_today::TEXT;
          IF NOT EXISTS (
            SELECT 1 FROM notifications WHERE dedup_key = v_dedup
              AND (status IN ('pending', 'sending')
                OR (status = 'sent' AND sent_at > NOW() - (v_rule.cooldown_hours || ' hours')::INTERVAL))
          ) THEN
            INSERT INTO notifications (group_id, rule_id, event_type, subject, body_text, recipients, channels, dedup_key, payload)
            VALUES (
              p_group_id, v_rule.id, 'ap_overdue',
              format('%s AP(s) em atraso — total R$ %s', v_count, to_char(v_total, 'FM999G999G999D00')),
              format(E'Você tem %s conta(s) a pagar em atraso, somando R$ %s.\n\nVer lista: /contas-a-pagar?status=overdue',
                v_count, to_char(v_total, 'FM999G999G999D00')),
              v_rule.recipients, v_rule.channels, v_dedup,
              jsonb_build_object('count', v_count, 'total', v_total)
            )
            ON CONFLICT DO NOTHING;
            v_gen := 1;
          ELSE v_skip := 1; END IF;
        END IF;
      END;

    -- ============ AR_OVERDUE ============
    ELSIF v_rule.event_type = 'ar_overdue' THEN
      DECLARE
        v_min_amount NUMERIC := COALESCE((v_rule.params->>'min_amount')::NUMERIC, 0);
        v_count INT;
        v_total NUMERIC;
        v_dedup TEXT;
      BEGIN
        SELECT COUNT(*), COALESCE(SUM(ar.amount_pending), 0)
          INTO v_count, v_total
          FROM accounts_receivable ar
          JOIN organizations o ON o.id = ar.organization_id
          WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
            AND ar.deleted_at IS NULL
            AND ar.status IN ('pending', 'partially_received')
            AND ar.due_date < v_today
            AND ar.amount_pending >= v_min_amount;

        IF v_count > 0 THEN
          v_dedup := 'ar_overdue:' || p_group_id::TEXT || ':' || v_today::TEXT;
          IF NOT EXISTS (
            SELECT 1 FROM notifications WHERE dedup_key = v_dedup
              AND (status IN ('pending', 'sending')
                OR (status = 'sent' AND sent_at > NOW() - (v_rule.cooldown_hours || ' hours')::INTERVAL))
          ) THEN
            INSERT INTO notifications (group_id, rule_id, event_type, subject, body_text, recipients, channels, dedup_key, payload)
            VALUES (
              p_group_id, v_rule.id, 'ar_overdue',
              format('%s AR(s) em atraso — total R$ %s', v_count, to_char(v_total, 'FM999G999G999D00')),
              format(E'Você tem %s conta(s) a receber em atraso, somando R$ %s.\n\nVer lista: /contas-a-receber?status=overdue',
                v_count, to_char(v_total, 'FM999G999G999D00')),
              v_rule.recipients, v_rule.channels, v_dedup,
              jsonb_build_object('count', v_count, 'total', v_total)
            )
            ON CONFLICT DO NOTHING;
            v_gen := 1;
          ELSE v_skip := 1; END IF;
        END IF;
      END;

    -- ============ UNMATCHED_BANK_PILE_UP ============
    ELSIF v_rule.event_type = 'unmatched_bank_pile_up' THEN
      DECLARE
        v_threshold INT := COALESCE((v_rule.params->>'threshold')::INT, 10);
        v_count INT;
        v_dedup TEXT;
      BEGIN
        SELECT COUNT(*)
          INTO v_count
          FROM bank_transactions bt
          JOIN organizations o ON o.id = bt.organization_id
          WHERE (o.parent_id = p_group_id OR o.id = p_group_id)
            AND bt.status = 'unmatched';

        IF v_count >= v_threshold THEN
          v_dedup := 'unmatched_pile_up:' || p_group_id::TEXT || ':' || v_today::TEXT;
          IF NOT EXISTS (
            SELECT 1 FROM notifications WHERE dedup_key = v_dedup
              AND (status IN ('pending', 'sending')
                OR (status = 'sent' AND sent_at > NOW() - (v_rule.cooldown_hours || ' hours')::INTERVAL))
          ) THEN
            INSERT INTO notifications (group_id, rule_id, event_type, subject, body_text, recipients, channels, dedup_key, payload)
            VALUES (
              p_group_id, v_rule.id, 'unmatched_bank_pile_up',
              format('%s transações bancárias aguardando conciliação', v_count),
              format(E'%s transações bancárias estão aguardando conciliação manual (limite: %s).\n\nVer: /caixa/conciliacao?status=unmatched',
                v_count, v_threshold),
              v_rule.recipients, v_rule.channels, v_dedup,
              jsonb_build_object('count', v_count, 'threshold', v_threshold)
            )
            ON CONFLICT DO NOTHING;
            v_gen := 1;
          ELSE v_skip := 1; END IF;
        END IF;
      END;
    END IF;

    -- Retorna 1 linha por regra processada
    event_type := v_rule.event_type;
    generated := v_gen;
    skipped := v_skip;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_notifications(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.generate_notifications(UUID) IS
  'Sprint 14: rule engine — avalia regras ativas do grupo e cria notifications pendentes. Idempotente via dedup_key + cooldown_hours.';
