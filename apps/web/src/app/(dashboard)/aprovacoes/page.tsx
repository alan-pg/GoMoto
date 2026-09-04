'use client'

import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  Loader2,
  X,
  XCircle,
} from 'lucide-react'
import {
  useCustomers,
  useMaintenances,
  useMaintenanceRecordsByStatus,
  useVehicles,
  useReviewMaintenanceRecord,
  useUpdateMaintenance,
  useSupabaseContext,
} from '@gomoto/data'
import type {
  Customer,
  Maintenance,
  MaintenanceRecord,
  Vehicle,
} from '@gomoto/core'

import { PageTitle } from '@/components/layout/PageTitle'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { registerApprovedRecordCost } from './actions'

const TYPE_LABEL: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Vistoria',
}

function fmtKm(km: number | null | undefined): string {
  if (km == null) return '—'
  return `${km.toLocaleString('pt-BR')} km`
}

export default function AprovacoesPage() {
  const recordsQuery = useMaintenanceRecordsByStatus('pending')
  const customersQuery = useCustomers()
  const vehiclesQuery = useVehicles()
  const maintenancesQuery = useMaintenances()
  const supabase = useSupabaseContext()

  const review = useReviewMaintenanceRecord()
  const updateMaintenance = useUpdateMaintenance()

  const [approving, setApproving] = useState<MaintenanceRecord | null>(null)
  const [rejecting, setRejecting] = useState<MaintenanceRecord | null>(null)

  const customersById = useMemo(() => {
    const m = new Map<string, Customer>()
    for (const c of customersQuery.data ?? []) m.set(c.id, c)
    return m
  }, [customersQuery.data])

  const vehiclesById = useMemo(() => {
    const m = new Map<string, Vehicle>()
    for (const x of vehiclesQuery.data ?? []) m.set(x.id, x)
    return m
  }, [vehiclesQuery.data])

  const maintenancesById = useMemo(() => {
    const m = new Map<string, Maintenance>()
    for (const x of maintenancesQuery.data ?? []) m.set(x.id, x)
    return m
  }, [maintenancesQuery.data])

  const loading =
    recordsQuery.isLoading ||
    customersQuery.isLoading ||
    vehiclesQuery.isLoading ||
    maintenancesQuery.isLoading

  const records = recordsQuery.data ?? []

  // PRD 0003 §F5 — aprovar liga `maintenance_records.status='approved'` e
  // espelha o que o cliente preencheu pra `maintenances`. Snapshot do
  // executor/% é decidido aqui (não veio do cliente — D4 é responsabilidade
  // do operador). Não usamos transação real (limite do client SDK); a
  // ordem é: maintenance primeiro (caso falhe, o record continua pending
  // e o operador re-tenta), depois marca o record como approved.
  async function handleApprove(input: {
    record: MaintenanceRecord
    effective_executor: 'company' | 'customer'
  }): Promise<void> {
    const { record } = input
    const { data: userRes } = await supabase.auth.getUser()
    const reviewerId = userRes.user?.id
    if (!reviewerId) throw new Error('Sessão expirada — faça login novamente.')

    if (record.maintenance_id) {
      await updateMaintenance.mutateAsync({
        id: record.maintenance_id,
        payload: {
          completed: true,
          completed_date: new Date().toISOString().slice(0, 10),
          actual_km: record.actual_km,
          workshop: record.workshop,
          observations: record.notes,
          odometer_photo_url: record.odometer_photo_url,
          invoice_photo_url: record.invoice_photo_url,
          effective_executor: input.effective_executor,
          // `cost` e `effective_customer_payer_pct` saíram de `maintenances` na
          // ADR 0024 — custo e rateio viraram payable, em valores, porque
          // percentual inteiro não representa 1/3 e deixa centavo sem dono.
          // Enquanto continuaram no payload, aprovar manutenção falhava.
        },
      })
    }

    await review.mutateAsync({
      id: record.id,
      payload: {
        status: 'approved',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
      },
    })

    // O custo que o cliente informou precisa VIRAR lançamento. Aprovar só
    // mudava o status: a despesa não existia, o crédito de quem pagou a oficina
    // não nascia, e o resultado do veículo não via nada. Depois do review para
    // que uma falha aqui não deixe o registro pendente com custo já lançado —
    // a action é idempotente por (source_module, source_id) e pode ser
    // reexecutada.
    const custo = await registerApprovedRecordCost({
      record_id: record.id,
      effective_executor: input.effective_executor,
      customer_amount: 0,
    })

    if (!custo.ok) throw new Error(custo.error.message)
  }

  async function handleReject(input: {
    record: MaintenanceRecord
    rejection_reason: string
  }): Promise<void> {
    const { data: userRes } = await supabase.auth.getUser()
    const reviewerId = userRes.user?.id
    if (!reviewerId) throw new Error('Sessão expirada — faça login novamente.')

    await review.mutateAsync({
      id: input.record.id,
      payload: {
        status: 'rejected',
        reviewed_by: reviewerId,
        reviewed_at: new Date().toISOString(),
        rejection_reason: input.rejection_reason,
      },
    })
  }

  return (
    <div>
      <PageTitle
        title="Aprovações de manutenção"
        subtitle="Registros que os clientes enviaram pelo app aguardando sua revisão"
      />
      <div className="px-6 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-fg-mute">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {records.map((record) => (
              <RecordCard
                key={record.id}
                record={record}
                customer={customersById.get(record.customer_id)}
                vehicle={vehiclesById.get(record.vehicle_id)}
                maintenance={record.maintenance_id ? maintenancesById.get(record.maintenance_id) : undefined}
                onApprove={() => setApproving(record)}
                onReject={() => setRejecting(record)}
              />
            ))}
          </div>
        )}
      </div>

      <ApproveModal
        record={approving}
        onClose={() => setApproving(null)}
        onConfirm={handleApprove}
      />
      <RejectModal
        record={rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={handleReject}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="border border-divider rounded-2xl bg-surface px-8 py-12 text-center">
      <ClipboardList className="w-8 h-8 text-fg-mute mx-auto mb-3" />
      <h2 className="text-[16px] font-medium text-fg">Nenhum registro pendente</h2>
      <p className="text-[13px] text-fg-mute mt-1">
        Quando um cliente concluir uma manutenção pelo app, ela aparece aqui pra revisão.
      </p>
    </div>
  )
}

