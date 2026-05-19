import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const {
    organization_id,
    cost_center_id,
    account_id,
    amount,
    competence_date,
    exclude_payable_id,
  } = body;

  if (!organization_id || !amount || !competence_date) {
    return NextResponse.json({ error: 'Faltam campos obrigatórios' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 });

  // RPC nova ainda não regenerada nos types — bypass localizado.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('check_budget_available', {
    p_organization_id: organization_id,
    p_cost_center_id: cost_center_id || null,
    p_account_id: account_id || null,
    p_amount: amount,
    p_competence_date: competence_date,
    p_exclude_payable_id: exclude_payable_id || null,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
