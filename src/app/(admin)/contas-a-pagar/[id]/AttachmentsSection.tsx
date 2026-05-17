import { createClient } from '@/lib/supabase/server';
// SERVICE_ROLE: gerar signed URLs sem expor service key ao client.
// eslint-disable-next-line no-restricted-imports
import { getAdminClient } from '@/lib/supabase/admin';
import { Badge } from '@/components/ui';
import { UploadAttachmentForm } from './UploadAttachmentForm';
import { DeleteAttachmentButton } from './DeleteAttachmentButton';

const KIND_LABEL: Record<string, string> = {
  nfe_xml: 'XML NF-e',
  nfe_pdf: 'PDF NF-e',
  boleto_pdf: 'Boleto',
  invoice: 'Fatura',
  receipt: 'Recibo',
  contract: 'Contrato',
  other: 'Outro',
};

const KIND_TONE: Record<string, Parameters<typeof Badge>[0]['tone']> = {
  nfe_xml: 'info',
  nfe_pdf: 'info',
  boleto_pdf: 'warning',
  invoice: 'pink',
  receipt: 'success',
  contract: 'neutral',
  other: 'neutral',
};

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export async function AttachmentsSection({
  payableId,
  canDelete,
}: {
  payableId: string;
  canDelete: boolean;
}) {
  const supabase = await createClient();

  const { data: attachments } = await supabase
    .from('accounts_payable_attachments')
    .select('id, storage_path, file_name, mime_type, size_bytes, kind, source, uploaded_at, ai_extraction')
    .eq('accounts_payable_id', payableId)
    .is('deleted_at', null)
    .order('uploaded_at', { ascending: false });

  // Signed URLs (1 hora) — geradas via service_role pra evitar expor RLS storage
  const admin = getAdminClient();
  const items = await Promise.all(
    (attachments ?? []).map(async (a) => {
      const { data: signed } = await admin.storage
        .from('cap-attachments')
        .createSignedUrl(a.storage_path, 3600);
      return { ...a, signedUrl: signed?.signedUrl ?? null };
    }),
  );

  return (
    <section className="bg-surface-raised border border-ink-200/60 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div>
          <h2 className="text-heading-sm font-semibold text-ink-900">Anexos</h2>
          <p className="text-caption text-ink-500 mt-0.5">
            XML NF-e, boleto, fatura e outros documentos da CAP.
          </p>
        </div>
        <Badge tone="neutral">{items.length}</Badge>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-200 px-4 py-8 text-center">
          <p className="text-body-sm text-ink-500">Nenhum anexo ainda.</p>
        </div>
      ) : (
        <ul className="space-y-2 mb-4">
          {items.map((a) => {
            const aiAmount =
              a.ai_extraction && typeof a.ai_extraction === 'object' && a.ai_extraction !== null
                ? (a.ai_extraction as { amount?: number }).amount
                : undefined;
            return (
              <li
                key={a.id}
                className="flex items-center gap-3 rounded-lg border border-ink-200/60 bg-surface px-3 py-2.5 hover:border-ink-300 transition-colors"
              >
                <span className="shrink-0 w-9 h-9 rounded-md bg-ink-100 flex items-center justify-center text-caption font-semibold text-ink-700">
                  {a.mime_type.includes('xml') ? 'XML' : a.mime_type.includes('pdf') ? 'PDF' : 'IMG'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-body-sm font-medium text-ink-900 truncate">{a.file_name}</p>
                    <Badge tone={KIND_TONE[a.kind] ?? 'neutral'}>
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </Badge>
                    {a.source === 'ai_import' && <Badge tone="pink">✦ IA</Badge>}
                  </div>
                  <p className="text-caption text-ink-500 mt-0.5 nums">
                    {fmtSize(a.size_bytes)} · enviado{' '}
                    {new Date(a.uploaded_at).toLocaleString('pt-BR')}
                    {aiAmount != null && (
                      <> · IA leu R$ {aiAmount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {a.signedUrl && (
                    <a
                      href={a.signedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-caption font-medium text-pink-700 hover:text-pink-800"
                    >
                      Abrir →
                    </a>
                  )}
                  {canDelete && <DeleteAttachmentButton attachmentId={a.id} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <UploadAttachmentForm payableId={payableId} />
    </section>
  );
}
