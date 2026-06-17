import { redirect } from 'next/navigation'

import { Sidebar } from '@/components/layout/Sidebar'
import { Providers } from '@/providers/Providers'
import { createClient } from '@/lib/supabase/server'
import { getPlatformRole } from '@/lib/auth/platform'

interface DashboardLayoutProps {
  children: React.ReactNode
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

  return (
    <Providers>
      <div className="flex min-h-screen bg-[#121212]">
        <Sidebar />
        <main className="flex-1 pl-[85px] min-h-screen overflow-auto">
          {children}
        </main>
      </div>
    </Providers>
  )
}
