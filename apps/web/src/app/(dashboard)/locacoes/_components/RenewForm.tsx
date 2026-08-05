'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'

import type { Rental } from '@gomoto/core'
import { formatDate } from '@/lib/utils'
import { renewRental } from '../actions'

interface RenewFormProps {
  rental: Rental
}

export function RenewForm({ rental }: RenewFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [newEndDate, setNewEndDate] = useState('')
  const [error, setError] = useState('')

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
    <div className="min-h-screen bg-[#121212]">

      {/* Header */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[#2a2a2a] bg-[#121212]/95 px-6 backdrop-blur">
        <Link href={`/locacoes/${rental.id}`} className="text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← {rental.vehicle?.license_plate ?? 'Locação'}
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="flex-1 text-[15px] font-bold text-[#f5f5f5]">Renovar locação</h1>
        <Link
          href={`/locacoes/${rental.id}`}
          className="inline-flex h-8 items-center rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !newEndDate}
          className="inline-flex h-8 items-center rounded-full bg-[#BAFF1A] px-5 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e616] disabled:opacity-60"
        >
          {isPending ? 'Renovando…' : 'Confirmar Renovação'}
        </button>
      </div>

      <div className="mx-auto max-w-md space-y-6 px-6 py-8">

        {/* Resumo */}
        <div className="rounded-xl bg-[#202020] p-4 text-[13px]">
          <p className="font-semibold text-[#f5f5f5]">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="mt-0.5 text-[#9e9e9e]">{rental.customer?.name}</p>
          <p className="mt-1.5 text-[#9e9e9e]">
            Fim atual: <span className="font-medium text-[#f5f5f5]">
              {rental.end_date ? formatDate(rental.end_date) : '—'}
            </span>
          </p>
        </div>

        {/* Nova data de fim */}
        <div>
          <label className="mb-1.5 block text-[13px] text-[#9e9e9e]">Nova data de fim *</label>
          <input
            type="date"
            min={rental.end_date ?? undefined}
            value={newEndDate}
            onChange={e => setNewEndDate(e.target.value)}
            className="h-9 w-full rounded-lg border border-[#474747] bg-[#282828] px-3 text-[13px] text-[#f5f5f5] outline-none transition-all focus:border-[#BAFF1A]"
          />
          <p className="mt-1 text-[12px] text-[#616161]">
            Novas cobranças serão geradas automaticamente para o período estendido.
          </p>
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-[#ff9c9a]/30 bg-[#7c1c1c] px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9c9a]" />
            <p className="text-[13px] text-[#ff9c9a]">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
