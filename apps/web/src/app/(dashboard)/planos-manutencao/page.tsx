/**
 * @file src/app/(dashboard)/planos-manutencao/page.tsx
 * @description CRUD de planos de manutenção em **uma única tela** (criar/editar).
 *
 * O editor é um modal `xl` que contém nome, descrição, default e a lista
 * inline de itens com "Adicionar item" inserindo uma linha em branco abaixo.
 * Submit final: cria o plano, depois encadeia create/update/delete dos itens
 * (diff contra o estado original quando estiver editando).
 *
 * O card da listagem mostra os itens como leitura (expandível), e toda
 * mutação passa pelo mesmo editor — não há mais modal isolado de item.
 */

'use client'

import { useState, useMemo, useId, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Wrench, ChevronDown, ChevronUp, Search, Plus, Star, Archive,
  Edit2, MoreVertical, Copy, ArchiveRestore, Trash2,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input, Textarea } from '@/components/ui/Input'
import { useMaintenancePlans, useMaintenancePlan } from '@gomoto/data'
import type { MaintenancePlan, MaintenancePlanItem } from '@gomoto/core'
import { SUGGESTED_PLAN_ITEMS, findSuggestedItemByDescription } from '@gomoto/core'
import {
  createMaintenancePlan,
  updateMaintenancePlan,
  archiveMaintenancePlan,
  unarchiveMaintenancePlan,
  cloneMaintenancePlan,
  createMaintenancePlanItem,
  updateMaintenancePlanItem,
  deleteMaintenancePlanItem,
} from './actions'

function formatInterval(item: { interval_km: number | null; interval_days: number | null }): string {
  const parts: string[] = []
  if (item.interval_km) parts.push(`${item.interval_km.toLocaleString('pt-BR')} km`)
  if (item.interval_days) parts.push(`${item.interval_days} dias`)
  return parts.join(' • ')
}

/**
 * Key local estável para cada draft. Usada como `key` do React e pra navegar
 * o array no `updateItem`/`removeItem`. crypto.randomUUID está disponível em
 * todo browser que o app suporta.
 */
function newDraftKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

type ItemDraft = {
  key: string
  /** id real do BD — populado quando o draft veio de um item já salvo. */
  existingId?: string
  name: string
  interval_km: string
  interval_days: string
  warn_threshold_pct: string
  is_critical: boolean
  tip: string
}

function emptyItemDraft(): ItemDraft {
  return {
    key: newDraftKey(),
    name: '',
    interval_km: '',
    interval_days: '',
    warn_threshold_pct: '',
    is_critical: false,
    tip: '',
  }
}

function itemToDraft(item: MaintenancePlanItem): ItemDraft {
  return {
    key: item.id,
    existingId: item.id,
    name: item.name,
    interval_km: item.interval_km != null ? String(item.interval_km) : '',
    interval_days: item.interval_days != null ? String(item.interval_days) : '',
    warn_threshold_pct: item.warn_threshold_pct != null ? String(item.warn_threshold_pct) : '',
    is_critical: item.is_critical,
    tip: item.tip ?? '',
  }
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

function PlanItemsReadOnly({ planId }: { planId: string }) {
  const { data: plan, isLoading } = useMaintenancePlan(planId)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
      </div>
    )
  }
  const items = plan?.items ?? ([] as MaintenancePlanItem[])
  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[13px] text-[#9e9e9e]">
          Nenhum item ainda. Use <strong className="text-[#f5f5f5]">Editar plano</strong> para adicionar.
        </p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="h-9 border-b border-[#323232]">
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Item</th>
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
                {item.tip && <p className="text-[12px] text-[#616161]">{item.tip}</p>}
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

function PlanCard({
  plan, expanded, onToggle, onEdit, onArchive, onUnarchive, onClone,
}: {
  plan: MaintenancePlan
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
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
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute right-0 top-9 z-40 w-52 bg-[#202020] border border-[#474747] rounded-lg shadow-lg overflow-hidden">
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
          <PlanItemsReadOnly planId={plan.id} />
        </div>
      )}
    </div>
  )
}

/**
 * Linha de item dentro do PlanEditorModal. Renderiza inputs lado a lado e
 * aplica autocomplete via datalist compartilhado. Pré-preenche intervalos
 * vazios no onBlur do nome quando bate com uma sugestão canônica.
 */
