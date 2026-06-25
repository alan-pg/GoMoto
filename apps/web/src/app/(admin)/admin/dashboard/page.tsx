import { Building2, Bike, FileText, Users } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { Badge } from '@/components/ui/Badge'

export const dynamic = 'force-dynamic'

type TenantRow = {
  id: string
  name: string
  slug: string
  suspended_at: string | null
}

type TenantRollup = TenantRow & {
  customers: number
  contracts_active: number
  motorcycles: number
}

async function loadDashboard() {
  await requirePlatformAdmin()
  const supabase = await createClient()

  // platform_admin_bypass_* deixa esses counts cruzarem o universo todo.
  // Cinco queries paralelas porque PostgREST não suporta GROUP BY agregado
  // direto; em 100+ tenants, migrar para uma view materializada.
  const [tenantsRes, customersRes, contractsRes, motorcyclesRes] = await Promise.all([
    supabase
      .from('tenants')
      .select('id, name, slug, suspended_at')
      .order('name', { ascending: true }),
    supabase.from('customers').select('tenant_id'),
    supabase.from('rentals').select('tenant_id').eq('status', 'active'),
    supabase.from('motorcycles').select('tenant_id'),
  ])

  const tenants = (tenantsRes.data ?? []) as TenantRow[]
  const tally = (rows: { tenant_id: string }[] | null) => {
    const map = new Map<string, number>()
    for (const r of rows ?? []) {
      map.set(r.tenant_id, (map.get(r.tenant_id) ?? 0) + 1)
    }
    return map
  }

  const customersByTenant = tally(customersRes.data)
  const contractsByTenant = tally(contractsRes.data)
  const motorcyclesByTenant = tally(motorcyclesRes.data)

  const rollups: TenantRollup[] = tenants.map((t) => ({
    ...t,
    customers: customersByTenant.get(t.id) ?? 0,
    contracts_active: contractsByTenant.get(t.id) ?? 0,
    motorcycles: motorcyclesByTenant.get(t.id) ?? 0,
  }))

  const kpis = {
    tenants_active: tenants.filter((t) => !t.suspended_at).length,
    tenants_suspended: tenants.filter((t) => !!t.suspended_at).length,
    customers_total: customersRes.data?.length ?? 0,
    contracts_active: contractsRes.data?.length ?? 0,
    motorcycles_total: motorcyclesRes.data?.length ?? 0,
  }

  return { rollups, kpis }
}

export default async function AdminDashboardPage() {
  const { rollups, kpis } = await loadDashboard()

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6">
        <h1 className="text-[24px] font-semibold text-[#f5f5f5]">Dashboard da plataforma</h1>
        <p className="text-[13px] text-[#9e9e9e] mt-1">
          Visão consolidada das locadoras cadastradas. Números agregam todas as empresas.
        </p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <KpiCard
          icon={<Building2 className="w-5 h-5 text-[#BAFF1A]" />}
          label="Empresas ativas"
          value={kpis.tenants_active}
          sub={kpis.tenants_suspended > 0 ? `+ ${kpis.tenants_suspended} suspensas` : 'nenhuma suspensa'}
        />
        <KpiCard
          icon={<Users className="w-5 h-5 text-[#BAFF1A]" />}
          label="Clientes na plataforma"
          value={kpis.customers_total}
        />
        <KpiCard
          icon={<FileText className="w-5 h-5 text-[#BAFF1A]" />}
          label="Contratos ativos"
          value={kpis.contracts_active}
        />
        <KpiCard
          icon={<Bike className="w-5 h-5 text-[#BAFF1A]" />}
          label="Motos cadastradas"
          value={kpis.motorcycles_total}
        />
      </section>

      <section>
        <h2 className="text-[16px] font-semibold text-[#f5f5f5] mb-3">Por empresa</h2>
        <div className="rounded-xl border border-[#323232] overflow-hidden bg-[#181818]">
          <table className="w-full text-left">
            <thead className="bg-[#202020] text-[12px] uppercase tracking-wide text-[#9e9e9e]">
              <tr>
                <th className="px-4 py-3 font-medium">Empresa</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium text-right">Clientes</th>
                <th className="px-4 py-3 font-medium text-right">Contratos ativos</th>
                <th className="px-4 py-3 font-medium text-right">Motos</th>
              </tr>
            </thead>
            <tbody>
              {rollups.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-[#9e9e9e] text-[14px]">
                    Nenhuma empresa cadastrada.
                  </td>
                </tr>
              ) : (
                rollups.map((row) => (
                  <tr key={row.id} className="border-t border-[#323232]">
                    <td className="px-4 py-3 text-[#f5f5f5] text-[14px]">
                      <div className="font-medium">{row.name}</div>
                      <div className="text-[11px] text-[#9e9e9e] font-mono">{row.slug}</div>
                    </td>
                    <td className="px-4 py-3">
                      {row.suspended_at ? (
                        <Badge variant="danger">Suspensa</Badge>
                      ) : (
                        <Badge variant="success">Ativa</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-[#f5f5f5] text-[14px]">
                      {row.customers}
                    </td>
                    <td className="px-4 py-3 text-right text-[#f5f5f5] text-[14px]">
                      {row.contracts_active}
                    </td>
                    <td className="px-4 py-3 text-right text-[#f5f5f5] text-[14px]">
                      {row.motorcycles}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: number
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-[#323232] bg-[#181818] p-4">
      <div className="flex items-center gap-2 text-[#9e9e9e] text-[12px] uppercase tracking-wide">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-[28px] font-semibold text-[#f5f5f5] leading-none">
        {value}
      </div>
      {sub ? <div className="mt-1 text-[12px] text-[#9e9e9e]">{sub}</div> : null}
    </div>
  )
}
