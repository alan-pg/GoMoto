'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle, ClipboardList, ClipboardCheck, Clock, Search, X, Camera,
} from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { usePendingInspections } from '@gomoto/data'
import type { ScheduleWithRentalInfo } from '@gomoto/data'
import type { Inspection } from '@gomoto/core'

type AwaitingClientSchedule = ScheduleWithRentalInfo & {
  status: 'pending' | 'overdue' | 'rejected'
  latest_inspection: Inspection | null
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

type Urgency = 'overdue' | 'review' | 'pending' | 'awaiting_client'
type Kind = 'checkin' | 'checkout' | 'periodic'

interface UnifiedRow {
  id: string
  urgency: Urgency
  kind: Kind
  customerName: string
  vehiclePlate: string
  vehicleLabel: string
  date: string
  dateLabel: string
  detail?: string
  href: string
}

// ─── Constantes visuais ─────────────────────────────────────────────────────

const KIND_LABEL: Record<Kind, string> = {
  checkin: 'Check-in',
  checkout: 'Check-out',
  periodic: 'Periódica',
}

const URGENCY_CONFIG: Record<Urgency, { label: string; icon: typeof AlertTriangle; color: string; active: string; bg: string; text: string }> = {
  overdue:         { label: 'Vencidas',         icon: AlertTriangle, color: 'text-danger', active: 'border-[#ff3e3c]', bg: 'bg-danger-bg', text: 'text-danger' },
  review:          { label: 'Para revisar',     icon: ClipboardList, color: 'text-pending', active: 'border-pending', bg: 'bg-pending-bg', text: 'text-pending' },
  pending:         { label: 'Pendentes',        icon: ClipboardCheck, color: 'text-primary', active: 'border-primary', bg: 'bg-[#233a05]', text: 'text-primary' },
  awaiting_client: { label: 'Aguardando cliente', icon: Clock,        color: 'text-fg-mute', active: 'border-fg-mute', bg: 'bg-surface-2', text: 'text-fg-mute' },
}

const URGENCY_RANK: Record<Urgency, number> = { overdue: 0, review: 1, pending: 2, awaiting_client: 3 }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  const datePart = iso.slice(0, 10)
  const [y, m, d] = datePart.split('-')
  return `${d}/${m}/${y}`
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = new Date(fromIso.slice(0, 10) + 'T12:00:00')
  const to = new Date(toIso.slice(0, 10) + 'T12:00:00')
  return Math.round((to.getTime() - from.getTime()) / 86_400_000)
}

