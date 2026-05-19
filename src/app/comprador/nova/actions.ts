'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export async function createBuyerRequestAction(formData: FormData): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Não autenticado');

  const organizationId = String(formData.get('organization_id') ?? '');
  const supplierId = String(formData.get('supplier_id') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  const dueDate = String(formData.get('due_date') ?? '');
  const issueDate = String(formData.get('issue_date') ?? dueDate);
  const competenceDate = String(formData.get('competence_date') ?? dueDate);
  const description = String(formData.get('description') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim();
  const paymentMethod = String(formData.get('payment_method') ?? 'pix');

  if (!organizationId || !supplierId || !amount || !dueDate || !description) {
    throw new Error('Preencha todos os campos obrigatórios');
  }
  if (amount <= 0) throw new Error('Valor deve ser positivo');

  const submit = formData.get('submit') === '1';

  const payload = {
    organization_id: organizationId,
    supplier_id: supplierId,
    buyer_id: user.id,
    created_by: user.id,
    amount,
    issue_date: issueDate,
    due_date: dueDate,
    competence_date: competenceDate,
    payment_method: paymentMethod,
    status: submit ? 'submitted' : 'draft',
    source: 'manual' as const,
    description,
    tags: category ? [category] : null,
    submitted_by: submit ? user.id : null,
    submitted_at: submit ? new Date().toISOString() : null,
  };

  // buyer_id ainda não está no schema gerado dos types; bypass localizado.
  const { data, error } = await supabase
    .from('accounts_payable')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .insert(payload as any)
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  revalidatePath('/comprador');
  redirect(`/comprador/${data.id}`);
}