function RecordCard({
  record,
  customer,
  vehicle,
  maintenance,
  onApprove,
  onReject,
}: {
  record: MaintenanceRecord
  customer?: Customer
  vehicle?: Vehicle
  maintenance?: Maintenance
  onApprove: () => void
  onReject: () => void
}) {
  return (
    <div className="border border-divider rounded-2xl bg-surface p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-medium text-fg">
            {maintenance?.description || 'Manutenção corretiva (sem vínculo no plano)'}
          </h3>
          <p className="text-[12px] text-fg-mute mt-0.5">
            {maintenance ? TYPE_LABEL[maintenance.type] ?? maintenance.type : 'Avulsa'}
            {' · '}
            {customer?.name ?? '—'}
            {' · '}
            {vehicle ? `${vehicle.license_plate} ${vehicle.make ?? ''} ${vehicle.model ?? ''}` : 'Moto não identificada'}
          </p>
        </div>
        <span className="bg-pending-bg text-pending text-[11px] font-medium px-2 py-1 rounded-full whitespace-nowrap">
          Pendente
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[13px]">
        <KV label="KM informado" value={fmtKm(record.actual_km)} />
        <KV label="Custo" value={record.cost == null ? '—' : formatCurrency(record.cost)} />
        <KV label="Oficina" value={record.workshop || '—'} />
        <KV label="Enviado" value={formatDate(record.created_at)} />
      </div>

      {record.notes ? (
        <div className="text-[13px] text-fg-soft bg-bg border border-divider rounded-lg px-3 py-2">
          {record.notes}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <PhotoSlot label="Hodômetro" url={record.odometer_photo_url} />
        <PhotoSlot label="Nota fiscal" url={record.invoice_photo_url} />
      </div>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button variant="danger" size="sm" onClick={onReject}>
          <XCircle className="w-4 h-4" />
          Rejeitar
        </Button>
        <Button variant="primary" size="sm" onClick={onApprove}>
          <CheckCircle2 className="w-4 h-4" />
          Aprovar
        </Button>
      </div>
    </div>
  )
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-fg-mute uppercase tracking-wide">{label}</p>
      <p className="text-[13px] text-fg mt-0.5">{value}</p>
    </div>
  )
}

function PhotoSlot({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <div className="border border-dashed border-divider rounded-lg p-3 text-center text-[12px] text-fg-mute">
        {label}: sem foto
      </div>
    )
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="group block border border-divider rounded-lg overflow-hidden"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={label} className="w-full h-32 object-cover" />
      <div className="flex items-center justify-between bg-bg px-2 py-1 text-[12px] text-fg-soft group-hover:text-primary">
        <span>{label}</span>
        <ExternalLink className="w-3 h-3" />
      </div>
    </a>
  )
}