function relativeLabel(row: UnifiedRow, todayIso: string): string {
  if (row.urgency === 'awaiting_client') {
    const days = daysBetween(todayIso, row.date)
    if (days === 0) return 'vence hoje'
    if (days === 1) return 'vence amanhã'
    return `vence em ${days} dias`
  }
  const days = daysBetween(row.date, todayIso)
  if (row.urgency === 'overdue') {
    return days <= 0 ? 'venceu hoje' : `${days} dia${days !== 1 ? 's' : ''} de atraso`
  }
  if (days === 0) return 'hoje'
  if (days === 1) return 'há 1 dia'
  return `há ${days} dias`
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function InspectionsPendingPage() {
  const router = useRouter()
  const { actionable, awaitingClient } = usePendingInspections()
  const [urgencyFilter, setUrgencyFilter] = useState<Urgency | 'all'>('all')
  const [kindFilter, setKindFilter] = useState<Kind | 'all'>('all')
  const [search, setSearch] = useState('')

  const loading = actionable.isLoading || awaitingClient.isLoading
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const rows = useMemo<UnifiedRow[]>(() => {
    const out: UnifiedRow[] = []

    for (const insp of actionable.data ?? []) {
      // Check-out nasce 'pending' na criação da locação (Spec 0009 §3.1), mas
      // só é executável de fato depois que a locação é encerrada — enquanto
      // ativa, não é uma pendência acionável hoje.
      if (insp.kind === 'checkout' && insp.rental?.status === 'active') continue

      out.push({
        id: insp.id,
        urgency: insp.kind === 'periodic' ? 'review' : 'pending',
        kind: insp.kind as Kind,
        customerName: insp.rental?.customer?.name ?? '—',
        vehiclePlate: insp.rental?.vehicle?.license_plate ?? '—',
        vehicleLabel: insp.rental?.vehicle ? `${insp.rental.vehicle.make} ${insp.rental.vehicle.model}` : '',
        date: insp.created_at,
        dateLabel: insp.kind === 'periodic' ? 'Enviada' : 'Pendente desde',
        href: `/vistorias/execute/${insp.id}`,
      })
    }

    // Um veículo pode ter vários agendamentos futuros já gerados upfront
    // (RF-011) — só o próximo (ou atrasado) é relevante no dia a dia; os
    // demais ainda não chegaram a vez. Agrupa por veículo e mantém apenas o
    // de target_date mais antiga entre os não resolvidos.
    const earliestByVehicle = new Map<string, AwaitingClientSchedule>()
    for (const s of awaitingClient.data ?? []) {
      const vehicleKey = s.rental?.vehicle?.id ?? s.rental_id
      const current = earliestByVehicle.get(vehicleKey)
      if (!current || s.target_date < current.target_date) earliestByVehicle.set(vehicleKey, s)
    }

    for (const s of earliestByVehicle.values()) {
      out.push({
        id: s.id,
        urgency: s.status === 'overdue' ? 'overdue' : 'awaiting_client',
        kind: 'periodic',
        customerName: s.rental?.customer?.name ?? '—',
        vehiclePlate: s.rental?.vehicle?.license_plate ?? '—',
        vehicleLabel: s.rental?.vehicle ? `${s.rental.vehicle.make} ${s.rental.vehicle.model}` : '',
        date: s.target_date,
        dateLabel: 'Prazo',
        detail: s.status === 'rejected'
          ? `Rejeitada${s.latest_inspection?.review_notes ? ' — ' + s.latest_inspection.review_notes : ''}, aguardando reenvio`
          : undefined,
        href: s.latest_inspection ? `/vistorias/execute/${s.latest_inspection.id}` : `/vistorias/schedule/${s.id}`,
      })
    }

    return out.sort((a, b) => {
      const rankDiff = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]
      if (rankDiff !== 0) return rankDiff
      return a.date.localeCompare(b.date)
    })
  }, [actionable.data, awaitingClient.data])

  const counts = useMemo(() => ({
    overdue: rows.filter((r) => r.urgency === 'overdue').length,
    review: rows.filter((r) => r.urgency === 'review').length,
    pending: rows.filter((r) => r.urgency === 'pending').length,
    awaiting_client: rows.filter((r) => r.urgency === 'awaiting_client').length,
  }), [rows])

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (urgencyFilter !== 'all' && r.urgency !== urgencyFilter) return false
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!r.customerName.toLowerCase().includes(q) && !r.vehiclePlate.toLowerCase().includes(q) && !r.vehicleLabel.toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })
  }, [rows, urgencyFilter, kindFilter, search])

  const hasActiveFilters = urgencyFilter !== 'all' || kindFilter !== 'all' || !!search

  return (
    <div className="flex flex-col bg-bg">
      <PageTitle
        title="Vistorias"
        subtitle="Fila de trabalho — check-in, check-out e vistoria periódica"
        actions={
          <Link
            href="/vistorias/perfis"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors"
          >
            Perfis de Vistoria
          </Link>
        }
      />

      <div className="p-6 space-y-5">

        {/* ── KPIs / filtros de urgência ──────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {(Object.keys(URGENCY_CONFIG) as Urgency[]).map((key) => {
            const cfg = URGENCY_CONFIG[key]
            const Icon = cfg.icon
            const isActive = urgencyFilter === key
            return (
              <button
                key={key}
                onClick={() => setUrgencyFilter((prev) => (prev === key ? 'all' : key))}
                aria-pressed={isActive}
                className={`flex items-center justify-between rounded-xl bg-surface p-4 border-2 transition-colors text-left ${
                  isActive ? cfg.active : 'border-transparent hover:border-border'
                }`}
              >
                <div>
                  <p className="text-[13px] text-fg-mute">{cfg.label}</p>
                  <p className={`text-2xl font-bold ${cfg.color}`}>{counts[key]}</p>
                </div>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Barra de filtros ─────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-mute" />
            <input
              type="text"
              placeholder="Buscar cliente, placa, modelo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 rounded-full border border-border bg-surface-2 pl-9 pr-4 text-[13px] text-fg placeholder:text-fg-mute focus:border-primary focus:outline-none w-64"
            />
          </div>

          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as Kind | 'all')}
            className="h-10 rounded-full border border-border bg-surface-2 px-3 text-[13px] text-fg focus:border-primary focus:outline-none"
          >
            <option value="all">Todos os tipos</option>
            <option value="checkin">Check-in</option>
            <option value="checkout">Check-out</option>
            <option value="periodic">Periódica</option>
          </select>

          {hasActiveFilters && (
            <button
              onClick={() => { setUrgencyFilter('all'); setKindFilter('all'); setSearch('') }}
              className="flex items-center gap-1 h-10 px-3 rounded-full border border-border bg-transparent text-[13px] text-fg-mute hover:text-fg hover:border-fg-mute transition-colors"
            >
              <X className="w-3.5 h-3.5" />
              Limpar
            </button>
          )}

          <span className="ml-auto text-[13px] text-fg-mute">
            {filtered.length} item{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* ── Fila de trabalho ─────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface p-16 text-center">
            <Camera className="mb-4 h-12 w-12 text-border" />
            <p className="text-lg font-medium text-fg">
              {rows.length === 0 ? 'Nenhuma vistoria pendente.' : 'Nenhuma vistoria encontrada.'}
            </p>
            <p className="mt-1 text-[13px] text-fg-mute">
              {rows.length === 0 ? 'Tudo em dia — novas pendências aparecem aqui automaticamente.' : 'Ajuste os filtros ou a busca.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl bg-surface">
            <table className="w-full text-left text-[13px] text-fg">
              <thead className="bg-surface-2 border-b border-border">
                <tr>
                  <th className="h-9 px-4 text-fg-mute text-[13px] font-medium w-40">Status</th>
                  <th className="h-9 px-4 text-fg-mute text-[13px] font-medium w-28">Tipo</th>
                  <th className="h-9 px-4 text-fg-mute text-[13px] font-medium">Cliente</th>
                  <th className="h-9 px-4 text-fg-mute text-[13px] font-medium">Veículo</th>
                  <th className="h-9 px-4 text-fg-mute text-[13px] font-medium">{'Data'}</th>
                  <th className="h-9 px-4 text-fg-mute text-[13px] font-medium">Detalhe</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => {
                  const cfg = URGENCY_CONFIG[row.urgency]
                  return (
                    <tr
                      key={`${row.kind}-${row.id}`}
                      onClick={() => router.push(row.href)}
                      className="h-9 border-b border-divider last:border-0 transition-colors hover:bg-surface-2 cursor-pointer"
                    >
                      <td className="px-4">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.bg} ${cfg.text}`}>
                          {cfg.label === 'Aguardando cliente' ? 'Aguard. cliente' : cfg.label.replace(/s$/, '')}
                        </span>
                      </td>
                      <td className="px-4 text-fg-mute">{KIND_LABEL[row.kind]}</td>
                      <td className="px-4 text-fg font-medium">{row.customerName}</td>
                      <td className="px-4">
                        <div className="flex flex-col leading-tight">
                          <span className="font-mono text-fg text-[13px]">{row.vehiclePlate}</span>
                          {row.vehicleLabel && <span className="text-[12px] text-fg-mute">{row.vehicleLabel}</span>}
                        </div>
                      </td>
                      <td className="px-4">
                        <div className="flex flex-col leading-tight">
                          <span className="text-fg-soft text-[13px]">{fmtDate(row.date)}</span>
                          <span className={`text-[12px] ${row.urgency === 'overdue' ? 'text-danger' : 'text-fg-mute'}`}>
                            {row.dateLabel} · {relativeLabel(row, todayIso)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 text-fg-mute max-w-[220px] truncate" title={row.detail}>
                        {row.detail ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
