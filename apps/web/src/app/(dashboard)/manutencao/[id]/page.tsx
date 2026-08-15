import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'
import { ConfirmBillingButton } from './_components/ConfirmBillingButton'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

const TYPE_LABELS: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Inspeção',
}

const EXECUTOR_LABELS: Record<string, string> = {
  company:  'Empresa',
  customer: 'Cliente',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function MaintenanceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const { data: maintenance, error } = await supabase
    .from('maintenances')
    .select('*, vehicle:vehicles(id, license_plate, make, model, km_current)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()

  if (error || !maintenance) notFound()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vehicle = (maintenance as any).vehicle as { id: string; license_plate: string; make: string; model: string; km_current: number | null } | null

  // Check if a billing already exists for this maintenance
  const { data: existingBilling } = await supabase
    .from('charge_items')
    .select('amount, charge:charges(id, status)')
    .eq('source_module', 'maintenance')
    .eq('source_id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  // O join vem como array na inferência do supabase-js; normalizamos.
  type ItemWithCharge = { amount: number; charge: { id: string; status: string } | { id: string; status: string }[] | null }
  const rawItem = existingBilling as unknown as ItemWithCharge | null
  const rawCharge = rawItem ? (Array.isArray(rawItem.charge) ? rawItem.charge[0] : rawItem.charge) : null
  const billingInfo = rawItem && rawCharge
    ? { id: rawCharge.id, status: rawCharge.status, original_amount: rawItem.amount }
    : null

  const hasBilling = !!billingInfo
  // `cost` e `effective_customer_payer_pct` saíram de `maintenances` na ADR
  // 0024: custo e rateio vivem no payable, em valores. Estas duas expressões
  // liam colunas inexistentes e resultavam sempre em `null`/`false`.
  // Quem responde "o cliente paga parte disto?" é a cobrança emitida.
  const isCustomerExpense = maintenance.effective_executor === 'customer' || hasBilling
  const customerShare = billingInfo?.original_amount ?? null

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-divider bg-bg px-6">
        <Link href="/manutencao" className="whitespace-nowrap text-[13px] text-fg-mute transition-colors hover:text-fg">
          ← Manutenção
        </Link>
        <span className="text-border">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-fg">
          {maintenance.description}
        </h1>
        <Link
          href={`/manutencao/${id}/editar`}
          className="inline-flex h-9 items-center rounded-full bg-surface-2 px-4 text-[13px] text-fg transition-colors hover:bg-divider"
        >
          Editar
        </Link>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── Status + custo ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex h-7 items-center rounded-full px-3 text-[13px] font-medium ${
            maintenance.completed
              ? 'bg-success-bg text-success'
              : 'bg-info-bg text-info'
          }`}>
            {maintenance.completed ? 'Concluída' : 'Pendente'}
          </span>
          {maintenance.cost != null && (
            <span className="text-2xl font-bold text-fg">
              {formatCurrency(maintenance.cost)}
            </span>
          )}
          {TYPE_LABELS[maintenance.type] && (
            <span className="text-[14px] text-fg-mute">{TYPE_LABELS[maintenance.type]}</span>
          )}
        </div>

        {/* ── Detalhes ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-primary">Detalhes</h2>
          <div className="overflow-hidden rounded-xl bg-surface">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Tipo',              TYPE_LABELS[maintenance.type] ?? maintenance.type],
                  ['Data prevista',     fmt(maintenance.scheduled_date)],
                  ['Data concluída',    fmt(maintenance.completed_date)],
                  ['KM previsto',       maintenance.predicted_km != null ? `${maintenance.predicted_km.toLocaleString('pt-BR')} km` : null],
                  ['KM real',          maintenance.actual_km != null ? `${maintenance.actual_km.toLocaleString('pt-BR')} km` : null],
                  ['Oficina',          maintenance.workshop],
                  ['Executor',         maintenance.effective_executor ? EXECUTOR_LABELS[maintenance.effective_executor] : null],
                  ['% do cliente',     maintenance.effective_customer_payer_pct != null ? `${maintenance.effective_customer_payer_pct}%` : null],
                ] as [string, string | null | undefined][]).filter(([, v]) => v).map(([label, value]) => (
                  <tr key={label} className="border-b border-divider last:border-0">
                    <td className="h-9 w-48 shrink-0 px-4 text-fg-mute">{label}</td>
                    <td className="h-9 px-4 text-fg">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Veículo ───────────────────────────────────────────────────── */}
        {vehicle && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">Veículo</h2>
            <div className="rounded-xl bg-surface p-4">
              <Link href={`/veiculos/${vehicle.id}`} className="group flex items-center gap-3">
                <span className="font-mono text-[15px] font-bold text-primary group-hover:underline">
                  {vehicle.license_plate}
                </span>
                <span className="text-[13px] text-fg">{vehicle.make} {vehicle.model}</span>
                {vehicle.km_current != null && (
                  <span className="text-[13px] text-fg-mute">— {vehicle.km_current.toLocaleString('pt-BR')} km</span>
                )}
              </Link>
            </div>
          </section>
        )}

        {/* ── Observações ───────────────────────────────────────────────── */}
        {maintenance.observations && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">Observações</h2>
            <div className="rounded-xl bg-surface px-4 py-3">
              <p className="whitespace-pre-wrap text-[13px] text-fg-mute">{maintenance.observations}</p>
            </div>
          </section>
        )}

        {/* ── Cobrança ao cliente ───────────────────────────────────────── */}
        {maintenance.completed && isCustomerExpense && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">Cobrança ao cliente</h2>

            {hasBilling ? (
              <div className="rounded-xl bg-surface px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] text-fg-mute">Cobrança gerada</p>
                    <p className="mt-1 text-[15px] font-bold text-fg">
                      {formatCurrency(billingInfo!.original_amount)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                    billingInfo!.status === 'paid'
                      ? 'bg-success-bg text-success'
                      : billingInfo!.status === 'cancelled'
                        ? 'bg-surface-2 text-fg-mute'
                        : 'bg-info-bg text-info'
                  }`}>
                    {billingInfo!.status === 'paid' ? 'Paga' : billingInfo!.status === 'cancelled' ? 'Cancelada' : 'Pendente'}
                  </span>
                </div>
                <Link
                  href={`/cobrancas/${billingInfo!.id}`}
                  className="mt-3 inline-flex text-[12px] text-fg-mute transition-colors hover:text-primary"
                >
                  Ver cobrança →
                </Link>
              </div>
            ) : (
              <div className="rounded-xl bg-surface p-4">
                {customerShare != null && (
                  <p className="mb-3 text-[13px] text-fg-mute">
                    Valor a cobrar do cliente:{' '}
                    <span className="font-mono font-semibold text-fg">{formatCurrency(customerShare)}</span>
                    {' '}({maintenance.effective_customer_payer_pct}% do custo total)
                  </p>
                )}
                <ConfirmBillingButton
                  maintenanceId={id}
                  defaultAmount={customerShare ?? maintenance.cost ?? 0}
                  vehicleId={maintenance.vehicle_id}
                />
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  )
}
