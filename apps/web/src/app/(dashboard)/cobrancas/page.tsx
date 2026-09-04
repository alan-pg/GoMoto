/**
 * @file page.tsx
 * @description Cobranças — cockpit de recebíveis (Spec 0014 / ADR 0024).
 *
 * Reescrita sobre o ledger. Diferenças de fundo em relação à versão anterior:
 *
 * - A listagem lê `charge_balances`: total, pago e em aberto são DERIVADOS, não
 *   colunas. Atraso vem de `due_date < hoje`, não de um status armazenado que
 *   ninguém atualizava.
 * - O valor exibido é `amount_due` (principal + encargo), calculado por
 *   `calculateAmountDue` de @gomoto/core — a mesma função do app do cliente e da
 *   criação de cobrança no gateway. Antes havia três contas divergentes (F-05).
 * - Recebimento aceita valor PARCIAL. A cobrança segue em aberto com o saldo
 *   restante; o modelo anterior tornava isso fisicamente impossível.
 * - Não existe excluir cobrança: apagar documento financeiro viola o
 *   Princípio 3. Cancelar e dar baixa cobrem os casos, ambos com estorno
 *   rastreável no ledger.
 */

'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus, Search, MessageCircle, DollarSign, XCircle,
  TrendingDown, Eye, AlertTriangle, Clock,
} from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Card, StatCard } from '@/components/ui/Card'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { RegistrarPagamentoModal } from '@/components/financial/RegistrarPagamentoModal'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useChargesList, useCustomers, useActiveRentals } from '@gomoto/data'
import { ACCOUNTS } from '@gomoto/core'
import {
  createChargeAction,
  cancelChargeAction,
  writeOffChargeAction,
} from './actions'

type ChargeRow = NonNullable<ReturnType<typeof useChargesList>['data']>[number]

const TABS = [
  { label: 'Em aberto', value: 'open' },
  { label: 'Vencidas', value: 'overdue' },
  { label: 'Pagas', value: 'paid' },
  { label: 'Encerradas', value: 'closed' },
  { label: 'Todas', value: 'all' },
]


const emptyForm = {
  customer_id: '',
  rental_id: '',
  description: '',
  amount: '',
  due_date: '',
}

