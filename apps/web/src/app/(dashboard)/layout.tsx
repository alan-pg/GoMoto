import { redirect } from 'next/navigation'
import { headers } from 'next/headers'

import { LayoutShell } from '@/components/layout/LayoutShell'
import { SidebarProvider } from '@/components/layout/SidebarContext'
import { Providers } from '@/providers/Providers'
import { createClient } from '@/lib/supabase/server'
import { getPlatformRole } from '@/lib/auth/platform'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { isMobileUserAgent } from '@/lib/device'

interface DashboardLayoutProps {
  children: React.ReactNode
}

function TenantSuspendedPage({ tenantName }: { tenantName: string }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bg">
      <div className="text-center max-w-md p-8">
        <h1 className="text-[20px] font-semibold text-fg mb-2">{tenantName}</h1>
        <p className="text-fg-mute text-[14px] mt-2">
          Esta empresa está temporariamente indisponível. Entre em contato com o suporte.
        </p>
      </div>
    </div>
  )
}

/** RF-021/RN-009 (Spec 0011) — acesso revogado pelo Owner/Admin do tenant. */
function AccessRevokedPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-bg">
      <div className="text-center max-w-md p-8">
        <h1 className="text-[20px] font-semibold text-fg mb-2">Acesso revogado</h1>
        <p className="text-fg-mute text-[14px] mt-2">
          Seu acesso a esta empresa foi revogado. Entre em contato com o responsável pela conta
          para restaurar o acesso.
        </p>
      </div>
    </div>
  )
}

/**
 * Separação dura de planos: platform_admin é "dono do sistema" e NÃO
 * acessa cockpit de tenant. Se o caller é platform_admin, manda direto
 * para o control plane. O caminho inverso (tenant_member tentando bater
 * em /admin/*) está bloqueado pelo (admin)/layout.tsx.
 */
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const supabase = await createClient()
  const role = await getPlatformRole(supabase)
  if (role) redirect('/admin/dashboard')

  // Confinamento de sessão mobile ao /mobile/* (ADR 0018) — o cockpit
  // desktop não é responsivo; qualquer navegação vinda de um celular real
  // (link salvo, digitação direta de URL, voltar do histórico) é
  // redirecionada pra tela adaptada em vez de renderizar a chrome quebrada
  // de Sidebar/Topbar.
  if (isMobileUserAgent(headers().get('user-agent'))) redirect('/mobile/vistorias')

  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) {
    // getCurrentTenantId() devolve null tanto pra "nunca foi membro" quanto
    // pra "acesso revogado" — get_user_tenants()/a RLS de tenant_members já
    // filtram status='active', então um revogado não enxerga a própria
    // linha por essa query. get_own_membership_status() é SECURITY DEFINER
    // e bypassa isso de propósito, só pra distinguir os dois casos aqui
    // (Spec 0011 §2.1/RF-021).
    const { data: membership } = await supabase.rpc('get_own_membership_status')
    const own = (membership as { tenant_id: string; status: string }[] | null)?.[0]
    if (own?.status === 'revoked') return <AccessRevokedPage />
    redirect('/login')
  }

  const [{ data: tenant }, { data: { user } }] = await Promise.all([
    supabase.from('tenants').select('id, name, suspended_at').eq('id', tenantId).single(),
    supabase.auth.getUser(),
  ])

  if (tenant?.suspended_at) {
    return <TenantSuspendedPage tenantName={tenant.name} />
  }

  const userName  = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? undefined
  const userEmail = user?.email ?? undefined

  return (
    <Providers>
      <SidebarProvider>
        <LayoutShell userName={userName} userEmail={userEmail}>
          {children}
        </LayoutShell>
      </SidebarProvider>
    </Providers>
  )
}
