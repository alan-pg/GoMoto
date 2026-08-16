'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'

import type { Rental } from '@gomoto/core'
import { generateSchedule } from '@gomoto/core'
import { formatCurrency, formatDate } from '@/lib/utils'
import { renewRental } from '../actions'

interface RenewFormProps {
  rental: Rental
}

export function RenewForm({ rental }: RenewFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [newEndDate, setNewEndDate] = useState('')
  const [error, setError] = useState('')

  /**
   * Prévia pela MESMA função que a action usa para gravar (`generateSchedule`),
   * então o que o operador confere é o que vai ser criado — não uma estimativa
   * paralela que diverge no primeiro caso de pro rata.
   */
  const preview = useMemo(() => {
    if (!rental.end_date || !newEndDate || newEndDate <= rental.end_date) return null
    if (!rental.cycle || !rental.due_day || !rental.cycle_amount) return null

    const lines = generateSchedule({
      start_date:   rental.end_date,
      end_date:     newEndDate,
      cycle:        rental.cycle as 'weekly' | 'monthly',
      due_day:      rental.due_day,
      cycle_amount: rental.cycle_amount,
      use_pro_rata: rental.use_pro_rata ?? true,
    })

    return { count: lines.length, total: lines.reduce((s, l) => s + l.amount, 0) }
  }, [rental.end_date, rental.cycle, rental.due_day, rental.cycle_amount, rental.use_pro_rata, newEndDate])

  const isShortening = Boolean(
    rental.end_date && newEndDate && newEndDate <= rental.end_date,
  )

  function handleConfirm() {
    if (!rental.end_date || !newEndDate) return
    setError('')
    startTransition(async () => {
      const result = await renewRental({
        lease_id:         rental.id,
        new_end_date:     newEndDate,
        current_end_date: rental.end_date!,
      })
      if (!result.ok) { setError(result.error.message); return }
      router.push(`/locacoes/${rental.id}`)
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
        <h1 className="flex-1 text-[15px] font-bold text-fg">Renovar locação</h1>
        <Link
          href={`/locacoes/${rental.id}`}
          className="inline-flex h-8 items-center rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:border-fg-mute hover:text-fg"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !newEndDate || isShortening}
          className="inline-flex h-8 items-center rounded-full bg-primary px-5 text-[13px] font-bold text-bg transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {isPending ? 'Renovando…' : 'Confirmar Renovação'}
        </button>
      </div>

      <div className="mx-auto max-w-md space-y-6 px-6 py-8">

        {/* Resumo */}
        <div className="rounded-xl bg-surface p-4 text-[13px]">
          <p className="font-semibold text-fg">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="mt-0.5 text-fg-mute">{rental.customer?.name}</p>
          <p className="mt-1.5 text-fg-mute">
            Fim atual: <span className="font-medium text-fg">
              {rental.end_date ? formatDate(rental.end_date) : '—'}
            </span>
          </p>
        </div>

        {/* Nova data de fim */}
        <div>
          <label className="mb-1.5 block text-[13px] text-fg-mute">Nova data de fim *</label>
          <input
            type="date"
            min={rental.end_date ?? undefined}
            value={newEndDate}
            onChange={e => setNewEndDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-fg outline-none transition-all focus:border-primary"
          />
          <p className="mt-1 text-[12px] text-fg-mute">
            A renovação estende o cronograma. Cada parcela vira cobrança quando o
            período dela chegar — nada é emitido agora.
          </p>
        </div>

        {isShortening && (
          <p className="text-[13px] text-pending">
            A nova data precisa ser posterior a {formatDate(rental.end_date!)}. Para
            encurtar o contrato, use Encerrar.
          </p>
        )}

        {preview && (
          <div className="rounded-xl border border-border bg-surface-2 p-3 text-[13px]">
            <div className="flex justify-between">
              <span className="text-fg-mute">Parcelas acrescentadas</span>
              <span className="tabular-nums">{preview.count}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-fg-mute">Total do período estendido</span>
              <span className="tabular-nums font-medium">{formatCurrency(preview.total)}</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-danger bg-danger-bg px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
            <p className="text-[13px] text-danger">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
