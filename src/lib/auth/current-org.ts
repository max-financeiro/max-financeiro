/**
 * Helpers pra resolver org_id do usuário atual em Server Actions.
 *
 * Master tem acesso ao group; analyst/manager podem ter acesso direto a branch.
 * `getCurrentGroupId` sobe a hierarquia até achar o group.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabase = SupabaseClient<any, any, any>;

export type CurrentOrgInfo = {
  user_id: string;
  group_id: string;
  /** Primeira filial à qual o user tem acesso (fallback: group itself) */
  branch_id: string;
};

/**
 * Encontra o group_id ascendendo a hierarquia.
 * Retorna null se o user não tem acesso a nenhuma org.
 */
export async function getCurrentOrgInfo(
  supabase: AnySupabase,
): Promise<CurrentOrgInfo | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: accesses } = await supabase
    .from('user_org_access')
    .select('organization_id, organizations!inner(id, type, parent_id)')
    .eq('user_id', user.id)
    .is('revoked_at', null);

  if (!accesses || accesses.length === 0) return null;

  // Procura group entre os acessos diretos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const directGroup = accesses.find((a: any) => a.organizations?.type === 'group');
  if (directGroup) {
    return {
      user_id: user.id,
      group_id: directGroup.organization_id,
      branch_id: directGroup.organization_id, // group nivel — usa group como branch fallback
    };
  }

  // Não tem acesso direto ao group — pega o primeiro acesso e sobe na hierarquia
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const first = accesses[0] as any;
  const branchId = first.organization_id;
  let cur = first.organizations;
  let safety = 5;
  while (cur && cur.type !== 'group' && cur.parent_id && safety-- > 0) {
    const { data: parent } = await supabase
      .from('organizations')
      .select('id, type, parent_id')
      .eq('id', cur.parent_id)
      .maybeSingle();
    cur = parent;
  }
  if (!cur || cur.type !== 'group') return null;

  return {
    user_id: user.id,
    group_id: cur.id,
    branch_id: branchId,
  };
}
