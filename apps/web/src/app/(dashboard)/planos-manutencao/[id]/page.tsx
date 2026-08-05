import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import type { MaintenancePlan, MaintenancePlanItem } from '@gomoto/core'
import { CloneButton } from '../_components/CloneButton'

function formatInterval(item: MaintenancePlanItem): string {
  const parts: string[] = []
  if (item.interval_km) parts.push(`${item.interval_km.toLocaleString('pt-BR')} km`)
  if (item.interval_days) parts.push(`${item.interval_days} dias`)
  return parts.join(' • ') || '—'
}

export default async function MaintenancePlanDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [planResult, itemsResult, vehiclesResult] = await Promise.all([
    supabase.from('maintenance_plans').select('*').eq('id', id).maybeSingle(),
    supabase
      .from('maintenance_plan_items')
      .select('*')
      .eq('plan_id', id)
      .order('sort_order', { ascending: true }),
    supabase
      .from('vehicles')
      .select('*', { count: 'exact', head: true })
      .eq('maintenance_plan_id', id),
  ])

  if (!planResult.data) notFound()

  const plan         = planResult.data as MaintenancePlan
  const items        = (itemsResult.data ?? []) as MaintenancePlanItem[]
  const isArchived   = plan.archived_at !== null
  const vehicleCount = vehiclesResult.count ?? 0

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-16 flex items-center gap-4">
        <Link
          href="/planos-manutencao"
          className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors whitespace-nowrap"
        >
          ← Planos de manutenção
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="text-[18px] font-bold text-[#f5f5f5] truncate flex-1">{plan.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <CloneButton planId={id} planName={plan.name} />
          <Link
            href={`/planos-manutencao/${id}/editar`}
            className="inline-flex items-center h-9 px-4 rounded-full bg-[#323232] text-[#f5f5f5] text-[13px] font-medium hover:bg-[#474747] transition-colors"
          >
            Editar plano
          </Link>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-4xl mx-auto">

        {/* Meta */}
        <section>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {plan.is_default && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-[#1a2700] text-[#BAFF1A] border border-[#BAFF1A]/30">
                Padrão
              </span>
            )}
            {isArchived && (
              <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-[#1a1a1a] text-[#9e9e9e] border border-[#474747]">
                Arquivado
              </span>
            )}
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-[#1a1a1a] text-[#9e9e9e] border border-[#2a2a2a]">
              {vehicleCount} {vehicleCount === 1 ? 'veículo' : 'veículos'}
            </span>
            <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[12px] font-medium bg-[#1a1a1a] text-[#9e9e9e] border border-[#2a2a2a]">
              {items.length} {items.length === 1 ? 'item' : 'itens'}
            </span>
          </div>
          {plan.description && (
            <p className="text-[13px] text-[#9e9e9e] leading-relaxed">{plan.description}</p>
          )}
        </section>

        {/* Itens */}
        <section>
          <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Itens do plano</h2>
          <div className="bg-[#202020] rounded-xl overflow-hidden">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-[13px] text-[#9e9e9e]">
                  Nenhum item —{' '}
                  <Link href={`/planos-manutencao/${id}/editar`} className="text-[#BAFF1A] hover:underline">
                    edite o plano
                  </Link>{' '}
                  para adicionar.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-[13px]">
                <thead className="border-b border-[#323232]">
                  <tr>
                    <th className="h-9 px-4 text-[#9e9e9e] font-medium w-8">#</th>
                    <th className="h-9 px-4 text-[#9e9e9e] font-medium">Item</th>
                    <th className="h-9 px-4 text-[#9e9e9e] font-medium">Intervalo</th>
                    <th className="h-9 px-4 text-[#9e9e9e] font-medium hidden sm:table-cell">Alerta</th>
                    <th className="h-9 px-4 text-[#9e9e9e] font-medium hidden sm:table-cell">Crítico</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={item.id} className="h-9 border-b border-[#323232] last:border-0">
                      <td className="px-4 text-[#616161] font-mono text-[12px]">{idx + 1}</td>
                      <td className="px-4">
                        <p className="font-medium text-[#f5f5f5]">{item.name}</p>
                        {item.tip && (
                          <p className="text-[11px] text-[#616161] leading-tight">{item.tip}</p>
                        )}
                      </td>
                      <td className="px-4 text-[#f5f5f5]">{formatInterval(item)}</td>
                      <td className="px-4 text-[#9e9e9e] hidden sm:table-cell">
                        {item.warn_threshold_pct != null ? `${item.warn_threshold_pct}%` : '—'}
                      </td>
                      <td className="px-4 hidden sm:table-cell">
                        {item.is_critical ? (
                          <span className="text-[12px] font-medium text-[#ff9c9a]">Crítico</span>
                        ) : (
                          <span className="text-[#616161]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Veículos */}
        {vehicleCount > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[14px] font-bold text-[#BAFF1A]">
                Veículos com este plano{' '}
                <span className="text-[12px] font-normal text-[#9e9e9e]">({vehicleCount})</span>
              </h2>
              <Link href="/veiculos" className="text-[12px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors">
                Ver frota →
              </Link>
            </div>
            <p className="text-[13px] text-[#616161]">
              {vehicleCount} {vehicleCount === 1 ? 'veículo utiliza' : 'veículos utilizam'} este plano.
              Acesse a frota para visualizá-los.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
