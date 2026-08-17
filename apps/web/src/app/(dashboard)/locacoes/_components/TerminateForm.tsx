'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, X, ChevronRight } from 'lucide-react'

import { useRentalOpenCharges, useDepositBalance, useRentalSchedule } from '@gomoto/data'
import {
  getEarlyTerminationImpact,
  CONTRACT_TERMINATION_FINE_BRL,
} from '@gomoto/core'
import type { Rental } from '@gomoto/core'
import { formatCurrency, formatDate } from '@/lib/utils'
import { terminateRental, closeRentalFinancial } from '../actions'

interface TerminateFormProps {
  rental: Rental
}

export function TerminateForm({ rental }: TerminateFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [terminationDate, setTerminationDate] = useState(
    rental.end_date ?? new Date().toISOString().slice(0, 10),
  )
  const [error, setError] = useState('')

  // Spec 0014: a apuração passa a olhar três coisas distintas — o que foi
  // emitido e não pago, o saldo de caução, e o cronograma ainda não emitido.
  // Antes, `useBillings` misturava documento e plano numa lista só.
  const chargesQuery  = useRentalOpenCharges(rental.id)
  const depositQuery  = useDepositBalance(rental.id)
  const scheduleQuery = useRentalSchedule(rental.id)

  // Consulta por LOCAÇÃO, não por cliente: antes o valor em aberto dependia de
  // `rental.customer_id` estar presente, e sem ele a apuração mostrava zero e o
  // encerramento falhava sem explicação.
  const openCharges = useMemo(() => chargesQuery.data ?? [], [chargesQuery.data])

  const openAmount     = openCharges.reduce((s, c) => s + c.open_amount, 0)
  const depositBalance = depositQuery.data ?? 0

  /**
   * O que o encerramento REALMENTE cancela, com o mesmo critério da RPC:
   * `status = 'scheduled' AND period_start > p_termination_date`.
   *
   * Duas coisas estavam erradas aqui. O alerta contava cobranças já EMITIDAS e
   * anunciava que seriam canceladas — o oposto do que acontece, e o oposto do
   * que o checkbox ao lado afirma. E o valor vinha de `contracted_backlog`,
   * que é todo o cronograma não emitido, sem olhar a data escolhida.
   *
   * Encerrando na data de fim do contrato, todos os períodos já começaram e
   * NADA é cancelado — a tela prometia três parcelas e cancelava zero. Como a
   * data é editável, os dois números precisam responder a ela.
   */
  const cancelable = useMemo(() => {
    const lines = (scheduleQuery.data?.lines ?? [])
      .filter(l => l.status === 'scheduled' && l.period_start > terminationDate)
    return { count: lines.length, total: lines.reduce((s, l) => s + l.amount, 0) }
  }, [scheduleQuery.data, terminationDate])

  const impact = useMemo(() => {
    if (!rental.start_date) return null
    return getEarlyTerminationImpact(
      openCharges.map(c => ({ due_date: c.due_date, status: 'pending' })),
      new Date(),
      rental.start_date,
      rental.contract_type ?? 'rental',
    )
  }, [openCharges, rental.start_date, rental.contract_type])

  /** Encerrar com débito em aberto exige confirmação explícita (F-08). */
  const [force, setForce] = useState(false)
  // Destino da caução. A locação encerra e o dinheiro do cliente precisa ir a
  // algum lugar — sem isto o passivo fica em aberto para sempre, sem caminho
  // no produto para devolver nem para reter.
  const [depositAction, setDepositAction] = useState<'full_return' | 'partial_return' | 'full_retention'>('full_return')
  const [retainedAmount, setRetainedAmount] = useState('')
  const [retentionReason, setRetentionReason] = useState('')

  const newStatus =
    rental.contract_type === 'rent_to_own' && impact && !impact.within_minimum
      ? 'transferred'
      : 'closed'

  function handleConfirm() {
    setError('')
    startTransition(async () => {
      const result = await terminateRental({
        lease_id:         rental.id,
        termination_date: terminationDate,
        new_status:       newStatus,
        force,
      })
      if (!result.ok) { setError(result.error.message); return }

      // Liquidação da caução, quando há saldo. `closeRentalFinancial` já existia
      // com toda a lógica — e sem nenhum chamador: a tela mostrava o saldo e
      // não oferecia como resolvê-lo.
      if (depositBalance > 0) {
        const retido = Number(retainedAmount.replace(',', '.')) || 0

        const payload =
          depositAction === 'full_return'
            ? { rental_id: rental.id, deposit_action: 'full_return' as const, return_date: terminationDate }
            : depositAction === 'full_retention'
              ? { rental_id: rental.id, deposit_action: 'full_retention' as const, retention_reason: retentionReason }
              : {
                  rental_id: rental.id,
                  deposit_action: 'partial_return' as const,
                  retained_amount: retido,
                  returned_amount: Math.round((depositBalance - retido) * 100) / 100,
                  retention_reason: retentionReason,
                  return_date: terminationDate,
                }

        const dep = await closeRentalFinancial(payload)
        if (!dep.ok) { setError(`Locação encerrada, mas a caução não foi liquidada: ${dep.error.message}`); return }
      }

      router.push('/locacoes')
    })
  }

  return (
    <div className="min-h-screen bg-bg">

      {/* Header */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-border bg-bg px-6 backdrop-blur">
        <Link href={`/locacoes/${rental.id}`} className="text-[13px] text-fg-mute transition-colors hover:text-fg">
          ← {rental.vehicle?.license_plate ?? 'Locação'}
        </Link>
        <span className="text-fg-mute">/</span>
        <h1 className="flex-1 text-[15px] font-bold text-fg">Encerrar locação</h1>
        <Link
          href={`/locacoes/${rental.id}`}
          className="inline-flex h-8 items-center rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !terminationDate || (openAmount > 0 && !force)}
          className="inline-flex h-8 items-center rounded-full bg-danger-bg px-5 text-[13px] font-bold text-danger transition-opacity hover:opacity-80 disabled:opacity-60"
        >
          {isPending ? 'Encerrando…' : 'Confirmar Encerramento'}
        </button>
      </div>

      <div className="mx-auto max-w-xl space-y-6 px-6 py-8">

        {/* Resumo da locação */}
        <div className="rounded-xl bg-surface p-4 text-[13px]">
          <p className="font-semibold text-fg">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="mt-0.5 text-fg-mute">{rental.customer?.name}</p>
          <p className="mt-0.5 text-fg-mute">
            {rental.start_date ? formatDate(rental.start_date) : '—'} até {rental.end_date ? formatDate(rental.end_date) : '—'}
          </p>
        </div>

        {/* Data de encerramento */}
        <div>
          <label className="mb-1.5 block text-[13px] text-fg-mute">Data de encerramento</label>
          <input
            type="date"
            value={terminationDate}
            onChange={e => setTerminationDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-fg outline-none transition-all focus:border-primary"
          />
        </div>

        {/* Apuração financeira — pré-requisito do encerramento (F-08) */}
        <div className="rounded-xl bg-surface p-4 text-[13px]">
          <p className="mb-2 font-semibold text-fg">Apuração financeira</p>

          <div className="flex justify-between py-0.5">
            <span className="text-fg-mute">Cobranças em aberto</span>
            <span className="tabular-nums">{formatCurrency(openAmount)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-fg-mute">Saldo de caução</span>
            <span className="tabular-nums">{formatCurrency(depositBalance)}</span>
          </div>
          <div className="flex justify-between py-0.5">
            <span className="text-fg-mute">Cronograma a cancelar</span>
            <span className="tabular-nums">{formatCurrency(cancelable.total)}</span>
          </div>

        </div>

        {depositBalance > 0 && (
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="text-[13px] font-bold text-fg">Destino da caução</h2>
            <p className="mt-1 text-[12px] text-fg-mute">
              O dinheiro do cliente está em custódia. Encerrar sem decidir o destino
              deixaria o passivo em aberto.
            </p>

            <div className="mt-3 flex flex-col gap-2">
              {([
                ['full_return', `Devolver tudo (${formatCurrency(depositBalance)})`],
                ['partial_return', 'Reter parte e devolver o resto'],
                ['full_retention', 'Reter tudo'],
              ] as const).map(([valor, rotulo]) => (
                <label key={valor} className="flex items-center gap-2 text-[13px] text-fg">
                  <input
                    type="radio"
                    name="deposit_action"
                    value={valor}
                    checked={depositAction === valor}
                    onChange={() => setDepositAction(valor)}
                    className="accent-primary"
                  />
                  {rotulo}
                </label>
              ))}
            </div>

            {depositAction === 'partial_return' && (
              <div className="mt-3">
                <label className="text-[12px] text-fg-mute" htmlFor="retido">Valor retido (R$)</label>
                <input
                  id="retido"
                  type="number"
                  step="0.01"
                  min="0"
                  max={depositBalance}
                  value={retainedAmount}
                  onChange={(e) => setRetainedAmount(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-fg"
                  placeholder="0,00"
                />
              </div>
            )}

            {depositAction !== 'full_return' && (
              <div className="mt-3">
                <label className="text-[12px] text-fg-mute" htmlFor="motivo">Motivo da retenção</label>
                <input
                  id="motivo"
                  value={retentionReason}
                  onChange={(e) => setRetentionReason(e.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-fg"
                  placeholder="Avaria no para-choque, diária em aberto…"
                />
              </div>
            )}
          </div>
        )}

        {openAmount > 0 && (
          <label className="flex items-start gap-2 rounded-lg border border-danger bg-danger-bg px-3 py-2.5 text-[13px] text-danger">
            <input
              type="checkbox"
              checked={force}
              onChange={e => setForce(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Encerrar mesmo com {formatCurrency(openAmount)} em aberto. As cobranças
              continuam cobráveis após o encerramento.
            </span>
          </label>
        )}

        {/* Alertas de impacto */}
        {impact && (
          <div className="space-y-2">
            {impact.overdue_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-bg px-3 py-2.5 text-[13px] text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {impact.overdue_count} cobrança{impact.overdue_count !== 1 ? 's' : ''} vencida
                  {impact.overdue_count !== 1 ? 's' : ''} permanece{impact.overdue_count !== 1 ? 'm' : ''} em aberto após o encerramento.
                </span>
              </div>
            )}
            {/* Dizia "N cobranças futuras serão canceladas" contando cobranças
                JÁ EMITIDAS com vencimento à frente — e elas não são canceladas.
                Ficava ao lado do checkbox que afirma o contrário ("as cobranças
                continuam cobráveis"), sobre exatamente o mesmo dinheiro. O que
                o encerramento cancela é o cronograma ainda não emitido. */}
            {cancelable.count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] text-fg-mute">
                <X className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {cancelable.count} parcela{cancelable.count !== 1 ? 's' : ''} ainda não emitida
                  {cancelable.count !== 1 ? 's' : ''} ser{cancelable.count !== 1 ? 'ão' : 'á'} cancelada
                  {cancelable.count !== 1 ? 's' : ''}. Cobrança já emitida não é cancelada pelo
                  encerramento.
                </span>
              </div>
            )}
            {impact.within_minimum && (
              <div className="flex items-start gap-2 rounded-lg border border-warning bg-warning-bg px-3 py-2.5 text-[13px] text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Rescisão dentro da vigência mínima —{' '}
                  <strong>multa contratual de {formatCurrency(CONTRACT_TERMINATION_FINE_BRL)} aplicável</strong>.
                </span>
              </div>
            )}
            {newStatus === 'transferred' && (
              <div className="flex items-start gap-2 rounded-lg border border-info bg-info-bg px-3 py-2.5 text-[13px] text-info">
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Compra Programada cumprida — status será alterado para <strong>Transferida</strong>.</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-[13px] text-danger">{error}</p>
        )}
      </div>
    </div>
  )
}
