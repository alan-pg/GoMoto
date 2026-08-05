'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Plus, Search, Clock, DollarSign, AlertTriangle,
  CalendarClock, ChevronRight, Users,
} from 'lucide-react'

import { useRentals, useBillings } from '@gomoto/data'
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
  active:      { bg: 'bg-[#BAFF1A22]', text: 'text-[#BAFF1A]', label: 'Ativa'       },
  closed:      { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Encerrada'   },
  transferred: { bg: 'bg-[#60a5fa22]', text: 'text-[#60a5fa]', label: 'Transferida' },
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
  iconBg = 'bg-[#323232]',
  iconColor = 'text-[#BAFF1A]',
}: {
  icon: React.ElementType
  label: string
  value: string | number
  sub?: string
  iconBg?: string
  iconColor?: string
}) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#202020] p-4">
      <div>
        <p className="text-[13px] text-[#9e9e9e]">{label}</p>
        <p className="text-2xl font-bold text-[#f5f5f5]">{value}</p>
        {sub && <p className="mt-0.5 text-[12px] text-[#9e9e9e]">{sub}</p>}
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
  const billingsQuery = useBillings({ overdue: true })

  const rentals  = useMemo(() => (rentalsQuery.data  ?? []) as Rental[], [rentalsQuery.data])
  const billings = useMemo(() => billingsQuery.data ?? [], [billingsQuery.data])

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

    const overdueIds  = new Set(billings.map(b => b.lease_id))
    const withOverdue = active.filter(r => overdueIds.has(r.id)).length

    return { total: active.length, monthlyRevenue, endingSoon, withOverdue }
  }, [rentals, billings])

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
    <div className="flex min-h-full flex-col bg-[#121212]">
      <PageTitle
        title="Locações"
        subtitle="Gestão de contratos de locação de veículos"
        actions={
          <Link
            href="/locacoes/nova"
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[#BAFF1A] px-4 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e818]"
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
            iconBg="bg-[#BAFF1A22]"
            iconColor="text-[#BAFF1A]"
            label="Locações ativas"
            value={kpis.total}
          />
          <KpiCard
            icon={DollarSign}
            iconBg="bg-[#0e2f13]"
            iconColor="text-[#229731]"
            label="Receita/ciclo esperada"
            value={formatCurrency(kpis.monthlyRevenue)}
            sub="soma dos contratos ativos"
          />
          <KpiCard
            icon={CalendarClock}
            iconBg="bg-[#3a180f]"
            iconColor="text-[#e65e24]"
            label="Vencendo em 30 dias"
            value={kpis.endingSoon}
          />
          <KpiCard
            icon={AlertTriangle}
            iconBg="bg-[#7c1c1c]"
            iconColor="text-[#ff9c9a]"
            label="Com cobrança em atraso"
            value={kpis.withOverdue}
          />
        </div>

        {/* ── Filtros ───────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Tabs de status */}
          <div className="flex border-b border-[#616161]">
            {([
              { id: 'active' as TabId, label: 'Ativas',     count: activeCount },
              { id: 'closed' as TabId, label: 'Encerradas', count: closedCount },
            ]).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-4 py-2 text-[14px] font-medium transition-all ${
                  tab === t.id
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {t.label}
                {t.count > 0 && (
                  <span className="ml-1.5 text-[#616161]">({t.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Filtros secundários */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="h-9 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] outline-none focus:border-[#BAFF1A]"
            >
              <option value="all">Todos os tipos</option>
              <option value="rental">Locação</option>
              <option value="rent_to_own">Compra Programada</option>
            </select>

            <select
              value={cycleFilter}
              onChange={e => setCycleFilter(e.target.value)}
              className="h-9 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] outline-none focus:border-[#BAFF1A]"
            >
              <option value="all">Todos os ciclos</option>
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#616161]" />
              <input
                type="text"
                placeholder="Buscar cliente ou placa…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-9 w-52 rounded-lg border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A]"
              />
            </div>
          </div>
        </div>

        {/* ── Tabela ────────────────────────────────────────────────────────── */}
        {rentalsQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <Users className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-lg font-medium text-[#f5f5f5]">
              {search ? 'Nenhuma locação encontrada.' : tab === 'active' ? 'Nenhuma locação ativa.' : 'Nenhuma locação encerrada.'}
            </p>
            {!search && tab === 'active' && (
              <Link
                href="/locacoes/nova"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#BAFF1A] px-4 py-2 text-[13px] font-bold text-[#121212] hover:bg-[#a8e818]"
              >
                <Plus className="h-4 w-4" />
                Nova Locação
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#323232] bg-[#1a1a1a]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232] text-left">
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Cliente</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Veículo</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Tipo / Ciclo</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Valor/ciclo</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Início</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Fim</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  <th className="h-9 px-4" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.closed
                  const days  = daysUntil(r.end_date)
                  const hasOverdue = billings.some(
                    b => b.lease_id === r.id && (b.status === 'overdue' || b.status === 'pending')
                  )
                  const endingSoon = days !== null && days >= 0 && days <= 30 && r.status === 'active'

                  return (
                    <tr
                      key={r.id}
                      className="group h-9 cursor-pointer border-b border-[#1e1e1e] transition-colors last:border-0 hover:bg-[#222222]"
                    >
                      <td className="px-4 text-[#f5f5f5]">
                        <Link href={`/locacoes/${r.id}`} className="block w-full">
                          {r.customer?.name ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          <span className="font-mono font-bold text-[#BAFF1A]">
                            {r.vehicle?.license_plate ?? '—'}
                          </span>
                          <span className="ml-1.5 text-[#9e9e9e]">
                            {r.vehicle?.make} {r.vehicle?.model}
                          </span>
                        </Link>
                      </td>
                      <td className="px-4 text-[#c7c7c7]">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          {CONTRACT_TYPE_LABEL[r.contract_type ?? 'rental']}
                          {r.cycle && <span className="ml-1 text-[#616161]">· {CYCLE_LABEL[r.cycle]}</span>}
                        </Link>
                      </td>
                      <td className="px-4 font-mono text-[#f5f5f5]">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          {r.cycle_amount != null
                            ? formatCurrency(r.cycle_amount)
                            : r.monthly_amount != null
                              ? formatCurrency(r.monthly_amount)
                              : '—'}
                        </Link>
                      </td>
                      <td className="px-4 text-[#9e9e9e]">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          {r.start_date ? formatDate(r.start_date) : '—'}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="block">
                          <span className={endingSoon ? 'font-medium text-[#e65e24]' : 'text-[#9e9e9e]'}>
                            {r.end_date ? formatDate(r.end_date) : '—'}
                          </span>
                          {endingSoon && days !== null && (
                            <span className="ml-1 text-[12px] text-[#e65e24]">({days}d)</span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="flex items-center gap-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.bg} ${badge.text}`}>
                            {badge.label}
                          </span>
                          {hasOverdue && r.status === 'active' && (
                            <span className="rounded-full bg-[#7c1c1c] px-2 py-0.5 text-[11px] font-semibold text-[#ff9c9a]">
                              inadimplente
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="px-4">
                        <Link href={`/locacoes/${r.id}`} className="flex justify-end">
                          <ChevronRight className="h-4 w-4 text-[#616161] transition-colors group-hover:text-[#9e9e9e]" />
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
            className="inline-flex items-center gap-1.5 text-[13px] text-[#9e9e9e] transition-colors hover:text-[#BAFF1A]"
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
