/**
 * @file src/app/(dashboard)/planos-manutencao/page.tsx
 * @description CRUD completo de planos de manutenção e seus itens (PRD 0003 F2.1/F2.2b/c).
 *
 * F2.2c adiciona o editor de itens dentro do detalhe do plano: chips de sugestão
 * (cópia direta de `SUGGESTED_PLAN_ITEMS`) + form livre para item customizado +
 * editar/remover linhas existentes.
 */

'use client'

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Wrench, ChevronDown, ChevronUp, Search, Plus, Star, Archive,
  Edit2, MoreVertical, Copy, ArchiveRestore, Trash2, Sparkles, X,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { useMaintenancePlans, useMaintenancePlan } from '@gomoto/data'
import type { MaintenancePlan, MaintenancePlanItem, MaintenancePlanItemCategory } from '@gomoto/core'
import { SUGGESTED_PLAN_ITEMS, groupSuggestionsByCategory } from '@gomoto/core'
import type { SuggestedPlanItem } from '@gomoto/core'
import {
  createMaintenancePlan,
  updateMaintenancePlan,
  setDefaultMaintenancePlan,
  archiveMaintenancePlan,
  unarchiveMaintenancePlan,
  cloneMaintenancePlan,
  createMaintenancePlanItem,
  updateMaintenancePlanItem,
  deleteMaintenancePlanItem,
} from './actions'

const CATEGORY_LABELS: Record<MaintenancePlanItemCategory, string> = {
  oil: 'Óleo',
  filter: 'Filtro',
  brake: 'Freio',
  tire: 'Pneu',
  wear_part: 'Peça de desgaste',
  inspection: 'Vistoria',
  fluid: 'Fluido',
  transmission: 'Transmissão',
  other: 'Outros',
}

const CATEGORY_VARIANT: Record<MaintenancePlanItemCategory, 'info' | 'success' | 'warning' | 'muted' | 'brand' | 'danger' | 'orange'> = {
  oil: 'brand',
  filter: 'info',
  brake: 'danger',
  tire: 'warning',
  wear_part: 'muted',
  inspection: 'info',
  fluid: 'success',
  transmission: 'orange',
  other: 'muted',
}

function formatInterval(item: MaintenancePlanItem): string {
  const parts: string[] = []
  if (item.interval_km) parts.push(`${item.interval_km.toLocaleString('pt-BR')} km`)
  if (item.interval_days) parts.push(`${item.interval_days} dias`)
  return parts.join(' • ')
}

function PlanItemsList({ planId, onAddItem, onEditItem, onRemoveItem, busyItemId }: {
  planId: string
  onAddItem: (planId: string) => void
  onEditItem: (item: MaintenancePlanItem) => void
  onRemoveItem: (item: MaintenancePlanItem) => void
  busyItemId: string | null
}) {
  const { data: plan, isLoading } = useMaintenancePlan(planId)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
      </div>
    )
  }
  const items = plan?.items ?? []
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#323232]">
        <span className="text-[12px] text-[#9e9e9e]">
          {items.length === 0 ? 'Nenhum item ainda' : `${items.length} item(s)`}
        </span>
        <Button size="sm" variant="secondary" onClick={() => onAddItem(planId)}>
          <Plus className="w-3.5 h-3.5" /> Adicionar item
        </Button>
      </div>
      {items.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-[13px] text-[#9e9e9e]">
            Clique em <strong className="text-[#f5f5f5]">Adicionar item</strong> para usar uma sugestão ou criar um item livre.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="h-9 border-b border-[#323232]">
                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Item</th>
                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Categoria</th>
                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Intervalo</th>
                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Alerta</th>
                <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Crítico</th>
                <th className="h-9 px-4 text-right text-[#9e9e9e] text-[13px] font-medium">Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="h-9 border-b border-[#323232] hover:bg-[#262626]">
                  <td className="px-4">
                    <p className="font-medium text-[#f5f5f5] text-[13px]">{item.name}</p>
                    {item.tip && (
                      <p className="text-[12px] text-[#616161]">{item.tip}</p>
                    )}
                  </td>
                  <td className="px-4">
                    <Badge variant={CATEGORY_VARIANT[item.category]}>{CATEGORY_LABELS[item.category]}</Badge>
                  </td>
                  <td className="px-4 text-[#f5f5f5] text-[13px]">{formatInterval(item)}</td>
                  <td className="px-4 text-[#9e9e9e] text-[13px]">
                    {item.warn_threshold_pct != null ? `${item.warn_threshold_pct}%` : '—'}
                  </td>
                  <td className="px-4">
                    {item.is_critical ? (
                      <Badge variant="danger">Crítico</Badge>
                    ) : (
                      <span className="text-[13px] text-[#616161]">—</span>
                    )}
                  </td>
                  <td className="px-4">
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => onEditItem(item)}
                        title="Editar item"
                        disabled={busyItemId === item.id}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => onRemoveItem(item)}
                        title="Remover item"
                        disabled={busyItemId === item.id}
                      >
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
  )
}

