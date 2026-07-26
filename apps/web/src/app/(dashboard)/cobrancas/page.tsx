/**
 * @file page.tsx
 * @description Página de Gerenciamento de Cobranças do Sistema GoMoto.
 *
 * Este arquivo é responsável por renderizar a interface de controle financeiro de recebíveis,
 * conectando-se ao banco de dados Supabase em tempo real para buscar, criar, editar e
 * gerenciar o status de cobranças vinculadas aos contratos de locação.
 *
 * Funcionalidades principais:
 * - Listagem de cobranças em tempo real com filtros por status.
 * - Painel de métricas financeiras calculado sobre os dados reais.
 * - CRUD completo: criar, editar, marcar como pago, marcar como prejuízo e excluir.
 * - Link direto para WhatsApp do cliente em cada linha da tabela.
 *
 * O código segue o padrão internacional com identificadores em Inglês,
 * enquanto a interface e os comentários são em Português Brasil.
 */

'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, CheckCircle, AlertTriangle, Search, MessageCircle, CheckCircle2, DollarSign, QrCode, Copy, X, Clock, TrendingDown, Eye } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Card, StatCard } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useBillings, useCustomers, useActiveRentals, usePaymentConnection } from '@gomoto/data'
import type { Billing, PixStatus } from '@gomoto/core'
import {
  calculateDaysOverdue,
  calculateDefaultRate,
  calculatePunctualityRate,
} from '@gomoto/core'
import type { PixResult } from '@gomoto/core'
import {
  createBilling,
  updateBilling,
  markBillingAsPaid,
  markBillingAsLoss,
  deleteBilling,
  generatePixAction,
} from './actions'

/**
 * @type ChargeWithRelations
 * @description Alias para Billing — mantido para legibilidade interna desta tela.
 * O shape `customers` / `contracts` vem dos joins feitos pelo repositório em @gomoto/data.
 */
type ChargeWithRelations = Billing

/** @constant tabs - Opções de filtragem por status para os botões de aba. */
const tabs = [
  { label: 'Em aberto', value: 'relevant' },
  { label: 'Todas', value: 'all' },
  { label: 'Pendentes', value: 'pending' },
  { label: 'Vencidas', value: 'overdue' },
  { label: 'Pagas', value: 'paid' },
  { label: 'Prejuízo', value: 'prejudice' },
]

/**
 * Retorna apenas as cobranças relevantes para o operador:
 * - Ciclo: vencidas ou pendentes com data já passada + próxima a vencer por locação
 * - Avulso/complementar: todas pendentes ou vencidas
 */
