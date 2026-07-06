import { redirect } from 'next/navigation'
import { Building2, LayoutDashboard, LogOut, ShieldCheck, UsersRound } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { getPlatformRole } from '@/lib/auth/platform'
import { Providers } from '@/providers/Providers'
import { Topbar } from '@/components/layout/Topbar'
import { AdminNav } from './AdminNav'

interface AdminLayoutProps {
  children: React.ReactNode
}

/**
 * Layout do control plane (área administrativa da plataforma).
 * Separado do (dashboard) do tenant para não vazar sidebar/branding entre
 * os universos. Gate em Server Component redireciona quem não é
 * platform_admin antes de qualquer render — o reforço real (RLS) está
 * nas policies `platform_admin_*` do banco.
 */
export default async function AdminLayout({ children }: AdminLayoutProps) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const role = await getPlatformRole(supabase)
  if (!role) redirect('/dashboard')

  const userName  = user?.user_metadata?.full_name ?? user?.user_metadata?.name ?? undefined
  const userEmail = user?.email ?? undefined

  return (
    <Providers>
      <div className="flex min-h-screen bg-[#0d0d0d]">
          <aside className="w-[240px] border-r border-[#323232] bg-[#121212] p-4 flex flex-col shrink-0">
            <div className="flex items-center gap-2 mb-6">
              <div className="w-9 h-9 rounded-lg bg-[#BAFF1A] flex items-center justify-center">
                <ShieldCheck className="w-5 h-5 text-[#121212]" />
              </div>
              <div>
                <div className="text-[15px] font-semibold text-[#f5f5f5] leading-tight">GoMoto</div>
                <div className="text-[11px] text-[#9e9e9e]">Admin da plataforma</div>
              </div>
            </div>

            <AdminNav
              items={[
                { href: '/admin/dashboard',       label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
                { href: '/admin/empresas',         label: 'Empresas',  icon: <Building2 className="w-4 h-4" /> },
                { href: '/admin/platform-admins',  label: 'Admins',    icon: <UsersRound className="w-4 h-4" /> },
              ]}
            />

            <div className="border-t border-[#323232] pt-3 space-y-1">
              <form action="/auth/logout" method="post">
                <button
                  type="submit"
                  className="flex items-center gap-2 w-full px-3 h-10 rounded-lg text-[13px] text-[#c7c7c7] hover:bg-[#7c1c1c] hover:text-[#ff9c9a] transition"
                >
                  <LogOut className="w-4 h-4" /> Sair
                </button>
              </form>
            </div>
          </aside>

          <div className="flex-1 flex flex-col min-h-screen">
            <Topbar userName={userName} userEmail={userEmail} />
            <main className="flex-1 overflow-y-auto">{children}</main>
          </div>
        </div>
    </Providers>
  )
}