function ItemRow({
  item, index, datalistId, onChange, onRemove,
}: {
  item: ItemDraft
  index: number
  datalistId: string
  onChange: (patch: Partial<ItemDraft>) => void
  onRemove: () => void
}) {
  // Pré-preenche intervalos/critical vazios quando o nome bate com uma
  // sugestão canônica. Disparado no blur pra não pular dentro da digitação.
  function applySuggestionOnBlur() {
    if (item.existingId) return
    const match = findSuggestedItemByDescription(item.name)
    if (!match) return
    const patch: Partial<ItemDraft> = {}
    if (!item.interval_km && match.interval_km != null) patch.interval_km = String(match.interval_km)
    if (!item.interval_days && match.interval_days != null) patch.interval_days = String(match.interval_days)
    if (!item.is_critical && match.is_critical) patch.is_critical = true
    if (Object.keys(patch).length > 0) onChange(patch)
  }

  return (
    <div className="rounded-lg border border-[#323232] bg-[#181818] p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[#616161] font-mono w-6 text-center">#{index + 1}</span>
        <Input
          list={datalistId}
          placeholder="Nome do item (ex.: Troca de óleo)"
          value={item.name}
          onChange={(e) => onChange({ name: e.target.value })}
          onBlur={applySuggestionOnBlur}
          maxLength={200}
          className="flex-1"
        />
        <button
          type="button"
          onClick={onRemove}
          className="p-2 rounded-lg text-[#ff9c9a] hover:bg-[#7c1c1c]/30 transition-colors"
          title="Remover item"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label="Intervalo (km)"
          type="number"
          min={1}
          placeholder="Ex.: 1000"
          value={item.interval_km}
          onChange={(e) => onChange({ interval_km: e.target.value })}
        />
        <Input
          label="Intervalo (dias)"
          type="number"
          min={1}
          placeholder="Ex.: 180"
          value={item.interval_days}
          onChange={(e) => onChange({ interval_days: e.target.value })}
        />
        <Input
          label="Alerta (%)"
          type="number"
          min={1}
          max={100}
          placeholder="Default: 10"
          value={item.warn_threshold_pct}
          onChange={(e) => onChange({ warn_threshold_pct: e.target.value })}
        />
      </div>

      <Textarea
        label="Dica (opcional)"
        rows={2}
        placeholder="Ex.: Verificar nível de óleo no painel"
        value={item.tip}
        onChange={(e) => onChange({ tip: e.target.value })}
        maxLength={2000}
      />

      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={item.is_critical}
          onChange={(e) => onChange({ is_critical: e.target.checked })}
          className="accent-[#BAFF1A]"
        />
        <span className="text-[12px] text-[#9e9e9e]">
          Item crítico (reservado pra bloqueio futuro de locação)
        </span>
      </label>
    </div>
  )
}

