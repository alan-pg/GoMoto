/**
 * @file src/app/(dashboard)/planos-manutencao/page.tsx
 * @description Listagem + CRUD de cabeçalho de planos de manutenção (PRD 0003 F2.1/F2.2b).
 *
 * F2.1 entregou só leitura. F2.2b adiciona criar/editar plano (nome, descrição,
 * tornar default) e o menu de ações em cada card. Edição de itens segue
 * read-only — vai virar editável em F2.2c, que liga os chips de sugestões.
 */

'use client'

import { useState, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Wrench, ChevronDown, ChevronUp, Search, Plus, Star, Archive,
  Edit2, MoreVertical, Copy, ArchiveRestore,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { useMaintenancePlans, useMaintenancePlan } from '@gomoto/data'
import type { MaintenancePlan, MaintenancePlanItem, MaintenancePlanItemCategory } from '@gomoto/core'
import {
  createMaintenancePlan,
  updateMaintenancePlan,
  setDefaultMaintenancePlan,
  archiveMaintenancePlan,
  unarchiveMaintenancePlan,
  cloneMaintenancePlan,
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

function PlanItemsList({ planId }: { planId: string }) {
  const { data: plan, isLoading } = useMaintenancePlan(planId)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
      </div>
    )
  }
  const items = plan?.items ?? []
  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[13px] text-[#9e9e9e]">Plano sem itens. Adicionar itens chega na próxima fatia (F2.2c).</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="h-9 border-b border-[#323232]">
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Item</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Categoria</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Intervalo</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Alerta</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Crítico</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="h-9 border-b border-[#323232]">
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
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanCard({ plan, expanded, onToggle, onEdit, onSetDefault, onArchive, onUnarchive, onClone }: {
  plan: MaintenancePlan
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onSetDefault: () => void
  onArchive: () => void
  onUnarchive: () => void
  onClone: () => void
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
          <PlanItemsList planId={plan.id} />
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
    </div>
  )
}
