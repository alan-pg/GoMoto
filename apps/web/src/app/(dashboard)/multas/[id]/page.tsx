import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'
import { isDriverUnidentified, calcFineUrgency } from '@gomoto/core'
import { FineAttachments, type FineAttachment, type AttachmentType } from './_components/FineAttachments'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

const STATUS_CONFIG = {
  paid:     { label: 'Paga',     bg: 'bg-success-bg', text: 'text-success', border: 'border-success' },
  overdue:  { label: 'Vencida',  bg: 'bg-danger-bg', text: 'text-danger', border: 'border-danger' },
  due_soon: { label: 'A vencer', bg: 'bg-warning-bg', text: 'text-warning', border: 'border-warning' },
  pending:  { label: 'Pendente', bg: 'bg-info-bg', text: 'text-info', border: 'border-info' },
}

// Status da cobrança (billings) — domínio próprio, distinto do status da multa acima
// (multa quitada junto ao órgão de trânsito ≠ cliente pagou a cobrança da empresa).
/** `charge_status` (ADR 0024) + `overdue`, que é derivado, não armazenado. */
const BILLING_STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; border: string }> = {
  open:        { label: 'Em aberto', bg: 'bg-info-bg',    text: 'text-info',    border: 'border-info' },
  overdue:     { label: 'Vencida',   bg: 'bg-danger-bg',  text: 'text-danger',  border: 'border-danger' },
  paid:        { label: 'Paga',      bg: 'bg-success-bg', text: 'text-success', border: 'border-success' },
  cancelled:   { label: 'Cancelada', bg: 'bg-surface-2',  text: 'text-fg-mute', border: 'border-divider' },
  written_off: { label: 'Baixada',   bg: 'bg-warning-bg', text: 'text-warning', border: 'border-warning' },
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function FineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase  = await createClient()
  const tenantId  = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [fineResult, attachmentsResult, billingResult] = await Promise.all([
    supabase
      .from('fines')
      .select('*, customers(name, phone), vehicles(license_plate, make, model)')
      .eq('id', id)
      .single(),
    supabase
      .from('fine_attachments')
      .select('*')
      .eq('fine_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('charge_items')
      .select('amount, description, charge:charges(id, status, due_date)')
      .eq('source_module', 'fine')
      .eq('source_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (fineResult.error || !fineResult.data) notFound()

  const fine        = fineResult.data
  const rawAtts     = attachmentsResult.data ?? []
  // Normaliza o join (o supabase-js infere array) e monta a forma que o JSX
  // consome. `paid_at` sai do documento: pagamento vive em `payments`.
  type FineItem = {
    amount: number; description: string
    charge: { id: string; status: string; due_date: string } | { id: string; status: string; due_date: string }[] | null
  }
  const rawFineItem = billingResult.data as unknown as FineItem | null
  const fineCharge = rawFineItem
    ? (Array.isArray(rawFineItem.charge) ? rawFineItem.charge[0] : rawFineItem.charge)
    : null

  const billing = rawFineItem && fineCharge
    ? {
        id: fineCharge.id,
        status: fineCharge.status,
        due_date: fineCharge.due_date,
        description: rawFineItem.description,
        original_amount: rawFineItem.amount,
        paid_at: fineCharge.status === 'paid' ? fineCharge.due_date : null,
      }
    : null
  const status      = calcFineUrgency(fine)
  const statusCfg   = STATUS_CONFIG[status]
  const driverUnidentified = isDriverUnidentified(fine, rawAtts)

  // Gerar signed URLs para todos os anexos
  const attachments: FineAttachment[] = await Promise.all(
    rawAtts.map(async (att) => {
      const { data } = await supabase.storage
        .from('fine-documents')
        .createSignedUrl(att.file_url, 3600)
      return {
        ...att,
        type: att.type as AttachmentType,
        signedUrl: data?.signedUrl ?? undefined,
      }
    }),
  )

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-bg border-b border-divider px-6 h-16 flex items-center gap-4">
        <Link href="/multas" className="text-[13px] text-fg-mute hover:text-fg transition-colors whitespace-nowrap">
          ← Multas
        </Link>
        <span className="text-border">/</span>
        <h1 className="text-[15px] font-bold text-fg flex-1 truncate">
          {fine.description}
        </h1>
        <Link
          href={`/multas/${id}/editar`}
          className="inline-flex items-center h-9 px-4 rounded-full bg-surface-2 text-fg text-[13px] font-medium hover:bg-divider transition-colors"
        >
          Editar
        </Link>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-4xl mx-auto">

        {/* ── Status + valor ────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 flex-wrap">
          <span className={`inline-flex items-center h-7 px-3 rounded-full text-[13px] font-medium border ${statusCfg.bg} ${statusCfg.text} ${statusCfg.border}`}>
            {statusCfg.label}
          </span>
          <span className={`text-2xl font-bold ${status === 'paid' ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(Number(fine.amount))}
          </span>
          {fine.points != null && fine.points > 0 && (
            <span className="text-[13px] text-fg-mute">
              {fine.points} ponto{fine.points !== 1 ? 's' : ''} na CNH
            </span>
          )}
        </div>

        {/* ── Infração ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-bold text-primary mb-3">Infração</h2>
          <div className="bg-surface rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Descrição',         fine.description],
                  ['Código SENATRAN',   [fine.senatran_infraction_code, fine.senatran_infraction_subcode].filter(Boolean).join(' / ') || null],
                  ['Órgão autuador',    fine.issuing_agency_name],
                  ['Código do órgão',   fine.issuing_agency_code],
                  ['Órgão competente',  fine.competent_agency_name],
                  ['Código do órgão competente', fine.competent_agency_code],
                  ['Local',             fine.infraction_location],
                  ['Município/UF',      [fine.infraction_municipality_name, fine.infraction_state].filter(Boolean).join(' / ') || null],
                  ['Nº do equipamento/instrumento', fine.measurement_instrument_id],
                  ['Matrícula do agente', fine.traffic_agent_id],
                  ['Nº do AIT',         fine.ait_number],
                  ['RENAINF',           fine.renainf_number],
                  ['RENAINF da multa original', fine.original_renainf_number],
                  ['Pontos na CNH',     fine.points != null ? `${fine.points} ponto${fine.points !== 1 ? 's' : ''}` : null],
                  ['Responsável',       fine.responsible === 'customer' ? 'Cliente' : 'Empresa'],
                ] as [string, string | null | undefined][]).map(([label, value]) => (
                  <tr key={label} className="border-b border-divider last:border-0">
                    <td className="h-9 px-4 text-fg-mute w-44 shrink-0">{label}</td>
                    <td className="h-9 px-4 text-fg">{value || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Datas ─────────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-bold text-primary mb-3">Datas</h2>
          <div className="bg-surface rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {([
                  ['Data da infração',  fmt(fine.infraction_date) + (fine.infraction_time ? ` às ${fine.infraction_time.slice(0, 5)}` : '')],
                  ['Vencimento',        fmt(fine.due_date)],
                  // 'Pago em' saiu daqui: a data de pagamento é do fato
                  // financeiro (conta a pagar da empresa ou cobrança do
                  // cliente), não da multa. A coluna não existe mais na tabela
                  // e o campo mostrava vazio para sempre.
                  ['Registrado em',     fmt(fine.created_at)],
                ] as [string, string][]).map(([label, value]) => (
                  <tr key={label} className="border-b border-divider last:border-0">
                    <td className="h-9 px-4 text-fg-mute w-44">{label}</td>
                    <td className="h-9 px-4 text-fg">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Prazos (NA/NP) ────────────────────────────────────────────────── */}
        {(fine.notification_date || fine.prior_defense_deadline || fine.driver_identification_deadline
          || fine.appeal_deadline || fine.discounted_payment_deadline) && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Prazos (NA/NP)</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  {([
                    ['Data da notificação',              fmt(fine.notification_date)],
                    ['Prazo — defesa prévia',            fmt(fine.prior_defense_deadline)],
                    ['Prazo — identificação de condutor', fmt(fine.driver_identification_deadline)],
                    ['Prazo — recurso',                  fmt(fine.appeal_deadline)],
                    ['Vencimento com desconto',           fmt(fine.discounted_payment_deadline)],
                  ] as [string, string][]).map(([label, value]) => (
                    <tr key={label} className="border-b border-divider last:border-0">
                      <td className="h-9 px-4 text-fg-mute w-44">{label}</td>
                      <td className="h-9 px-4 text-fg">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Condutor identificado no documento ──────────────────────────────── */}
        {(fine.driver_name || fine.driver_cnh || fine.driver_cpf || fine.driver_document) && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Condutor identificado no documento</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  {([
                    ['Nome', fine.driver_name],
                    ['CNH',  fine.driver_cnh],
                    ['CPF',  fine.driver_cpf],
                    ['Outro documento', fine.driver_document],
                  ] as [string, string | null][]).map(([label, value]) => (
                    <tr key={label} className="border-b border-divider last:border-0">
                      <td className="h-9 px-4 text-fg-mute w-44">{label}</td>
                      <td className="h-9 px-4 text-fg">{value || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Velocidade ────────────────────────────────────────────────────── */}
        {(fine.measured_speed != null || fine.considered_speed != null || fine.speed_limit != null) && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Velocidade</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  {([
                    ['Medição realizada',   fine.measured_speed != null ? `${fine.measured_speed} km/h` : null],
                    ['Valor considerado',   fine.considered_speed != null ? `${fine.considered_speed} km/h` : null],
                    ['Limite regulamentado', fine.speed_limit != null ? `${fine.speed_limit} km/h` : null],
                  ] as [string, string | null][]).map(([label, value]) => (
                    <tr key={label} className="border-b border-divider last:border-0">
                      <td className="h-9 px-4 text-fg-mute w-44">{label}</td>
                      <td className="h-9 px-4 text-fg">{value || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Vínculo ───────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-bold text-primary mb-3">Vínculo</h2>
          <div className="grid grid-cols-2 gap-4">

            {/* Veículo */}
            <div className="bg-surface rounded-xl p-4 space-y-1">
              <p className="text-[12px] text-fg-mute uppercase tracking-wide font-medium">Veículo</p>
              {fine.vehicles ? (
                <>
                  <p className="text-[15px] font-bold font-mono text-primary">
                    {fine.vehicles.license_plate}
                  </p>
                  <p className="text-[13px] text-fg">
                    {fine.vehicles.make} {fine.vehicles.model}
                  </p>
                  <Link
                    href={`/veiculos/${fine.vehicle_id}`}
                    className="text-[12px] text-fg-mute hover:text-primary transition-colors"
                  >
                    Ver veículo →
                  </Link>
                </>
              ) : (
                <p className="text-[13px] text-fg-mute">Não vinculado</p>
              )}
            </div>

            {/* Cliente */}
            <div className="bg-surface rounded-xl p-4 space-y-1">
              <p className="text-[12px] text-fg-mute uppercase tracking-wide font-medium">Cliente</p>
              {fine.customers ? (
                <>
                  <p className="text-[15px] font-bold text-fg">{fine.customers.name}</p>
                  {fine.customers.phone && (
                    <p className="text-[13px] text-fg-mute">{fine.customers.phone}</p>
                  )}
                  <Link
                    href={`/clientes/${fine.customer_id}`}
                    className="text-[12px] text-fg-mute hover:text-primary transition-colors"
                  >
                    Ver cliente →
                  </Link>
                </>
              ) : (
                <div>
                  <p className="text-[13px] text-fg-mute">Sem cliente vinculado</p>
                  <Link
                    href={`/multas/${id}/editar`}
                    className="text-[12px] text-primary hover:underline"
                  >
                    Vincular cliente →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ── Cobrança ──────────────────────────────────────────────────────── */}
        {fine.responsible === 'customer' && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Cobrança</h2>
            {billing ? (
              <div className="bg-surface rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-[13px] text-fg">{billing.description}</p>
                  <p className="text-[12px] text-fg-mute mt-0.5">Vencimento: {fmt(billing.due_date)}</p>
                  {billing.paid_at && (
                    <p className="text-[12px] text-fg-mute">Pago em: {fmt(billing.paid_at)}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[15px] font-bold text-fg">{formatCurrency(Number(billing.original_amount))}</span>
                  {(() => {
                    // Atraso derivado do vencimento — não há status 'overdue'
                    // armazenado (Princípio 4).
                    const hoje = new Date().toISOString().slice(0, 10)
                    const bStatus = billing.status === 'open' && billing.due_date < hoje
                      ? 'overdue'
                      : billing.status
                    // Fallback obrigatório: sem ele, um status fora do mapa
                    // (era o caso de `written_off`) derruba a página inteira na
                    // linha seguinte, ao ler `.bg` de undefined.
                    const bCfg = BILLING_STATUS_CONFIG[bStatus] ?? BILLING_STATUS_CONFIG.open
                    return (
                      <span className={`inline-flex items-center h-7 px-3 rounded-full text-[13px] font-medium border ${bCfg.bg} ${bCfg.text} ${bCfg.border}`}>
                        {bCfg.label}
                      </span>
                    )
                  })()}
                  <Link
                    href={`/cobrancas/${billing.id}`}
                    className="text-[12px] text-primary hover:underline whitespace-nowrap"
                  >
                    Ver cobrança →
                  </Link>
                </div>
              </div>
            ) : (
              <div className="bg-surface rounded-xl p-4">
                <p className="text-[13px] text-fg-mute">Sem cobrança gerada ainda.</p>
              </div>
            )}
          </section>
        )}

        {/* ── Observações ───────────────────────────────────────────────────── */}
        {fine.observations && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Observações</h2>
            <div className="bg-surface rounded-xl px-4 py-3">
              <p className="text-[13px] text-fg-mute whitespace-pre-wrap">{fine.observations}</p>
            </div>
          </section>
        )}

        {/* ── Mensagem SENATRAN ────────────────────────────────────────────────── */}
        {fine.senatran_message && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Mensagem SENATRAN</h2>
            <div className="bg-surface rounded-xl px-4 py-3">
              <p className="text-[13px] text-fg-mute whitespace-pre-wrap">{fine.senatran_message}</p>
            </div>
          </section>
        )}

        {/* ── Documentos (client component) ─────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-bold text-primary mb-3">
            Documentos{attachments.length > 0 && (
              <span className="ml-2 text-[12px] font-normal text-fg-mute">({attachments.length})</span>
            )}
          </h2>

          {/* Legenda dos tipos — contexto para o operador */}
          <div className="mb-4 px-4 py-3 bg-surface border border-border rounded-xl">
            <p className="text-[12px] text-fg-mute leading-relaxed">
              <strong className="text-fg-mute">NA</strong> — Notificação de Autuação, sempre existe, abre defesa prévia e identificação de condutor.{' '}
              <strong className="text-fg-mute">NP</strong> — Notificação de Penalidade, chega depois se a responsabilidade não passar pro condutor.{' '}
              <strong className="text-fg-mute">Indicação de condutor</strong> — obrigatório para veículos de empresa no prazo do DENATRAN.{' '}
              <strong className="text-fg-mute">Boleto</strong> — guia de pagamento com código de barras.{' '}
              <strong className="text-fg-mute">Comprovante</strong> — guarda sempre para contabilidade.
            </p>
          </div>

          <FineAttachments fineId={id} attachments={attachments} driverUnidentified={driverUnidentified} />
        </section>

      </div>
    </div>
  )
}
