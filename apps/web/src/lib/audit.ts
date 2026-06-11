import { createClient } from '@/lib/supabase/server'

interface AuditParams {
  action: 'create' | 'update' | 'delete'
  table: string
  recordId?: string
  oldData?: unknown
  newData?: unknown
}

export async function logAction(params: AuditParams): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    await supabase.from('audit_logs').insert({
      user_id: user.id,
      action: params.action,
      table_name: params.table,
      record_id: params.recordId ?? null,
      old_data: params.oldData ?? null,
      new_data: params.newData ?? null,
    })
  } catch (err) {
    console.error('[AUDIT ERROR]', err)
  }
}
