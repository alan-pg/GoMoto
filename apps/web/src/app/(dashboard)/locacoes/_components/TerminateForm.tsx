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
    <div className="min-h-screen bg-[#121212]">

      {/* Header */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[#2a2a2a] bg-[#121212]/95 px-6 backdrop-blur">
        <Link href={`/locacoes/${rental.id}`} className="text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← {rental.vehicle?.license_plate ?? 'Locação'}
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="flex-1 text-[15px] font-bold text-[#f5f5f5]">Encerrar locação</h1>
        <Link
          href={`/locacoes/${rental.id}`}
          className="inline-flex h-8 items-center rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !terminationDate}
          className="inline-flex h-8 items-center rounded-full bg-[#7c1c1c] px-5 text-[13px] font-bold text-[#ff9c9a] transition-colors hover:bg-[#9c2c2c] disabled:opacity-60"
        >
          {isPending ? 'Encerrando…' : 'Confirmar Encerramento'}
        </button>
      </div>

      <div className="mx-auto max-w-xl space-y-6 px-6 py-8">

        {/* Resumo da locação */}
        <div className="rounded-xl bg-[#202020] p-4 text-[13px]">
          <p className="font-semibold text-[#f5f5f5]">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="mt-0.5 text-[#9e9e9e]">{rental.customer?.name}</p>
          <p className="mt-0.5 text-[#9e9e9e]">
            {rental.start_date ? formatDate(rental.start_date) : '—'} até {rental.end_date ? formatDate(rental.end_date) : '—'}
          </p>
        </div>

        {/* Data de encerramento */}
        <div>
          <label className="mb-1.5 block text-[13px] text-[#9e9e9e]">Data de encerramento</label>
          <input
            type="date"
            value={terminationDate}
            onChange={e => setTerminationDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#474747] bg-[#282828] px-3 text-[13px] text-[#f5f5f5] outline-none transition-all focus:border-[#BAFF1A]"
          />
        </div>

        {/* Alertas de impacto */}
        {impact && (
          <div className="space-y-2">
            {impact.overdue_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#e65e24] bg-[#3a1200] px-3 py-2.5 text-[13px] text-[#ffa040]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {impact.overdue_count} cobrança{impact.overdue_count !== 1 ? 's' : ''} vencida
                  {impact.overdue_count !== 1 ? 's' : ''} permanece{impact.overdue_count !== 1 ? 'm' : ''} em aberto após o encerramento.
                </span>
              </div>
            )}
            {impact.future_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#474747] bg-[#202020] px-3 py-2.5 text-[13px] text-[#9e9e9e]">
                <X className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {impact.future_count} cobrança{impact.future_count !== 1 ? 's' : ''} futura
                  {impact.future_count !== 1 ? 's' : ''} ser{impact.future_count !== 1 ? 'ão' : 'á'} cancelada{impact.future_count !== 1 ? 's' : ''}.
                </span>
              </div>
            )}
            {impact.within_minimum && (
              <div className="flex items-start gap-2 rounded-lg border border-[#eab308] bg-[#2a2000] px-3 py-2.5 text-[13px] text-[#fde047]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Rescisão dentro da vigência mínima —{' '}
                  <strong>multa contratual de {formatCurrency(CONTRACT_TERMINATION_FINE_BRL)} aplicável</strong>.
                </span>
              </div>
            )}
            {newStatus === 'transferred' && (
              <div className="flex items-start gap-2 rounded-lg border border-[#60a5fa] bg-[#0a1f3a] px-3 py-2.5 text-[13px] text-[#60a5fa]">
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Compra Programada cumprida — status será alterado para <strong>Transferida</strong>.</span>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-[13px] text-[#ff9c9a]">{error}</p>
        )}
      </div>
    </div>
  )
}
