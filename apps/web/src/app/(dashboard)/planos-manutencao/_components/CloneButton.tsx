'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Check } from 'lucide-react'
import { cloneMaintenancePlan } from '../actions'

interface CloneButtonProps {
  planId: string
  planName: string
}

export function CloneButton({ planId, planName }: CloneButtonProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [cloneName, setCloneName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleOpen() {
    setCloneName(`${planName} (cópia)`)
    setError(null)
    setOpen(true)
  }

  async function handleClone() {
    const trimmed = cloneName.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await cloneMaintenancePlan(planId, trimmed)
      if (res.error || !res.data) {
        setError(res.error ?? 'Falha ao clonar.')
        return
      }
      router.push(`/planos-manutencao/${res.data.id}/editar`)
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors"
      >
        <Copy className="h-3.5 w-3.5" />
        Clonar
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <input
        autoFocus
        type="text"
        value={cloneName}
        onChange={(e) => setCloneName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void handleClone() }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Nome do clone"
        maxLength={200}
        className="h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all w-56"
      />
      <button
        type="button"
        disabled={!cloneName.trim() || loading}
        onClick={handleClone}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-surface-2 border border-border text-[13px] text-fg hover:border-primary hover:text-primary transition-all disabled:opacity-50"
      >
        {loading ? 'Clonando…' : <><Check className="h-3.5 w-3.5" /> Clonar</>}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[13px] text-fg-mute hover:text-fg-mute transition-colors px-1"
      >
        Cancelar
      </button>
      {error && <p className="text-[12px] text-danger">{error}</p>}
    </div>
  )
}