function getRelevantBillings(billings: ChargeWithRelations[]): ChargeWithRelations[] {
  const today = new Date().toISOString().slice(0, 10)
  const isOpenCycle = (b: ChargeWithRelations) =>
    b.billing_type === 'cycle' &&
    (b.status === 'overdue' || (b.status === 'pending' && b.due_date < today))
  const isNonCyclePending = (b: ChargeWithRelations) =>
    b.billing_type !== 'cycle' && (b.status === 'pending' || b.status === 'overdue')

  const overdueCycle    = billings.filter(isOpenCycle)
  const nonCyclePending = billings.filter(isNonCyclePending)

  // Próxima cobrança de ciclo futura por locação (ou por cliente se sem locação)
  const pendingCyclesSorted = billings
    .filter((b) => b.billing_type === 'cycle' && b.status === 'pending' && b.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
  const seenLease = new Set<string>()
  const nextCycle: ChargeWithRelations[] = []
  for (const b of pendingCyclesSorted) {
    const key = b.lease_id ?? b.customer_id ?? b.id
    if (!seenLease.has(key)) { seenLease.add(key); nextCycle.push(b) }
  }

  const seen = new Set<string>()
  const result: ChargeWithRelations[] = []
  for (const b of [...overdueCycle, ...nonCyclePending, ...nextCycle]) {
    if (!seen.has(b.id)) { seen.add(b.id); result.push(b) }
  }
  return result.sort((a, b) => a.due_date.localeCompare(b.due_date))
}

/** @constant defaultForm - Estado inicial limpo para o formulário de cobrança. */
const defaultForm = {
  customer_id: '',
  lease_id: '',
  description: '',
  amount: '',
  due_date: '',
  notes: '',
}

/**
 * @component CobrancasPage
 * @description Componente principal da página de cobranças.
 * Gerencia todo o estado da interface, busca dados reais do Supabase e
 * realiza operações de escrita em tempo real.
 */
export default function CobrancasPage() {
  const queryClient = useQueryClient()

  /** Reads via @gomoto/data — cache compartilhado entre telas, refetch automático após mutations. */
  const billingsQuery = useBillings()
  const customersQuery = useCustomers()
  const rentalsQuery = useActiveRentals()
  const paymentConnection = usePaymentConnection()

  const charges: ChargeWithRelations[] = useMemo(
    () => (billingsQuery.data ?? []) as ChargeWithRelations[],
    [billingsQuery.data],
  )
  const clientes = useMemo(
    () => (customersQuery.data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
    [customersQuery.data],
  )
  const contratos = useMemo(
    () =>
      (rentalsQuery.data ?? []).map((r) => ({
        id: r.id,
        customer_id: r.customer_id,
        customers: r.customer ? { name: r.customer.name } : null,
      })),
    [rentalsQuery.data],
  )

  const loading = billingsQuery.isLoading
  const fetchError = billingsQuery.error instanceof Error ? billingsQuery.error.message : null

  /** @state saving - Bloqueia botões durante operações de escrita. */
  const [saving, setSaving] = useState(false)

  /** @state activeTab - Filtro de status selecionado. */
  const [activeTab, setActiveTab] = useState('relevant')
  /** @state search - Termo de busca textual. */
  const [search, setSearch] = useState('')

  /** @state modalOpen - Controla o modal de criação/edição. */
  const [modalOpen, setModalOpen] = useState(false)
  /** @state editingId - ID da cobrança sendo editada (null = nova). */
  const [editingId, setEditingId] = useState<string | null>(null)
  /** @state form - Dados capturados pelo formulário. */
  const [form, setForm] = useState(defaultForm)

  /** @state confirmingPaid - Cobrança selecionada para confirmar pagamento. */
  const [confirmingPaid, setConfirmingPaid] = useState<ChargeWithRelations | null>(null)
  /** @state paymentMethod - Método de pagamento selecionado no modal. */
  const [paymentMethod, setPaymentMethod] = useState('')
  /** @state confirmingLoss - Cobrança selecionada para marcar como prejuízo. */
  const [confirmingLoss, setConfirmingLoss] = useState<ChargeWithRelations | null>(null)
  /** @state deleting - Cobrança selecionada para exclusão. */
  const [deleting, setDeleting] = useState<ChargeWithRelations | null>(null)

  /** @state pixModal - Dados do Pix exibido no modal. */
  const [pixModal, setPixModal] = useState<{ billing: ChargeWithRelations; result: PixResult } | null>(null)
  /** @state generatingPixId - ID da cobrança com geração de Pix em andamento. */
  const [generatingPixId, setGeneratingPixId] = useState<string | null>(null)
  /** @state copied - Sinaliza que o código foi copiado. */
  const [copied, setCopied] = useState(false)
  /** @state pixPaid - Pix do modal foi confirmado pelo webhook durante o polling. */
  const [pixPaid, setPixPaid] = useState(false)

  /** Invalida o cache de billings após cada mutation — substitui o antigo `fetchCharges()`. */
  const invalidateBillings = () => queryClient.invalidateQueries({ queryKey: ['billings'] })

  /** Fecha o modal de Pix e força refresh para refletir status atualizado. */
  function closePixModal() {
    setPixModal(null)
    setPixPaid(false)
    invalidateBillings()
  }

  // Refetch quando a janela volta ao foco (ex: cliente pagou no celular, operador alt-tabs de volta)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') billingsQuery.refetch()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [billingsQuery])

  // Polling a cada 5s enquanto modal Pix está aberto
  useEffect(() => {
    if (!pixModal) return
    const id = setInterval(() => billingsQuery.refetch(), 5000)
    return () => clearInterval(id)
  }, [pixModal, billingsQuery])

  // Detecta confirmação automática via webhook (cobrança mudou para 'paid' durante polling)
  useEffect(() => {
    if (!pixModal || pixPaid) return
    const latest = charges.find((c) => c.id === pixModal.billing.id)
    if (latest?.status === 'paid') {
      setPixPaid(true)
      setTimeout(() => closePixModal(), 2500)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charges, pixModal, pixPaid])

  const isConnected = paymentConnection.data?.is_connected ?? false

  function getPixStatus(row: ChargeWithRelations): PixStatus {
    const pixList = row.billing_pix
    if (!pixList || pixList.length === 0) return 'none'
    const active = pixList.find(
      (p) => p.status === 'active' && new Date(p.expires_at) > new Date(),
    )
    if (active) return 'active'
    const paid = pixList.find((p) => p.status === 'paid')
    if (paid) return 'paid'
    return 'expired'
  }

  async function handleGeneratePix(row: ChargeWithRelations) {
    setGeneratingPixId(row.id)
    const result = await generatePixAction(row.id)
    setGeneratingPixId(null)
    if (!result.ok || !result.data) {
      alert(result.error?.message ?? 'Falha ao gerar Pix.')
      return
    }
    setPixModal({ billing: row, result: result.data })
    await invalidateBillings()
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  /**
   * @function openNew
   * @description Reseta o formulário e abre o modal para criação de uma nova cobrança.
   */
  function openNew() {
    setEditingId(null)
    setForm(defaultForm)
    setModalOpen(true)
  }

  /**
   * @function openEdit
   * @description Preenche o formulário com os dados existentes e abre o modal para edição.
   * @param row - Objeto da cobrança a ser editada.
   */
  function openEdit(row: ChargeWithRelations) {
    setEditingId(row.id)
    setForm({
      customer_id: row.customer_id ?? '',
      lease_id: row.lease_id ?? '',
      description: row.description ?? '',
      amount: String(row.original_amount ?? 0),
      due_date: row.due_date,
      notes: row.observations ?? '',
    })
    setModalOpen(true)
  }

  /**
   * Envia o formulário para a Server Action correspondente.
   * As actions validam via Zod, injetam tenant_id e gravam audit_log automaticamente.
   */
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const basePayload = {
      customer_id:     form.customer_id,
      lease_id:        form.lease_id || null,
      description:     form.description,
      original_amount: parseFloat(form.amount),
      due_date:        form.due_date,
      observations:    form.notes || null,
    }
    const result = editingId
      ? await updateBilling(editingId, basePayload)
      : await createBilling({ ...basePayload, billing_type: 'one_time' })

    if ('error' in result) {
      alert('Erro ao salvar cobrança: ' + result.error)
    } else {
      setModalOpen(false)
      await invalidateBillings()
    }
    setSaving(false)
  }

  /** Marca como pago via Server Action — concat de observations e audit_log feitos server-side. */
  async function confirmPaid() {
    if (!confirmingPaid || !paymentMethod) return
    const latest = charges.find((c) => c.id === confirmingPaid.id)
    if (latest?.status === 'paid') {
      alert('Esta cobrança já foi confirmada como paga.')
      setConfirmingPaid(null)
      return
    }
    setSaving(true)
    const result = await markBillingAsPaid(confirmingPaid.id, paymentMethod)
    if ('error' in result) {
      alert('Erro: ' + result.error)
    } else {
      setConfirmingPaid(null)
      setPaymentMethod('')
      await invalidateBillings()
    }
    setSaving(false)
  }

  /** Marca como prejuízo via Server Action. */
  async function confirmLoss() {
    if (!confirmingLoss) return
    const latest = charges.find((c) => c.id === confirmingLoss.id)
    if (latest?.status === 'paid') {
      alert('Esta cobrança já foi paga e não pode ser registrada como prejuízo.')
      setConfirmingLoss(null)
      return
    }
    setSaving(true)
    const result = await markBillingAsLoss(confirmingLoss.id)
    if ('error' in result) {
      alert('Erro: ' + result.error)
    } else {
      setConfirmingLoss(null)
      await invalidateBillings()
    }
    setSaving(false)
  }

  /** Exclui via Server Action — audit_log da exclusão registrado server-side. */
  async function confirmDeletion() {
    if (!deleting) return
    const latest = charges.find((c) => c.id === deleting.id)
    if (latest?.status === 'paid') {
      alert('Cobranças pagas não podem ser excluídas.')
      setDeleting(null)
      return
    }
    setSaving(true)
    const result = await deleteBilling(deleting.id)
    if ('error' in result) {
      alert('Erro: ' + result.error)
    } else {
      setDeleting(null)
      await invalidateBillings()
    }
    setSaving(false)
  }

  /**
   * @variable filtered
   * @description Aplica filtros de aba e busca textual sobre a lista de cobranças.
   * useMemo evita reprocessar a lista a cada render causado por estados não relacionados (ex: modais).
   */
  const filtered = useMemo(() => {
    const base = activeTab === 'relevant'
      ? getRelevantBillings(charges)
      : charges.filter((c) => activeTab === 'all' || c.status === activeTab)
    if (!search) return base
    const q = search.toLowerCase()
    return base.filter((c) =>
      (c.customers?.name ?? '').toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    )
  }, [charges, activeTab, search])

  const metrics = useMemo(() => {
    const today = new Date()
    const in30Days = new Date(today)
    in30Days.setDate(today.getDate() + 30)

    const overdueCharges = charges.filter((c) => c.status === 'overdue')
    const totalOverdue = overdueCharges.reduce((sum, c) => sum + (c.original_amount ?? 0), 0)
    const oldestOverdue = overdueCharges.sort(
      (a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime(),
    )[0]
    const daysOverdue = oldestOverdue ? calculateDaysOverdue(oldestOverdue, today) : 0

    const pendingCharges = charges.filter((c) => c.status === 'pending')
    const totalPending = pendingCharges.reduce((sum, c) => sum + (c.original_amount ?? 0), 0)
    const projection30Days = pendingCharges
      .filter((c) => new Date(c.due_date + 'T00:00:00') <= in30Days)
      .reduce((sum, c) => sum + (c.original_amount ?? 0), 0)

    const defaultRate = calculateDefaultRate(charges)
    const punctualityRate = calculatePunctualityRate(charges)

    return {
      totalOverdue,
      overdueCount: overdueCharges.length,
      oldestOverdue,
      daysOverdue,
      totalPending,
      pendingCount: pendingCharges.length,
      projection30Days,
      defaultRate,
      punctualityRate,
    }
  }, [charges])

  return (
    <div className="flex flex-col min-h-full">
      <PageTitle
        title="Cobranças"
        subtitle="Controle de recebimentos em tempo real"
        actions={
          <Button onClick={openNew}>
            <Plus className="w-4 h-4" />
            Nova Cobrança
          </Button>
        }
      />
      <div className="p-6 space-y-4">

        {/* Status da integração MP */}
        {!paymentConnection.isLoading && !isConnected && (
          <div className="rounded-xl border border-[#474747] bg-[#1a1a1a] px-4 py-3 flex items-center gap-3">
            <QrCode className="w-5 h-5 text-[#9e9e9e] shrink-0" />
            <p className="text-[13px] text-[#9e9e9e] flex-1">
              Para gerar Pix de cobranças, conecte a conta Mercado Pago nas{' '}
              <a href="/configuracoes" className="text-[#BAFF1A] underline underline-offset-2">Configurações</a>.
            </p>
          </div>
        )}

        {/* Mensagem de erro no carregamento */}
        {fetchError && (
          <div className="rounded-xl border border-[#ff9c9a] bg-[#7c1c1c] px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-[#ff9c9a] shrink-0" />
            <div className="flex-1">
              <p className="text-[13px] font-medium text-[#ff9c9a]">Erro ao carregar cobranças</p>
              <p className="text-[12px] text-[#9e9e9e] mt-0.5">{fetchError}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => billingsQuery.refetch()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            title="Vencidas"
            value={formatCurrency(metrics.totalOverdue)}
            subtitle={
              metrics.overdueCount === 0
                ? 'Nenhuma em atraso'
                : metrics.oldestOverdue
                ? `${metrics.overdueCount} cobranças · mais antiga: ${metrics.daysOverdue}d`
                : `${metrics.overdueCount} cobranças em atraso`
            }
            icon={AlertTriangle}
          />
          <StatCard
            title="Pendentes"
            value={formatCurrency(metrics.totalPending)}
            subtitle={`${metrics.pendingCount} cobranças · ${formatCurrency(metrics.projection30Days)} vencem em 30 dias`}
            icon={Clock}
          />
          <StatCard
            title="Inadimplência"
            value={`${metrics.defaultRate.toFixed(1)}%`}
            subtitle={`${metrics.punctualityRate.toFixed(1)}% de pontualidade`}
            icon={TrendingDown}
          />
        </div>

        {/* Barra de Filtros e Busca */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex flex-wrap border-b border-[#616161]">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setActiveTab(tab.value)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  activeTab === tab.value
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {tab.label}
                {tab.value !== 'all' && (
                  <span className="ml-1.5 text-[#616161]">
                    ({tab.value === 'relevant'
                      ? getRelevantBillings(charges).length
                      : charges.filter((c) => c.status === tab.value).length})
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="ml-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9e9e9e]" />
            <input
              type="text"
              placeholder="Buscar por cliente ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 pl-9 pr-4 rounded-full bg-[#323232] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder-[#616161] focus:outline-none focus:border-[#BAFF1A] w-72"
            />
          </div>
        </div>

        {/* Tabela de Cobranças */}
        <div className="overflow-hidden rounded-xl bg-[#202020]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <svg className="animate-spin h-8 w-8 text-[#BAFF1A]" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <p className="text-[13px] text-[#c7c7c7]">Carregando cobranças...</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-[#c7c7c7] text-[13px] italic">Nenhuma cobrança encontrada</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] text-[#f5f5f5]">
                <thead className="text-[#9e9e9e]">
                  <tr className="border-b border-[#323232]">
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Cliente</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Descrição</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Valor</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Vencimento</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Status</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Pix</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Dt. Pagamento</th>
                    <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => {
                    const phone = row.customers?.phone
                    const wpLink = phone ? `https://wa.me/55${phone.replace(/\D/g, '')}` : null
                    return (
                      <tr key={row.id} className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232]">
                        <td className="px-4 text-[13px]">
                          <div className="flex items-center gap-2">
                            <span className="text-[#f5f5f5]">{row.customers?.name ?? '—'}</span>
                            {wpLink && (
                              <a
                                href={wpLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title="Abrir WhatsApp"
                                className="text-[#9e9e9e] hover:text-[#229731] transition-colors"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="px-4 text-[13px]">{row.description}</td>
                        <td className="whitespace-nowrap px-4 text-[13px] font-medium text-[#f5f5f5]">{formatCurrency(row.original_amount ?? 0)}</td>
                        <td className="whitespace-nowrap px-4 text-[13px]">{formatDate(row.due_date)}</td>
                        <td className="px-4"><StatusBadge status={row.status} /></td>
                        <td className="whitespace-nowrap px-4">
                          {(() => {
                            const ps = getPixStatus(row)
                            const colors: Record<string, string> = {
                              none:    'text-[#616161]',
                              active:  'text-[#3b82f6]',
                              expired: 'text-[#9e9e9e]',
                              paid:    'text-[#229731]',
                            }
                            const labels: Record<string, string> = {
                              none: '—', active: 'Ativo', expired: 'Expirado', paid: 'Pago',
                            }
                            return <span className={`text-[13px] ${colors[ps]}`}>{labels[ps]}</span>
                          })()}
                        </td>
                        <td className="whitespace-nowrap px-4 text-[13px] text-[#9e9e9e]">
                          {row.paid_at ? formatDate(row.paid_at) : row.payment_date ? formatDate(row.payment_date) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/cobrancas/${row.id}`} className="inline-flex h-8 w-8 items-center justify-center rounded bg-[#323232] text-[#9e9e9e] transition-colors hover:bg-[#474747] hover:text-[#f5f5f5]" title="Ver detalhes">
                              <Eye className="h-4 w-4" />
                            </Link>
                            {row.status !== 'paid' && (
                              <Button variant="secondary" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(row)} title="Editar">
                                <Edit2 className="h-4 w-4" />
                              </Button>
                            )}
                            {(row.status === 'pending' || row.status === 'overdue') && isConnected && (
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleGeneratePix(row)}
                                loading={generatingPixId === row.id}
                                title="Gerar Pix"
                              >
                                <QrCode className="h-4 w-4" />
                              </Button>
                            )}
                            {(row.status === 'pending' || row.status === 'overdue') && !isConnected && (
                              <button
                                className="h-8 w-8 p-0 rounded flex items-center justify-center text-[#474747] cursor-not-allowed"
                                title="Configure a integração de pagamento nas Configurações"
                                disabled
                              >
                                <QrCode className="h-4 w-4" />
                              </button>
                            )}
                            {(row.status === 'pending' || row.status === 'overdue') && (
                              <Button variant="primary" size="sm" className="h-8 w-8 p-0" onClick={() => { setConfirmingPaid(row); setPaymentMethod('') }} title="Marcar como pago">
                                <CheckCircle2 className="h-4 w-4" />
                              </Button>
                            )}
                            {(row.status === 'pending' || row.status === 'overdue') && (
                              <Button variant="danger" size="sm" className="h-8 w-8 p-0" onClick={() => setConfirmingLoss(row)} title="Contabilizar como prejuízo">
                                <AlertTriangle className="h-4 w-4" />
                              </Button>
                            )}
                            {row.status !== 'paid' && (
                              <Button variant="danger" size="sm" className="h-8 w-8 p-0" onClick={() => setDeleting(row)} title="Excluir">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
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

      {/* Modal: Formulário de criação ou edição de cobrança */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Editar Cobrança' : 'Nova Cobrança'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Select
            label="Cliente"
            options={[
              { value: '', label: 'Selecione um cliente' },
              ...clientes.map((c) => ({ value: c.id, label: c.name })),
            ]}
            value={form.customer_id}
            onChange={(e) => setForm({ ...form, customer_id: e.target.value })}
            required
          />
          <Select
            label="Locação (opcional)"
            options={[
              { value: '', label: 'Nenhuma locação vinculada' },
              ...contratos
                .filter((c) => !form.customer_id || c.customer_id === form.customer_id)
                .map((c) => ({
                  value: c.id,
                  label: `${c.id.slice(0, 8)}... — ${c.customers?.name ?? 'Cliente'}`,
                })),
            ]}
            value={form.lease_id}
            onChange={(e) => setForm({ ...form, lease_id: e.target.value })}
          />
          <Input
            label="Descrição"
            placeholder="Ex: Semanal — 10/03 a 16/03"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Valor (R$)"
              type="number"
              step="0.01"
              placeholder="350.00"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
              required
            />
            <Input
              label="Vencimento"
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
              required
            />
          </div>
          <Textarea
            label="Observações"
            placeholder="Informações adicionais..."
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              <DollarSign className="w-4 h-4" />
              {editingId ? 'Salvar Alterações' : 'Criar Cobrança'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Confirmar recebimento de pagamento */}
      <Modal open={!!confirmingPaid} onClose={() => setConfirmingPaid(null)} title="Confirmar Pagamento" size="sm">
        <div className="space-y-4">
          <div className="p-4 bg-[#0e2f13] border border-[#28b438] rounded-xl space-y-2">
            <p className="text-[13px] text-[#f5f5f5] font-medium">Confirmar recebimento desta cobrança?</p>
            {confirmingPaid && (
              <div className="space-y-0.5">
                <p className="text-[12px] text-[#9e9e9e]">{confirmingPaid.customers?.name ?? '—'}</p>
                <p className="text-[12px] text-[#9e9e9e]">{confirmingPaid.description}</p>
                <p className="text-[13px] font-medium text-[#229731]">{formatCurrency(confirmingPaid.original_amount ?? 0)}</p>
              </div>
            )}
          </div>
          <Select
            label="Método de Pagamento"
            options={[
              { value: '', label: 'Selecione o método' },
              { value: 'PIX', label: 'PIX' },
              { value: 'Dinheiro', label: 'Dinheiro' },
              { value: 'Cartão de Crédito', label: 'Cartão de Crédito' },
              { value: 'Cartão de Débito', label: 'Cartão de Débito' },
              { value: 'Transferência', label: 'Transferência' },
            ]}
            value={paymentMethod}
            onChange={(e) => setPaymentMethod(e.target.value)}
            required
          />
          <p className="text-[12px] text-[#9e9e9e]">A data de pagamento será registrada como hoje.</p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setConfirmingPaid(null)}>Cancelar</Button>
            <Button onClick={confirmPaid} loading={saving} disabled={!paymentMethod}>
              <CheckCircle className="w-4 h-4" />
              Confirmar Pagamento
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Contabilizar cobrança como prejuízo */}
      <Modal open={!!confirmingLoss} onClose={() => setConfirmingLoss(null)} title="Registrar como Prejuízo" size="sm">
        <div className="space-y-4">
          <div className="p-4 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl space-y-2">
            <p className="text-[13px] text-[#f5f5f5] font-medium">Tem certeza que deseja contabilizar esta cobrança como prejuízo?</p>
            {confirmingLoss && (
              <div className="space-y-0.5">
                <p className="text-[12px] text-[#9e9e9e]">{confirmingLoss.customers?.name ?? '—'}</p>
                <p className="text-[12px] text-[#9e9e9e]">{confirmingLoss.description}</p>
                <p className="text-[13px] font-medium text-[#ff9c9a]">{formatCurrency(confirmingLoss.original_amount ?? 0)}</p>
              </div>
            )}
          </div>
          <p className="text-[12px] text-[#ff9c9a]">Esta ação indica que a dívida é irrecuperável. Não pode ser desfeita facilmente.</p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setConfirmingLoss(null)}>Cancelar</Button>
            <Button variant="danger" onClick={confirmLoss} loading={saving}>
              <AlertTriangle className="w-4 h-4" />
              Confirmar Prejuízo
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: QR Code Pix */}
      <Modal open={!!pixModal} onClose={closePixModal} title="Pix de Cobrança" size="sm">
        {pixModal && (
          <div className="space-y-4">
            {pixPaid ? (
              <div className="flex flex-col items-center gap-3 py-6">
                <CheckCircle2 className="w-16 h-16 text-[#229731]" />
                <p className="text-[15px] font-medium text-[#f5f5f5]">Pagamento confirmado!</p>
                <p className="text-[13px] text-[#9e9e9e]">O Pix foi recebido via Mercado Pago.</p>
              </div>
            ) : (
              <>
                {pixModal.result.is_reused && (
                  <p className="text-[12px] text-[#9e9e9e] text-center">Pix ativo reutilizado — mesmo código gerado anteriormente.</p>
                )}
                <div className="flex flex-col items-center gap-2">
                  <img
                    src={`data:image/png;base64,${pixModal.result.qr_code_base64}`}
                    alt="QR Code Pix"
                    className="w-48 h-48 rounded-xl bg-white p-2"
                  />
                  <div className="text-center">
                    <p className="text-[13px] text-[#9e9e9e]">
                      {pixModal.billing.customers?.name ?? '—'} — {formatCurrency(
                        (pixModal.billing.original_amount ?? 0) - (pixModal.billing.discount_amount ?? 0)
                      )}
                    </p>
                    <p className="text-[12px] text-[#616161] mt-0.5">
                      Vence em {formatDate(pixModal.result.expires_at.slice(0, 10))}
                    </p>
                  </div>
                </div>
                <div className="rounded-xl bg-[#1a1a1a] border border-[#323232] p-3">
                  <p className="text-[11px] text-[#9e9e9e] mb-1">Copia e Cola</p>
                  <p className="text-[12px] text-[#f5f5f5] break-all font-mono leading-relaxed select-all">
                    {pixModal.result.qr_code}
                  </p>
                </div>
                <div className="flex gap-3 items-center">
                  <Button
                    className="flex-1"
                    onClick={() => copyToClipboard(pixModal.result.qr_code)}
                  >
                    {copied ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? 'Copiado!' : 'Copiar Código'}
                  </Button>
                  <div className="flex items-center gap-1.5 text-[12px] text-[#616161]">
                    <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Aguardando…
                  </div>
                  <Button variant="ghost" onClick={closePixModal}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </Modal>

      {/* Modal: Exclusão definitiva de cobrança */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} title="Excluir Cobrança" size="sm">
        <div className="space-y-4">
          <p className="text-[#9e9e9e] text-[13px]">
            Tem certeza que deseja excluir a cobrança{' '}
            <span className="text-[#f5f5f5] font-medium">{deleting?.description}</span>?
            Esta ação não poderá ser desfeita.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={confirmDeletion} loading={saving}>
              <Trash2 className="w-4 h-4" />
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
