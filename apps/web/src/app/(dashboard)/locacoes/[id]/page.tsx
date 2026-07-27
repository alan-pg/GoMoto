import { notFound } from 'next/navigation'
import Link from 'next/link'
import {
  Edit2, X, RotateCcw, TrendingUp, Zap, ChevronRight, Users, Bike,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'
import {
  effectiveBillingStatus, netBillingAmount, BILLING_STATUS_BADGE, BILLING_TYPE_LABEL,
} from '@/lib/billing-status'
import { SignedContractUpload } from '../_components/SignedContractUpload'
import { ContractPreviewPanel } from '../_components/ContractPreviewPanel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

const CONTRACT_LABEL: Record<string, string> = {
  rental:      'Locação',
  rent_to_own: 'Compra Programada',
}

const CYCLE_LABEL: Record<string, string> = {
  weekly:  'Semanal',
  monthly: 'Mensal',
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active:      { bg: 'bg-[#BAFF1A22]', text: 'text-[#BAFF1A]', label: 'Ativa'       },
  closed:      { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Encerrada'   },
  transferred: { bg: 'bg-[#60a5fa22]', text: 'text-[#60a5fa]', label: 'Transferida' },
}

const SIGNED_CONTRACT_BUCKET = 'rental-documents'

async function getSignedContractUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from(SIGNED_CONTRACT_BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RentalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase  = await createClient()
  const tenantId  = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [rentalResult, billingsResult, depositResult, adjustmentsResult, tenantResult] = await Promise.all([
    supabase
      .from('rentals')
      .select(`*,
        customer:customers(id,name,phone,cpf,rg,drivers_license,drivers_license_category,street,street_number,complement,neighborhood,city,state,zip_code),
        vehicle:vehicles(id,license_plate,make,model,year_manufacture,year_model,color,renavam,chassis,fuel,km_current),
        contract_template:contract_templates(id,name)`)
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    supabase
      .from('billings')
      .select('*')
      .eq('lease_id', id)
      .eq('tenant_id', tenantId)
      .order('due_date', { ascending: true }),
    supabase
      .from('deposits')
      .select('amount, balance, status, received_at')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    supabase
      .from('rental_adjustments')
      .select('id, adjusted_at')
      .eq('rental_id', id)
      .eq('tenant_id', tenantId)
      .order('adjusted_at', { ascending: false }),
    supabase
      .from('tenants')
      .select('name, legal_name')
      .eq('id', tenantId)
      .single(),
  ])

  if (rentalResult.error || !rentalResult.data) notFound()

  const rental      = rentalResult.data
  const billings    = billingsResult.data ?? []
  const deposit     = depositResult.data as { amount: number; balance: number; status: string; received_at: string } | null
  const adjustments = adjustmentsResult.data ?? []
  const statusCfg   = STATUS_BADGE[rental.status] ?? STATUS_BADGE.closed
  const isActive    = rental.status === 'active'
  const signedContractUrl = await getSignedContractUrl(supabase, rental.signed_contract_path)
  const tenantName  = tenantResult.data?.legal_name ?? tenantResult.data?.name ?? ''

  // Totais financeiros — mesma regra de @/lib/billing-status usada em /financeiro,
  // para os dois nunca mostrarem números divergentes.
  const totalPaid = billings
    .filter(b => b.status === 'paid')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const totalPending = billings
    .filter(b => effectiveBillingStatus(b) === 'pending')
    .reduce((s, b) => s + netBillingAmount(b), 0)
  const overdueBillings = billings.filter(b => effectiveBillingStatus(b) === 'overdue')
  const totalOverdue = overdueBillings.reduce((s, b) => s + netBillingAmount(b), 0)
  const overdueCount = overdueBillings.length

  // Prévia: sempre mostra as vencidas (são as mais acionáveis) + completa até
  // 5 linhas com as demais mais próximas — nunca deixa vencida de fora só
  // porque há muitas pendentes futuras depois dela na ordem cronológica.
  const otherBillings = billings
    .filter(b => effectiveBillingStatus(b) !== 'overdue')
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  const remainingPreviewSlots = Math.max(0, 5 - overdueBillings.length)
  // slice(-0) retornaria o array inteiro (JS trata -0 === 0) — por isso o guard acima
  const previewBillings = [...overdueBillings, ...(remainingPreviewSlots > 0 ? otherBillings.slice(-remainingPreviewSlots) : [])]
    .sort((a, b) => a.due_date.localeCompare(b.due_date))

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b border-[#323232] bg-[#121212] px-6">
        <Link href="/locacoes" className="whitespace-nowrap text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Locações
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-[#f5f5f5]">
          {rental.customer?.name ?? '—'} · {rental.vehicle?.license_plate ?? '—'}
        </h1>

        <div className="flex items-center gap-2">
          {isActive && (
            <>
              <Link
                href={`/locacoes/${id}/cobranca-avulsa`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
                title="Cobrança Avulsa"
              >
                <Zap className="h-4 w-4" />
                Cobrança avulsa
              </Link>
              <Link
                href={`/locacoes/${id}/renovar`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
                title="Renovar"
              >
                <RotateCcw className="h-4 w-4" />
                Renovar
              </Link>
              <Link
                href={`/locacoes/${id}/reajustar`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
                title="Reajustar"
              >
                <TrendingUp className="h-4 w-4" />
                Reajustar
              </Link>
              <Link
                href={`/locacoes/${id}/encerrar`}
                className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#ff9c9a]/30 bg-[#7c1c1c] px-3 text-[13px] text-[#ff9c9a] transition-colors hover:bg-[#9c2c2c]"
                title="Encerrar"
              >
                <X className="h-4 w-4" />
                Encerrar
              </Link>
            </>
          )}
          <Link
            href={`/locacoes/${id}/financeiro`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-3 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
          >
            Financeiro
          </Link>
          <Link
            href={`/locacoes/${id}/editar`}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#323232] px-3 text-[13px] text-[#f5f5f5] transition-colors hover:bg-[#474747]"
          >
            <Edit2 className="h-4 w-4" />
            Editar
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">

        {/* ── Status + resumo financeiro ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-4">
          <span className={`inline-flex h-7 items-center rounded-full border border-transparent px-3 text-[13px] font-medium ${statusCfg.bg} ${statusCfg.text}`}>
            {statusCfg.label}
          </span>
          <span className="text-2xl font-bold text-[#f5f5f5]">
            {rental.cycle_amount != null ? formatCurrency(rental.cycle_amount) : '—'}
            <span className="ml-1 text-[14px] font-normal text-[#9e9e9e]">/{CYCLE_LABEL[rental.cycle ?? 'monthly'] ?? 'ciclo'}</span>
          </span>
          {overdueCount > 0 && (
            <span className="rounded-full bg-[#7c1c1c] px-3 py-0.5 text-[13px] font-semibold text-[#ff9c9a]">
              {overdueCount} cobrança{overdueCount !== 1 ? 's' : ''} vencida{overdueCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ── Cards de totais ───────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Total pago</p>
            <p className="mt-1 text-xl font-bold text-[#229731]">{formatCurrency(totalPaid)}</p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Em aberto</p>
            <p className={`mt-1 text-xl font-bold ${totalPending > 0 ? 'text-[#a880ff]' : 'text-[#9e9e9e]'}`}>
              {formatCurrency(totalPending)}
            </p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Vencido</p>
            <p className={`mt-1 text-xl font-bold ${totalOverdue > 0 ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
              {formatCurrency(totalOverdue)}
            </p>
          </div>
          <div className="rounded-xl bg-[#202020] p-4">
            <p className="text-[12px] text-[#9e9e9e]">Caução</p>
            <p className="mt-1 text-xl font-bold text-[#f5f5f5]">
              {deposit != null ? formatCurrency(deposit.amount) : '—'}
            </p>
            {deposit && deposit.status !== 'received' && (
              <p className="mt-0.5 text-[12px] text-[#9e9e9e]">
                Saldo: {formatCurrency(deposit.balance)}
              </p>
            )}
          </div>
        </div>

        {/* ── Dados do contrato ─────────────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Contrato</h2>
          <div className="overflow-hidden rounded-xl bg-[#202020]">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Tipo',        CONTRACT_LABEL[rental.contract_type ?? 'rental']],
                  ['Ciclo',       CYCLE_LABEL[rental.cycle ?? 'monthly']],
                  ['Vencimento',  `Dia ${rental.due_day ?? '—'}`],
                  ['Início',      fmt(rental.start_date)],
                  ['Fim',         fmt(rental.end_date)],
                  ['Pro rata',    rental.use_pro_rata ? 'Sim' : 'Não'],
                  ...(rental.observations ? [['Observações', rental.observations]] : []),
                ] as [string, string][]).map(([label, value]) => (
                  <tr key={label} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-[#9e9e9e]">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value}</td>
                  </tr>
                ))}
                {adjustments.length > 0 && (
                  <tr className="border-b border-[#323232] last:border-0">
                    <td className="h-9 w-44 shrink-0 px-4 text-[#9e9e9e]">Reajustes</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">
                      {adjustments.length} · último em {fmt(adjustments[0].adjusted_at)}
                      {' '}
                      <Link
                        href={`/locacoes/${id}/financeiro`}
                        className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                      >
                        ver histórico →
                      </Link>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-3 space-y-3">
            <ContractPreviewPanel
              rentalId={id}
              currentTemplateId={rental.contract_template_id}
              customer={{
                name: rental.customer?.name ?? '',
                cpf: rental.customer?.cpf ?? null,
                rg: rental.customer?.rg ?? null,
                drivers_license: rental.customer?.drivers_license ?? null,
                drivers_license_category: rental.customer?.drivers_license_category ?? null,
                street: rental.customer?.street ?? null,
                street_number: rental.customer?.street_number ?? null,
                complement: rental.customer?.complement ?? null,
                neighborhood: rental.customer?.neighborhood ?? null,
                city: rental.customer?.city ?? null,
                state: rental.customer?.state ?? null,
                zip_code: rental.customer?.zip_code ?? null,
              }}
              vehicle={{
                make: rental.vehicle?.make ?? '',
                model: rental.vehicle?.model ?? '',
                year_manufacture: rental.vehicle?.year_manufacture ?? '',
                year_model: rental.vehicle?.year_model ?? undefined,
                renavam: rental.vehicle?.renavam ?? '',
                license_plate: rental.vehicle?.license_plate ?? '',
                chassis: rental.vehicle?.chassis ?? '',
                color: rental.vehicle?.color ?? '',
                fuel: rental.vehicle?.fuel ?? undefined,
                km_current: rental.vehicle?.km_current ?? undefined,
              }}
              rental={{
                cycle: rental.cycle ?? 'monthly',
                due_day: rental.due_day ?? 10,
                cycle_amount: rental.cycle_amount ?? 0,
                start_date: rental.start_date,
                end_date: rental.end_date,
                security_deposit: deposit?.amount ?? null,
              }}
              tenantName={tenantName}
            />
            <SignedContractUpload
              rentalId={id}
              currentFileName={rental.signed_contract_file_name}
              signedUrl={signedContractUrl}
            />
          </div>
        </section>

        {/* ── Vínculo: cliente + veículo ─────────────────────────────────── */}
        <section>
          <h2 className="mb-3 text-[14px] font-bold text-[#BAFF1A]">Vínculo</h2>
          <div className="grid grid-cols-2 gap-4">

            <div className="space-y-1 rounded-xl bg-[#202020] p-4">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-[#9e9e9e]" />
                <p className="text-[12px] font-medium uppercase tracking-wide text-[#9e9e9e]">Cliente</p>
              </div>
              {rental.customer ? (
                <>
                  <p className="text-[15px] font-bold text-[#f5f5f5]">{rental.customer.name}</p>
                  {rental.customer.phone && <p className="text-[13px] text-[#9e9e9e]">{rental.customer.phone}</p>}
                  {rental.customer.cpf   && <p className="text-[13px] text-[#9e9e9e]">CPF: {rental.customer.cpf}</p>}
                  <Link
                    href={`/clientes/${rental.customer.id}`}
                    className="inline-flex items-center gap-1 text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                  >
                    Ver cliente <ChevronRight className="h-3 w-3" />
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-[#616161]">Não vinculado</p>
              )}
            </div>

            <div className="space-y-1 rounded-xl bg-[#202020] p-4">
              <div className="flex items-center gap-2">
                <Bike className="h-4 w-4 text-[#9e9e9e]" />
                <p className="text-[12px] font-medium uppercase tracking-wide text-[#9e9e9e]">Veículo</p>
              </div>
              {rental.vehicle ? (
                <>
                  <p className="font-mono text-[15px] font-bold text-[#BAFF1A]">{rental.vehicle.license_plate}</p>
                  <p className="text-[13px] text-[#f5f5f5]">{rental.vehicle.make} {rental.vehicle.model}</p>
                  {rental.vehicle.year_manufacture && (
                    <p className="text-[13px] text-[#9e9e9e]">{rental.vehicle.year_manufacture} · {rental.vehicle.color}</p>
                  )}
                  <Link
                    href={`/veiculos/${rental.vehicle.id}`}
                    className="inline-flex items-center gap-1 text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                  >
                    Ver veículo <ChevronRight className="h-3 w-3" />
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-[#616161]">Não vinculado</p>
              )}
            </div>
          </div>
        </section>

        {/* ── Prévia de cobranças ───────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-[#BAFF1A]">
              Cobranças recentes
              <span className="ml-2 text-[12px] font-normal text-[#9e9e9e]">({billings.length})</span>
            </h2>
            <Link
              href={`/locacoes/${id}/financeiro`}
              className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
            >
              Ver extrato completo →
            </Link>
          </div>

          {billings.length === 0 ? (
            <div className="flex items-center justify-center rounded-xl bg-[#202020] py-10">
              <p className="text-[13px] text-[#616161]">Nenhuma cobrança registrada.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[#323232] bg-[#1a1a1a]">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[#323232]">
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Vencimento</th>
                    <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Tipo</th>
                    <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Valor</th>
                    <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {previewBillings
                    .map(b => {
                      const dynStatus = effectiveBillingStatus(b)
                      const badge     = BILLING_STATUS_BADGE[dynStatus] ?? BILLING_STATUS_BADGE.pending
                      return (
                        <tr key={b.id} className="h-9 border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                          <td className="px-4 text-[#c7c7c7]">{fmt(b.due_date)}</td>
                          <td className="px-4 text-[#9e9e9e]">
                            {BILLING_TYPE_LABEL[b.billing_type ?? 'cycle'] ?? '—'}
                          </td>
                          <td className="px-4 text-right font-mono text-[#f5f5f5]">
                            {formatCurrency(netBillingAmount(b))}
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
              {billings.length > previewBillings.length && (
                <div className="border-t border-[#1e1e1e] px-4 py-2 text-center">
                  <Link
                    href={`/locacoes/${id}/financeiro`}
                    className="text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
                  >
                    +{billings.length - previewBillings.length} mais → ver extrato completo
                  </Link>
                </div>
              )}
            </div>
          )}
        </section>

      </div>
    </div>
  )
}
