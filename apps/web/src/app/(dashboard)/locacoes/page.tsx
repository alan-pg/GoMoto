'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Plus, Search, Clock, DollarSign, AlertTriangle,
  CalendarClock, ChevronRight, Users,
} from 'lucide-react'

import { useRentals, useOverdueCharges } from '@gomoto/data'
import { PageTitle } from '@/components/layout/PageTitle'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { Rental } from '@gomoto/core'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CONTRACT_TYPE_LABEL: Record<string, string> = {
  rental:      'Locação',
  rent_to_own: 'Compra Prog.',
}

const CYCLE_LABEL: Record<string, string> = {
  weekly:  'Semanal',
  monthly: 'Mensal',
}

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active:      { bg: 'bg-primary-tint', text: 'text-primary', label: 'Ativa'       },
  closed:      { bg: 'bg-surface-2',    text: 'text-fg-mute', label: 'Encerrada'   },
  transferred: { bg: 'bg-info-bg',      text: 'text-info', label: 'Transferida' },
}

function daysUntil(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0,0,0,0)
  const [y, m, d] = dateStr.split('-').map(Number)
  const target = new Date(y, m - 1, d)
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000)
}

// ─── KpiCard ──────────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  iconBg = 'bg-surface-2',
  iconColor = 'text-primary',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  iconBg?: string
  iconColor?: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-surface p-4">
      <div>
        <p className="text-[13px] text-fg-mute">{label}</p>
        <p className="text-2xl font-bold text-fg">{value}</p>
        {sub && <p className="mt-0.5 text-[12px] text-fg-mute">{sub}</p>}
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  )
}

// ─── LocacoesPage ─────────────────────────────────────────────────────────────

type TabId = 'active' | 'closed'

