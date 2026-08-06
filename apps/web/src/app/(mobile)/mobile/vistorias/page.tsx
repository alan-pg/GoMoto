'use client'

import Link from 'next/link'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { usePendingInspections } from '@gomoto/data'

const KIND_LABEL: Record<string, string> = {
  checkin: 'Check-in',
  checkout: 'Check-out',
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}

/**
 * Lista mobile de pendências pro pátio (ADR 0018) — versão enxuta do
 * `/vistorias` desktop: só check-in/check-out (a vistoria periódica enviada
 * pelo cliente é análise de mesa, fora de escopo aqui), cards em vez de
 * tabela. Mesmo hook `usePendingInspections` do desktop, sem duplicar query.
 */
export default function MobileInspectionsPage() {
  const { actionable } = usePendingInspections()

  const rows = (actionable.data ?? [])
    .filter((insp) => insp.kind === 'checkin' || insp.kind === 'checkout')
    // Check-out nasce 'pending' na criação da locação, mas só é executável
    // de fato depois que a locação é encerrada (mesmo filtro do desktop).
    .filter((insp) => !(insp.kind === 'checkout' && insp.rental?.status === 'active'))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))

  return (
    <div className="px-4 py-5 pb-10 space-y-4">
      <div>
        <h1 className="text-[17px] font-bold text-fg">Vistorias pendentes</h1>
        <p className="text-[13px] text-fg-mute mt-0.5">Check-in e check-out no pátio</p>
      </div>

      {actionable.isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl bg-surface border border-border p-8 text-center">
          <ClipboardCheck className="w-8 h-8 text-border mx-auto mb-3" />
          <p className="text-[13px] text-fg font-medium">Nenhuma vistoria pendente</p>
          <p className="text-[12px] text-fg-mute mt-1">Tudo em dia por aqui.</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {rows.map((insp) => (
            <Link
              key={insp.id}
              href={`/mobile/vistorias/${insp.id}`}
              className="block rounded-xl bg-surface border border-border active:bg-[#232323] transition-colors p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span
                  className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold ${
                    insp.kind === 'checkin' ? 'bg-[#233a05] text-primary' : 'bg-surface-2 text-fg-soft'
                  }`}
                >
                  {KIND_LABEL[insp.kind] ?? insp.kind}
                </span>
                <span className="text-[11px] text-fg-mute">{fmtDate(insp.created_at)}</span>
              </div>
              <p className="text-[15px] font-semibold text-fg mt-2">
                {insp.rental?.customer?.name ?? '—'}
              </p>
              <p className="text-[13px] text-fg-mute mt-0.5 font-mono">
                {insp.rental?.vehicle?.license_plate ?? '—'}
                {insp.rental?.vehicle ? ` · ${insp.rental.vehicle.make} ${insp.rental.vehicle.model}` : ''}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
