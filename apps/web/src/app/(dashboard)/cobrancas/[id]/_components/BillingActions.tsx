'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { formatCurrency } from '@/lib/utils'
import { registerPayment, waiveCharges, applyCredit, cancelBilling } from '../actions'

interface AvailableCredit {
  id: string
  amount: number
  available_balance: number
  origin: string
  reason: string
}

interface BillingActionsProps {
  billingId: string
  status: string
  amountDue: number
  chargesWaived: boolean
  availableCredits: AvailableCredit[]
}

const PAYMENT_METHOD_OPTIONS = [
  { label: 'PIX', value: 'pix' },
  { label: 'Dinheiro', value: 'cash' },
  { label: 'Cartão de crédito', value: 'credit_card' },
  { label: 'Cartão de débito', value: 'debit_card' },
  { label: 'Transferência bancária', value: 'bank_transfer' },
  { label: 'Outro', value: 'other' },
]

const CREDIT_ORIGIN_LABELS: Record<string, string> = {
  maintenance_refund: 'Estorno manutenção',
  reversal:          'Estorno',
  manual_adjustment: 'Ajuste manual',
}

export function BillingActions({ billingId, status, amountDue, chargesWaived, availableCredits }: BillingActionsProps) {
  const [isPending, startTransition] = useTransition()
  const [flashError, setFlashError] = useState<string | null>(null)

  const [payOpen, setPayOpen]     = useState(false)
  const [waiveOpen, setWaiveOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  // Register Payment form
  const [payAmount, setPayAmount]   = useState(amountDue > 0 ? amountDue.toFixed(2) : '')
  const [payMethod, setPayMethod]   = useState('pix')
  const [payNotes, setPayNotes]     = useState('')

  // Waive Charges form
  const [waiveReason, setWaiveReason] = useState('')

  // Apply Credit form
  const [selectedCredit, setSelectedCredit] = useState(availableCredits[0]?.id ?? '')
  const [creditAmount, setCreditAmount]     = useState('')

  const isActionable = status !== 'paid' && status !== 'cancelled'
  const hasCredits = availableCredits.length > 0 && isActionable

  function handlePay() {
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) { setFlashError('Valor inválido'); return }
    setFlashError(null)
    startTransition(async () => {
      const result = await registerPayment({
        billing_id:     billingId,
        amount,
        payment_method: payMethod,
        paid_at:        new Date().toISOString(),
        notes:          payNotes || undefined,
      })
      if (!result.ok) { setFlashError(result.error.message); return }
      setPayOpen(false)
      setPayNotes('')
    })
  }

  function handleWaive() {
    if (waiveReason.trim().length < 5) { setFlashError('Motivo deve ter ao menos 5 caracteres'); return }
    setFlashError(null)
    startTransition(async () => {
      const result = await waiveCharges({ billing_id: billingId, reason: waiveReason.trim() })
      if (!result.ok) { setFlashError(result.error.message); return }
      setWaiveOpen(false)
      setWaiveReason('')
    })
  }

  function handleCredit() {
    const amount = parseFloat(creditAmount)
    if (!selectedCredit) { setFlashError('Selecione um crédito'); return }
    if (isNaN(amount) || amount <= 0) { setFlashError('Valor inválido'); return }
    setFlashError(null)
    startTransition(async () => {
      const result = await applyCredit({ billing_id: billingId, credit_id: selectedCredit, amount })
      if (!result.ok) { setFlashError(result.error.message); return }
      setCreditOpen(false)
      setCreditAmount('')
    })
  }

  function handleCancel() {
    setFlashError(null)
    startTransition(async () => {
      const result = await cancelBilling({ billing_id: billingId })
      if (!result.ok) { setFlashError(result.error.message); return }
      setCancelOpen(false)
    })
  }

  return (
    <>
      {flashError && (
        <div className="rounded-xl border border-[#ff9c9a]/30 bg-[#7c1c1c] px-4 py-3">
          <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isActionable && (
          <button
            onClick={() => { setFlashError(null); setPayAmount(amountDue > 0 ? amountDue.toFixed(2) : ''); setPayOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#BAFF1A] px-4 text-[13px] font-semibold text-[#121212] transition-colors hover:bg-[#ccff40] disabled:opacity-50"
          >
            Registrar pagamento
          </button>
        )}
        {isActionable && !chargesWaived && (
          <button
            onClick={() => { setFlashError(null); setWaiveOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5] disabled:opacity-50"
          >
            Dispensar encargos
          </button>
        )}
        {hasCredits && (
          <button
            onClick={() => { setFlashError(null); setCreditOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5] disabled:opacity-50"
          >
            Aplicar crédito
          </button>
        )}
        {isActionable && (
          <button
            onClick={() => { setFlashError(null); setCancelOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#ff9c9a]/20 bg-[#7c1c1c]/50 px-4 text-[13px] text-[#ff9c9a] transition-colors hover:bg-[#7c1c1c] disabled:opacity-50"
          >
            Cancelar cobrança
          </button>
        )}
      </div>

      {/* ── Registrar pagamento ────────────────────────────────────────────── */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Registrar pagamento">
        <div className="space-y-4">
          <Input
            label="Valor pago (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={payAmount}
            onChange={e => setPayAmount(e.target.value)}
          />
          <Select
            label="Forma de pagamento"
            value={payMethod}
            onChange={e => setPayMethod(e.target.value)}
            options={PAYMENT_METHOD_OPTIONS}
          />
          <Textarea
            label="Observações (opcional)"
            value={payNotes}
            onChange={e => setPayNotes(e.target.value)}
            rows={2}
          />
          {flashError && <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setPayOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handlePay}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-[#BAFF1A] text-[13px] font-semibold text-[#121212] hover:bg-[#ccff40] disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Confirmar pagamento'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Dispensar encargos ─────────────────────────────────────────────── */}
      <Modal open={waiveOpen} onClose={() => setWaiveOpen(false)} title="Dispensar encargos">
        <div className="space-y-4">
          <p className="text-[13px] text-[#9e9e9e]">
            Os encargos (multa e juros) desta cobrança serão zerados. Essa ação é irreversível.
          </p>
          <Textarea
            label="Motivo"
            value={waiveReason}
            onChange={e => setWaiveReason(e.target.value)}
            rows={3}
            placeholder="Explique o motivo da dispensa…"
          />
          {flashError && <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setWaiveOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handleWaive}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-[#BAFF1A] text-[13px] font-semibold text-[#121212] hover:bg-[#ccff40] disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Confirmar dispensa'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Aplicar crédito ────────────────────────────────────────────────── */}
      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title="Aplicar crédito">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[13px] text-[#9e9e9e]">Crédito disponível</label>
            <select
              value={selectedCredit}
              onChange={e => setSelectedCredit(e.target.value)}
              className="w-full rounded-lg border border-[#323232] bg-[#202020] px-3 py-2 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              {availableCredits.map(c => (
                <option key={c.id} value={c.id}>
                  {CREDIT_ORIGIN_LABELS[c.origin] ?? c.origin} — saldo {formatCurrency(c.available_balance)}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Valor a aplicar (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={creditAmount}
            onChange={e => setCreditAmount(e.target.value)}
            placeholder={selectedCredit ? formatCurrency(availableCredits.find(c => c.id === selectedCredit)?.available_balance ?? 0) : ''}
          />
          {flashError && <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCreditOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handleCredit}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-[#BAFF1A] text-[13px] font-semibold text-[#121212] hover:bg-[#ccff40] disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Aplicar crédito'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Cancelar cobrança ──────────────────────────────────────────────── */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar cobrança">
        <div className="space-y-4">
          <p className="text-[13px] text-[#9e9e9e]">
            Esta cobrança será cancelada e não poderá mais ser reativada. Confirma?
          </p>
          {flashError && <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCancelOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5]"
            >
              Voltar
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#ff9c9a]/30 bg-[#7c1c1c] text-[13px] text-[#ff9c9a] hover:bg-[#9c2c2c] disabled:opacity-50"
            >
              {isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