export default function LocacoesPage() {
  const rentalsQuery  = useRentals()
  const overdueQuery = useOverdueCharges()

  const rentals  = useMemo(() => (rentalsQuery.data  ?? []) as Rental[], [rentalsQuery.data])
  const overdueCharges = useMemo(() => overdueQuery.data ?? [], [overdueQuery.data])

  const [tab,    setTab]    = useState<TabId>('active')
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [cycleFilter, setCycleFilter] = useState<string>('all')

  // ── KPIs
  const kpis = useMemo(() => {
    const active    = rentals.filter(r => r.status === 'active')
    const monthlyRevenue = active.reduce((sum, r) => sum + (r.cycle_amount ?? r.monthly_amount ?? 0), 0)

    const today = new Date(); today.setHours(0,0,0,0)
    const in30  = new Date(today); in30.setDate(in30.getDate() + 30)

    const endingSoon = active.filter(r => {
      if (!r.end_date) return false
      const [y,m,d] = r.end_date.split('-').map(Number)
      const end = new Date(y, m-1, d)
      return end >= today && end <= in30
    }).length

    // Atraso é derivado em charge_balances; nada aqui recalcula data.
    const overdueIds  = new Set(overdueCharges.map(c => c.rental_id).filter(Boolean))
    const withOverdue = active.filter(r => overdueIds.has(r.id)).length

    return { total: active.length, monthlyRevenue, endingSoon, withOverdue }
  }, [rentals, overdueCharges])

  // ── Filtro
  const filtered = useMemo(() => {
    const base = rentals.filter(r =>
      tab === 'active' ? r.status === 'active' : (r.status === 'closed' || r.status === 'transferred')
    )
    return base.filter(r => {
      const q = search.toLowerCase()
      const matchSearch = !q ||
        (r.customer?.name ?? '').toLowerCase().includes(q) ||
        (r.vehicle?.license_plate ?? '').toLowerCase().includes(q)
      const matchType  = typeFilter  === 'all' || r.contract_type === typeFilter
      const matchCycle = cycleFilter === 'all' || r.cycle === cycleFilter
      return matchSearch && matchType && matchCycle
    })
  }, [rentals, tab, search, typeFilter, cycleFilter])

  const activeCount = useMemo(() => rentals.filter(r => r.status === 'active').length, [rentals])
  const closedCount = useMemo(() => rentals.filter(r => r.status !== 'active').length, [rentals])

  // ── Render
  return (
    <div className="flex min-h-full flex-col bg-bg">
      <PageTitle
        title="Locações"
        subtitle="Gestão de contratos de locação de veículos"
        actions={
          <Link
            href="/locacoes/nova"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[13px] font-bold text-bg transition-colors hover:bg-primary-hover"
          >
            <Plus className="h-4 w-4" />
            Nova Locação
          </Link>
        }
      />

      <div className="space-y-5 p-6">

        {/* ── KPI cards ─────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <KpiCard
            icon={Clock}
            iconBg="bg-primary-tint"
            iconColor="text-primary"
            label="Locações ativas"
            value={kpis.total}
          />
          <KpiCard
            icon={DollarSign}
            iconBg="bg-success-bg"
            iconColor="text-success"
            label="Receita/ciclo esperada"
            value={formatCurrency(kpis.monthlyRevenue)}
            sub="soma dos contratos ativos"
          />
          <KpiCard
            icon={CalendarClock}
            iconBg="bg-warning-bg"
            iconColor="text-warning"
            label="Vencendo em 30 dias"
            value={kpis.endingSoon}
          />
          <KpiCard
            icon={AlertTriangle}
            iconBg="bg-danger-bg"
            iconColor="text-danger"
            label="Com cobrança em atraso"
            value={kpis.withOverdue}
          />
        </div>

        {/* ── Filtros ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Tabs de status */}
          <div className="flex border-b border-fg-mute">
            {([
              { id: 'active' as TabId, label: 'Ativas',     count: activeCount },
              { id: 'closed' as TabId, label: 'Encerradas', count: closedCount },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-4 py-2 text-[14px] font-medium transition-all ${
                  tab === t.id
                    ? 'border-primary text-fg'
                    : 'border-transparent text-fg-mute hover:text-fg'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="ml-1.5 text-fg-mute">({t.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Filtros secundários */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-fg outline-none focus:border-primary"
            >
              <option value="all">Todos os tipos</option>
              <option value="rental">Locação</option>
              <option value="rent_to_own">Compra Programada</option>
            </select>

            <select
              value={cycleFilter}
              onChange={e => setCycleFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-[13px] text-fg outline-none focus:border-primary"
            >
              <option value="all">Todos os ciclos</option>
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-mute" />
              <input
                type="text"
                placeholder="Buscar cliente ou placa…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-9 w-52 rounded-lg border border-border bg-surface-2 pl-9 pr-4 text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* ── Tabela ────────────────────────────────────────────────────────── */}
        {rentalsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-surface p-16 text-center">
            <Users className="mb-4 h-12 w-12 text-fg-mute" />
            <p className="text-lg font-medium text-fg">
              {search ? 'Nenhuma locação encontrada.' : tab === 'active' ? 'Nenhuma locação ativa.' : 'Nenhuma locação encerrada.'}
            </p>
            {!search && tab === 'active' && (
              <Link
                href="/locacoes/nova"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-2 text-[13px] font-bold text-bg hover:bg-primary-hover"
              >
                <Plus className="h-4 w-4" />
                Nova Locação
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-divider bg-surface">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-divider text-left">
                  <th className="h-9 px-4 font-medium text-fg-mute">Cliente</th>
                  <th className="h-9 px-4 font-medium text-fg-mute">Veículo</th>
                  <th className="h-9 px-4 font-medium text-fg-mute">Tipo / Ciclo</th>
                  <th className="h-9 px-4 font-medium text-fg-mute">Valor/ciclo</th>
                  <th className="h-9 px-4 font-medium text-fg-mute">Início</th>
                  <th className="h-9 px-4 font-medium text-fg-mute">Fim</th>
                  <th className="h-9 px-4 font-medium text-fg-mute">Status</th>
                  <th className="h-9 px-4" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.closed
                  const days  = daysUntil(r.end_date)
                  const hasOverdue = overdueCharges.some(c => c.rental_id === r.id)
                  const endingSoon = days !== null && days >= 0 && days <= 30 && r.status === 'active'

                  return (
                    <tr
                      key={r.id}
                      className="group h-9 cursor-pointer border-b border-border transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-4 text-fg">
                        <Link href={`/locacoes/${r.id}`} className="block w-full">
                          {r.customer?.name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          <span className="font-mono font-bold text-primary">
                            {r.vehicle?.license_plate ?? '—'}
                          </span>
                          <span className="ml-1.5 text-fg-mute">
                            {r.vehicle?.make} {r.vehicle?.model}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 text-fg-soft">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          {CONTRACT_TYPE_LABEL[r.contract_type ?? 'rental']}
                          {r.cycle && <span className="ml-1 text-fg-mute">· {CYCLE_LABEL[r.cycle]}</span>}
                        </Link>
                      </td>
                      <td className="px-4 font-mono text-fg">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          {r.cycle_amount != null
                            ? formatCurrency(r.cycle_amount)
                            : r.monthly_amount != null
                              ? formatCurrency(r.monthly_amount)
                              : '—'}
                        </Link>
                      </td>
                      <td className="px-4 text-fg-mute">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          {r.start_date ? formatDate(r.start_date) : '—'}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          <span className={endingSoon ? 'font-medium text-warning' : 'text-fg-mute'}>
                            {r.end_date ? formatDate(r.end_date) : '—'}
                          </span>
                          {endingSoon && days !== null && (
                            <span className="ml-1 text-[12px] text-warning">({days}d)</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="flex items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                          {hasOverdue && r.status === 'active' && (
                            <span className="rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger">
                              inadimplente
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="flex justify-end">
                          <ChevronRight className="h-4 w-4 text-fg-mute transition-colors group-hover:text-fg-mute" />
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Link para fila ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-end">
          <Link
            href="/locacoes/fila"
            className="inline-flex items-center gap-1.5 text-[13px] text-fg-mute transition-colors hover:text-primary"
          >
            <Users className="h-4 w-4" />
            Ver fila de espera
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>

      </div>
    </div>
  )
}
