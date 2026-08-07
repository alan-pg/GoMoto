import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { formatCurrency } from '@/lib/utils'
import { FineAttachments, type FineAttachment, type AttachmentType } from './_components/FineAttachments'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

function calcStatus(fine: { status: string; due_date?: string | null }) {
  if (fine.status === 'paid') return 'paid'
  if (fine.due_date) {
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const [y, m, d] = fine.due_date.split('-').map(Number)
    const due = new Date(y, m - 1, d)
    if (due < today) return 'overdue'
    const diff = Math.ceil((due.getTime() - today.getTime()) / 86_400_000)
    if (diff <= 7) return 'due_soon'
  }
  return 'pending'
}

const STATUS_CONFIG = {
  paid:     { label: 'Paga',     bg: 'bg-success-bg', text: 'text-success', border: 'border-success' },
  overdue:  { label: 'Vencida',  bg: 'bg-danger-bg', text: 'text-danger', border: 'border-danger' },
  due_soon: { label: 'A vencer', bg: 'bg-warning-bg', text: 'text-warning', border: 'border-warning' },
  pending:  { label: 'Pendente', bg: 'bg-info-bg', text: 'text-info', border: 'border-info' },
}

const SOURCE_LABELS: Record<string, string> = {
  detran:       'DETRAN',
  cetran:       'CETRAN',
  municipal:    'Municipal (CET / SMTT)',
  private_area: 'Área privada',
  other:        'Outro',
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

  const [fineResult, attachmentsResult] = await Promise.all([
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
  ])

  if (fineResult.error || !fineResult.data) notFound()

  const fine        = fineResult.data
  const rawAtts     = attachmentsResult.data ?? []
  const status      = calcStatus(fine)
  const statusCfg   = STATUS_CONFIG[status]

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
                  ['Artigo (CTB)',       fine.infraction_code],
                  ['Órgão autuador',    fine.source ? SOURCE_LABELS[fine.source] ?? fine.source : null],
                  ['Local',             fine.infraction_location],
                  ['Nº do AIT',         fine.ait_number],
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
                  ['Data da infração',  fmt(fine.infraction_date)],
                  ['Vencimento',        fmt(fine.due_date)],
                  ['Pago em',           fmt(fine.payment_date)],
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
                  <p className="text-[13px] text-fg-mute">Condutor não identificado</p>
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

        {/* ── Link do boleto ────────────────────────────────────────────────── */}
        {fine.ticket_url && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Boleto / Notificação</h2>
            <div className="bg-surface rounded-xl px-4 py-3">
              <a
                href={fine.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[13px] text-info hover:text-[#c4a0ff] transition-colors break-all"
              >
                {fine.ticket_url}
              </a>
            </div>
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
              <strong className="text-fg-mute">AIT</strong> — documento original da autuação.{' '}
              <strong className="text-fg-mute">NIP</strong> — notificação que abre prazo de defesa (30 dias).{' '}
              <strong className="text-fg-mute">Indicação de condutor</strong> — obrigatório para veículos de empresa no prazo do DENATRAN.{' '}
              <strong className="text-fg-mute">Comprovante</strong> — guarda sempre para contabilidade.
            </p>
          </div>

          <FineAttachments fineId={id} attachments={attachments} />
        </section>

      </div>
    </div>
  )
}
