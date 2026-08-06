import Link from 'next/link'
import { deriveInspectionScheduleStatus, pickLatestInspectionBySchedule } from '@gomoto/core'
import type { Inspection, InspectionSchedule } from '@gomoto/core'
import { InspectionComparisonPanel } from '../../../_components/InspectionComparisonPanel'
import { InspectionStatusCard } from '../_components/InspectionStatusCard'
import { getRentalCore } from '../_lib/get-rental-core'
import { fmt, SCHEDULE_STATUS_BADGE } from '../_lib/shared'

export default async function RentalInspectionsTab({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const { rental, supabase } = await getRentalCore(id)

  const hasAnyInspectionLink = Boolean(rental.checkin_checkout_inspection_profile_id || rental.periodic_inspection_profile_id)

  if (!hasAnyInspectionLink) {
    return (
      <div className="flex items-center justify-center rounded-xl bg-surface py-10">
        <p className="text-[13px] text-fg-mute">Nenhum perfil de vistoria vinculado a esta locação.</p>
      </div>
    )
  }

  const isActive = rental.status === 'active'

  const [inspectionsResult, schedulesResult] = await Promise.all([
    supabase.from('inspections').select('*').eq('rental_id', id).order('created_at', { ascending: true }),
    rental.periodic_inspection_profile_id
      ? supabase.from('inspection_schedules').select('*').eq('rental_id', id).order('target_date', { ascending: true })
      : Promise.resolve({ data: [] as InspectionSchedule[] }),
  ])

  const rentalInspections = (inspectionsResult.data ?? []) as Inspection[]
  const checkinInspection  = rentalInspections.find(i => i.kind === 'checkin') ?? null
  const checkoutInspection = rentalInspections.find(i => i.kind === 'checkout') ?? null
  // Status "atrasada"/"aprovada"/etc. não fica em coluna — deriva na leitura
  // cruzando com a última `inspections` do agendamento (RN-009, Spec 0009 §2.3).
  const latestInspectionBySchedule = pickLatestInspectionBySchedule(rentalInspections)
  const inspectionSchedules = ((schedulesResult.data ?? []) as InspectionSchedule[]).map((schedule) => {
    const latest = latestInspectionBySchedule.get(schedule.id) ?? null
    return { ...schedule, status: deriveInspectionScheduleStatus(schedule, latest), latest_inspection: latest }
  })

  return (
    <section>
      {rental.checkin_checkout_inspection_profile_id && (
        <div className="grid grid-cols-2 gap-4 mb-4">
          <InspectionStatusCard label="Check-in" inspection={checkinInspection} />
          <InspectionStatusCard
            label="Check-out"
            inspection={checkoutInspection}
            disabledReason={isActive ? 'Disponível após o encerramento da locação' : undefined}
          />
        </div>
      )}

      {checkinInspection?.status === 'completed' && checkoutInspection?.status === 'completed' && (
        <div className="mb-4">
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-mute">Comparação</p>
          <InspectionComparisonPanel rentalId={id} />
        </div>
      )}

      {rental.periodic_inspection_profile_id && inspectionSchedules.length > 0 && (
        <div>
          <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-fg-mute">
            Vistoria periódica — a cada {rental.periodic_inspection_frequency_days} dias
          </p>
          <div className="overflow-hidden rounded-xl bg-surface">
            <table className="w-full text-[13px]">
              <tbody>
                {inspectionSchedules.map((s) => {
                  const badge = SCHEDULE_STATUS_BADGE[s.status] ?? SCHEDULE_STATUS_BADGE.pending
                  return (
                    <tr key={s.id} className="h-9 border-b border-surface-2 last:border-0">
                      <td className="px-4 text-fg-soft">{fmt(s.target_date)}</td>
                      <td className="px-4 text-right">
                        {s.latest_inspection ? (
                          <Link href={`/vistorias/execute/${s.latest_inspection.id}`} className="inline-flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                              {badge.label}
                            </span>
                          </Link>
                        ) : (
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
