'use server';

import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { logAuditEvent } from '@/lib/auth/audit';
import { getCurrentOrgInfo } from '@/lib/auth/current-org';

const CreateSchema = z.object({
  organization_id: z.string().uuid(),
  bank_code: z.string().min(1).max(10),
  bank_name: z.string().min(2).max(255),
  agency: z.string().min(1).max(20),
  account_number: z.string().min(1).max(30),
  account_digit: z.string().max(5).optional().or(z.literal('')),
  account_type: z.enum(['checking', 'savings', 'payment']),
  purpose: z.enum(['main', 'dda_only', 'reserve']),
  display_name: z.string().max(255).optional().or(z.literal('')),
  notes: z.string().max(2000).optional().or(z.literal('')),
});

export type CreateState =
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | null;

export async function createBankAccountAction(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const parsed = CreateSchema.safeParse({
    organization_id: formData.get('organization_id'),
    bank_code: formData.get('bank_code'),
    bank_name: formData.get('bank_name'),
    agency: formData.get('agency'),
    account_number: formData.get('account_number'),
    account_digit: formData.get('account_digit'),
    account_type: formData.get('account_type'),
    purpose: formData.get('purpose'),
    display_name: formData.get('display_name'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]?.toString();
      if (path) fieldErrors[path] = issue.message;
    }
    return { ok: false, error: 'Dados inválidos', fieldErrors };
  }

  const supabase = await createClient();
  const org = await getCurrentOrgInfo(supabase);
  if (!org) return { ok: false, error: 'Sem acesso a organização' };

  const payload = {
    organization_id: parsed.data.organization_id,
    bank_code: parsed.data.bank_code.trim(),
    bank_name: parsed.data.bank_name.trim(),
    agency: parsed.data.agency.replace(/\D/g, ''),
    account_number: parsed.data.account_number.replace(/\D/g, ''),
    account_digit: parsed.data.account_digit?.replace(/\D/g, '') || null,
    account_type: parsed.data.account_type,
    purpose: parsed.data.purpose,
    display_name: parsed.data.display_name?.trim() || null,
    notes: parsed.data.notes?.trim() || null,
  };

  const { data: inserted, error } = await supabase
    .from('bank_accounts')
    .insert(payload)
    .select('id')
    .single();

  if (error || !inserted) {
    return { ok: false, error: error?.message ?? 'Falha ao salvar' };
  }

  await logAuditEvent(supabase, {
    action: 'bank_account.created',
    entityType: 'bank_accounts',
    entityId: inserted.id,
    afterState: payload,
    organizationId: parsed.data.organization_id,
  });

  revalidatePath('/cadastros/contas-bancarias');
  redirect('/cadastros/contas-bancarias');
}