function ApproveModal({
  record,
  onClose,
  onConfirm,
}: {
  record: MaintenanceRecord | null
  onClose: () => void
  onConfirm: (input: {
    record: MaintenanceRecord
    effective_executor: 'company' | 'customer'
  }) => Promise<void>
}) {
  const [executor, setExecutor] = useState<'company' | 'customer'>('company')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    if (submitting) return
    setError(null)
    setExecutor('company')
    onClose()
  }

  async function handleSubmit() {
    if (!record) return
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm({
        record,
        effective_executor: executor,
      })
      setExecutor('company')
        onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao aprovar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={record !== null} onClose={handleClose} title="Aprovar registro" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-fg-soft">
          {/* "Defina o snapshot de responsabilidade (D4 do PRD)" — referência
              interna de especificação, sem sentido para quem opera. O texto
              agora diz o que a escolha DECIDE, que é o que o operador precisa
              saber para escolher. */}
          Aprovar marca a manutenção como concluída, com o KM e o custo informados pelo cliente,
          e lança a despesa. Quem levou a moto à oficina decide o destino do dinheiro: pela
          empresa, a parte do cliente vira cobrança; pelo cliente, o que cabia à empresa vira
          crédito para ele.
        </p>
        <Select
          label="Quem levou à oficina"
          value={executor}
          onChange={(e) => setExecutor(e.target.value as 'company' | 'customer')}
          options={[
            { value: 'company', label: 'Empresa' },
            { value: 'customer', label: 'Cliente' },
          ]}
        />
        {/* O campo de % do cliente saiu: rateio virou valor no payable, não
            percentual na manutenção. O input continuava pedindo o número ao
            operador e descartando a resposta em silêncio. O rateio é informado
            ao lançar a despesa, em Despesas. */}
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            <X className="w-4 h-4" />
            Cancelar
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={submitting}>
            <CheckCircle2 className="w-4 h-4" />
            Confirmar aprovação
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function RejectModal({
  record,
  onClose,
  onConfirm,
}: {
  record: MaintenanceRecord | null
  onClose: () => void
  onConfirm: (input: { record: MaintenanceRecord; rejection_reason: string }) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleClose() {
    if (submitting) return
    setReason('')
    setError(null)
    onClose()
  }

  async function handleSubmit() {
    if (!record) return
    const trimmed = reason.trim()
    if (trimmed.length < 10) {
      setError('Descreva o motivo com pelo menos 10 caracteres — o cliente verá esta mensagem.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await onConfirm({ record, rejection_reason: trimmed })
      setReason('')
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Erro ao rejeitar.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal open={record !== null} onClose={handleClose} title="Rejeitar registro" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-fg-soft">
          O cliente recebe o motivo e pode reenviar. Não altera a manutenção planejada.
        </p>
        <Textarea
          label="Motivo da rejeição"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ex.: a foto do hodômetro está borrada, refaça com a moto desligada."
        />
        {error ? <p className="text-[12px] text-danger">{error}</p> : null}
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={handleClose} disabled={submitting}>
            <X className="w-4 h-4" />
            Cancelar
          </Button>
          <Button variant="danger" onClick={handleSubmit} loading={submitting}>
            <XCircle className="w-4 h-4" />
            Confirmar rejeição
          </Button>
        </div>
      </div>
    </Modal>
  )
}
