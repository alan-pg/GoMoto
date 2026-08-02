import { filterMaintenancesInRentalPeriod } from '@gomoto/core'
import { formatCurrency } from '@/lib/utils'
import { getRentalCore } from '../_lib/get-rental-core'
import { fmt, MAINTENANCE_STATUS_BADGE, MAINTENANCE_TYPE_LABEL } from '../_lib/shared'

type MaintenanceRow = {
  id: string
  vehicle_id: string
  type: 'preventive' | 'corrective' | 'inspection'
  description: string
  scheduled_date: string | null
  completed_date: string | null
  cost: number | null
  completed: boolean
}

export default async function RentalMaintenanceTab({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { rental, tenantId, supabase } = await getRentalCore(id)

  // Não existe FK maintenances→rentals — a associação é inferida por
  // veículo + período (RN nova, ver filterMaintenancesInRentalPeriod em
  // @gomoto/core e obsidian-notes/Telas/Locações.md).
  const { data } = rental.vehicle_id
    ? await supabase
        .from('maintenances')
        .select('id, vehicle_id, type, description, scheduled_date, completed_date, cost, completed')
        .eq('tenant_id', tenantId)
        .eq('vehicle_id', rental.vehicle_id)
        .order('scheduled_date', { ascending: true })
    : { data: [] as MaintenanceRow[] }

  const maintenances = filterMaintenancesInRentalPeriod((data ?? []) as MaintenanceRow[], rental)

  if (maintenances.length === 0) {
    return (
      <div className="flex items-center justify-center rounded-xl bg-[#202020] py-10">
        <p className="text-[13px] text-[#616161]">Nenhuma manutenção registrada no período desta locação.</p>
      </div>
    )
  }

  return (
    <section>
      <div className="overflow-hidden rounded-xl border border-[#323232] bg-[#1a1a1a]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#323232]">
              <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Descrição</th>
              <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Tipo</th>
              <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Data</th>
              <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Custo</th>
              <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
            </tr>
          </thead>
          <tbody>
            {maintenances.map((m) => {
              const badge = m.completed ? MAINTENANCE_STATUS_BADGE.completed : MAINTENANCE_STATUS_BADGE.pending
              return (
                <tr key={m.id} className="h-9 border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                  <td className="px-4 text-[#f5f5f5]">{m.description}</td>
                  <td className="px-4 text-[#9e9e9e]">{MAINTENANCE_TYPE_LABEL[m.type] ?? '—'}</td>
                  <td className="px-4 text-[#c7c7c7]">{fmt(m.completed_date ?? m.scheduled_date)}</td>
                  <td className="px-4 text-right font-mono text-[#f5f5f5]">
                    {m.cost != null ? formatCurrency(m.cost) : '—'}
                  </td>
                  <td className="px-4">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                      {badge.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