function PlanEditorModal({
  open, onClose, editingPlan, onSaved,
}: {
  open: boolean
  onClose: () => void
  editingPlan: MaintenancePlan | null
  onSaved: () => void
}) {
  const datalistId = useId()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [items, setItems] = useState<ItemDraft[]>([emptyItemDraft()])
  /** Ids dos itens que existiam no servidor quando o modal abriu — alimentam o diff de delete. */
  const [originalItemIds, setOriginalItemIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Carrega o plano completo (com itens) quando estiver editando.
  const planQuery = useMaintenancePlan(editingPlan?.id)

  // Reset / hydrate quando o modal abre ou muda de target.
  useEffect(() => {
    if (!open) return
    if (editingPlan) {
      setName(editingPlan.name)
      setDescription(editingPlan.description ?? '')
      setIsDefault(editingPlan.is_default)
      // items vão ser populados pelo próximo effect quando planQuery resolver
    } else {
      setName('')
      setDescription('')
      setIsDefault(false)
      setItems([emptyItemDraft()])
      setOriginalItemIds([])
    }
    setError(null)
  }, [open, editingPlan])

  useEffect(() => {
    if (!open || !editingPlan) return
    const data = planQuery.data
    if (!data) return
    const dataItems = data.items ?? []
    const drafts = dataItems.map(itemToDraft)
    setItems(drafts.length > 0 ? drafts : [emptyItemDraft()])
    setOriginalItemIds(dataItems.map((i) => i.id))
  }, [open, editingPlan, planQuery.data])

  // Sugestões para o datalist: SUGGESTED_PLAN_ITEMS + nomes já no draft.
  const autocompleteOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const normalize = (s: string) =>
      s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    for (const s of SUGGESTED_PLAN_ITEMS) {
      const key = normalize(s.name)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(s.name)
    }
    for (const it of items) {
      if (!it.name.trim()) continue
      const key = normalize(it.name)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(it.name)
    }
    return out
  }, [items])

  function addItem() {
    setItems((prev) => [...prev, emptyItemDraft()])
  }

  function removeItem(key: string) {
    setItems((prev) => {
      const next = prev.filter((it) => it.key !== key)
      // Garante que sempre exista pelo menos uma linha em branco visível.
      return next.length > 0 ? next : [emptyItemDraft()]
    })
  }

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  /**
   * Valida nome do plano + cada item não-vazio. Linhas totalmente em branco
   * (sem nome e sem nenhum intervalo) são silenciosamente descartadas, pra
   * permitir que o operador termine com a última linha vazia que ficou.
   */
  type ParsedItem = {
    name: string
    interval_km: number | null
    interval_days: number | null
    warn_threshold_pct: number | null
    is_critical: boolean
    tip: string | null
  }
  type ValidationResult =
    | { ok: true; planName: string; planDescription: string | null; validItems: Array<{ draft: ItemDraft; parsed: ParsedItem }> }
    | { ok: false; message: string }

  function validate(): ValidationResult {
    const trimmedName = name.trim()
    if (!trimmedName) return { ok: false, message: 'Nome do plano é obrigatório.' }

    const validItems: Array<{ draft: ItemDraft; parsed: ParsedItem }> = []
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      const hasName = it.name.trim().length > 0
      const hasAnyInterval = it.interval_km.trim().length > 0 || it.interval_days.trim().length > 0
      const hasAnyOptional = it.warn_threshold_pct.trim().length > 0 || it.tip.trim().length > 0 || it.is_critical
      // Linha totalmente em branco — descarta.
      if (!hasName && !hasAnyInterval && !hasAnyOptional) continue
      if (!hasName) return { ok: false, message: `Item #${i + 1}: nome é obrigatório.` }

      const interval_km = parseIntOrNull(it.interval_km)
      const interval_days = parseIntOrNull(it.interval_days)
      if (it.interval_km.trim() && interval_km == null) return { ok: false, message: `Item "${it.name}": intervalo em km deve ser inteiro positivo.` }
      if (it.interval_days.trim() && interval_days == null) return { ok: false, message: `Item "${it.name}": intervalo em dias deve ser inteiro positivo.` }
      if (interval_km == null && interval_days == null) return { ok: false, message: `Item "${it.name}": informe ao menos um intervalo (km ou dias).` }

      const warn = parsePctOrNull(it.warn_threshold_pct)
      if (it.warn_threshold_pct.trim() && warn == null) return { ok: false, message: `Item "${it.name}": threshold deve ser inteiro entre 1 e 100.` }

      validItems.push({
        draft: it,
        parsed: {
          name: it.name.trim(),
          interval_km,
          interval_days,
          warn_threshold_pct: warn,
          is_critical: it.is_critical,
          tip: it.tip.trim() || null,
        },
      })
    }

    return {
      ok: true,
      planName: trimmedName,
      planDescription: description.trim() || null,
      validItems,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const v = validate()
    if (!v.ok) { setError(v.message); return }

    setSubmitting(true)
    try {
      if (editingPlan) {
        // ── UPDATE plano + diff dos itens ──
        const res = await updateMaintenancePlan(editingPlan.id, {
          name: v.planName,
          description: v.planDescription,
          is_default: isDefault,
        })
        if (res.error) { setError(res.error); return }

        const keptIds = new Set(v.validItems.map((vi) => vi.draft.existingId).filter((x): x is string => Boolean(x)))
        const toDelete = originalItemIds.filter((id) => !keptIds.has(id))
        for (const id of toDelete) {
          const r = await deleteMaintenancePlanItem(id)
          if (r.error) { setError(`Erro ao remover item: ${r.error}`); return }
        }
        for (const vi of v.validItems) {
          if (vi.draft.existingId) {
            const r = await updateMaintenancePlanItem(vi.draft.existingId, vi.parsed)
            if (r.error) { setError(`Erro ao atualizar item "${vi.parsed.name}": ${r.error}`); return }
          } else {
            const r = await createMaintenancePlanItem({ ...vi.parsed, plan_id: editingPlan.id })
            if (r.error) { setError(`Erro ao adicionar item "${vi.parsed.name}": ${r.error}`); return }
          }
        }
      } else {
        // ── CREATE plano + itens em sequência ──
        const res = await createMaintenancePlan({
          name: v.planName,
          description: v.planDescription,
          is_default: isDefault,
        })
        if (res.error || !res.data) { setError(res.error ?? 'Falha ao criar plano.'); return }
        const planId = res.data.id
        for (const vi of v.validItems) {
          const r = await createMaintenancePlanItem({ ...vi.parsed, plan_id: planId })
          if (r.error) {
            setError(`Plano criado, mas falhou ao adicionar item "${vi.parsed.name}": ${r.error}. Reabra para corrigir.`)
            return
          }
        }
      }

      onSaved()
      onClose()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={editingPlan ? 'Editar plano' : 'Novo plano de manutenção'}
      size="xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <Input
          label="Nome do plano"
          placeholder="Ex.: Plano Honda CG 160, Frota Premium..."
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={200}
          autoFocus
        />
        <Textarea
          label="Descrição (opcional)"
          placeholder="Quando usar este plano, particularidades..."
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="mt-0.5 accent-[#BAFF1A]"
          />
          <div>
            <p className="text-[13px] text-[#f5f5f5] font-medium">Tornar plano default</p>
            <p className="text-[12px] text-[#9e9e9e]">
              Pré-seleciona este plano no cadastro de novas motos. O default
              anterior é desmarcado automaticamente.
            </p>
          </div>
        </label>

        <div className="border-t border-[#323232] pt-4 space-y-3">
          <div>
            <h3 className="text-[14px] font-medium text-[#f5f5f5]">Itens do plano</h3>
            <p className="text-[12px] text-[#9e9e9e]">
              Comece a digitar pra ver sugestões; selecionar pré-preenche os intervalos.
            </p>
          </div>

          <datalist id={datalistId}>
            {autocompleteOptions.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>

          <div className="space-y-3">
            {items.map((it, idx) => (
              <ItemRow
                key={it.key}
                item={it}
                index={idx}
                datalistId={datalistId}
                onChange={(patch) => updateItem(it.key, patch)}
                onRemove={() => removeItem(it.key)}
              />
            ))}
          </div>

          {/* Botão fica abaixo do último item para o operador adicionar uma nova
              linha sem precisar rolar até o topo da seção. */}
          <button
            type="button"
            onClick={addItem}
            className="flex items-center justify-center gap-2 w-full h-10 rounded-lg border border-dashed border-[#474747] text-[13px] text-[#9e9e9e] hover:border-[#BAFF1A] hover:text-[#BAFF1A] transition-colors"
          >
            <Plus className="w-4 h-4" /> Adicionar item
          </button>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-lg bg-[#3a1010] border border-[#7c1c1c] text-[13px] text-[#ff9c9a]">
            {error}
          </div>
        )}

        <div className="flex gap-3 justify-end pt-2 border-t border-[#323232]">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={submitting || !name.trim()}>
            {submitting ? 'Salvando...' : editingPlan ? (
              <><Edit2 className="w-4 h-4" /> Salvar plano</>
            ) : (
              <><Plus className="w-4 h-4" /> Criar plano</>
            )}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

export default function MaintenancePlansPage() {
  const qc = useQueryClient()
  const { data: plans = [], isLoading } = useMaintenancePlans()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const [editorOpen, setEditorOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<MaintenancePlan | null>(null)

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

  function openCreate() {
    setEditingPlan(null)
    setEditorOpen(true)
  }

  function openEdit(plan: MaintenancePlan) {
    setEditingPlan(plan)
    setEditorOpen(true)
  }

  function handleSaved() {
    qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
  }

  async function handleArchive(plan: MaintenancePlan) {
    if (!confirm(`Arquivar o plano "${plan.name}"? Motos atribuídas continuam apontando para ele, mas ele sai da seleção de novos cadastros.`)) return
    const res = await archiveMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
  }

  async function handleUnarchive(plan: MaintenancePlan) {
    const res = await unarchiveMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
  }

  async function handleClone(plan: MaintenancePlan) {
    const suggested = `${plan.name} (cópia)`
    const newName = prompt('Nome do novo plano:', suggested)
    if (!newName) return
    const res = await cloneMaintenancePlan(plan.id, newName)
    if (res.error) { alert(res.error); return }
    qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
  }

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Planos de Manutenção"
        subtitle={`${plans.length} plano(s) cadastrado(s)`}
        actions={
          <Button onClick={openCreate}>
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
                onEdit={() => openEdit(plan)}
                onArchive={() => handleArchive(plan)}
                onUnarchive={() => handleUnarchive(plan)}
                onClone={() => handleClone(plan)}
              />
            ))}
          </div>
        )}
      </div>

      <PlanEditorModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        editingPlan={editingPlan}
        onSaved={handleSaved}
      />
    </div>
  )
}
