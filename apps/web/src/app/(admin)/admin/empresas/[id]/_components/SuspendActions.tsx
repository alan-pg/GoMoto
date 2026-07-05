'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pause, Play } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { suspendTenant, reactivateTenant } from '../../actions'

export function SuspendActions({
  tenantId,
  tenantName,
  isSuspended,
}: {
  tenantId: string
  tenantName: string
  isSuspended: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showModal, setShowModal]     = useState(false)
  const [reason, setReason]           = useState('')
  const [error, setError]             = useState<string | null>(null)

  function handleSuspend() {
    setError(null)
    startTransition(async () => {
      const result = await suspendTenant(tenantId, { reason })
      if ('error' in result && result.error) {
        setError(result.error as string)
        return
      }
      setShowModal(false)
      router.refresh()
    })
  }

  function handleReactivate() {
    setError(null)
    startTransition(async () => {
      const result = await reactivateTenant(tenantId)
      if ('error' in result && result.error) {
        setError(result.error as string)
        return
      }
      router.refresh()
    })
  }

  if (isSuspended) {
    return (
      <>
        {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}
        <button
          onClick={handleReactivate}
          disabled={isPending}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#0e2f13] text-[#229731] text-[13px] font-medium hover:bg-[#1a4a1f] transition-colors disabled:opacity-50"
        >
          <Play className="w-4 h-4" />
          {isPending ? 'Reativando…' : 'Reativar'}
        </button>
      </>
    )
  }

  return (
    <>
      <button
        onClick={() => { setShowModal(true); setReason(''); setError(null) }}
        disabled={isPending}
        className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#7c1c1c]/40 text-[#ff9c9a] text-[13px] font-medium hover:bg-[#7c1c1c] transition-colors disabled:opacity-50"
      >
        <Pause className="w-4 h-4" />
        Suspender
      </button>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={`Suspender ${tenantName}`}
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-[#7c1c1c]/40 border border-[#ff9c9a]/30 rounded-xl">
            <p className="text-[13px] text-[#c7c7c7] leading-relaxed">
              A empresa não conseguirá acessar dados enquanto suspensa. O time interno
              continua vendo o login com a mensagem de suspensão.
            </p>
          </div>
          <Input
            label="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ex.: inadimplência da mensalidade"
            disabled={isPending}
          />
          {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowModal(false)} disabled={isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleSuspend}
              disabled={isPending || reason.trim().length === 0}
            >
              {isPending ? 'Suspendendo…' : 'Confirmar suspensão'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
