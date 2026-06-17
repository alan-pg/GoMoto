import { requirePlatformAdmin } from '@/lib/auth/platform'
import { PlatformAdminsClient, type PlatformAdminRow } from './PlatformAdminsClient'

export const dynamic = 'force-dynamic'

export default async function PlatformAdminsPage() {
  const ctx = await requirePlatformAdmin()

  // list_platform_admins SECURITY DEFINER junta auth.users e retorna email/nome.
  const { data, error } = await ctx.supabase.rpc('list_platform_admins')

  const rows: PlatformAdminRow[] = (data ?? []) as PlatformAdminRow[]

  return (
    <PlatformAdminsClient
      initialRows={rows}
      loadError={error?.message ?? null}
      currentUserId={ctx.userId}
      currentRole={ctx.role}
    />
  )
}
