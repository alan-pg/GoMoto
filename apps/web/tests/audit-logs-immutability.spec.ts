import { test, expect } from '@playwright/test'
import { TEST_TAG, getSupabase, getSupabaseAdmin, getTestTenantId } from './helpers'

// RNF-005 — audit_logs precisa ser imutável (nem Owner edita/apaga). Chamada
// direta à API via client Supabase autenticado, não interação de UI — a
// garantia é RLS no banco (Spec 0011 §6.3), não uma checagem de tela.
test.describe('audit_logs — imutabilidade (RNF-005)', () => {
  test('Owner do tenant não consegue UPDATE nem DELETE em audit_logs', async () => {
    const admin = getSupabaseAdmin()
    const tenantId = await getTestTenantId()
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 })
    const ownerId = users.users.find((u) => u.email === 'empresa01@teste.com')!.id

    const { data: inserted, error: insertErr } = await admin
      .from('audit_logs')
      .insert({
        tenant_id: tenantId,
        user_id: ownerId,
        action: 'create',
        table_name: 'e2e_immutability_test',
        new_data: { note: TEST_TAG },
      })
      .select('id')
      .single()
    expect(insertErr).toBeNull()

    const sb = await getSupabase() // autenticado como empresa01@teste.com (Owner), via anon key

    const { data: updateResult, error: updateErr } = await sb
      .from('audit_logs')
      .update({ table_name: 'tampered' })
      .eq('id', inserted!.id)
      .select()
    expect(updateErr).toBeNull()
    expect(updateResult).toEqual([]) // RLS bloqueia — 0 linhas afetadas, sem erro explícito

    const { data: deleteResult, error: deleteErr } = await sb
      .from('audit_logs')
      .delete()
      .eq('id', inserted!.id)
      .select()
    expect(deleteErr).toBeNull()
    expect(deleteResult).toEqual([])

    const { data: stillThere } = await admin
      .from('audit_logs')
      .select('table_name')
      .eq('id', inserted!.id)
      .single()
    expect(stillThere?.table_name).toBe('e2e_immutability_test')

    await admin.from('audit_logs').delete().eq('id', inserted!.id)
  })
})