export default function CobrancasPage() {
  const queryClient = useQueryClient()

  const chargesQuery = useChargesList()
  const customersQuery = useCustomers()
  const rentalsQuery = useActiveRentals()

  const charges = useMemo(() => chargesQuery.data ?? [], [chargesQuery.data])

  const customers = useMemo(
    () => (customersQuery.data ?? []).filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
    [customersQuery.data],
  )

  const rentals = useMemo(
    () => (rentalsQuery.data ?? []).map((r) => ({ id: r.id, customer_id: r.customer_id })),
    [rentalsQuery.data],
  )

  const [activeTab, setActiveTab] = useState('open')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  /** Erro do modal aberto. Separado de `feedback`, que vive no topo da página
   *  e fica ATRÁS do modal — invisível justamente quando mais importa. */
  const [modalError, setModalError] = useState<string | null>(null)

  const [newOpen, setNewOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)

  const [receiving, setReceiving] = useState<ChargeRow | null>(null)

  const [cancelling, setCancelling] = useState<ChargeRow | null>(null)
  const [writingOff, setWritingOff] = useState<ChargeRow | null>(null)
  const [reason, setReason] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['charges'] })

  // ---------------------------------------------------------------
  // Métricas
  // ---------------------------------------------------------------

  const metrics = useMemo(() => {
    const open = charges.filter((c) => c.status === 'open')
    const overdue = open.filter((c) => c.is_overdue)

    return {
      // Contas a receber: emitido e não pago. NÃO inclui cronograma futuro —
      // isso é carteira contratada, outra métrica (F-10).
      receivable: open.reduce((s, c) => s + c.amount_due, 0),
      overdueTotal: overdue.reduce((s, c) => s + c.amount_due, 0),
      overdueCount: overdue.length,
      received: charges.reduce((s, c) => s + c.paid_amount, 0),
      // Quanto do recebido é caução — dinheiro do cliente que a empresa segura
      // e um dia devolve. Somado ao aluguel sem distinção, o card mostra um mês
      // bom que pode ter sido só depósito. Não sai da conta (o dinheiro entrou
      // mesmo, e o card precisa bater com o extrato); fica declarado ao lado.
      receivedDeposit: charges
        .filter((c) => c.is_deposit)
        .reduce((s, c) => s + c.paid_amount, 0),
    }
  }, [charges])

  // ---------------------------------------------------------------
  // Filtro
  // ---------------------------------------------------------------

  const visible = useMemo(() => {
    let list = charges

    if (activeTab === 'open') list = list.filter((c) => c.status === 'open')
    else if (activeTab === 'overdue') list = list.filter((c) => c.is_overdue)
    else if (activeTab === 'paid') list = list.filter((c) => c.status === 'paid')
    else if (activeTab === 'closed') {
      list = list.filter((c) => c.status === 'cancelled' || c.status === 'written_off')
    }

    const term = search.trim().toLowerCase()
    if (term) {
      list = list.filter(
        (c) =>
          c.customer_name.toLowerCase().includes(term) ||
          c.primary_description.toLowerCase().includes(term) ||
          String(c.charge_number).includes(term) ||
          (c.vehicle_plate ?? '').toLowerCase().includes(term),
      )
    }

    return list
  }, [charges, activeTab, search])

  // ---------------------------------------------------------------
  // Ações
  // ---------------------------------------------------------------

  async function handleCreate() {
    setSaving(true)
    setFeedback(null)

    const amount = Number(form.amount)
    const result = await createChargeAction({
      customer_id: form.customer_id,
      rental_id: form.rental_id || null,
      due_date: form.due_date,
      items: [
        {
          description: form.description,
          // Cobrança manual credita receita de locação por padrão. Itens de
          // repasse nascem dos módulos (multa, manutenção, despesa), que
          // escolhem a conta correta automaticamente.
          credit_account_code: ACCOUNTS.RENTAL_REVENUE,
          quantity: 1,
          unit_amount: amount,
          amount,
          source_module: 'manual',
        },
      ],
    })

    setSaving(false)

    if (!result.ok) {
      // Dentro do modal: `feedback` renderiza no topo da página, atrás dele.
      setModalError(result.error.message)
      return
    }

    setNewOpen(false)
    setForm(emptyForm)
    setFeedback(`Cobrança #${result.data.charge_number} criada.`)
    refresh()
  }

  async function handleCancel() {
    if (!cancelling) return
    setSaving(true)

    const result = await cancelChargeAction({ charge_id: cancelling.charge_id, reason })
    setSaving(false)

    if (!result.ok) {
      // Dentro do modal: `feedback` renderiza no topo da página, atrás dele.
      setModalError(result.error.message)
      return
    }

    setCancelling(null)
    setReason('')
    setFeedback('Cobrança cancelada e emissão estornada.')
    refresh()
  }

  async function handleWriteOff() {
    if (!writingOff) return
    setSaving(true)

    const result = await writeOffChargeAction({ charge_id: writingOff.charge_id, reason })
    setSaving(false)

    if (!result.ok) {
      // Dentro do modal: `feedback` renderiza no topo da página, atrás dele.
      setModalError(result.error.message)
      return
    }

    setWritingOff(null)
    setReason('')
    setFeedback('Baixa por inadimplência registrada.')
    refresh()
  }

  // ---------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------

  const fetchError = chargesQuery.error instanceof Error ? chargesQuery.error.message : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <PageTitle title="Cobranças" subtitle="Recebíveis emitidos e seus saldos" />
        <Button onClick={() => { setModalError(null); setNewOpen(true) }}>
          <Plus className="h-4 w-4" /> Nova cobrança
        </Button>
      </div>

      {feedback && (
        <div className="border border-[var(--border)] bg-[var(--surface-2)] px-4 py-3 text-[13px]">
          {feedback}
        </div>
      )}

      {fetchError && (
        <div className="border border-[var(--danger)] bg-[var(--danger-bg)] px-4 py-3 text-[13px]">
          Falha ao carregar cobranças: {fetchError}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          title="A receber"
          value={formatCurrency(metrics.receivable)}
          icon={DollarSign}
          subtitle="Emitido e não pago"
        />
        <StatCard
          title="Vencido"
          value={formatCurrency(metrics.overdueTotal)}
          icon={AlertTriangle}
          color="danger"
          subtitle={`${metrics.overdueCount} cobrança(s)`}
        />
        <StatCard
          title="Recebido"
          value={formatCurrency(metrics.received)}
          icon={TrendingDown}
          subtitle={metrics.receivedDeposit > 0
            ? `Inclui ${formatCurrency(metrics.receivedDeposit)} de caução`
            : 'Alocado a cobranças'}
        />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--divider)] p-4">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setActiveTab(t.value)}
              className={`px-3 py-1.5 text-[13px] transition-colors ${
                activeTab === t.value
                  ? 'bg-[var(--primary)] text-[var(--primary-contrast)]'
                  : 'text-[var(--fg-soft)] hover:bg-[var(--surface-2)]'
              }`}
            >
              {t.label}
            </button>
          ))}

          <div className="ml-auto relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--fg-mute)]" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cliente, placa ou número"
              className="pl-9"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--divider)] text-left text-[11px] uppercase tracking-wide text-[var(--fg-mute)]">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Cliente</th>
                <th className="px-4 py-2 font-medium">Descrição</th>
                <th className="px-4 py-2 font-medium">Vencimento</th>
                <th className="px-4 py-2 font-medium text-right">Total</th>
                <th className="px-4 py-2 font-medium text-right">Pago</th>
                <th className="px-4 py-2 font-medium text-right">Devido</th>
                <th className="px-4 py-2 font-medium">Situação</th>
                <th className="px-4 py-2 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {chargesQuery.isLoading && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-[13px] text-[var(--fg-mute)]">Carregando…</td></tr>
              )}

              {!chargesQuery.isLoading && visible.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-[13px] text-[var(--fg-mute)]">Nenhuma cobrança encontrada.</td></tr>
              )}

              {visible.map((c) => (
                <tr key={c.charge_id} className="h-9 border-b border-[var(--divider)] text-[13px]">
                  <td className="px-4 tabular-nums text-[var(--fg-mute)]">{c.charge_number}</td>
                  <td className="px-4">{c.customer_name}</td>
                  <td className="px-4">
                    {c.primary_description}
                    {/* O "+N" sinalizava cobrança composta. Com a regra de
                        origem única não existe mais composta: o único item a
                        mais possível é o encargo por atraso, que já aparece na
                        coluna DEVIDO como "+R$ x". */}
                    {c.vehicle_plate && (
                      <span className="ml-2 text-[var(--fg-mute)]">{c.vehicle_plate}</span>
                    )}
                  </td>
                  <td className="px-4 tabular-nums">
                    {formatDate(c.due_date)}
                    {c.is_overdue && (
                      <span className="ml-2 inline-flex items-center gap-1 text-[var(--critical)]">
                        <Clock className="h-3 w-3" />{c.days_overdue}d
                      </span>
                    )}
                  </td>
                  <td className="px-4 text-right tabular-nums">{formatCurrency(c.total_amount)}</td>
                  <td className="px-4 text-right tabular-nums text-[var(--fg-soft)]">
                    {c.paid_amount > 0 ? formatCurrency(c.paid_amount) : '—'}
                  </td>
                  <td className="px-4 text-right tabular-nums font-medium">
                    {formatCurrency(c.amount_due)}
                    {c.accrued_total > 0 && (
                      <span className="ml-1 text-[11px] text-[var(--pending)]">
                        +{formatCurrency(c.accrued_total)}
                      </span>
                    )}
                  </td>
                  <td className="px-4">
                    <StatusBadge status={c.is_overdue ? 'overdue' : c.status} />
                  </td>
                  <td className="px-4">
                    <div className="flex items-center justify-end gap-1">
                      {c.status === 'open' && (
                        <button
                          title="Registrar pagamento"
                          onClick={() => setReceiving(c)}
                          className="p-1 text-[var(--fg-soft)] hover:text-[var(--success)]"
                        >
                          <DollarSign className="h-4 w-4" />
                        </button>
                      )}

                      {c.status === 'open' && c.paid_amount === 0 && (
                        <button
                          title="Cancelar cobrança"
                          onClick={() => { setModalError(null); setCancelling(c); setReason('') }}
                          className="p-1 text-[var(--fg-soft)] hover:text-[var(--danger)]"
                        >
                          <XCircle className="h-4 w-4" />
                        </button>
                      )}

                      {c.status === 'open' && c.is_overdue && (
                        <button
                          title="Baixa por inadimplência"
                          onClick={() => { setModalError(null); setWritingOff(c); setReason('') }}
                          className="p-1 text-[var(--fg-soft)] hover:text-[var(--critical)]"
                        >
                          <TrendingDown className="h-4 w-4" />
                        </button>
                      )}

                      {c.customer_phone && (
                        <a
                          title="WhatsApp"
                          href={`https://wa.me/55${c.customer_phone.replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-1 text-[var(--fg-soft)] hover:text-[var(--success)]"
                        >
                          <MessageCircle className="h-4 w-4" />
                        </a>
                      )}

                      <Link
                        title="Detalhe"
                        href={`/cobrancas/${c.charge_id}`}
                        className="p-1 text-[var(--fg-soft)] hover:text-[var(--primary)]"
                      >
                        <Eye className="h-4 w-4" />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Nova cobrança ------------------------------------------------ */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Nova cobrança">
        <div className="space-y-4">
          <Select
            label="Cliente"
            value={form.customer_id}
            onChange={(e) => setForm({ ...form, customer_id: e.target.value, rental_id: '' })}
            options={[
              { value: '', label: 'Selecione…' },
              ...customers.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />

          <Select
            label="Locação (opcional)"
            value={form.rental_id}
            onChange={(e) => setForm({ ...form, rental_id: e.target.value })}
            options={[
              { value: '', label: 'Sem vínculo' },
              ...rentals
                .filter((r) => !form.customer_id || r.customer_id === form.customer_id)
                .map((r) => ({ value: r.id, label: r.id.slice(0, 8) })),
            ]}
          />

          <Input
            label="Descrição"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Ex.: Aluguel referente a agosto"
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Valor"
              type="number"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <Input
              label="Vencimento"
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({ ...form, due_date: e.target.value })}
            />
          </div>

          <p className="text-[12px] text-[var(--fg-mute)]">
            Cobranças com vários itens — aluguel, multa e encargo no mesmo documento — são
            geradas automaticamente pelos módulos de origem.
          </p>

          {modalError && (
            <div className="border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
              {modalError}
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNewOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !form.customer_id || !form.description || !form.amount || !form.due_date}
            >
              {saving ? 'Criando…' : 'Criar cobrança'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Implementação única, compartilhada com a tela de detalhe. Eram dois
          modais com o mesmo propósito e comportamentos diferentes — títulos,
          campos, tetos e até onde o erro aparecia. Cada correção precisava ser
          feita duas vezes, e por duas vezes só uma foi. */}
      <RegistrarPagamentoModal
        open={!!receiving}
        onClose={() => setReceiving(null)}
        cobranca={receiving && {
          chargeId:     receiving.charge_id,
          chargeNumber: receiving.charge_number,
          customerId:   receiving.customer_id,
          customerName: receiving.customer_name,
          dueDate:      receiving.due_date,
          openAmount:   receiving.open_amount,
          paidAmount:   receiving.paid_amount,
          lateChargeAmount: receiving.late_charge_amount,
          status:       receiving.status,
        }}
        policy={receiving?.late_charge_policy ?? null}
        onRegistrado={() => { setFeedback('Recebimento registrado.'); refresh() }}
      />

      {/* Cancelamento ------------------------------------------------- */}
      <Modal open={!!cancelling} onClose={() => setCancelling(null)} title="Cancelar cobrança">
        {cancelling && (
          <div className="space-y-4">
            <p className="text-[13px] text-[var(--fg-soft)]">
              A cobrança #{cancelling.charge_number} de {formatCurrency(cancelling.total_amount)} será
              cancelada e a emissão estornada no ledger. O documento permanece no histórico.
            </p>

            <Textarea
              label="Motivo"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo do cancelamento"
            />

                        {modalError && (
              <div className="border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
                {modalError}
              </div>
            )}

<div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCancelling(null)}>Voltar</Button>
              <Button variant="danger" onClick={handleCancel} disabled={saving || reason.trim().length < 3}>
                {saving ? 'Cancelando…' : 'Cancelar cobrança'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Baixa -------------------------------------------------------- */}
      <Modal open={!!writingOff} onClose={() => setWritingOff(null)} title="Baixa por inadimplência">
        {writingOff && (
          <div className="space-y-4">
            <p className="text-[13px] text-[var(--fg-soft)]">
              {/* `open_amount`, não `amount_due`: a baixa reconhece a perda do que
                  é RECEBÍVEL. O encargo do atraso ainda é projeção do relógio —
                  nunca virou lançamento —, e não se perde o que nunca se teve.
                  O texto exibia o valor com encargo e prometia baixar mais do
                  que a ação baixa. */}
              O saldo de {formatCurrency(writingOff.open_amount)} será reconhecido como perda. A
              cobrança sai de contas a receber e passa a compor o indicador de inadimplência.
              {writingOff.accrued_total > 0 && (
                <>
                  {' '}Os {formatCurrency(writingOff.accrued_total)} de encargo acumulado não entram:
                  eles nunca viraram recebível.
                </>
              )}
            </p>

            <Textarea
              label="Motivo"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Descreva o motivo da baixa"
            />

                        {modalError && (
              <div className="border border-[var(--danger)] bg-[var(--danger-bg)] px-3 py-2 text-[13px] text-[var(--danger)]">
                {modalError}
              </div>
            )}

<div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setWritingOff(null)}>Voltar</Button>
              <Button variant="danger" onClick={handleWriteOff} disabled={saving || reason.trim().length < 3}>
                {saving ? 'Registrando…' : 'Dar baixa'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
