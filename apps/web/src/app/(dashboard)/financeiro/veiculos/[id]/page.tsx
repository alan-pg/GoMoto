import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'
import { VehicleFinancialActions } from './_components/VehicleFinancialActions'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function VehicleROIPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [vehicleResult, paidBillingsResult, maintenanceCostResult, fineCostResult] = await Promise.all([
    supabase
      .from('vehicles')
      .select('id, license_plate, make, model, year_manufacture, color, acquisition_value, sale_value, sold_at, created_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    // Receita total: cobranças pagas vinculadas a este veículo — caução fica
    // de fora, é garantia/depósito, não receita operacional.
    supabase
      .from('billings')
      .select('original_amount, discount_amount, source, due_date')
      .eq('vehicle_id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'paid')
      .neq('source', 'deposit'),
    // Custo: manutenções finalizadas
    supabase
      .from('maintenances')
      .select('cost, completed_at, description')
      .eq('vehicle_id', id)
      .eq('tenant_id', tenantId)
      .not('cost', 'is', null)
      .order('completed_at', { ascending: false }),
    // Custo: multas pagas (company responsible)
    supabase
      .from('fines')
      .select('amount, payment_date, description')
      .eq('vehicle_id', id)
      .eq('tenant_id', tenantId)
      .eq('status', 'paid')
      .eq('responsible', 'company')
      .order('payment_date', { ascending: false }),
  ])

  if (vehicleResult.error || !vehicleResult.data) notFound()

  const vehicle = vehicleResult.data
  const paidBillings = paidBillingsResult.data ?? []
  const maintenances = (maintenanceCostResult.data ?? []) as { cost: number; completed_at: string | null; description: string | null }[]
  const fines = (fineCostResult.data ?? []) as { amount: number; payment_date: string | null; description: string | null }[]

  // ── Cálculos de ROI ───────────────────────────────────────────────────────
  const totalRevenue = paidBillings.reduce((s, b) => s + (b.original_amount - (b.discount_amount ?? 0)), 0)
  const totalMaintenanceCost = maintenances.reduce((s, m) => s + (m.cost ?? 0), 0)
  const totalFineCost = fines.reduce((s, f) => s + (f.amount ?? 0), 0)
  const totalCost = totalMaintenanceCost + totalFineCost
  const acquisitionCost = vehicle.acquisition_value ?? 0

  const netProfit = totalRevenue - totalCost
  const totalInvestment = acquisitionCost + totalCost
  const roiPercent = acquisitionCost > 0
    ? ((totalRevenue - totalInvestment) / acquisitionCost) * 100
    : null

  // Receita por fonte
  const revenueBySource: Record<string, number> = {}
  for (const b of paidBillings) {
    const src = b.source ?? 'unknown'
    revenueBySource[src] = (revenueBySource[src] ?? 0) + (b.original_amount - (b.discount_amount ?? 0))
  }

  const SOURCE_LABELS: Record<string, string> = {
    cycle:       'Locação (ciclos)',
    fine:        'Cobranças de multa',
    maintenance: 'Cobranças de manutenção',
    expense:     'Despesas',
    manual:      'Avulso manual',
  }

  const alreadySold = vehicle.sale_value != null

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-[#323232] bg-[#121212] px-6">
        <Link href="/financeiro" className="whitespace-nowrap text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Financeiro
        </Link>
        <span className="text-[#474747]">/</span>
        <span className="text-[#9e9e9e] text-[13px]">ROI</span>
        <span className="text-[#474747]">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-[#f5f5f5]">
          <span className="font-mono text-[#BAFF1A]">{vehicle.license_plate}</span>
          <span className="ml-2 font-normal text-[#9e9e9e]">{vehicle.make} {vehicle.model}</span>
        </h1>
        <Link
          href={`/veiculos/${id}`}
          className="inline-flex h-9 items-center rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
        >
          Ver veículo →
        </Link>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── KPIs ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Aquisição</p>
            <p className="mt-1 text-xl font-bold text-[#f5f5f5]">
              {acquisitionCost > 0 ? formatCurrency(acquisitionCost) : '—'}
            </p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Receita total</p>
            <p className="mt-1 text-xl font-bold text-[#229731]">{formatCurrency(totalRevenue)}</p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Custos (manutenção + multas)</p>
            <p className={`mt-1 text-xl font-bold ${totalCost > 0 ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
              {formatCurrency(totalCost)}
            </p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">
              {roiPercent != null ? 'ROI' : 'Lucro líquido'}
            </p>
            <p className={`mt-1 text-xl font-bold ${netProfit >= 0 ? 'text-[#BAFF1A]' : 'text-[#ff9c9a]'}`}>
              {roiPercent != null
                ? `${roiPercent >= 0 ? '+' : ''}${roiPercent.toFixed(1)}%`
                : formatCurrency(netProfit)}
            </p>
            {roiPercent != null && (
              <p className="mt-0.5 text-[12px] text-[#616161]">{formatCurrency(netProfit)} líquido</p>
            )}
          </div>
        </div>

        {/* ── Dados do veículo ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Veículo</h2>
          <div className="overflow-hidden rounded-xl bg-[#202020]">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Placa',        vehicle.license_plate],
                  ['Marca/Modelo', `${vehicle.make} ${vehicle.model}`],
                  ['Ano',          vehicle.year_manufacture],
                  ['Cor',          vehicle.color],
                  ['Cadastrado',   fmt(vehicle.created_at)],
                ] as [string, string | number | null | undefined][]).map(([label, value]) => (
                  <tr key={label} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-[#9e9e9e]">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Alienação ─────────────────────────────────────────────────── */}
        {alreadySold ? (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Alienação</h2>
            <div className="overflow-hidden rounded-xl bg-[#202020]">
              <table className="w-full text-[13px]">
                <tbody>
                  <tr className="border-b border-[#323232]">
                    <td className="h-9 w-44 px-4 text-[#9e9e9e]">Valor de venda</td>
                    <td className="h-9 px-4 font-semibold text-[#f5f5f5]">{formatCurrency(vehicle.sale_value!)}</td>
                  </tr>
                  <tr>
                    <td className="h-9 w-44 px-4 text-[#9e9e9e]">Data</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{fmt(vehicle.sold_at)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* ── Receita por origem ────────────────────────────────────────── */}
        {Object.keys(revenueBySource).length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Receita por origem</h2>
            <div className="overflow-hidden rounded-xl bg-[#202020]">
              <table className="w-full text-[13px]">
                <tbody>
                  {Object.entries(revenueBySource).map(([src, value]) => (
                    <tr key={src} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 w-56 px-4 text-[#9e9e9e]">{SOURCE_LABELS[src] ?? src}</td>
                      <td className="h-9 px-4 font-mono font-semibold text-[#229731]">{formatCurrency(value)}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#1a1a1a]">
                    <td className="h-9 w-56 px-4 font-medium text-[#f5f5f5]">Total</td>
                    <td className="h-9 px-4 font-mono font-bold text-[#229731]">{formatCurrency(totalRevenue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Custos de manutenção ──────────────────────────────────────── */}
        {maintenances.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
              Manutenções
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">{formatCurrency(totalMaintenanceCost)} total</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Descrição</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Concluída</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenances.map((m, i) => (
                    <tr key={i} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 max-w-[220px] truncate px-4 text-[#c7c7c7]">{m.description ?? '—'}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{fmt(m.completed_at)}</td>
                      <td className="h-9 px-4 text-right font-mono text-[#ff9c9a]">{formatCurrency(m.cost ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Multas da empresa ─────────────────────────────────────────── */}
        {fines.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">
              Multas (empresa)
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">{formatCurrency(totalFineCost)} total</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-[#323232]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232] bg-[#1a1a1a]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Descrição</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Paga em</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {fines.map((f, i) => (
                    <tr key={i} className="border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                      <td className="h-9 max-w-[220px] truncate px-4 text-[#c7c7c7]">{f.description ?? '—'}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{fmt(f.payment_date)}</td>
                      <td className="h-9 px-4 text-right font-mono text-[#ff9c9a]">{formatCurrency(f.amount ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Ações financeiras ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Ações</h2>
          <VehicleFinancialActions
            vehicleId={id}
            hasAcquisitionValue={acquisitionCost > 0}
            alreadySold={alreadySold}
          />
        </section>

      </div>
    </div>
  )
}
