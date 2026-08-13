'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, X, ChevronRight } from 'lucide-react'

import { useOpenCharges, useDepositBalance, useRentalSchedule } from '@gomoto/data'
import {
  getEarlyTerminationImpact,
  CONTRACT_TERMINATION_FINE_BRL,
} from '@gomoto/core'
import type { Rental } from '@gomoto/core'
import { formatCurrency, formatDate } from '@/lib/utils'
import { terminateRental } from '../actions'

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
  const chargesQuery  = useOpenCharges(rental.customer_id ?? undefined)
  const depositQuery  = useDepositBalance(rental.id)
  const scheduleQuery = useRentalSchedule(rental.id)

  const openCharges = useMemo(
    () => (chargesQuery.data ?? []).filter(c => c.rental_id === rental.id),
    [chargesQuery.data, rental.id],
  )

  const openAmount     = openCharges.reduce((s, c) => s + c.amount_due, 0)
  const depositBalance = depositQuery.data ?? 0
  const backlog        = scheduleQuery.data?.contracted_backlog ?? 0

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
            <span className="tabular-nums">{formatCurrency(backlog)}</span>
          </div>

          {depositBalance > 0 && (
            <p className="mt-2 border-t border-border pt-2 text-[12px] text-fg-mute">
              A caução permanece como passivo até ser retida ou devolvida — o encerramento
              não a movimenta sozinho.
            </p>
          )}
        </div>

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
            {impact.future_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-[13px] text-fg-mute">
                <X className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {impact.future_count} cobrança{impact.future_count !== 1 ? 's' : ''} futura
                  {impact.future_count !== 1 ? 's' : ''} ser{impact.future_count !== 1 ? 'ão' : 'á'} cancelada{impact.future_count !== 1 ? 's' : ''}.
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
