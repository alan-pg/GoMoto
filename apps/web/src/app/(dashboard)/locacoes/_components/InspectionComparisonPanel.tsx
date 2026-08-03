'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useSupabaseContext, useRentalInspectionComparison } from '@gomoto/data'
import type { Inspection } from '@gomoto/core'

/** Comparação lado a lado check-in × check-out de uma locação (RF-022). */
export function InspectionComparisonPanel({ rentalId }: { rentalId: string }) {
  const { data, isLoading } = useRentalInspectionComparison(rentalId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center rounded-xl bg-[#202020] py-10">
        <Loader2 className="w-5 h-5 text-[#BAFF1A] animate-spin" />
      </div>
    )
  }
  if (!data?.checkin || !data?.checkout || data.checkin.status !== 'completed' || data.checkout.status !== 'completed') {
    return null
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <InspectionColumn title="Check-in" inspection={data.checkin} />
      <InspectionColumn title="Check-out" inspection={data.checkout} />
    </div>
  )
}

function InspectionColumn({ title, inspection }: { title: string; inspection: Inspection }) {
  const urls = useSignedUrls(inspection.photos.map((p) => p.storage_path))

  return (
    <div className="rounded-xl bg-[#202020] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-bold text-[#f5f5f5]">{title}</h3>
        <span className="text-[11px] text-[#616161]">
          {inspection.executed_at ? new Date(inspection.executed_at).toLocaleDateString('pt-BR') : '—'}
        </span>
      </div>

      <div className="space-y-1.5">
        {inspection.answers.map((a) => (
          <div key={a.item_id} className="flex items-center justify-between text-[12px]">
            <span className="text-[#9e9e9e] truncate pr-2">{a.name}</span>
            <span className={`flex-shrink-0 font-semibold ${a.status === 'ok' ? 'text-[#229731]' : 'text-[#ff9c9a]'}`}>
              {a.status === 'ok' ? 'OK' : 'Não OK'}
            </span>
          </div>
        ))}
      </div>

      {inspection.photos.length > 0 && (
        <div className="grid grid-cols-3 gap-2 pt-1">
          {inspection.photos.map((p) => (
            <div key={p.item_id} className="aspect-square rounded-lg bg-[#1a1a1a] overflow-hidden">
              {urls[p.storage_path] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={urls[p.storage_path]} alt={p.label} className="w-full h-full object-cover" />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function useSignedUrls(paths: string[]): Record<string, string> {
  const supabase = useSupabaseContext()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = paths.join(',')

  useEffect(() => {
    if (!key) return
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        key.split(',').map(async (path) => {
          const { data } = await supabase.storage.from('inspection-photos').createSignedUrl(path, 3600)
          return [path, data?.signedUrl ?? ''] as const
        }),
      )
      if (!cancelled) setUrls(Object.fromEntries(entries))
    })()
    return () => { cancelled = true }
  }, [key, supabase])

  return urls
}
