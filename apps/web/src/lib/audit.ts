import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'

interface AuditParams {
  action: 'create' | 'update' | 'delete'
    | 'connect_payment' | 'disconnect_payment'
    | 'generate_pix' | 'payment_confirmed' | 'token_refreshed'
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

    const tenantId = await getCurrentTenantId(supabase)
    if (!tenantId) return

    await supabase.from('audit_logs').insert({
      tenant_id: tenantId,
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

export async function logPlatformAction(
  supabase: SupabaseClient,
  actorId: string,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await supabase.from('platform_audit_logs').insert({
      actor_id: actorId,
      action,
      target_type: targetType,
      target_id: targetId,
      metadata,
    })
  } catch (err) {
    console.error('[PLATFORM AUDIT ERROR]', err)
  }
}
