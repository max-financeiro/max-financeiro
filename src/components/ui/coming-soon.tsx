import { Badge, Card } from './';

export interface ComingSoonProps {
  features: string[];
  sprint?: string;
  blockedBy?: string;
}

/**
 * Stub guiado pra páginas ainda em desenvolvimento.
 * Mostra roadmap concreto em vez de só "em construção".
 */
export function ComingSoon({ features, sprint, blockedBy }: ComingSoonProps) {
  return (
    <Card padded className="bg-pink-50/30 border-pink-100">
      <div className="flex items-start gap-3 mb-4">
        <span className="shrink-0 w-9 h-9 rounded-full bg-pink-100 text-pink-700 flex items-center justify-center font-semibold">
          ✦
        </span>
        <div className="flex-1">
          <h3 className="text-heading-sm font-semibold text-ink-900">Em desenvolvimento</h3>
          <p className="text-body-sm text-ink-600 mt-1">
            Esta seção está no roadmap.{' '}
            {sprint && (
              <>
                Implementação prevista <Badge tone="pink">{sprint}</Badge>.{' '}
              </>
            )}
            {blockedBy && (
              <>Bloqueada por: <Badge tone="warning">{blockedBy}</Badge></>
            )}
          </p>
        </div>
      </div>

      <div>
        <p className="text-micro font-semibold uppercase tracking-wider text-ink-500 mb-2">
          O que vai ter aqui
        </p>
        <ul className="text-body-sm text-ink-700 space-y-1.5">
          {features.map((f) => (
            <li key={f} className="flex items-start gap-2">
              <span className="text-pink-500 mt-0.5 shrink-0">›</span>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
