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
    .from('billings')
    .select('id, status, original_amount')
    .eq('maintenance_id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()

  const hasBilling = !!existingBilling
  const isCustomerExpense = maintenance.effective_executor === 'customer' || (maintenance.effective_customer_payer_pct ?? 0) > 0
  const customerShare = maintenance.cost != null && maintenance.effective_customer_payer_pct != null
    ? Math.round(maintenance.cost * (maintenance.effective_customer_payer_pct / 100) * 100) / 100
    : null

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-[#323232] bg-[#121212] px-6">
        <Link href="/manutencao" className="whitespace-nowrap text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Manutenção
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-[#f5f5f5]">
          {maintenance.description}
        </h1>
        <Link
          href={`/manutencao/${id}/editar`}
          className="inline-flex h-9 items-center rounded-full bg-[#323232] px-4 text-[13px] text-[#f5f5f5] transition-colors hover:bg-[#474747]"
        >
          Editar
        </Link>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── Status + custo ────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex h-7 items-center rounded-full px-3 text-[13px] font-medium ${
            maintenance.completed
              ? 'bg-[#0e2f13] text-[#229731]'
              : 'bg-[#2d0363] text-[#a880ff]'
          }`}>
            {maintenance.completed ? 'Concluída' : 'Pendente'}
          </span>
          {maintenance.cost != null && (
            <span className="text-2xl font-bold text-[#f5f5f5]">
              {formatCurrency(maintenance.cost)}
            </span>
          )}
          {TYPE_LABELS[maintenance.type] && (
            <span className="text-[14px] text-[#9e9e9e]">{TYPE_LABELS[maintenance.type]}</span>
          )}
        </div>

        {/* ── Detalhes ──────────────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Detalhes</h2>
          <div className="overflow-hidden rounded-xl bg-[#202020]">
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
                  <tr key={label} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-48 shrink-0 px-4 text-[#9e9e9e]">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Veículo ───────────────────────────────────────────────────── */}
        {vehicle && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Veículo</h2>
            <div className="rounded-xl bg-[#202020] p-4">
              <Link href={`/veiculos/${vehicle.id}`} className="group flex items-center gap-3">
                <span className="font-mono text-[15px] font-bold text-[#BAFF1A] group-hover:underline">
                  {vehicle.license_plate}
                </span>
                <span className="text-[13px] text-[#f5f5f5]">{vehicle.make} {vehicle.model}</span>
                {vehicle.km_current != null && (
                  <span className="text-[13px] text-[#9e9e9e]">— {vehicle.km_current.toLocaleString('pt-BR')} km</span>
                )}
              </Link>
            </div>
          </section>
        )}

        {/* ── Observações ───────────────────────────────────────────────── */}
        {maintenance.observations && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Observações</h2>
            <div className="rounded-xl bg-[#202020] px-4 py-3">
              <p className="whitespace-pre-wrap text-[13px] text-[#9e9e9e]">{maintenance.observations}</p>
            </div>
          </section>
        )}

        {/* ── Cobrança ao cliente ───────────────────────────────────────── */}
        {maintenance.completed && isCustomerExpense && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Cobrança ao cliente</h2>

            {hasBilling ? (
              <div className="rounded-xl bg-[#202020] px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[13px] text-[#9e9e9e]">Cobrança gerada</p>
                    <p className="mt-1 text-[15px] font-bold text-[#f5f5f5]">
                      {formatCurrency(existingBilling!.original_amount)}
                    </p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${
                    existingBilling!.status === 'paid'
                      ? 'bg-[#0e2f13] text-[#229731]'
                      : existingBilling!.status === 'cancelled'
                        ? 'bg-[#32323222] text-[#9e9e9e]'
                        : 'bg-[#2d0363] text-[#a880ff]'
                  }`}>
                    {existingBilling!.status === 'paid' ? 'Paga' : existingBilling!.status === 'cancelled' ? 'Cancelada' : 'Pendente'}
                  </span>
                </div>
                <Link
                  href={`/cobrancas/${existingBilling!.id}`}
                  className="mt-3 inline-flex text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                >
                  Ver cobrança →
                </Link>
              </div>
            ) : (
              <div className="rounded-xl bg-[#202020] p-4">
                {customerShare != null && (
                  <p className="mb-3 text-[13px] text-[#9e9e9e]">
                    Valor a cobrar do cliente:{' '}
                    <span className="font-mono font-semibold text-[#f5f5f5]">{formatCurrency(customerShare)}</span>
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
