'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { registerVehicleSale, updateAcquisitionValue } from '../actions'

interface VehicleFinancialActionsProps {
  vehicleId: string
  hasAcquisitionValue: boolean
  alreadySold: boolean
}

export function VehicleFinancialActions({ vehicleId, hasAcquisitionValue, alreadySold }: VehicleFinancialActionsProps) {
  const [isPending, startTransition] = useTransition()
  const [flashError, setFlashError] = useState<string | null>(null)

  const [saleOpen, setSaleOpen]         = useState(false)
  const [acquisitionOpen, setAcquisitionOpen] = useState(false)

  const [saleValue, setSaleValue]             = useState('')
  const [soldAt, setSoldAt]                   = useState(new Date().toISOString().slice(0, 10))
  const [acquisitionValue, setAcquisitionValue] = useState('')

  function handleSale() {
    const amount = parseFloat(saleValue)
    if (isNaN(amount) || amount <= 0) { setFlashError('Valor inválido'); return }
    if (!soldAt) { setFlashError('Data obrigatória'); return }
    setFlashError(null)
    startTransition(async () => {
      const result = await registerVehicleSale({ vehicle_id: vehicleId, sale_value: amount, sold_at: soldAt })
      if (!result.ok) { setFlashError(result.error.message); return }
      setSaleOpen(false)
    })
  }

  function handleAcquisition() {
    const amount = parseFloat(acquisitionValue)
    if (isNaN(amount) || amount <= 0) { setFlashError('Valor inválido'); return }
    setFlashError(null)
    startTransition(async () => {
      const result = await updateAcquisitionValue({ vehicle_id: vehicleId, acquisition_value: amount })
      if (!result.ok) { setFlashError(result.error.message); return }
      setAcquisitionOpen(false)
    })
  }

  return (
    <>
      {flashError && (
        <div className="mb-3 rounded-xl border border-[#ff9c9a]/30 bg-[#7c1c1c] px-4 py-3">
          <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => { setFlashError(null); setAcquisitionOpen(true) }}
          disabled={isPending}
          className="inline-flex h-9 items-center rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5] disabled:opacity-50"
        >
          {hasAcquisitionValue ? 'Atualizar valor de aquisição' : 'Cadastrar valor de aquisição'}
        </button>
        {!alreadySold && (
          <button
            onClick={() => { setFlashError(null); setSaleOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center rounded-full bg-[#BAFF1A] px-4 text-[13px] font-semibold text-[#121212] transition-colors hover:bg-[#ccff40] disabled:opacity-50"
          >
            Registrar alienação
          </button>
        )}
      </div>

      {/* ── Registrar alienação ────────────────────────────────────────── */}
      <Modal open={saleOpen} onClose={() => setSaleOpen(false)} title="Registrar alienação">
        <div className="space-y-4">
          <p className="text-[13px] text-[#9e9e9e]">
            Registre o valor pelo qual o veículo foi vendido. Esta ação é definitiva.
          </p>
          <Input
            label="Valor de venda (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={saleValue}
            onChange={e => setSaleValue(e.target.value)}
          />
          <Input
            label="Data da venda"
            type="date"
            value={soldAt}
            onChange={e => setSoldAt(e.target.value)}
          />
          {flashError && <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setSaleOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handleSale}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-[#BAFF1A] text-[13px] font-semibold text-[#121212] hover:bg-[#ccff40] disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Confirmar alienação'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Atualizar aquisição ────────────────────────────────────────── */}
      <Modal open={acquisitionOpen} onClose={() => setAcquisitionOpen(false)} title={hasAcquisitionValue ? 'Atualizar valor de aquisição' : 'Cadastrar valor de aquisição'}>
        <div className="space-y-4">
          <Input
            label="Valor de aquisição (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={acquisitionValue}
            onChange={e => setAcquisitionValue(e.target.value)}
          />
          {flashError && <p className="text-[13px] text-[#ff9c9a]">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setAcquisitionOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5]"
            >
              Cancelar
            </button>
            <button
              onClick={handleAcquisition}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-[#BAFF1A] text-[13px] font-semibold text-[#121212] hover:bg-[#ccff40] disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