function PlanCard({ plan, expanded, onToggle, onEdit, onSetDefault, onArchive, onUnarchive, onClone, onAddItem, onEditItem, onRemoveItem, busyItemId }: {
  plan: MaintenancePlan
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onSetDefault: () => void
  onArchive: () => void
  onUnarchive: () => void
  onClone: () => void
  onAddItem: (planId: string) => void
  onEditItem: (item: MaintenancePlanItem) => void
  onRemoveItem: (item: MaintenancePlanItem) => void
  busyItemId: string | null
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const isArchived = plan.archived_at !== null
  return (
    <div className="bg-[#202020] rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-4 p-4">
        <button
          className="flex items-center gap-2 min-w-0 flex-1 text-left"
          onClick={onToggle}
        >
          <Wrench className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
          <p className="font-medium text-[#f5f5f5] text-[13px]">{plan.name}</p>
          {plan.is_default && (
            <Badge variant="brand">
              <Star className="inline-block w-3 h-3 mr-1 -mt-0.5" />
              Default
            </Badge>
          )}
          {isArchived && (
            <Badge variant="muted">
              <Archive className="inline-block w-3 h-3 mr-1 -mt-0.5" />
              Arquivado
            </Badge>
          )}
          {plan.description && (
            <span className="text-[12px] text-[#9e9e9e] ml-2 truncate">{plan.description}</span>
          )}
        </button>

        <div className="flex items-center gap-2 flex-shrink-0 relative">
          <Button variant="secondary" size="sm" className="h-8 w-8 p-0" onClick={onEdit} title="Editar plano">
            <Edit2 className="h-4 w-4" />
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => setMenuOpen((p) => !p)}
            title="Mais ações"
          >
            <MoreVertical className="h-4 w-4" />
          </Button>
          {menuOpen && (
            <>
              <div
                className="fixed inset-0 z-30"
                onClick={() => setMenuOpen(false)}
                aria-hidden
              />
              <div className="absolute right-0 top-9 z-40 w-52 bg-[#202020] border border-[#474747] rounded-lg shadow-lg overflow-hidden">
                {!plan.is_default && !isArchived && (
                  <button
                    className="w-full px-3 py-2 text-left text-[13px] text-[#f5f5f5] hover:bg-[#323232] flex items-center gap-2"
                    onClick={() => { setMenuOpen(false); onSetDefault() }}
                  >
                    <Star className="h-4 w-4 text-[#BAFF1A]" /> Tornar default
                  </button>
                )}
                <button
                  className="w-full px-3 py-2 text-left text-[13px] text-[#f5f5f5] hover:bg-[#323232] flex items-center gap-2"
                  onClick={() => { setMenuOpen(false); onClone() }}
                >
                  <Copy className="h-4 w-4 text-[#9e9e9e]" /> Clonar plano
                </button>
                {isArchived ? (
                  <button
                    className="w-full px-3 py-2 text-left text-[13px] text-[#f5f5f5] hover:bg-[#323232] flex items-center gap-2"
                    onClick={() => { setMenuOpen(false); onUnarchive() }}
                  >
                    <ArchiveRestore className="h-4 w-4 text-[#9e9e9e]" /> Desarquivar
                  </button>
                ) : (
                  <button
                    className="w-full px-3 py-2 text-left text-[13px] text-[#ff9c9a] hover:bg-[#323232] flex items-center gap-2"
                    onClick={() => { setMenuOpen(false); onArchive() }}
                  >
                    <Archive className="h-4 w-4" /> Arquivar
                  </button>
                )}
              </div>
            </>
          )}
          <button onClick={onToggle} className="p-1" aria-label={expanded ? 'Recolher' : 'Expandir'}>
            {expanded ? (
              <ChevronUp className="w-4 h-4 text-[#9e9e9e]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#9e9e9e]" />
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#323232]">
          <PlanItemsList
            planId={plan.id}
            onAddItem={onAddItem}
            onEditItem={onEditItem}
            onRemoveItem={onRemoveItem}
            busyItemId={busyItemId}
          />
        </div>
      )}
    </div>
  )
}

