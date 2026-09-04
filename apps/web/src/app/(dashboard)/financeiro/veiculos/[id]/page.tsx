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
      .select('id, license_plate, make, model, year_manufacture, color, acquisition_amount, sale_value, sold_at, created_at')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    // Receita total: cobranças pagas vinculadas a este veículo — caução fica
    // de fora, é garantia/depósito, não receita operacional. `billings` não
    // tem vehicle_id direto (só lease_id) — filtra via join com rentals.
    supabase
      // Spec 0014: receita do veículo vem da POSIÇÃO no ledger. Somar
      // billings pagas incluía caução e entrada como faturamento (F-09) e
      // ignorava repasse. Aqui a caução nem aparece: credita passivo.
      .from('vehicle_financial_position')
      .select('operating_revenue, gross_costs, reimbursed, net_result, maintenance_cost, documentation_cost, insurance_cost, fines_cost')
      .eq('vehicle_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    // Custo: manutenções lançadas.
    // Vem de `payables` pelo mesmo motivo das multas: `maintenances.cost` saiu
    // na ADR 0024 (custo e rateio passaram a viver no payable, em valores) e a
    // coluna de data chamava-se `completed_date`, não `completed_at`. A query
    // falhava por dois motivos ao mesmo tempo, em silêncio.
    supabase
      .from('payables')
      .select('amount, paid_at, description')
      .eq('vehicle_id', id)
      .eq('tenant_id', tenantId)
      .in('source_module', ['maintenance', 'expense'])
      .order('due_date', { ascending: false }),
    // Custo: multas pagas pela empresa.
    // Vem de `payables`, não de `fines`: as colunas status/payment_date saíram
    // da multa na ADR 0024 porque pagamento é fato financeiro. Enquanto a
    // consulta apontava para elas, ela falhava em silêncio e a lista de multas
    // aparecia vazia — sem erro na tela.
    supabase
      .from('payables')
      .select('amount, paid_at, description')
      .eq('vehicle_id', id)
      .eq('tenant_id', tenantId)
      .eq('source_module', 'fine')
      .eq('status', 'paid')
      .order('paid_at', { ascending: false }),
  ])

  if (vehicleResult.error || !vehicleResult.data) notFound()

  const vehicle = vehicleResult.data
  // Posição do veículo agregada do ledger — uma linha, não uma lista.
  type Position = {
    operating_revenue: number; gross_costs: number; reimbursed: number; net_result: number
    maintenance_cost: number; documentation_cost: number; insurance_cost: number
    // `acquisition_cost` e `accumulated_depreciation` saíram da view: eram
    // alimentados por eventos sem chamador e retornavam zero por construção.
    // ROI usa `vehicles.acquisition_amount`.
    fines_cost: number
  }
  const position = (paidBillingsResult.data ?? null) as unknown as Position | null
  const maintenances = (maintenanceCostResult.data ?? []) as { amount: number; paid_at: string | null; description: string | null }[]
  const fines = (fineCostResult.data ?? []) as { amount: number; paid_at: string | null; description: string | null }[]

  // ── Cálculos de ROI ───────────────────────────────────────────────────────
  const totalRevenue = position?.operating_revenue ?? 0
  const totalMaintenanceCost = maintenances.reduce((s, m) => s + (m.amount ?? 0), 0)
  const totalFineCost = fines.reduce((s, f) => s + (f.amount ?? 0), 0)
  const totalCost = totalMaintenanceCost + totalFineCost
  const acquisitionCost = vehicle.acquisition_amount ?? 0

  // Alienação entra no retorno. Compra e venda não geram lançamento no razão
  // (decisão do Alan, 2026-08-17) — são dados de relatório —, e ROI é
  // exatamente relatório: ignorar o que a moto trouxe na saída fazia um veículo
  // vendido com lucro aparecer com retorno negativo.
  const saleProceeds = vehicle.sale_value ?? 0

  const netProfit = totalRevenue - totalCost
  const totalInvestment = acquisitionCost + totalCost
  const roiPercent = acquisitionCost > 0
    ? ((totalRevenue + saleProceeds - totalInvestment) / acquisitionCost) * 100
    : null

  // Receita por fonte
  // Composição vem das contas do plano, não de um campo `source` na cobrança.
  // Repasse aparece separado de receita: reduz custo, não fatura (R-03).
  const revenueBySource: Record<string, number> = {
    cycle:      position?.operating_revenue ?? 0,
    reimbursed: position?.reimbursed ?? 0,
  }

  const SOURCE_LABELS: Record<string, string> = {
    cycle:        'Locação (ciclos)',
    reimbursed:   'Repasses recuperados',
    fine:         'Cobranças de multa',
    maintenance:  'Cobranças de manutenção',
    expense:      'Despesas',
    manual:       'Avulso manual',
    down_payment: 'Entrada',
  }

  const alreadySold = vehicle.sale_value != null

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-divider bg-bg px-6">
        <Link href="/financeiro" className="whitespace-nowrap text-[13px] text-fg-mute transition-colors hover:text-fg">
          ← Financeiro
        </Link>
        <span className="text-border">/</span>
        <span className="text-fg-mute text-[13px]">ROI</span>
        <span className="text-border">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-fg">
          <span className="font-mono text-primary">{vehicle.license_plate}</span>
          <span className="ml-2 font-normal text-fg-mute">{vehicle.make} {vehicle.model}</span>
        </h1>
        <Link
          href={`/veiculos/${id}`}
          className="inline-flex h-9 items-center rounded-full border border-border px-3 text-[13px] text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
        >
          Ver veículo →
        </Link>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── KPIs ──────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-surface p-4">
            <p className="text-[12px] text-fg-mute">Aquisição</p>
            <p className="mt-1 text-xl font-bold text-fg">
              {acquisitionCost > 0 ? formatCurrency(acquisitionCost) : '—'}
            </p>
            {saleProceeds > 0 && (
              <p className="mt-0.5 text-[12px] text-fg-mute">
                Vendido por {formatCurrency(saleProceeds)}
              </p>
            )}
          </div>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-[12px] text-fg-mute">Receita total</p>
            <p className="mt-1 text-xl font-bold text-success">{formatCurrency(totalRevenue)}</p>
          </div>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-[12px] text-fg-mute">Custos (manutenção + multas)</p>
            <p className={`mt-1 text-xl font-bold ${totalCost > 0 ? 'text-danger' : 'text-fg-mute'}`}>
              {formatCurrency(totalCost)}
            </p>
          </div>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-[12px] text-fg-mute">
              {roiPercent != null ? 'ROI' : 'Lucro líquido'}
            </p>
            <p className={`mt-1 text-xl font-bold ${netProfit >= 0 ? 'text-primary' : 'text-danger'}`}>
              {roiPercent != null
                ? `${roiPercent >= 0 ? '+' : ''}${roiPercent.toFixed(1)}%`
                : formatCurrency(netProfit)}
            </p>
            {roiPercent != null && (
              <p className="mt-0.5 text-[12px] text-fg-mute">{formatCurrency(netProfit)} líquido</p>
            )}
          </div>
        </div>

        {/* ── Dados do veículo ──────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-primary">Veículo</h2>
          <div className="overflow-hidden rounded-xl bg-surface">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Placa',        vehicle.license_plate],
                  ['Marca/Modelo', `${vehicle.make} ${vehicle.model}`],
                  ['Ano',          vehicle.year_manufacture],
                  ['Cor',          vehicle.color],
                  ['Cadastrado',   fmt(vehicle.created_at)],
                ] as [string, string | number | null | undefined][]).map(([label, value]) => (
                  <tr key={label} className="border-b border-divider last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-fg-mute">{label}</td>
                    <td className="h-9 px-4 text-fg">{value ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Alienação ─────────────────────────────────────────────────── */}
        {alreadySold ? (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">Alienação</h2>
            <div className="overflow-hidden rounded-xl bg-surface">
              <table className="w-full text-[13px]">
                <tbody>
                  <tr className="border-b border-divider">
                    <td className="h-9 w-44 px-4 text-fg-mute">Valor de venda</td>
                    <td className="h-9 px-4 font-semibold text-fg">{formatCurrency(vehicle.sale_value!)}</td>
                  </tr>
                  <tr>
                    <td className="h-9 w-44 px-4 text-fg-mute">Data</td>
                    <td className="h-9 px-4 text-fg">{fmt(vehicle.sold_at)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {/* ── Receita por origem ────────────────────────────────────────── */}
        {Object.keys(revenueBySource).length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">Receita por origem</h2>
            <div className="overflow-hidden rounded-xl bg-surface">
              <table className="w-full text-[13px]">
                <tbody>
                  {Object.entries(revenueBySource).map(([src, value]) => (
                    <tr key={src} className="border-b border-divider last:border-0">
                      <td className="h-9 w-56 px-4 text-fg-mute">{SOURCE_LABELS[src] ?? src}</td>
                      <td className="h-9 px-4 font-mono font-semibold text-success">{formatCurrency(value)}</td>
                    </tr>
                  ))}
                  <tr className="bg-surface">
                    <td className="h-9 w-56 px-4 font-medium text-fg">Total</td>
                    <td className="h-9 px-4 font-mono font-bold text-success">{formatCurrency(totalRevenue)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Custos de manutenção ──────────────────────────────────────── */}
        {maintenances.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Manutenções
              <span className="ml-2 text-[12px] font-normal text-fg-mute">{formatCurrency(totalMaintenanceCost)} total</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Descrição</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Concluída</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenances.map((m, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 max-w-[220px] truncate px-4 text-fg-soft">{m.description ?? '—'}</td>
                      <td className="h-9 px-4 text-fg-mute">{fmt(m.paid_at)}</td>
                      <td className="h-9 px-4 text-right font-mono text-danger">{formatCurrency(m.amount ?? 0)}</td>
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
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Multas (empresa)
              <span className="ml-2 text-[12px] font-normal text-fg-mute">{formatCurrency(totalFineCost)} total</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Descrição</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Paga em</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {fines.map((f, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 max-w-[220px] truncate px-4 text-fg-soft">{f.description ?? '—'}</td>
                      <td className="h-9 px-4 text-fg-mute">{fmt(f.paid_at)}</td>
                      <td className="h-9 px-4 text-right font-mono text-danger">{formatCurrency(f.amount ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Ações financeiras ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-primary">Ações</h2>
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
