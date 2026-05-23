/**
 * tests/rls/supplier-isolation.test.ts
 * Testa isolamento RLS entre fornecedores.
 *
 * Garante que Fornecedor A nunca vê dados do Fornecedor B.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
}

describe('RLS Supplier Isolation — Sprint 4b', () => {
  let supplierAUser: any;
  let supplierBUser: any;
  let supplierAId: string;
  let supplierBId: string;
  let fiscalDocAId: string;
  let orgId: string;

  beforeAll(async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cria organização de teste (schema atual: type=group + legal_name)
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({
        type: 'group',
        legal_name: `Test Org RLS ${Date.now()}`,
        cnpj: `${Date.now()}`.slice(-14).padStart(14, '0'),
      })
      .select()
      .single();

    if (orgError) throw new Error(`Erro ao criar org: ${orgError.message}`);
    orgId = org.id;

    // Cria 2 usuários fornecedores de teste
    const { data: userA, error: errorA } = await supabase.auth.admin.createUser({
      email: `supplier-a-${Date.now()}@test.com`,
      password: 'Test123!@#',
      email_confirm: true,
    });

    if (errorA) throw new Error(`Erro ao criar usuário A: ${errorA.message}`);
    supplierAUser = userA.user;

    const { data: userB, error: errorB } = await supabase.auth.admin.createUser({
      email: `supplier-b-${Date.now()}@test.com`,
      password: 'Test123!@#',
      email_confirm: true,
    });

    if (errorB) throw new Error(`Erro ao criar usuário B: ${errorB.message}`);
    supplierBUser = userB.user;

    // Cria business_partners
    const { data: bpA, error: bpAError } = await supabase
      .from('business_partners')
      .insert({
        group_id: orgId,
        partner_type: 'supplier',
        document_type: 'cnpj',
        document: '11111111000111',
        legal_name: 'Fornecedor A Test',
        supplier_user_id: supplierAUser.id,
        status: 'active',
      })
      .select()
      .single();

    if (bpAError) throw new Error(`Erro ao criar BP A: ${bpAError.message}`);
    supplierAId = bpA.id;

    const { data: bpB, error: bpBError } = await supabase
      .from('business_partners')
      .insert({
        group_id: orgId,
        partner_type: 'supplier',
        document_type: 'cnpj',
        document: '22222222000222',
        legal_name: 'Fornecedor B Test',
        supplier_user_id: supplierBUser.id,
        status: 'active',
      })
      .select()
      .single();

    if (bpBError) throw new Error(`Erro ao criar BP B: ${bpBError.message}`);
    supplierBId = bpB.id;

    // Cria perfis de usuário (role=supplier). full_name é NOT NULL.
    const { error: profErr } = await supabase.from('user_profiles').insert([
      { user_id: supplierAUser.id, role: 'supplier', full_name: 'Fornecedor A Test' },
      { user_id: supplierBUser.id, role: 'supplier', full_name: 'Fornecedor B Test' },
    ]);
    if (profErr) throw new Error(`Erro ao criar user_profiles: ${profErr.message}`);

    // Cria uma NF do fornecedor A
    const { data: fiscalDoc, error: fiscalError } = await supabase
      .from('fiscal_documents')
      .insert({
        organization_id: orgId,
        direction: 'inbound',
        document_type: 'nfe',
        number: '12345',
        series: '1',
        access_key: '12345678901234567890123456789012345678901234',
        issue_date: '2024-05-17',
        competence_date: '2024-05-17',
        issuer_document: '11111111000111',
        issuer_name: 'Fornecedor A Test',
        recipient_document: '00000000000191',
        recipient_name: 'Test Org RLS',
        total_amount: 1000.00,
        source: 'supplier_portal',
        status: 'received',
        created_by: supplierAUser.id,
      })
      .select()
      .single();

    if (fiscalError) throw new Error(`Erro ao criar fiscal_document: ${fiscalError.message}`);
    fiscalDocAId = fiscalDoc.id;
  });

  it('Fornecedor A vê suas próprias NFs', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Sign in como fornecedor A
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: supplierAUser.email,
      password: 'Test123!@#',
    });

    if (signInError) throw new Error(`Erro sign in A: ${signInError.message}`);

    const { data, error } = await supabase
      .from('fiscal_documents')
      .select('id')
      .eq('id', fiscalDocAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data?.[0]?.id).toBe(fiscalDocAId);
  });

  it('Fornecedor B NÃO vê NFs do fornecedor A (RLS bloqueia)', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    // Sign in como fornecedor B
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: supplierBUser.email,
      password: 'Test123!@#',
    });

    if (signInError) throw new Error(`Erro sign in B: ${signInError.message}`);

    const { data, error } = await supabase
      .from('fiscal_documents')
      .select('id')
      .eq('id', fiscalDocAId);

    // RLS deve bloquear — data deve ser vazia
    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it('Fornecedor B não consegue UPDATE em NF do fornecedor A', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    await supabase.auth.signInWithPassword({
      email: supplierBUser.email,
      password: 'Test123!@#',
    });

    const { data: updated } = await supabase
      .from('fiscal_documents')
      .update({ status: 'cancelled' })
      .eq('id', fiscalDocAId)
      .select('id');

    // RLS bloqueia: o row é invisível pro B, então o WHERE casa 0 rows.
    // Supabase devolve data=[] sem erro. O importante: nada foi alterado.
    expect(updated ?? []).toHaveLength(0);

    // Confirma com service_role que o status original não mudou.
    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: untouched } = await admin
      .from('fiscal_documents')
      .select('status')
      .eq('id', fiscalDocAId)
      .single();
    expect(untouched?.status).toBe('received');
  });

  it('Fornecedor B não consegue DELETE em NF do fornecedor A', async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    await supabase.auth.signInWithPassword({
      email: supplierBUser.email,
      password: 'Test123!@#',
    });

    const { data: deleted } = await supabase
      .from('fiscal_documents')
      .delete()
      .eq('id', fiscalDocAId)
      .select('id');

    // Mesmo padrão: RLS torna o row invisível, DELETE não casa nada.
    expect(deleted ?? []).toHaveLength(0);

    // Confirma com service_role que a NF continua existindo.
    const admin = createClient(supabaseUrl, supabaseServiceKey);
    const { data: stillThere } = await admin
      .from('fiscal_documents')
      .select('id')
      .eq('id', fiscalDocAId)
      .maybeSingle();
    expect(stillThere?.id).toBe(fiscalDocAId);
  });

  afterAll(async () => {
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Cleanup (ordem inversa de dependências)
    await supabase.from('fiscal_documents').delete().eq('id', fiscalDocAId);
    await supabase.from('user_profiles').delete().eq('user_id', supplierAUser.id);
    await supabase.from('user_profiles').delete().eq('user_id', supplierBUser.id);
    await supabase.from('business_partners').delete().eq('id', supplierAId);
    await supabase.from('business_partners').delete().eq('id', supplierBId);
    await supabase.auth.admin.deleteUser(supplierAUser.id);
    await supabase.auth.admin.deleteUser(supplierBUser.id);
    await supabase.from('organizations').delete().eq('id', orgId);
  });
});
