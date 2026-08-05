'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'

import { createOneTimeCharge } from '../../actions'

// ─── Wrapper server → client ──────────────────────────────────────────────────
// Esta page é Client Component pois o formulário não requer dados server-side

export default function OneTimeChargePage({
  params,
}: {
  params: { id: string }
}) {
  const rentalId = params.id
  const router   = useRouter()
  const [isPending, startTransition] = useTransition()

  const [form,  setForm]  = useState({ description: '', amount: '', due_date: '' })
  const [error, setError] = useState('')

  function set(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const isReady = form.description && form.amount && form.due_date

  function handleConfirm() {
    const amount = parseFloat(form.amount)
    if (!form.description || isNaN(amount) || !form.due_date) return
    setError('')
    startTransition(async () => {
      const result = await createOneTimeCharge({
        lease_id:    rentalId,
        description: form.description,
        amount,
        due_date:    form.due_date,
      })
      if (!result.ok) { setError(result.error.message); return }
      router.push(`/locacoes/${rentalId}`)
    })
  }

  const inputCls = 'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all'
  const labelCls = 'block mb-1.5 text-[13px] text-[#9e9e9e]'

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* Header */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[#2a2a2a] bg-[#121212]/95 px-6 backdrop-blur">
        <Link href={`/locacoes/${rentalId}`} className="text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Locação
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="flex-1 text-[15px] font-bold text-[#f5f5f5]">Cobrança avulsa</h1>
        <Link
          href={`/locacoes/${rentalId}`}
          className="inline-flex h-8 items-center rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !isReady}
          className="inline-flex h-8 items-center rounded-full bg-[#BAFF1A] px-5 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e616] disabled:opacity-60"
        >
          {isPending ? 'Criando…' : 'Criar Cobrança'}
        </button>
      </div>

      <div className="mx-auto max-w-md space-y-5 px-6 py-8">

        <div>
          <label className={labelCls}>Descrição *</label>
          <input
            className={inputCls}
            placeholder="Ex.: Taxa de devolução, lavagem, dano…"
            value={form.description}
            onChange={e => set('description', e.target.value)}
            maxLength={300}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Valor (R$) *</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              placeholder="0,00"
              className={inputCls}
              value={form.amount}
              onChange={e => set('amount', e.target.value)}
            />
          </div>
          <div>
            <label className={labelCls}>Vencimento *</label>
            <input
              type="date"
              className={inputCls}
              value={form.due_date}
              onChange={e => set('due_date', e.target.value)}
            />
          </div>
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
