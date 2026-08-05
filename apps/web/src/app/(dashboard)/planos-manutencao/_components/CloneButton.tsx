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
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-[#474747] text-[#9e9e9e] text-[13px] font-medium hover:text-[#f5f5f5] hover:border-[#616161] transition-colors"
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
        className="h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all w-56"
      />
      <button
        type="button"
        disabled={!cloneName.trim() || loading}
        onClick={handleClone}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] hover:border-[#BAFF1A] hover:text-[#BAFF1A] transition-all disabled:opacity-50"
      >
        {loading ? 'Clonando…' : <><Check className="h-3.5 w-3.5" /> Clonar</>}
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[13px] text-[#616161] hover:text-[#9e9e9e] transition-colors px-1"
      >
        Cancelar
      </button>
      {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}
    </div>
  )
}
