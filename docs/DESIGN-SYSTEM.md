# Design System · Financeiro Maxfem

Última atualização: 2026-05-17 (Sprint 7-A · skill `frontend-design`)

---

## Princípios

1. **Não parecer AI-gerado** — sem Inter, sem Roboto, sem gradient roxo, sem layout cookie-cutter.
2. **Intencional, não decorativo** — cada escolha resolve um problema (legibilidade, hierarquia, foco).
3. **Tipografia carrega** — Geist Sans + Geist Mono fazem 80% do trabalho.
4. **Cor com propósito** — rosa Maxfem é assinatura, ink é estrutura, semânticas só pra estado.
5. **Density controlada** — informação financeira pede densidade, mas com respiro.

---

## Tipografia

**Fonte primária:** [Geist Sans](https://vercel.com/font) (Vercel)
**Fonte de números/códigos:** Geist Mono

Carregada via `next/font/google` no `src/app/layout.tsx`. As CSS vars `--font-geist-sans` e `--font-geist-mono` ficam disponíveis globalmente.

### Escala (em `tailwind.config.ts`)

| Token | Tamanho | Line-height | Letter-spacing | Uso |
|---|---|---|---|---|
| `text-micro` | 11px | 14 | +0.02em | Labels, eyebrows, badges |
| `text-caption` | 12px | 16 | +0.01em | Meta info, timestamps |
| `text-body-sm` | 13px | 20 | 0 | Body secundário |
| `text-body` | 14px | 22 | 0 | Body default |
| `text-body-lg` | 15px | 24 | 0 | Body grande, intro |
| `text-heading-sm` | 17px | 24 | −0.005em | Subtítulos cards |
| `text-heading` | 20px | 28 | −0.01em | Seções na página |
| `text-heading-lg` | 24px | 32 | −0.015em | Page title (geralmente) |
| `text-display-sm` | 30px | 36 | −0.02em | KPI value, page title hero |
| `text-display` | 38px | 44 | −0.025em | Hero |
| `text-display-lg` | 48px | 52 | −0.03em | Marketing |

### Features

`font-feature-settings: "cv11", "ss01", "ss03"` ativa variantes do Geist com:
- `cv11`: 1 sem serifa (mais limpo em UI)
- `ss01`: alternate `a` (single-story)
- `ss03`: alternate `g` (single-story)

`.nums` + `<table>` ativam `font-variant-numeric: tabular-nums` automaticamente — números alinham por coluna.

---

## Paleta

### Pink (assinatura Maxfem)
50–900. Base é 500 (`#E94C7B`). CTA primário usa `pink-600`, hover `pink-700`. Use moderadamente — pink é destaque, não fundo.

### Ink (estrutura)
50–900. Warm gray (não cold blue-gray do Tailwind default). `ink-900` é texto, `ink-500` é muted, `ink-200` é border, `ink-100` é hover bg.

### Surface (fundos)
- `surface` (`#FAF6F1`) — fundo da página, cream off-white
- `surface-raised` (`#FFFFFF`) — cards e elementos elevados
- `surface-sunken` (`#F4F0EA`) — toolbars, table headers, sub-elevações

### Semânticas
`success`, `warning`, `danger`, `info` — escalas 50/100/500/600/700/900. Use `*-50` em backgrounds, `*-700` em texto, `*-500` em pontos/ícones.

**Regra de ouro:** não misture múltiplas escalas semânticas na mesma view a menos que estado o exija (Dashboard sim, página de cadastro normal não).

---

## Spacing

Default Tailwind (`p-4`, `gap-6`, etc). Não invente escala custom.

**Container central:** `.container-page` (max-width 6xl + px-6).

---

## Border radius

Escala compacta — sem cantos crus.

| Token | Valor | Uso |
|---|---|---|
| `rounded-xs` | 4 | Micro elementos |
| `rounded-sm` | 6 | Inputs pequenos |
| `rounded` / `rounded-md` | 8 | Default |
| `rounded-lg` | 10 | Buttons, inputs |
| `rounded-xl` | 14 | **Cards** |
| `rounded-2xl` | 20 | Modais, hero cards |
| `rounded-3xl` | 28 | Decorativo |
| `rounded-full` | ∞ | Pills, badges |

---

## Shadows

Sombras com transparência do ink (warm), nunca preto duro.

| Token | Uso |
|---|---|
| `shadow-xs` | Card padrão (1px sutil) |
| `shadow-sm` | Elementos com hover |
| `shadow` | Default elevation |
| `shadow-md` | Cards elevados, modais |
| `shadow-lg` | Dropdowns, overlays |
| `shadow-glow-pink` | Foco/ativo em ações primárias |

---

## Motion

`transition-all duration-150 ease-out-expo` é o default pra interações.

Animations:
- `animate-fade-in` — entrada de pages e cards (220ms)
- `animate-slide-up` — entrada de banners/toasts (280ms)

Hover: nunca usar `transform: scale > 1.05` em UI séria. `active:scale-[0.98]` em botões é o limite.

---

## Componentes

Importar de `@/components/ui`.

### `<Button>`
```tsx
<Button variant="primary">Ação principal</Button>      // ink-900 bg
<Button variant="pink">Destaque Maxfem</Button>        // pink-600 bg
<Button variant="secondary">Ação secundária</Button>   // border + bg branco
<Button variant="ghost">Ação discreta</Button>          // só hover bg
<Button variant="danger">Excluir</Button>               // danger-600 bg
```
Sizes: `sm` (h-8) / `md` (h-10, default) / `lg` (h-12).

### `<Card>`
```tsx
<Card padded>...</Card>                  // border + shadow-xs + p-5
<Card tone="raised" padded>...</Card>    // shadow-md
<Card tone="pink" padded>...</Card>      // pink-50 bg
<Card tone="sunken" padded>...</Card>    // surface-sunken bg
```

### `<Badge>` / `<StatusBadge>`
```tsx
<Badge tone="success" dot>Conectado</Badge>
<Badge tone="pink">Premium</Badge>
<StatusBadge status="paid" />              // mapeia status do domínio
<StatusBadge status="orphan" dot={false} />
```

### `<KpiCard>`
```tsx
<KpiCard
  label="Pago no mês"
  value="R$ 124.300,00"
  subtitle="desde 01/05"
  tone="pink"
  trend={{ value: "12%", positive: true }}
/>
```

### `<PageHeader>`
```tsx
<PageHeader
  eyebrow="Operação"
  title="Contas a pagar"
  description="Gerencie aprovações e pagamentos."
  action={<Button variant="pink">Nova CAP</Button>}
/>
```

### `<EmptyState>`
```tsx
<EmptyState
  title="Sem dados aqui"
  description="Aparecem aqui quando..."
  action={<Button>Criar primeiro</Button>}
/>
```

### Classes utility (`globals.css`)

Pra HTML puro (Server Actions, login forms): `.btn-primary`, `.btn-pink`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`, `.input-field`, `.form-label`, `.card`, `.card-padded`, `.pill`, `.pill-success`, `.pill-pink`, etc.

---

## Layout patterns

### Página admin
```tsx
<div className="container-page max-w-7xl space-y-10">
  <PageHeader title="..." />
  <section>...</section>
  <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">...</section>
</div>
```

### Tabela densa
```tsx
<Card className="overflow-hidden">
  <table className="w-full">
    <thead className="bg-surface-sunken">
      <tr>
        <th className="px-4 py-2.5 text-left text-micro font-semibold text-ink-500 uppercase tracking-wider">
          ...
        </th>
      </tr>
    </thead>
    <tbody className="divide-y divide-ink-200/60">
      <tr className="hover:bg-surface-sunken/50 transition-colors">
        <td className="px-4 py-3 text-body-sm">...</td>
      </tr>
    </tbody>
  </table>
</Card>
```

---

## Anti-patterns

❌ **NÃO use:**
- Fontes Inter, Roboto, Arial, "system-ui" como display
- `bg-white` direto — use `bg-surface-raised`
- `text-black` — use `text-ink-900`
- `border-neutral-*` — use `border-ink-*`
- Gradient roxo on white
- Rounded inteiros sem hierarquia (todo elemento com `rounded-md`)
- Sombras `shadow-2xl` decorativas
- Animações `transition-all duration-1000` (lentas)
- `text-pink-600` direto pra texto longo — use só em CTAs

✓ **Faça:**
- Tabular nums em valores monetários (`className="nums"`)
- Letter-spacing negativo em headings ≥ heading-lg
- Eyebrow + title pattern em PageHeader pra hierarquia
- Active states com sombras coloridas (`shadow-glow-pink`)
- Padding generoso em cards (p-5/p-6, não p-3)
