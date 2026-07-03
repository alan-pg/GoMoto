'use client'

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Plus, X, AlertTriangle, RotateCcw, Zap, Clock, ChevronRight,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  useRentals,
  useCustomers,
  useVehicles,
  useQueueEntries,
  useBillings,
} from '@gomoto/data'
import type { Rental, CycleCharge } from '@gomoto/core'
import {
  generateCycleCharges,
  getEarlyTerminationImpact,
  isRentalTerminationWithinMinimum,
  CONTRACT_TERMINATION_FINE_BRL,
} from '@gomoto/core'
import {
  createRental,
  terminateRental,
  renewRental,
  createOneTimeCharge,
  addToQueue,
} from './actions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Tab = 'active' | 'closed' | 'queue'

type CreateForm = {
  vehicle_id:  string
  customer_id:    string
  contract_type:  'rental' | 'rent_to_own'
  cycle:          'weekly' | 'monthly'
  due_day:        string
  cycle_amount:   string
  start_date:     string
  end_date:       string
  use_pro_rata:   boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  active:      'Ativa',
  closed:      'Encerrada',
  transferred: 'Transferida',
}

const STATUS_CLASS: Record<string, string> = {
  active:      'text-[#BAFF1A] bg-[#BAFF1A22]',
  closed:      'text-[#9e9e9e] bg-[#9e9e9e22]',
  transferred: 'text-[#60a5fa] bg-[#60a5fa22]',
}

const CONTRACT_TYPE_LABEL = {
  rental:       'Locação',
  rent_to_own:  'Compra Programada',
}

const CYCLE_LABEL = {
  weekly:  'Semanal',
  monthly: 'Mensal',
}

const DEFAULT_FORM: CreateForm = {
  vehicle_id: '',
  customer_id:   '',
  contract_type: 'rental',
  cycle:         'monthly',
  due_day:       '10',
  cycle_amount:  '',
  start_date:    '',
  end_date:      '',
  use_pro_rata:  true,
}

// ---------------------------------------------------------------------------
// TerminateModal — componente separado para isolar o hook useBillings
// ---------------------------------------------------------------------------

