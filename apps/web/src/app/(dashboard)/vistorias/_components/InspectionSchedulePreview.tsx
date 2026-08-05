'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useInspectionSchedule, usePeriodicInspectionProfileForRental } from '@gomoto/data'

const SCHEDULE_STATUS_LABEL: Record<string, { label: string; bg: string; text: string }> = {
  pending:  { label: 'Pendente',                       bg: 'bg-[#323232]', text: 'text-[#9e9e9e]' },
  overdue:  { label: 'Atrasada',                        bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]' },
  rejected: { label: 'Rejeitada — aguardando reenvio',  bg: 'bg-[#5e3a00]', text: 'text-[#ffba49]' },
}

/**
 * Preview de um agendamento de vistoria periódica ainda sem submissão do
 * cliente (RN-011 — cliente é quem executa) — mostra os itens do perfil
 * vinculado (checklist + fotos exigidas) sem respostas, só para o
 * administrativo enxergar o que está pendente. Se já existir uma
 * `inspections` vinculada (rejeitada, submetida ou aprovada), redireciona
 * para `/vistorias/execute/[id]`, que já sabe renderizar esse estado.
 */
export function InspectionSchedulePreview({ scheduleId }: { scheduleId: string }) {
  const router = useRouter()
  const { data: schedule, isLoading, error } = useInspectionSchedule(scheduleId)
  const profileQuery = usePeriodicInspectionProfileForRental(schedule?.rental_id)

  useEffect(() => {
    if (schedule?.latest_inspection) {
      router.replace(`/vistorias/execute/${schedule.latest_inspection.id}`)
    }
  }, [schedule, router])

  if (isLoading || schedule?.latest_inspection) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-[#BAFF1A] animate-spin" />
      </div>
    )
  }
  if (error || !schedule) {
    return <p className="text-[13px] text-[#ff9c9a] py-8 text-center">Agendamento não encontrado.</p>
  }

  const badge = SCHEDULE_STATUS_LABEL[schedule.status] ?? SCHEDULE_STATUS_LABEL.pending
  const profile = profileQuery.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-7 items-center rounded-full bg-[#323232] px-3 text-[13px] font-medium text-[#f5f5f5]">
          Vistoria periódica
        </span>
        <span className={`inline-flex h-7 items-center rounded-full px-3 text-[12px] font-semibold ${badge.bg} ${badge.text}`}>
          {badge.label}
        </span>
        <span className="text-[13px] text-[#9e9e9e]">
          Prazo: {new Date(schedule.target_date + 'T12:00:00').toLocaleDateString('pt-BR')}
        </span>
      </div>

      <div className="rounded-xl bg-[#202020] p-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#9e9e9e] mb-1">Cliente</p>
          <p className="text-[13px] text-[#f5f5f5]">{schedule.rental?.customer?.name ?? '—'}</p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wide text-[#9e9e9e] mb-1">Veículo</p>
          <p className="text-[13px] text-[#f5f5f5]">
            {schedule.rental?.vehicle
              ? `${schedule.rental.vehicle.license_plate} — ${schedule.rental.vehicle.make} ${schedule.rental.vehicle.model}`
              : '—'}
          </p>
        </div>
      </div>

      <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] px-4 py-3">
        <p className="text-[13px] text-[#9e9e9e]">
          Vistoria ainda não enviada pelo cliente. Só o cliente pode executar a vistoria periódica pelo app — os itens
          abaixo são o que ele vai precisar preencher.
        </p>
      </div>

      {profileQuery.isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 text-[#BAFF1A] animate-spin" />
        </div>
      ) : !profile ? (
        <p className="text-[13px] text-[#616161] text-center py-8">Perfil de vistoria não encontrado.</p>
      ) : (
        <>
          <section className="space-y-3">
            <h3 className="text-[13px] font-bold text-[#9e9e9e] uppercase tracking-wide">
              Checklist <span className="font-normal normal-case text-[#616161]">— Perfil: {profile.name}</span>
            </h3>
            {(profile.checklist_items ?? []).map((item) => (
              <div key={item.id} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
                <p className="text-[13px] text-[#f5f5f5]">{item.name}</p>
              </div>
            ))}
          </section>

          <section className="space-y-3">
            <h3 className="text-[13px] font-bold text-[#9e9e9e] uppercase tracking-wide">Fotos exigidas</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(profile.photo_items ?? []).map((item) => (
                <div key={item.id} className="rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] p-3 text-center">
                  <p className="text-[12px] text-[#9e9e9e]">
                    {item.label} {item.is_required && <span className="text-[#ff9c9a]">*</span>}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
