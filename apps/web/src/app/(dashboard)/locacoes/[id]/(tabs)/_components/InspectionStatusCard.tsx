import Link from 'next/link'
import { INSPECTION_STATUS_BADGE } from '../_lib/shared'

export function InspectionStatusCard({
  label,
  inspection,
  disabledReason,
}: {
  label: string
  inspection: { id: string; status: string } | null
  disabledReason?: string
}) {
  const badge = inspection ? (INSPECTION_STATUS_BADGE[inspection.status] ?? INSPECTION_STATUS_BADGE.pending) : null
  return (
    <div className="rounded-xl bg-[#202020] p-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-medium text-[#f5f5f5]">{label}</p>
        {badge && (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
            {badge.label}
          </span>
        )}
      </div>
      {!inspection ? (
        <p className="text-[12px] text-[#616161]">—</p>
      ) : inspection.status === 'pending' ? (
        disabledReason ? (
          <p className="text-[12px] text-[#616161]">{disabledReason}</p>
        ) : (
          <Link
            href={`/vistorias/execute/${inspection.id}`}
            className="inline-flex items-center h-8 px-3 rounded-full bg-[#323232] text-[12px] font-medium text-[#f5f5f5] hover:bg-[#474747] transition-colors"
          >
            Executar vistoria
          </Link>
        )
      ) : (
        <Link
          href={`/vistorias/execute/${inspection.id}`}
          className="text-[12px] text-[#616161] hover:text-[#BAFF1A] transition-colors"
        >
          Ver detalhes →
        </Link>
      )}
    </div>
  )
}