function TerminateModal({
  rental,
  onClose,
  onSuccess,
}: {
  rental: Rental
  onClose: () => void
  onSuccess: () => void
}) {
  const [terminationDate, setTerminationDate] = useState(
    rental.end_date ?? new Date().toISOString().slice(0, 10),
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const billingsQuery = useBillings({ lease_id: rental.id })
  const billings = billingsQuery.data ?? []

  const impact = useMemo(() => {
    if (!rental.start_date) return null
    return getEarlyTerminationImpact(
      billings.map(b => ({ due_date: b.due_date, status: b.status })),
      new Date(),
      rental.start_date,
      rental.contract_type ?? 'rental',
    )
  }, [billings, rental.start_date, rental.contract_type])

  const newStatus =
    rental.contract_type === 'rent_to_own' && impact && !impact.within_minimum
      ? 'transferred'
      : 'closed'

  async function handleConfirm() {
    setLoading(true)
    setError('')
    const result = await terminateRental({
      lease_id:         rental.id,
      termination_date: terminationDate,
      new_status:       newStatus,
    })
    setLoading(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onSuccess()
  }

  return (
    <Modal open onClose={onClose} title="Encerrar Locação" size="md">
      <div className="flex flex-col gap-5">
        {/* Info da locação */}
        <div className="rounded-lg bg-[#202020] p-3 text-[13px]">
          <p className="font-semibold text-[#f5f5f5]">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="text-[#9e9e9e]">{rental.customer?.name}</p>
        </div>

        <Input
          label="Data de encerramento"
          type="date"
          value={terminationDate}
          onChange={e => setTerminationDate(e.target.value)}
        />

        {/* Alertas de impacto */}
        {impact && (
          <div className="flex flex-col gap-2">
            {impact.overdue_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#e65e24] bg-[#3a1200] px-3 py-2.5 text-[13px] text-[#ffa040]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {impact.overdue_count} cobrança{impact.overdue_count !== 1 ? 's' : ''} vencida
                  {impact.overdue_count !== 1 ? 's' : ''} permanece{impact.overdue_count !== 1 ? 'm' : ''}{' '}
                  em aberto após o encerramento.
                </span>
              </div>
            )}
            {impact.future_count > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#474747] bg-[#202020] px-3 py-2.5 text-[13px] text-[#9e9e9e]">
                <X size={14} className="mt-0.5 shrink-0" />
                <span>
                  {impact.future_count} cobrança{impact.future_count !== 1 ? 's' : ''} futura
                  {impact.future_count !== 1 ? 's' : ''} ser{impact.future_count !== 1 ? 'ão' : 'á'} cancelada
                  {impact.future_count !== 1 ? 's' : ''}.
                </span>
              </div>
            )}
            {impact.within_minimum && (
              <div className="flex items-start gap-2 rounded-lg border border-[#eab308] bg-[#2a2000] px-3 py-2.5 text-[13px] text-[#fde047]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Rescisão dentro da vigência mínima —{' '}
                  <strong>multa contratual de {formatCurrency(CONTRACT_TERMINATION_FINE_BRL)} aplicável</strong>.
                </span>
              </div>
            )}
            {newStatus === 'transferred' && (
              <div className="flex items-start gap-2 rounded-lg border border-[#60a5fa] bg-[#0a1f3a] px-3 py-2.5 text-[13px] text-[#60a5fa]">
                <ChevronRight size={14} className="mt-0.5 shrink-0" />
                <span>Compra Programada cumprida — status alterará para <strong>Transferida</strong>.</span>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button variant="danger" onClick={handleConfirm} disabled={loading || !terminationDate}>
            {loading ? 'Encerrando…' : 'Confirmar Encerramento'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// RenewModal
// ---------------------------------------------------------------------------

function RenewModal({
  rental,
  onClose,
  onSuccess,
}: {
  rental: Rental
  onClose: () => void
  onSuccess: () => void
}) {
  const [newEndDate, setNewEndDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (!rental.end_date) return
    setLoading(true)
    setError('')
    const result = await renewRental({
      lease_id:         rental.id,
      new_end_date:     newEndDate,
      current_end_date: rental.end_date,
    })
    setLoading(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onSuccess()
  }

  return (
    <Modal open onClose={onClose} title="Renovar Locação" size="sm">
      <div className="flex flex-col gap-5">
        <div className="rounded-lg bg-[#202020] p-3 text-[13px]">
          <p className="font-semibold text-[#f5f5f5]">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="text-[#9e9e9e]">
            Fim atual: {rental.end_date ? formatDate(rental.end_date) : '—'}
          </p>
        </div>

        <Input
          label="Nova data de fim"
          type="date"
          value={newEndDate}
          min={rental.end_date ?? undefined}
          onChange={e => setNewEndDate(e.target.value)}
        />

        {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading || !newEndDate}>
            {loading ? 'Renovando…' : 'Confirmar Renovação'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// OneTimeChargeModal
// ---------------------------------------------------------------------------

function OneTimeChargeModal({
  rental,
  onClose,
  onSuccess,
}: {
  rental: Rental
  onClose: () => void
  onSuccess: () => void
}) {
  const [form, setForm] = useState({ description: '', amount: '', due_date: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k: keyof typeof form, v: string) {
    setForm(f => ({ ...f, [k]: v }))
  }

  async function handleConfirm() {
    const amount = parseFloat(form.amount)
    if (!form.description || isNaN(amount) || !form.due_date) return
    setLoading(true)
    setError('')
    const result = await createOneTimeCharge({
      lease_id:    rental.id,
      description: form.description,
      amount,
      due_date:    form.due_date,
    })
    setLoading(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onSuccess()
  }

  return (
    <Modal open onClose={onClose} title="Cobrança Avulsa" size="sm">
      <div className="flex flex-col gap-4">
        <div className="rounded-lg bg-[#202020] p-3 text-[13px]">
          <p className="font-semibold text-[#f5f5f5]">
            {rental.vehicle?.license_plate} — {rental.customer?.name}
          </p>
        </div>

        <Input
          label="Descrição"
          value={form.description}
          placeholder="Ex: Taxa de devolução"
          onChange={e => set('description', e.target.value)}
        />
        <Input
          label="Valor (R$)"
          type="number"
          min="0.01"
          step="0.01"
          value={form.amount}
          placeholder="0,00"
          onChange={e => set('amount', e.target.value)}
        />
        <Input
          label="Vencimento"
          type="date"
          value={form.due_date}
          onChange={e => set('due_date', e.target.value)}
        />

        {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading}>
            {loading ? 'Criando…' : 'Criar Cobrança'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// ChargePreview — tabela de cobranças geradas no formulário de criação
// ---------------------------------------------------------------------------

function ChargePreview({ charges }: { charges: CycleCharge[] }) {
  if (charges.length === 0) return null

  const total = charges.reduce((s, c) => s + c.amount, 0)

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-[#f5f5f5]">
        Preview — {charges.length} cobrança{charges.length !== 1 ? 's' : ''} ({formatCurrency(total)})
      </p>
      <div className="max-h-48 overflow-y-auto rounded-lg border border-[#323232]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#323232] text-left text-[#9e9e9e]">
              <th className="px-3 py-2 font-normal">Vencimento</th>
              <th className="px-3 py-2 font-normal">Tipo</th>
              <th className="px-3 py-2 text-right font-normal">Valor</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c, i) => (
              <tr key={i} className="h-9 border-b border-[#1e1e1e] last:border-0">
                <td className="px-3 text-[#c7c7c7]">{formatDate(c.due_date)}</td>
                <td className="px-3 text-[#9e9e9e]">
                  {c.billing_type === 'cycle' ? 'Ciclo' : 'Complementar'}
                </td>
                <td className="px-3 text-right font-mono text-[#f5f5f5]">
                  {formatCurrency(c.amount)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AddToQueueModal
// ---------------------------------------------------------------------------

function AddToQueueModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void
  onSuccess: () => void
}) {
  const customersQuery = useCustomers()
  const customers = customersQuery.data ?? []
  const [customerId, setCustomerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleConfirm() {
    if (!customerId) return
    setLoading(true)
    setError('')
    const result = await addToQueue({ customer_id: customerId })
    setLoading(false)
    if (!result.ok) {
      setError(result.error.message)
      return
    }
    onSuccess()
  }

  return (
    <Modal open onClose={onClose} title="Adicionar à Fila" size="sm">
      <div className="flex flex-col gap-4">
        <Select
          label="Cliente"
          value={customerId}
          onChange={e => setCustomerId(e.target.value)}
          options={[
            { value: '', label: 'Selecione um cliente…' },
            ...customers.map(c => ({ value: c.id, label: c.name })),
          ]}
        />
        {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancelar</Button>
          <Button onClick={handleConfirm} disabled={loading || !customerId}>
            {loading ? 'Adicionando…' : 'Adicionar à Fila'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// LocacoesPage
// ---------------------------------------------------------------------------

export default function LocacoesPage() {
  const qc = useQueryClient()

  const [tab, setTab] = useState<Tab>('active')

  // Data
  const rentalsQuery   = useRentals()
  const customersQuery = useCustomers()
  const motoQuery      = useVehicles()
  const queueQuery     = useQueueEntries()

  const rentals   = rentalsQuery.data   ?? []
  const customers = customersQuery.data ?? []
  const motos     = motoQuery.data      ?? []
  const queue     = queueQuery.data     ?? []

  const activeRentals = useMemo(() => rentals.filter(r => r.status === 'active'), [rentals])
  const closedRentals = useMemo(
    () => rentals.filter(r => r.status === 'closed' || r.status === 'transferred'),
    [rentals],
  )

  // Modal states
  const [showCreate,       setShowCreate]       = useState(false)
  const [terminatingRental, setTerminatingRental] = useState<Rental | null>(null)
  const [renewingRental,   setRenewingRental]   = useState<Rental | null>(null)
  const [oneTimeRental,    setOneTimeRental]     = useState<Rental | null>(null)
  const [showAddQueue,     setShowAddQueue]      = useState(false)

  // Create form
  const [form, setForm] = useState<CreateForm>(DEFAULT_FORM)
  const [createError, setCreateError] = useState('')
  const [creating, setCreating] = useState(false)
  const [step, setStep] = useState<'form' | 'preview'>('form')

  function setField<K extends keyof CreateForm>(k: K, v: CreateForm[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  const previewCharges = useMemo<CycleCharge[]>(() => {
    const dueDay    = parseInt(form.due_day, 10)
    const amount    = parseFloat(form.cycle_amount)
    if (
      !form.start_date || !form.end_date ||
      isNaN(dueDay) || dueDay < 1 || dueDay > 28 ||
      isNaN(amount) || amount <= 0 ||
      form.end_date <= form.start_date
    ) return []

    try {
      return generateCycleCharges({
        start_date:   form.start_date,
        end_date:     form.end_date,
        cycle:        form.cycle,
        due_day:      dueDay,
        cycle_amount: amount,
        use_pro_rata: form.use_pro_rata,
      })
    } catch {
      return []
    }
  }, [form.start_date, form.end_date, form.cycle, form.due_day, form.cycle_amount, form.use_pro_rata])

  function openCreate() {
    setForm(DEFAULT_FORM)
    setCreateError('')
    setStep('form')
    setShowCreate(true)
  }

  function closeCreate() {
    setShowCreate(false)
    setStep('form')
    setCreateError('')
  }

  async function handleCreate() {
    setCreating(true)
    setCreateError('')
    const result = await createRental({
      vehicle_id: form.vehicle_id,
      customer_id:   form.customer_id,
      contract_type: form.contract_type,
      cycle:         form.cycle,
      due_day:       parseInt(form.due_day, 10),
      cycle_amount:  parseFloat(form.cycle_amount),
      start_date:    form.start_date,
      end_date:      form.end_date,
      use_pro_rata:  form.use_pro_rata,
    })
    setCreating(false)
    if (!result.ok) {
      setCreateError(result.error.message)
      return
    }
    qc.invalidateQueries({ queryKey: ['rentals'] })
    qc.invalidateQueries({ queryKey: ['billings'] })
    closeCreate()
  }

  function handleActionSuccess() {
    qc.invalidateQueries({ queryKey: ['rentals'] })
    qc.invalidateQueries({ queryKey: ['billings'] })
    setTerminatingRental(null)
    setRenewingRental(null)
    setOneTimeRental(null)
  }

  function handleQueueSuccess() {
    qc.invalidateQueries({ queryKey: ['queue_entries'] })
    setShowAddQueue(false)
  }

  const isFormReady = Boolean(
    form.vehicle_id &&
    form.customer_id &&
    form.start_date &&
    form.end_date &&
    form.cycle_amount &&
    form.due_day &&
    form.end_date > form.start_date
  )

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        title="Locações"
        subtitle="Gestão de locações ativas e fila de espera"
      />

      <div className="flex flex-1 flex-col gap-4 p-6">
        {/* Tabs + Action */}
        <div className="flex items-center justify-between">
          <div className="flex gap-1 rounded-lg bg-[#1e1e1e] p-1">
            {(
              [
                { id: 'active' as Tab,  label: `Ativas (${activeRentals.length})` },
                { id: 'closed' as Tab,  label: `Encerradas (${closedRentals.length})` },
                { id: 'queue'  as Tab,  label: `Fila (${queue.length})` },
              ] as const
            ).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`rounded-md px-4 py-1.5 text-[13px] font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-[#BAFF1A] text-[#121212]'
                    : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {tab === 'queue' && (
              <Button variant="secondary" onClick={() => setShowAddQueue(true)}>
                <Plus size={14} /> Adicionar à Fila
              </Button>
            )}
            {tab !== 'queue' && (
              <Button onClick={openCreate}>
                <Plus size={14} /> Nova Locação
              </Button>
            )}
          </div>
        </div>

        {/* ── Ativas / Encerradas ── */}
        {tab !== 'queue' && (
          <div className="overflow-hidden rounded-lg border border-[#323232] bg-[#1a1a1a]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232] text-left text-[#9e9e9e]">
                  <th className="px-4 py-3 font-normal">Cliente</th>
                  <th className="px-4 py-3 font-normal">Moto</th>
                  <th className="px-4 py-3 font-normal">Tipo</th>
                  <th className="px-4 py-3 font-normal">Ciclo</th>
                  <th className="px-4 py-3 font-normal">Valor/ciclo</th>
                  <th className="px-4 py-3 font-normal">Início</th>
                  <th className="px-4 py-3 font-normal">Fim</th>
                  <th className="px-4 py-3 font-normal">Status</th>
                  {tab === 'active' && <th className="px-4 py-3 font-normal">Ações</th>}
                </tr>
              </thead>
              <tbody>
                {(tab === 'active' ? activeRentals : closedRentals).map(r => (
                  <tr
                    key={r.id}
                    className="h-9 border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]"
                  >
                    <td className="px-4 text-[#f5f5f5]">
                      {r.customer?.name ?? '—'}
                    </td>
                    <td className="px-4 font-mono text-[#BAFF1A]">
                      {r.vehicle?.license_plate ?? '—'}
                      <span className="ml-1 font-sans text-[#9e9e9e]">
                        {r.vehicle?.make} {r.vehicle?.model}
                      </span>
                    </td>
                    <td className="px-4 text-[#c7c7c7]">
                      {CONTRACT_TYPE_LABEL[r.contract_type ?? 'rental']}
                    </td>
                    <td className="px-4 text-[#c7c7c7]">
                      {r.cycle ? CYCLE_LABEL[r.cycle] : '—'}
                    </td>
                    <td className="px-4 font-mono text-[#f5f5f5]">
                      {r.cycle_amount != null
                        ? formatCurrency(r.cycle_amount)
                        : r.monthly_amount != null
                          ? formatCurrency(r.monthly_amount)
                          : '—'}
                    </td>
                    <td className="px-4 text-[#9e9e9e]">
                      {r.start_date ? formatDate(r.start_date) : '—'}
                    </td>
                    <td className="px-4 text-[#9e9e9e]">
                      {r.end_date ? formatDate(r.end_date) : '—'}
                    </td>
                    <td className="px-4">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_CLASS[r.status] ?? ''}`}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    {tab === 'active' && (
                      <td className="px-4">
                        <div className="flex items-center gap-1">
                          <button
                            title="Encerrar"
                            onClick={() => setTerminatingRental(r)}
                            className="rounded p-1 text-[#9e9e9e] hover:bg-[#323232] hover:text-[#ff9c9a]"
                          >
                            <X size={14} />
                          </button>
                          <button
                            title="Renovar"
                            onClick={() => setRenewingRental(r)}
                            className="rounded p-1 text-[#9e9e9e] hover:bg-[#323232] hover:text-[#BAFF1A]"
                          >
                            <RotateCcw size={14} />
                          </button>
                          <button
                            title="Cobrança Avulsa"
                            onClick={() => setOneTimeRental(r)}
                            className="rounded p-1 text-[#9e9e9e] hover:bg-[#323232] hover:text-[#60a5fa]"
                          >
                            <Zap size={14} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
                {(tab === 'active' ? activeRentals : closedRentals).length === 0 && (
                  <tr>
                    <td
                      colSpan={tab === 'active' ? 9 : 8}
                      className="px-4 py-8 text-center text-[#616161]"
                    >
                      Nenhuma locação {tab === 'active' ? 'ativa' : 'encerrada'}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Fila ── */}
        {tab === 'queue' && (
          <div className="overflow-hidden rounded-lg border border-[#323232] bg-[#1a1a1a]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232] text-left text-[#9e9e9e]">
                  <th className="px-4 py-3 font-normal">Posição</th>
                  <th className="px-4 py-3 font-normal">Cliente</th>
                  <th className="px-4 py-3 font-normal">Telefone</th>
                  <th className="px-4 py-3 font-normal">Na fila desde</th>
                  <th className="px-4 py-3 font-normal">Ações</th>
                </tr>
              </thead>
              <tbody>
                {queue.map(q => (
                  <tr key={q.id} className="h-9 border-b border-[#1e1e1e] last:border-0 hover:bg-[#222222]">
                    <td className="px-4 font-mono text-[#BAFF1A]">#{q.position}</td>
                    <td className="px-4 text-[#f5f5f5]">{q.customers?.name ?? '—'}</td>
                    <td className="px-4 text-[#9e9e9e]">{q.customers?.phone ?? '—'}</td>
                    <td className="px-4 text-[#9e9e9e]">{formatDate(q.created_at)}</td>
                    <td className="px-4">
                      <button
                        onClick={() => {
                          setTab('active')
                          openCreate()
                        }}
                        className="flex items-center gap-1 rounded px-2 py-1 text-[12px] text-[#BAFF1A] hover:bg-[#BAFF1A22]"
                      >
                        <Plus size={11} /> Nova Locação
                      </button>
                    </td>
                  </tr>
                ))}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[#616161]">
                      Nenhum cliente na fila de espera.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Modal: Nova Locação ── */}
      {showCreate && (
        <Modal open onClose={closeCreate} title="Nova Locação" size="lg">
          {step === 'form' ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <Select
                  label="Cliente"
                  value={form.customer_id}
                  onChange={e => setField('customer_id', e.target.value)}
                  options={[
                    { value: '', label: 'Selecione um cliente…' },
                    ...customers.map(c => ({ value: c.id, label: c.name })),
                  ]}
                />
                <Select
                  label="Moto"
                  value={form.vehicle_id}
                  onChange={e => setField('vehicle_id', e.target.value)}
                  options={[
                    { value: '', label: 'Selecione uma moto…' },
                    ...motos.map(m => ({
                      value: m.id,
                      label: `${m.license_plate} — ${m.make} ${m.model}`,
                    })),
                  ]}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Select
                  label="Tipo de locação"
                  value={form.contract_type}
                  onChange={e => setField('contract_type', e.target.value as CreateForm['contract_type'])}
                  options={[
                    { value: 'rental',      label: 'Locação' },
                    { value: 'rent_to_own', label: 'Compra Programada' },
                  ]}
                />
                <Select
                  label="Ciclo"
                  value={form.cycle}
                  onChange={e => setField('cycle', e.target.value as CreateForm['cycle'])}
                  options={[
                    { value: 'monthly', label: 'Mensal' },
                    { value: 'weekly',  label: 'Semanal' },
                  ]}
                />
                <Input
                  label={form.cycle === 'monthly' ? 'Dia de vencimento (1-28)' : 'Dia da semana (1=seg, 7=dom)'}
                  type="number"
                  min={1}
                  max={form.cycle === 'monthly' ? 28 : 7}
                  value={form.due_day}
                  onChange={e => setField('due_day', e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Input
                  label="Valor do ciclo (R$)"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={form.cycle_amount}
                  placeholder="0,00"
                  onChange={e => setField('cycle_amount', e.target.value)}
                />
                <Input
                  label="Data de início"
                  type="date"
                  value={form.start_date}
                  onChange={e => setField('start_date', e.target.value)}
                />
                <Input
                  label="Data de fim"
                  type="date"
                  value={form.end_date}
                  min={form.start_date || undefined}
                  onChange={e => setField('end_date', e.target.value)}
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#c7c7c7]">
                <input
                  type="checkbox"
                  checked={form.use_pro_rata}
                  onChange={e => setField('use_pro_rata', e.target.checked)}
                  className="rounded accent-[#BAFF1A]"
                />
                Calcular pro rata na primeira e última cobranças
              </label>

              {previewCharges.length > 0 && (
                <ChargePreview charges={previewCharges} />
              )}

              {createError && <p className="text-[13px] text-[#ff9c9a]">{createError}</p>}

              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={closeCreate}>Cancelar</Button>
                <Button
                  onClick={() => setStep('preview')}
                  disabled={!isFormReady || previewCharges.length === 0}
                >
                  Ver Preview →
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              {/* Resumo */}
              <div className="rounded-lg bg-[#202020] p-4 text-[13px]">
                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                  <Row label="Cliente"    value={customers.find(c => c.id === form.customer_id)?.name ?? '—'} />
                  <Row label="Moto"       value={motos.find(m => m.id === form.vehicle_id)?.license_plate ?? '—'} />
                  <Row label="Tipo"       value={CONTRACT_TYPE_LABEL[form.contract_type]} />
                  <Row label="Ciclo"      value={CYCLE_LABEL[form.cycle]} />
                  <Row label="Vencimento" value={`Dia ${form.due_day}`} />
                  <Row label="Valor"      value={formatCurrency(parseFloat(form.cycle_amount) || 0)} />
                  <Row label="Início"     value={form.start_date ? formatDate(form.start_date) : '—'} />
                  <Row label="Fim"        value={form.end_date ? formatDate(form.end_date) : '—'} />
                  <Row label="Pro rata"   value={form.use_pro_rata ? 'Sim' : 'Não'} />
                </div>
              </div>

              <ChargePreview charges={previewCharges} />

              {createError && <p className="text-[13px] text-[#ff9c9a]">{createError}</p>}

              <div className="flex justify-between">
                <Button variant="secondary" onClick={() => setStep('form')} disabled={creating}>
                  ← Editar
                </Button>
                <Button onClick={handleCreate} disabled={creating}>
                  {creating ? 'Criando…' : `Confirmar — ${previewCharges.length} cobrança${previewCharges.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Modal: Encerrar ── */}
      {terminatingRental && (
        <TerminateModal
          rental={terminatingRental}
          onClose={() => setTerminatingRental(null)}
          onSuccess={handleActionSuccess}
        />
      )}

      {/* ── Modal: Renovar ── */}
      {renewingRental && (
        <RenewModal
          rental={renewingRental}
          onClose={() => setRenewingRental(null)}
          onSuccess={handleActionSuccess}
        />
      )}

      {/* ── Modal: Cobrança Avulsa ── */}
      {oneTimeRental && (
        <OneTimeChargeModal
          rental={oneTimeRental}
          onClose={() => setOneTimeRental(null)}
          onSuccess={handleActionSuccess}
        />
      )}

      {/* ── Modal: Adicionar à Fila ── */}
      {showAddQueue && (
        <AddToQueueModal
          onClose={() => setShowAddQueue(false)}
          onSuccess={handleQueueSuccess}
        />
      )}
    </div>
  )
}

// Componente auxiliar de linha para o resumo de criação
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="min-w-[80px] text-[#9e9e9e]">{label}:</span>
      <span className="text-[#f5f5f5]">{value}</span>
    </div>
  )
}
