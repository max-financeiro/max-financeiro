import { redirect } from 'next/navigation';

// Rota antiga do roadmap original. A conciliação bancária real foi entregue
// em /caixa/conciliacao (Sprint 7-B). Mantemos redirect pra não quebrar
// bookmarks antigos.
export default function ConciliacaoBancariaPage() {
  redirect('/caixa/conciliacao');
}
