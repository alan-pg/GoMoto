'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'

import {
  Plus,
  Edit2,
  Eye,
  Trash2,
  CheckCircle,
  AlertTriangle,
  Search,
  ChevronDown,
  Clock,
  Calendar,
  FileText,
  CheckCircle2,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { useFines, useVehicles } from '@gomoto/data'
import { markFineAsPaid, deleteFine } from './actions'

import { Header }             from '@/components/layout/Header'
import { Button }             from '@/components/ui/Button'
import { Input }              from '@/components/ui/Input'
import { Modal }              from '@/components/ui/Modal'
import { formatCurrency, formatDate } from '@/lib/utils'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type FineWithRelations = {
  id: string
  customer_id: string
  vehicle_id: string
  description: string
  amount: number
  infraction_date: string
  due_date?: string | null
  status: 'pending' | 'paid'
  payment_date?: string | null
  responsible: 'customer' | 'company'
  observations?: string | null
  created_at: string
  customers: { name: string; phone: string } | null
  vehicles: { license_plate: string; model: string; make: string } | null
}

type FineStatus = 'overdue' | 'due_soon' | 'pending' | 'paid'
type FineWithStatus = FineWithRelations & { _status: FineStatus }

// ─── Mapas de estilo ──────────────────────────────────────────────────────────

const STATUS_BADGE: Record<FineStatus, { bg: string; text: string; label: string }> = {
  overdue:  { bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]', label: 'Vencida'  },
  due_soon: { bg: 'bg-[#3a180f]', text: 'text-[#e65e24]', label: 'A vencer' },
  pending:  { bg: 'bg-[#2d0363]', text: 'text-[#a880ff]', label: 'Pendente' },
  paid:     { bg: 'bg-[#0e2f13]', text: 'text-[#229731]', label: 'Paga'     },
}

const STATUS_DOT: Record<'overdue' | 'due_soon' | 'ok', string> = {
  overdue:  'bg-[#ff3e3c]',
  due_soon: 'bg-[#e65e24]',
  ok:       'bg-[#28b438]',
}

// ─── Auxiliar de status dinâmico ──────────────────────────────────────────────

function calcFineStatus(fine: FineWithRelations): FineStatus {
  if (fine.status === 'paid') return 'paid'

  if (fine.due_date) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [year, month, day] = fine.due_date.split('-').map(Number)
    const dueDate = new Date(year, month - 1, day)

    if (dueDate < today) return 'overdue'

    const diffDays = Math.ceil((dueDate.getTime() - today.getTime()) / 86_400_000)
    if (diffDays <= 7) return 'due_soon'
  }

  return 'pending'
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
        {sub && <p className="text-[12px] mt-0.5 text-[#9e9e9e]">{sub}</p>}
      </div>
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${iconBg} ${iconColor}`}>
        <Icon className="h-6 w-6" />
      </div>
    </div>
  )
}

// ─── MultasPage ───────────────────────────────────────────────────────────────

export default function MultasPage() {
  const queryClient = useQueryClient()

  // ── Dados
  const finesQuery    = useFines()
  const vehiclesQuery = useVehicles()

  const fines = useMemo<FineWithRelations[]>(
    () => (finesQuery.data ?? []) as unknown as FineWithRelations[],
    [finesQuery.data],
  )
  const vehicles = useMemo(
    () => (vehiclesQuery.data ?? [])
      .map((m) => ({ id: m.id, license_plate: m.license_plate, model: m.model, make: m.make }))
      .sort((a, b) => a.license_plate.localeCompare(b.license_plate)),
    [vehiclesQuery.data],
  )

  const loading = finesQuery.isLoading || vehiclesQuery.isLoading

  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const invalidateFines = () => queryClient.invalidateQueries({ queryKey: ['fines'] })

  // ── Estado: modais
  const [deleting,          setDeleting]          = useState<FineWithRelations | null>(null)
  const [payingFine,        setPayingFine]        = useState<FineWithRelations | null>(null)
  const [paymentDateInput,  setPaymentDateInput]  = useState('')

  // ── Estado: filtros
  const [search,         setSearch]         = useState('')
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [vehicleFilter,  setVehicleFilter]  = useState('')

  // ── Estado: accordion
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [historyGroups,   setHistoryGroups]   = useState<Set<string>>(new Set())

  function toggleGroup(id: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleHistory(id: string) {
    setHistoryGroups((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── Handlers
  function handleMarkAsPaid(row: FineWithRelations) {
    setPayingFine(row)
    setPaymentDateInput(new Date().toISOString().split('T')[0])
  }

  async function confirmPayment() {
    if (!payingFine) return
    setSaving(true)
    try {
      const result = await markFineAsPaid(payingFine.id, paymentDateInput)
      if ('error' in result) { setError('Erro ao registrar pagamento.'); return }
      setPayingFine(null)
      setPaymentDateInput('')
      await invalidateFines()
    } finally {
      setSaving(false)
    }
  }

  async function confirmDeletion() {
    if (!deleting) return
    setSaving(true)
    try {
      const result = await deleteFine(deleting.id)
      if ('error' in result) { setError('Erro ao excluir a multa.'); return }
      setDeleting(null)
      await invalidateFines()
    } finally {
      setSaving(false)
    }
  }

  // ── KPIs
  const kpis = useMemo(() => {
    const currentMonth = new Date().toISOString().slice(0, 7)

    let total = 0, pendingCount = 0, pendingValue = 0
    let overdueCount = 0, overdueValue = 0, dueSoonCount = 0
    let paidMonthCount = 0, paidMonthValue = 0, paidCount = 0

    fines.forEach((fine) => {
      total++
      const s = calcFineStatus(fine)

      if (s === 'overdue') {
        overdueCount++;  overdueValue  += Number(fine.amount)
        pendingCount++;  pendingValue  += Number(fine.amount)
      } else if (s === 'due_soon') {
        dueSoonCount++
        pendingCount++;  pendingValue  += Number(fine.amount)
      } else if (s === 'pending') {
        pendingCount++;  pendingValue  += Number(fine.amount)
      } else if (s === 'paid') {
        paidCount++
        if (fine.payment_date?.startsWith(currentMonth)) {
          paidMonthCount++;  paidMonthValue += Number(fine.amount)
        }
      }
    })

    return { total, pendingCount, pendingValue, overdueCount, overdueValue,
             dueSoonCount, paidMonthCount, paidMonthValue, paidCount }
  }, [fines])

  // ── Abas de status
  const statusTabs = useMemo(() => [
    { id: 'all',      label: 'Todas',     count: kpis.total                                              },
    { id: 'overdue',  label: 'Vencidas',  count: kpis.overdueCount                                      },
    { id: 'due_soon', label: 'A vencer',  count: kpis.dueSoonCount                                      },
    { id: 'pending',  label: 'Pendentes', count: kpis.pendingCount - kpis.overdueCount - kpis.dueSoonCount },
    { id: 'paid',     label: 'Pagas',     count: kpis.paidCount                                          },
  ], [kpis])

  // ── Agrupamento com filtros
  const groupedFines = useMemo(() => {
    let filtered: FineWithStatus[] = fines.map((f) => ({ ...f, _status: calcFineStatus(f) }))

    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter((f) =>
        f.description.toLowerCase().includes(q) ||
        (f.customers?.name ?? '').toLowerCase().includes(q),
      )
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((f) => f._status === statusFilter)
    }

    if (vehicleFilter) {
      filtered = filtered.filter((f) => f.vehicle_id === vehicleFilter)
    }

    const ORDER: Record<FineStatus, number> = { overdue: 0, due_soon: 1, pending: 2, paid: 3 }

    const map = new Map<string, {
      vehicle_id: string
      moto: FineWithRelations['vehicles']
      items: FineWithStatus[]
    }>()

    filtered.forEach((fine) => {
      if (!map.has(fine.vehicle_id)) {
        map.set(fine.vehicle_id, { vehicle_id: fine.vehicle_id, moto: fine.vehicles, items: [] })
      }
      map.get(fine.vehicle_id)!.items.push(fine)
    })

    const groups = Array.from(map.values())
    groups.forEach((g) => g.items.sort((a, b) => ORDER[a._status] - ORDER[b._status]))
    groups.sort((a, b) => {
      const worst = (items: FineWithStatus[]) =>
        items.reduce((min, i) => Math.min(min, ORDER[i._status]), 3)
      return worst(a.items) - worst(b.items)
    })

    return groups
  }, [fines, search, statusFilter, vehicleFilter])

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">

      {/* Header */}
      <Header
        title="Multas"
        subtitle="Controle de infrações de trânsito"
        actions={
          <Link
            href="/multas/novo"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e818] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Registrar Multa
          </Link>
        }
      />

      <div className="p-6 space-y-5">

        {/* Erro global */}
        {error && (
          <div className="p-3 rounded-lg bg-[#7c1c1c] text-[13px] text-[#ff9c9a]">
            {error}
          </div>
        )}

        {/* ── KPI cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <KpiCard icon={FileText}    iconBg="bg-[#323232]" iconColor="text-[#9e9e9e]" label="Total"         value={kpis.total} />
          <KpiCard icon={Clock}       iconBg="bg-[#2d0363]" iconColor="text-[#a880ff]" label="Pendentes"     value={kpis.pendingCount}   sub={formatCurrency(kpis.pendingValue)} />
          <KpiCard icon={AlertTriangle} iconBg="bg-[#7c1c1c]" iconColor="text-[#ff9c9a]" label="Vencidas"   value={kpis.overdueCount}   sub={formatCurrency(kpis.overdueValue)} />
          <KpiCard icon={Calendar}    iconBg="bg-[#3a180f]" iconColor="text-[#e65e24]" label="A vencer (7d)" value={kpis.dueSoonCount} />
          <KpiCard icon={CheckCircle2} iconBg="bg-[#0e2f13]" iconColor="text-[#229731]" label="Pagas (mês)"  value={kpis.paidMonthCount} sub={formatCurrency(kpis.paidMonthValue)} />
        </div>

        {/* ── Filtros ────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Abas de status */}
          <div className="flex flex-wrap border-b border-[#616161]">
            {statusTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  statusFilter === tab.id
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-[#616161]">({tab.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Filtros secundários */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={vehicleFilter}
              onChange={(e) => setVehicleFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              <option value="">Todas as motos</option>
              {vehicles.map((m) => (
                <option key={m.id} value={m.id} className="bg-[#202020]">
                  {m.license_plate} — {m.make} {m.model}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#616161]" />
              <input
                type="text"
                placeholder="Buscar..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 rounded-lg border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none w-44"
              />
            </div>
          </div>
        </div>

        {/* ── Accordion por moto ─────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>

        ) : groupedFines.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <FileText className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhuma multa encontrada.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou registre uma nova multa.</p>
          </div>

        ) : (
          <div className="space-y-2">
            {groupedFines.map(({ vehicle_id, moto, items }) => {
              const isExpanded  = !collapsedGroups.has(vehicle_id)
              const showHistory = historyGroups.has(vehicle_id)

              const pendingItems = items.filter((i) => i._status !== 'paid')
              const paidItems    = items.filter((i) => i._status === 'paid')

              const nOverdue     = pendingItems.filter((i) => i._status === 'overdue').length
              const nDueSoon     = pendingItems.filter((i) => i._status === 'due_soon').length
              const pendingTotal = pendingItems.reduce((acc, i) => acc + Number(i.amount), 0)

              const dotColor = nOverdue > 0
                ? STATUS_DOT.overdue
                : nDueSoon > 0
                  ? STATUS_DOT.due_soon
                  : STATUS_DOT.ok

              return (
                <div key={vehicle_id} className="overflow-hidden rounded-xl bg-[#202020]">

                  {/* Cabeçalho do accordion */}
                  <button
                    onClick={() => toggleGroup(vehicle_id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#323232] transition-colors text-left"
                  >
                    <ChevronDown className={`w-4 h-4 text-[#9e9e9e] shrink-0 transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`} />
                    <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                    <span className="font-mono font-bold text-[#f5f5f5] text-[13px]">
                      {moto?.license_plate ?? '—'}
                    </span>
                    <span className="text-[13px] text-[#9e9e9e]">{moto?.make} {moto?.model}</span>

                    <div className="ml-auto flex items-center gap-1.5">
                      {nOverdue > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#7c1c1c] text-[#ff9c9a]">
                          {nOverdue} vencida{nOverdue > 1 ? 's' : ''}
                        </span>
                      )}
                      {nDueSoon > 0 && (
                        <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#3a180f] text-[#e65e24]">
                          {nDueSoon} a vencer
                        </span>
                      )}
                      {pendingTotal > 0 && (
                        <span className="text-[13px] font-medium text-[#ff9c9a] ml-1">
                          {formatCurrency(pendingTotal)}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Conteúdo expandido */}
                  {isExpanded && (
                    <div className="border-t border-[#323232]">

                      {/* Tabela de pendentes */}
                      {pendingItems.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-[13px] text-[#f5f5f5]">
                            <thead>
                              <tr className="border-b border-[#323232]">
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Infração</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Data / Vencimento</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Valor</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Responsável</th>
                                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Status</th>
                                <th className="h-9 px-4 text-right text-[#9e9e9e] text-[13px] font-medium">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pendingItems.map((item) => {
                                const badge = STATUS_BADGE[item._status]
                                return (
                                  <tr key={item.id} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232]">

                                    <td className="px-4 max-w-xs">
                                      <p className="font-medium text-[#f5f5f5]">{item.description}</p>
                                      {item.observations && (
                                        <p className="text-[12px] text-[#9e9e9e] mt-0.5 line-clamp-1">{item.observations}</p>
                                      )}
                                      {item.customers?.name && (
                                        <p className="text-[12px] text-[#616161] mt-0.5">{item.customers.name}</p>
                                      )}
                                    </td>

                                    <td className="px-4">
                                      <p className="text-[#f5f5f5]">{formatDate(item.infraction_date)}</p>
                                      {item.due_date && (
                                        <p className={`text-[12px] mt-0.5 ${item._status === 'overdue' ? 'text-[#ff9c9a]' : 'text-[#9e9e9e]'}`}>
                                          Venc: {formatDate(item.due_date)}
                                        </p>
                                      )}
                                    </td>

                                    <td className="px-4">
                                      <span className="font-medium text-[#ff9c9a]">
                                        {formatCurrency(Number(item.amount))}
                                      </span>
                                    </td>

                                    <td className="px-4">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${
                                        item.responsible === 'customer'
                                          ? 'bg-[#2d0363] text-[#a880ff]'
                                          : 'bg-[#323232] text-[#9e9e9e]'
                                      }`}>
                                        {item.responsible === 'customer' ? 'Cliente' : 'Empresa'}
                                      </span>
                                    </td>

                                    <td className="px-4">
                                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium ${badge.bg} ${badge.text}`}>
                                        {badge.label}
                                      </span>
                                    </td>

                                    <td className="px-4 text-right">
                                      <div className="flex items-center justify-end gap-1">
                                        <Link
                                          href={`/multas/${item.id}`}
                                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                                          title="Ver detalhes"
                                        >
                                          <Eye className="h-4 w-4" />
                                        </Link>
                                        <Link
                                          href={`/multas/${item.id}/editar`}
                                          className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                                          title="Editar"
                                        >
                                          <Edit2 className="h-4 w-4" />
                                        </Link>
                                        <Button variant="primary" size="sm" className="h-8 w-8 p-0"
                                          onClick={() => handleMarkAsPaid(item)} title="Registrar pagamento">
                                          <CheckCircle className="h-4 w-4" />
                                        </Button>
                                        <Button variant="danger" size="sm" className="h-8 w-8 p-0"
                                          onClick={() => setDeleting(item)} title="Excluir">
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </div>
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="text-center text-[#616161] py-5 text-[13px]">
                          Nenhuma multa pendente.
                        </p>
                      )}

                      {/* Histórico de pagas */}
                      {paidItems.length > 0 && (
                        <div className={pendingItems.length > 0 ? 'border-t border-[#323232]' : ''}>
                          <button
                            onClick={() => toggleHistory(vehicle_id)}
                            className="w-full flex items-center gap-2 px-4 py-2 text-[12px] text-[#616161] hover:text-[#9e9e9e] transition-colors"
                          >
                            <ChevronDown className={`w-3 h-3 transition-transform duration-150 ${showHistory ? '' : '-rotate-90'}`} />
                            {showHistory
                              ? 'Ocultar histórico'
                              : `Ver histórico (${paidItems.length} paga${paidItems.length > 1 ? 's' : ''})`}
                          </button>

                          {showHistory && (
                            <div className="border-t border-[#323232] overflow-x-auto">
                              <table className="w-full text-left text-[13px]">
                                <tbody>
                                  {paidItems.map((item) => (
                                    <tr key={item.id} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232] opacity-80">
                                      <td className="px-4 w-1/2">
                                        <p className="text-[#9e9e9e]">{item.description}</p>
                                        {item.customers?.name && (
                                          <p className="text-[12px] text-[#616161]">{item.customers.name}</p>
                                        )}
                                      </td>
                                      <td className="px-4 text-[12px] text-[#9e9e9e]">
                                        {item.payment_date ? formatDate(item.payment_date) : '—'}
                                      </td>
                                      <td className="px-4 text-[13px] font-medium text-[#229731]">
                                        {formatCurrency(Number(item.amount))}
                                      </td>
                                      <td className="px-4 text-right">
                                        <div className="flex items-center justify-end gap-1">
                                          <Link
                                            href={`/multas/${item.id}`}
                                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                                            title="Ver detalhes"
                                          >
                                            <Eye className="h-4 w-4" />
                                          </Link>
                                          <Link
                                            href={`/multas/${item.id}/editar`}
                                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                                            title="Editar"
                                          >
                                            <Edit2 className="h-4 w-4" />
                                          </Link>
                                          <Button variant="danger" size="sm" className="h-8 w-8 p-0"
                                            onClick={() => setDeleting(item)} title="Excluir">
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal: Confirmar Pagamento ──────────────────────────────────────── */}
      <Modal
        open={!!payingFine}
        onClose={() => { setPayingFine(null); setPaymentDateInput('') }}
        title="Confirmar Pagamento"
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-[#323232] rounded-lg space-y-1">
            <p className="text-[13px] text-[#9e9e9e]">
              Cliente: <span className="text-[#f5f5f5] font-medium">{payingFine?.customers?.name ?? '—'}</span>
            </p>
            <p className="text-[13px] text-[#9e9e9e]">
              Valor: <span className="text-[#ff9c9a] font-medium">
                {payingFine ? formatCurrency(Number(payingFine.amount)) : ''}
              </span>
            </p>
          </div>

          <Input
            label="Data do Pagamento"
            type="date"
            value={paymentDateInput}
            onChange={(e) => setPaymentDateInput(e.target.value)}
            required
          />

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => { setPayingFine(null); setPaymentDateInput('') }}>
              Cancelar
            </Button>
            <Button loading={saving} onClick={confirmPayment}>
              <CheckCircle className="w-4 h-4" />
              Confirmar Pagamento
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Modal: Confirmar Exclusão ───────────────────────────────────────── */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Excluir Multa" size="sm">
        <div className="space-y-4">
          <p className="text-[#9e9e9e] text-[13px]">
            Tem certeza que deseja excluir a multa{' '}
            <span className="text-[#f5f5f5] font-medium">{deleting?.description}</span>?
            Esta ação removerá permanentemente o histórico da infração.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" loading={saving} onClick={confirmDeletion}>
              <Trash2 className="w-4 h-4" />
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
