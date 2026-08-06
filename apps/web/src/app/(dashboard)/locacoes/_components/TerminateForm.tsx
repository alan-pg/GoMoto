'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, X, ChevronRight } from 'lucide-react'

import { useBillings } from '@gomoto/data'
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

  const billingsQuery = useBillings({ lease_id: rental.id })
  const billings      = billingsQuery.data ?? []

  const impact = useMemo(() => {
    if (!rental.start_date) return null
    return getEarlyTerminationImpact(
      billings.map(b => ({ due_date: b.due_date, status: b.status })),
      new Date(),
      rental.start_date,
      rental.contract_type ?? 'rental',
    )
  }, [billings, rental.start_date, rental.contract_type])

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
          disabled={isPending || !terminationDate}
          className="inline-flex h-8 items-center rounded-full bg-danger-bg px-5 text-[13px] font-bold text-danger transition-colors hover:bg-[#9c2c2c] disabled:opacity-60"
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

        {/* Alertas de impacto */}
        {impact && (
          <div className="space-y-2">
            {impact.overdue_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-warning bg-[#3a1200] px-3 py-2.5 text-[13px] text-[#ffa040]">
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
              <div className="flex items-start gap-2 rounded-lg border border-warning bg-[#2a2000] px-3 py-2.5 text-[13px] text-[#fde047]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Rescisão dentro da vigência mínima —{' '}
                  <strong>multa contratual de {formatCurrency(CONTRACT_TERMINATION_FINE_BRL)} aplicável</strong>.
                </span>
              </div>
            )}
            {newStatus === 'transferred' && (
              <div className="flex items-start gap-2 rounded-lg border border-info bg-[#0a1f3a] px-3 py-2.5 text-[13px] text-info">
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
