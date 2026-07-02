'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { VEHICLE_STATUS_LABELS, type VehicleStatus } from '@gomoto/core'
import { changeVehicleStatus } from '../../actions'

interface Props {
  motorcycleId: string
  currentStatus: VehicleStatus
  selectableStatuses: VehicleStatus[]
}

const ACTION_LABELS: Partial<Record<VehicleStatus, string>> = {
  sold:      'Vender',
  inactive:  'Desativar',
  available: 'Reativar',
}

const ACTION_COLORS: Partial<Record<VehicleStatus, string>> = {
  sold:      'bg-[#7c1c1c] text-[#ff9c9a] hover:bg-[#9c2c2c] border border-[#ff9c9a]/30',
  inactive:  'bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] border border-[#474747]',
  available: 'bg-[#143c18] text-[#4ade80] hover:bg-[#1a5020] border border-[#4ade80]/30',
}

const CONFIRM_MESSAGES: Partial<Record<VehicleStatus, string>> = {
  sold:     'Tem certeza que deseja marcar este veículo como Vendido? Esta ação pode ser desfeita com "Reativar".',
  inactive: 'Tem certeza que deseja Desativar este veículo? Ele não aparecerá mais nos filtros padrão.',
}

export default function VehicleStatusActions({ motorcycleId, currentStatus, selectableStatuses }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmStatus, setConfirmStatus] = useState<VehicleStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleClick(status: VehicleStatus) {
    // Reativar não precisa de modal de confirmação (RF-021)
    if (status === 'available') {
      execute(status)
    } else {
      setConfirmStatus(status)
    }
  }

  function execute(status: VehicleStatus) {
    setError(null)
    setConfirmStatus(null)
    startTransition(async () => {
      const result = await changeVehicleStatus(motorcycleId, {
        motorcycle_id: motorcycleId,
        new_status: status,
      })
      if (result.ok) {
        router.refresh()
      } else {
        setError(result.error.message)
      }
    })
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {selectableStatuses.map((status) => (
          <button
            key={status}
            onClick={() => handleClick(status)}
            disabled={isPending}
            className={`h-8 px-4 rounded-full text-[13px] font-medium transition-colors disabled:opacity-60 ${ACTION_COLORS[status] ?? 'bg-[#323232] text-[#f5f5f5]'}`}
          >
            {ACTION_LABELS[status] ?? VEHICLE_STATUS_LABELS[status]}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-[12px] text-[#ff9c9a] mt-1">{error}</p>
      )}

      {/* Modal de confirmação (Vender / Desativar) */}
      {confirmStatus && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-[#202020] border border-[#323232] rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
            <h3 className="text-[16px] font-bold text-[#f5f5f5]">
              {ACTION_LABELS[confirmStatus]}?
            </h3>
            <p className="text-[13px] text-[#9e9e9e] leading-relaxed">
              {CONFIRM_MESSAGES[confirmStatus]}
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                onClick={() => setConfirmStatus(null)}
                className="h-9 px-4 rounded-full bg-[#323232] text-[#f5f5f5] text-[13px] font-medium hover:bg-[#474747] transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => execute(confirmStatus)}
                disabled={isPending}
                className={`h-9 px-4 rounded-full text-[13px] font-medium transition-colors disabled:opacity-60 ${ACTION_COLORS[confirmStatus] ?? ''}`}
              >
                {isPending ? 'Aguarde...' : `Confirmar ${ACTION_LABELS[confirmStatus]}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
