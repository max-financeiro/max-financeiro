'use client';

import { useState, useTransition } from 'react';
import { saveRuleAction, deleteRuleAction, type ActionState } from './actions';

interface Rule {
  id: string;
  event_type: string;
  params: Record<string, unknown>;
  recipients: string[];
  channels: string[];
  cooldown_hours: number;
  active: boolean;
}

interface Props {
  eventType: string;
  eventLabel: string;
  paramHint: string;
  rule: Rule | null;
  groupId: string;
}

export function RuleEditor({ eventType, eventLabel, paramHint, rule, groupId }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<ActionState>(null);

  const [params, setParams] = useState(rule ? JSON.stringify(rule.params) : paramHint);
  const [recipients, setRecipients] = useState((rule?.recipients ?? []).join(', '));
  const [cooldown, setCooldown] = useState(String(rule?.cooldown_hours ?? 24));
  const [active, setActive] = useState(rule?.active ?? true);

  function save() {
    const fd = new FormData();
    fd.set('group_id', groupId);
    fd.set('event_type', eventType);
    fd.set('params_json', params);
    fd.set('recipients', recipients);
    fd.set('cooldown_hours', cooldown);
    fd.set('active', active ? 'on' : 'off');
    startTransition(async () => {
      const r = await saveRuleAction(null, fd);
      setState(r);
      if (r?.ok) {
        setTimeout(() => setOpen(false), 500);
      }
    });
  }

  function doDelete() {
    if (!rule) return;
    if (!confirm(`Remover regra "${eventLabel}"?`)) return;
    const fd = new FormData();
    fd.set('rule_id', rule.id);
    startTransition(async () => {
      const r = await deleteRuleAction(fd);
      setState(r);
      if (r?.ok) setTimeout(() => setOpen(false), 500);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs bg-neutral-100 text-neutral-700 px-2 py-1 rounded hover:bg-neutral-200"
      >
        {rule ? 'editar' : 'criar'}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-lg max-w-lg w-full p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h2 className="font-semibold text-lg text-maxfem-pink">{eventLabel}</h2>
              <p className="text-xs text-neutral-500 mt-0.5">
                event_type: <code>{eventType}</code>
              </p>
            </div>

            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs uppercase text-neutral-500 font-semibold mb-1">
                  Parâmetros (JSON)
                </label>
                <input
                  type="text"
                  value={params}
                  onChange={(e) => setParams(e.target.value)}
                  placeholder={paramHint}
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-mono focus:border-maxfem-pink focus:outline-none"
                />
                <p className="text-[11px] text-neutral-500 mt-1">Exemplo: <code>{paramHint}</code></p>
              </div>

              <div>
                <label className="block text-xs uppercase text-neutral-500 font-semibold mb-1">
                  Destinatários (separados por vírgula)
                </label>
                <textarea
                  value={recipients}
                  onChange={(e) => setRecipients(e.target.value)}
                  placeholder="thiago@maxfem.com.br, anderson@maxfem.com.br"
                  rows={2}
                  className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs uppercase text-neutral-500 font-semibold mb-1">
                    Cooldown (horas)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={168}
                    value={cooldown}
                    onChange={(e) => setCooldown(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm focus:border-maxfem-pink focus:outline-none"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={(e) => setActive(e.target.checked)}
                      className="rounded border-neutral-300 text-maxfem-pink focus:ring-maxfem-pink"
                    />
                    Regra ativa
                  </label>
                </div>
              </div>
            </div>

            {state?.ok === false && (
              <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
                {state.error}
              </p>
            )}
            {state?.ok === true && (
              <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded p-2">
                {state.message}
              </p>
            )}

            <div className="flex items-center justify-between pt-2">
              <div>
                {rule && (
                  <button
                    type="button"
                    onClick={doDelete}
                    disabled={pending}
                    className="text-xs text-rose-700 hover:underline disabled:opacity-50"
                  >
                    remover regra
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs text-neutral-600 px-3 py-1.5 rounded hover:bg-neutral-100"
                >
                  cancelar
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="text-xs bg-maxfem-pink text-white px-3 py-1.5 rounded hover:bg-pink-600 disabled:opacity-50"
                >
                  {pending ? 'salvando…' : 'salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