type PlanFormState = {
  name: string
  description: string
  is_default: boolean
}

const emptyForm: PlanFormState = { name: '', description: '', is_default: false }

type ItemFormState = {
  name: string
  category: MaintenancePlanItemCategory
  type: 'preventive' | 'inspection'
  interval_km: string
  interval_days: string
  warn_threshold_pct: string
  is_critical: boolean
  tip: string
}

const emptyItemForm: ItemFormState = {
  name: '',
  category: 'oil',
  type: 'preventive',
  interval_km: '',
  interval_days: '',
  warn_threshold_pct: '',
  is_critical: false,
  tip: '',
}

function suggestionToForm(s: SuggestedPlanItem): ItemFormState {
  return {
    name: s.name,
    category: s.category as MaintenancePlanItemCategory,
    type: s.type,
    interval_km: s.interval_km != null ? String(s.interval_km) : '',
    interval_days: s.interval_days != null ? String(s.interval_days) : '',
    warn_threshold_pct: '',
    is_critical: s.is_critical,
    tip: '',
  }
}

function itemToForm(item: MaintenancePlanItem): ItemFormState {
  return {
    name: item.name,
    category: item.category,
    type: item.type,
    interval_km: item.interval_km != null ? String(item.interval_km) : '',
    interval_days: item.interval_days != null ? String(item.interval_days) : '',
    warn_threshold_pct: item.warn_threshold_pct != null ? String(item.warn_threshold_pct) : '',
    is_critical: item.is_critical,
    tip: item.tip ?? '',
  }
}

const CATEGORY_OPTIONS: { value: MaintenancePlanItemCategory; label: string }[] = [
  { value: 'oil', label: 'Óleo' },
  { value: 'filter', label: 'Filtro' },
  { value: 'brake', label: 'Freio' },
  { value: 'tire', label: 'Pneu' },
  { value: 'wear_part', label: 'Peça de desgaste' },
  { value: 'inspection', label: 'Vistoria' },
  { value: 'fluid', label: 'Fluido' },
  { value: 'transmission', label: 'Transmissão' },
  { value: 'other', label: 'Outros' },
]

