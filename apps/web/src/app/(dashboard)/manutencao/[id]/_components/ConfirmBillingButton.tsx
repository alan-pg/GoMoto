'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { confirmAutoBilling } from '../actions'

interface ConfirmBillingButtonProps {
  maintenanceId: string
  defaultAmount: number
  vehicleId: string
}

export function ConfirmBillingButton({ maintenanceId, defaultAmount, vehicleId: _vehicleId }: ConfirmBillingButtonProps) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen]         = useState(false)
  const [flashError, setFlashError] = useState<string | null>(null)
  const [refused, setRefused]   = useState(false)

  const [amount, setAmount]   = useState(defaultAmount.toFixed(2))
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  )

  const lateChargeConfig = {
    late_fee_type:       'percentage' as const,
    late_fee_value:      0.02,
    daily_interest_rate: 0.001,
    grace_period_days:   3,
  }

  function handleConfirm() {
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed <= 0) { setFlashError('Valor inválido'); return }
    if (!dueDate) { setFlashError('Data obrigatória'); return }
    setFlashError(null)
    startTransition(async () => {
      const result = await confirmAutoBilling({
        action:         'confirm',
        maintenance_id: maintenanceId,
        amount:         parsed,
        due_date:       dueDate,
        late_charge_config: lateChargeConfig,
      })
      if (!result.ok) { setFlashError(result.error.message); return }
      if (result.data && 'no_active_rental' in result.data && result.data.no_active_rental) {
        setFlashError('Nenhuma locação ativa encontrada para este veículo.')
        return
      }
      setOpen(false)
    })
  }

  function handleRefuse() {
    setFlashError(null)
    startTransition(async () => {
      const result = await confirmAutoBilling({
        action:         'refuse',
        maintenance_id: maintenanceId,
      })
      if (!result.ok) { setFlashError(result.error.message); return }
      setRefused(true)
      setOpen(false)
    })
  }

  if (refused) {
    return (
      <p className="text-[13px] text-fg-mute">Cobrança recusada — não será gerada.</p>
    )
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          onClick={() => { setFlashError(null); setOpen(true) }}
          disabled={isPending}
          className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
        >
          Gerar cobrança
        </button>
        <button
          onClick={handleRefuse}
          disabled={isPending}
          className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:border-fg-mute hover:text-fg disabled:opacity-50"
        >
          Não cobrar
        </button>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Gerar cobrança de manutenção">
        <div className="space-y-4">
          <Input
            label="Valor (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
          />
          <Input
            label="Vencimento"
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          {flashError && <p className="text-[13px] text-danger">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-border text-[13px] text-fg-mute hover:text-fg"
            >
              Cancelar
            </button>
            <button
              onClick={handleConfirm}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-primary text-[13px] font-semibold text-bg hover:bg-primary-hover disabled:opacity-50"
            >
              {isPending ? 'Gerando…' : 'Confirmar cobrança'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