export default function MaintenancePlansPage() {
  const qc = useQueryClient()
  const { data: plans = [], isLoading } = useMaintenancePlans()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<MaintenancePlan | null>(null)
  const [form, setForm] = useState<PlanFormState>(emptyForm)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Editor de item — modal único compartilhado entre criar e editar.
  const [itemModalOpen, setItemModalOpen] = useState(false)
  const [itemModalPlanId, setItemModalPlanId] = useState<string | null>(null)
  const [editingItem, setEditingItem] = useState<MaintenancePlanItem | null>(null)
  const [itemMode, setItemMode] = useState<'suggestions' | 'custom'>('suggestions')
  const [itemForm, setItemForm] = useState<ItemFormState>(emptyItemForm)
  const [itemSubmitting, setItemSubmitting] = useState(false)
  const [itemError, setItemError] = useState<string | null>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['maintenance_plans'] })

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (!showArchived && p.archived_at !== null) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [plans, search, showArchived])

  function openCreateModal() {
    setEditingPlan(null)
    setForm(emptyForm)
    setError(null)
    setPlanModalOpen(true)
  }

  function openEditModal(plan: MaintenancePlan) {
    setEditingPlan(plan)
    setForm({
      name: plan.name,
      description: plan.description ?? '',
      is_default: plan.is_default,
    })
    setError(null)
    setPlanModalOpen(true)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        is_default: form.is_default,
      }
      const res = editingPlan
        ? await updateMaintenancePlan(editingPlan.id, payload)
        : await createMaintenancePlan(payload)
      if (res.error) {
        setError(res.error)
        return
      }
      setPlanModalOpen(false)
      invalidate()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleSetDefault(plan: MaintenancePlan) {
    const res = await setDefaultMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    invalidate()
  }

  async function handleArchive(plan: MaintenancePlan) {
    if (!confirm(`Arquivar o plano "${plan.name}"? Motos atribuídas continuam apontando para ele, mas ele sai da seleção de novos cadastros.`)) return
    const res = await archiveMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    invalidate()
  }

  async function handleUnarchive(plan: MaintenancePlan) {
    const res = await unarchiveMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    invalidate()
  }

  async function handleClone(plan: MaintenancePlan) {
    const suggested = `${plan.name} (cópia)`
    const newName = prompt('Nome do novo plano:', suggested)
    if (!newName) return
    const res = await cloneMaintenancePlan(plan.id, newName)
    if (res.error) {
      alert(res.error)
      return
    }
    invalidate()
  }

  function openAddItem(planId: string) {
    setItemModalPlanId(planId)
    setEditingItem(null)
    setItemForm(emptyItemForm)
    setItemMode('suggestions')
    setItemError(null)
    setItemModalOpen(true)
  }

  function openEditItem(item: MaintenancePlanItem) {
    setItemModalPlanId(item.plan_id)
    setEditingItem(item)
    setItemForm(itemToForm(item))
    // Editar já abre direto no form — sugestões só fazem sentido pra novo.
    setItemMode('custom')
    setItemError(null)
    setItemModalOpen(true)
  }

  function applySuggestion(s: SuggestedPlanItem) {
    setItemForm(suggestionToForm(s))
    setItemMode('custom')
  }

  function parseIntOrNull(s: string): number | null {
    const trimmed = s.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : null
  }

  function parsePctOrNull(s: string): number | null {
    const trimmed = s.trim()
    if (!trimmed) return null
    const n = Number(trimmed)
    return Number.isFinite(n) && Number.isInteger(n) && n >= 1 && n <= 100 ? n : null
  }

  async function handleSubmitItem(e: React.FormEvent) {
    e.preventDefault()
    setItemError(null)
    if (!itemModalPlanId) return
    const interval_km = parseIntOrNull(itemForm.interval_km)
    const interval_days = parseIntOrNull(itemForm.interval_days)
    if (interval_km == null && interval_days == null) {
      setItemError('Informe ao menos um intervalo (km ou dias).')
      return
    }
    if (itemForm.interval_km.trim() && interval_km == null) {
      setItemError('Intervalo em km precisa ser inteiro positivo.')
      return
    }
    if (itemForm.interval_days.trim() && interval_days == null) {
      setItemError('Intervalo em dias precisa ser inteiro positivo.')
      return
    }
    const warn = parsePctOrNull(itemForm.warn_threshold_pct)
    if (itemForm.warn_threshold_pct.trim() && warn == null) {
      setItemError('Threshold precisa ser inteiro entre 1 e 100.')
      return
    }

    setItemSubmitting(true)
    try {
      if (editingItem) {
        const res = await updateMaintenancePlanItem(editingItem.id, {
          name: itemForm.name.trim(),
          category: itemForm.category,
          type: itemForm.type,
          interval_km,
          interval_days,
          warn_threshold_pct: warn,
          is_critical: itemForm.is_critical,
          tip: itemForm.tip.trim() || null,
        })
        if (res.error) {
          setItemError(res.error)
          return
        }
      } else {
        const res = await createMaintenancePlanItem({
          plan_id: itemModalPlanId,
          name: itemForm.name.trim(),
          category: itemForm.category,
          type: itemForm.type,
          interval_km,
          interval_days,
          warn_threshold_pct: warn,
          is_critical: itemForm.is_critical,
          tip: itemForm.tip.trim() || null,
        })
        if (res.error) {
          setItemError(res.error)
          return
        }
      }
      setItemModalOpen(false)
      qc.invalidateQueries({ queryKey: ['maintenance_plans', itemModalPlanId] })
      qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
    } finally {
      setItemSubmitting(false)
    }
  }

  async function handleRemoveItem(item: MaintenancePlanItem) {
    if (!confirm(`Remover o item "${item.name}" deste plano? Manutenções já criadas com este item são preservadas.`)) return
    setBusyItemId(item.id)
    try {
      const res = await deleteMaintenancePlanItem(item.id)
      if (res.error) {
        alert(res.error)
        return
      }
      qc.invalidateQueries({ queryKey: ['maintenance_plans', item.plan_id] })
      qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
    } finally {
      setBusyItemId(null)
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Planos de Manutenção"
        subtitle={`${plans.length} plano(s) cadastrado(s)`}
        actions={
          <Button onClick={openCreateModal}>
            <Plus className="w-4 h-4" />
            Novo plano
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-4 bg-[#323232] border border-[#474747] rounded-full h-10 w-72 focus-within:border-[#616161]">
            <Search className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
            <input
              type="text"
              placeholder="Buscar plano por nome ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[#f5f5f5] text-[13px] outline-none placeholder:text-[#616161]"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-[#9e9e9e] cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[#BAFF1A]"
            />
            Mostrar arquivados
          </label>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <Wrench className="w-12 h-12 text-[#616161] mx-auto mb-3" />
              <p className="text-[13px] text-[#9e9e9e]">
                {search ? `Nenhum plano para "${search}"` : 'Nenhum plano cadastrado'}
              </p>
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="mt-2 text-[13px] text-[#BAFF1A] hover:underline"
                >
                  Limpar busca
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                expanded={expandedId === plan.id}
                onToggle={() => setExpandedId((prev) => (prev === plan.id ? null : plan.id))}
                onEdit={() => openEditModal(plan)}
                onSetDefault={() => handleSetDefault(plan)}
                onArchive={() => handleArchive(plan)}
                onUnarchive={() => handleUnarchive(plan)}
                onClone={() => handleClone(plan)}
                onAddItem={openAddItem}
                onEditItem={openEditItem}
                onRemoveItem={handleRemoveItem}
                busyItemId={busyItemId}
              />
            ))}
          </div>
        )}
      </div>

      <Modal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        title={editingPlan ? 'Editar plano' : 'Novo plano de manutenção'}
        size="md"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Nome do plano"
            placeholder="Ex.: Plano Honda CG 160, Frota Premium..."
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={200}
            autoFocus
          />
          <Textarea
            label="Descrição (opcional)"
            placeholder="Quando usar este plano, particularidades..."
            rows={3}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            maxLength={2000}
          />
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_default}
              onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
              className="mt-0.5 accent-[#BAFF1A]"
            />
            <div>
              <p className="text-[13px] text-[#f5f5f5] font-medium">Tornar plano default</p>
              <p className="text-[12px] text-[#9e9e9e]">
                Pré-seleciona este plano no cadastro de novas motos. O plano default
                anterior é desmarcado automaticamente.
              </p>
            </div>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[#3a1010] border border-[#7c1c1c] text-[13px] text-[#ff9c9a]">
              {error}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={() => setPlanModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={submitting || !form.name.trim()}>
              {editingPlan ? (
                <>
                  <Edit2 className="w-4 h-4" />
                  Salvar alterações
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Criar plano
                </>
              )}
            </Button>
          </div>
        </form>
      </Modal>

      <ItemEditorModal
        open={itemModalOpen}
        onClose={() => setItemModalOpen(false)}
        editingItem={editingItem}
        mode={itemMode}
        onModeChange={setItemMode}
        form={itemForm}
        setForm={setItemForm}
        onApplySuggestion={applySuggestion}
        onSubmit={handleSubmitItem}
        submitting={itemSubmitting}
        error={itemError}
      />
    </div>
  )
}

function ItemEditorModal({
  open, onClose, editingItem, mode, onModeChange, form, setForm,
  onApplySuggestion, onSubmit, submitting, error,
}: {
  open: boolean
  onClose: () => void
  editingItem: MaintenancePlanItem | null
  mode: 'suggestions' | 'custom'
  onModeChange: (m: 'suggestions' | 'custom') => void
  form: ItemFormState
  setForm: (f: ItemFormState) => void
  onApplySuggestion: (s: SuggestedPlanItem) => void
  onSubmit: (e: React.FormEvent) => void
  submitting: boolean
  error: string | null
}) {
  const grouped = useMemo(() => groupSuggestionsByCategory(), [])
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingItem ? 'Editar item do plano' : 'Adicionar item ao plano'}
      size="lg"
    >
      {!editingItem && (
        <div className="flex border-b border-[#323232] mb-4">
          <button
            type="button"
            onClick={() => onModeChange('suggestions')}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              mode === 'suggestions'
                ? 'border-[#BAFF1A] text-[#f5f5f5]'
                : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
            }`}
          >
            <Sparkles className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5" /> Da sugestão
          </button>
          <button
            type="button"
            onClick={() => onModeChange('custom')}
            className={`px-4 py-2 text-[13px] font-medium border-b-2 transition-colors ${
              mode === 'custom'
                ? 'border-[#BAFF1A] text-[#f5f5f5]'
                : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
            }`}
          >
            Personalizado
          </button>
        </div>
      )}

      {mode === 'suggestions' && !editingItem ? (
        <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
          <p className="text-[13px] text-[#9e9e9e]">
            Clique numa sugestão para copiar os campos pro formulário. Você ainda
            pode ajustar tudo antes de salvar.
          </p>
          {(Object.entries(grouped) as [MaintenancePlanItemCategory, SuggestedPlanItem[]][]).map(([category, items]) => (
            <div key={category}>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={CATEGORY_VARIANT[category]}>{CATEGORY_LABELS[category]}</Badge>
                <span className="text-[12px] text-[#616161]">{items.length} sugestão(ões)</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {items.map((s) => {
                  const interval = s.interval_km
                    ? `${s.interval_km.toLocaleString('pt-BR')} km`
                    : `${s.interval_days} dias`
                  return (
                    <button
                      key={s.name}
                      type="button"
                      onClick={() => onApplySuggestion(s)}
                      className="px-3 py-2 rounded-lg bg-[#262626] border border-[#474747] hover:border-[#BAFF1A] hover:bg-[#323232] transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] text-[#f5f5f5] font-medium">{s.name}</span>
                        {s.is_critical && <Badge variant="danger">Crítico</Badge>}
                      </div>
                      <span className="text-[12px] text-[#9e9e9e]">{interval}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center pt-2 border-t border-[#323232]">
            <span className="text-[12px] text-[#616161]">
              {SUGGESTED_PLAN_ITEMS.length} sugestões disponíveis
            </span>
            <Button type="button" variant="ghost" onClick={() => onModeChange('custom')}>
              Pular para personalizado
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <Input
            label="Nome do item"
            placeholder="Ex.: Troca de óleo"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            maxLength={200}
            autoFocus
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Categoria"
              options={CATEGORY_OPTIONS}
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as MaintenancePlanItemCategory })}
            />
            <Select
              label="Tipo"
              options={[
                { value: 'preventive', label: 'Preventiva (peça/insumo)' },
                { value: 'inspection', label: 'Vistoria' },
              ]}
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as 'preventive' | 'inspection' })}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Intervalo (km)"
              type="number"
              min={1}
              placeholder="Ex.: 1000"
              value={form.interval_km}
              onChange={(e) => setForm({ ...form, interval_km: e.target.value })}
              hint="Deixe em branco se for só por data"
            />
            <Input
              label="Intervalo (dias)"
              type="number"
              min={1}
              placeholder="Ex.: 180"
              value={form.interval_days}
              onChange={(e) => setForm({ ...form, interval_days: e.target.value })}
              hint="Deixe em branco se for só por km"
            />
          </div>
          <Input
            label="Threshold de alerta (%)"
            type="number"
            min={1}
            max={100}
            placeholder="Default: 10%"
            value={form.warn_threshold_pct}
            onChange={(e) => setForm({ ...form, warn_threshold_pct: e.target.value })}
            hint="Antecedência (% do intervalo) para marcar como 'Próxima'."
          />
          <Textarea
            label="Dica para o operador (opcional)"
            rows={2}
            placeholder="Ex.: Verificar nível de óleo no painel"
            value={form.tip}
            onChange={(e) => setForm({ ...form, tip: e.target.value })}
            maxLength={2000}
          />
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.is_critical}
              onChange={(e) => setForm({ ...form, is_critical: e.target.checked })}
              className="mt-0.5 accent-[#BAFF1A]"
            />
            <div>
              <p className="text-[13px] text-[#f5f5f5] font-medium">Item crítico</p>
              <p className="text-[12px] text-[#9e9e9e]">
                Reservado para o PRD futuro de bloqueio de locação por preventiva
                vencida. Sem efeito operacional no V1 — pode marcar agora pra
                evitar migração depois.
              </p>
            </div>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-[#3a1010] border border-[#7c1c1c] text-[13px] text-[#ff9c9a] flex items-start gap-2">
              <X className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-3 justify-end pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={submitting || !form.name.trim()}>
              {editingItem ? (
                <><Edit2 className="w-4 h-4" /> Salvar alterações</>
              ) : (
                <><Plus className="w-4 h-4" /> Adicionar item</>
              )}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  )
}
