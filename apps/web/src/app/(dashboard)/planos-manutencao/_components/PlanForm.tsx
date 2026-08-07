'use client'

import { useState, useEffect, useRef, useMemo, useId, useTransition, forwardRef } from 'react'
import { flushSync } from 'react-dom'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, Trash2, AlertCircle, ChevronUp, ChevronDown,
  Archive, ArchiveRestore, Copy, ChevronRight, Check,
} from 'lucide-react'
import { SUGGESTED_PLAN_ITEMS, findSuggestedItemByDescription } from '@gomoto/core'
import type { MaintenancePlan, MaintenancePlanItem } from '@gomoto/core'
import {
  createMaintenancePlan,
  updateMaintenancePlan,
  createMaintenancePlanItem,
  updateMaintenancePlanItem,
  deleteMaintenancePlanItem,
  archiveMaintenancePlan,
  unarchiveMaintenancePlan,
  cloneMaintenancePlan,
} from '../actions'

// ─── Types ───────────────────────────────────────────────────────────────────

type ItemDraft = {
  key: string
  existingId?: string
  name: string
  interval_km: string
  interval_days: string
  warn_threshold_pct: string
  is_critical: boolean
  tip: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function newDraftKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function emptyItemDraft(): ItemDraft {
  return { key: newDraftKey(), name: '', interval_km: '', interval_days: '', warn_threshold_pct: '', is_critical: false, tip: '' }
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

// ─── Constants ────────────────────────────────────────────────────────────────

const inputCls =
  'w-full h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all'

// ─── Sub-components ──────────────────────────────────────────────────────────

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-2 mb-5">
      <h2 className="text-[15px] font-bold text-fg">{title}</h2>
      {hint && <span className="text-[12px] text-fg-mute">{hint}</span>}
    </div>
  )
}

function Field({ label, hint, error, children, className }: {
  label: string; hint?: string; error?: string; children: React.ReactNode; className?: string
}) {
  return (
    <div className={className}>
      <label className="block text-[13px] text-fg-mute mb-1.5">
        {label}
        {hint && <span className="ml-1.5 text-[12px] text-fg-mute">{hint}</span>}
      </label>
      {children}
      {error && <p className="text-[12px] text-danger mt-1">{error}</p>}
    </div>
  )
}

// ─── ItemRow ─────────────────────────────────────────────────────────────────

type ItemRowProps = {
  item: ItemDraft
  index: number
  datalistId: string
  onChange: (patch: Partial<ItemDraft>) => void
  onRemove: () => void
  onMoveUp: () => void
  onMoveDown: () => void
  canMoveUp: boolean
  canMoveDown: boolean
}

const ItemRow = forwardRef<HTMLDivElement, ItemRowProps>(
  ({ item, index, datalistId, onChange, onRemove, onMoveUp, onMoveDown, canMoveUp, canMoveDown }, ref) => {
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
      <div
        id={`item-${item.key}`}
        ref={ref}
        style={{ viewTransitionName: `plan-item-${item.key}` }}
        className="rounded-xl border border-border bg-surface p-4 space-y-3 scroll-mt-16"
      >
        {/* Nome + ordem + remover */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-border font-mono w-5 text-center flex-shrink-0">
            {index + 1}
          </span>
          <input
            list={datalistId}
            placeholder="Nome do item (ex.: Troca de óleo)"
            value={item.name}
            onChange={(e) => onChange({ name: e.target.value })}
            onBlur={applySuggestionOnBlur}
            maxLength={200}
            className="flex-1 h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all"
          />
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="flex-shrink-0 h-7 w-7 rounded-md text-fg-mute hover:bg-surface-2 hover:text-fg-mute transition-colors flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed"
            title="Mover para cima"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="flex-shrink-0 h-7 w-7 rounded-md text-fg-mute hover:bg-surface-2 hover:text-fg-mute transition-colors flex items-center justify-center disabled:opacity-25 disabled:cursor-not-allowed"
            title="Mover para baixo"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="flex-shrink-0 h-7 w-7 rounded-md text-fg-mute hover:bg-danger-bg hover:text-danger transition-colors flex items-center justify-center"
            title="Remover item"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Intervalos + alerta */}
        <div className="grid grid-cols-3 gap-3 pl-7">
          <Field label="Intervalo (km)">
            <input
              type="number" min={1} placeholder="Ex.: 1000"
              value={item.interval_km}
              onChange={(e) => onChange({ interval_km: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Intervalo (dias)">
            <input
              type="number" min={1} placeholder="Ex.: 180"
              value={item.interval_days}
              onChange={(e) => onChange({ interval_days: e.target.value })}
              className={inputCls}
            />
          </Field>
          <Field label="Alerta (%)">
            <input
              type="number" min={1} max={100} placeholder="Padrão: 10"
              value={item.warn_threshold_pct}
              onChange={(e) => onChange({ warn_threshold_pct: e.target.value })}
              className={inputCls}
            />
          </Field>
        </div>

        {/* Dica + crítico */}
        <div className="grid grid-cols-[1fr_auto] gap-3 pl-7 items-end">
          <Field label="Dica" hint="(opcional)">
            <input
              placeholder="Ex.: Verificar nível no painel"
              value={item.tip}
              onChange={(e) => onChange({ tip: e.target.value })}
              maxLength={2000}
              className={inputCls}
            />
          </Field>
          <label className="flex items-center gap-2 cursor-pointer h-9 pb-0.5">
            <input
              type="checkbox"
              checked={item.is_critical}
              onChange={(e) => onChange({ is_critical: e.target.checked })}
              className="accent-primary"
            />
            <span className="text-[12px] text-fg-mute whitespace-nowrap">Crítico</span>
          </label>
        </div>
      </div>
    )
  },
)
ItemRow.displayName = 'ItemRow'

// ─── Props ────────────────────────────────────────────────────────────────────

interface PlanFormProps {
  planId?: string
  initialPlan?: Pick<MaintenancePlan, 'name' | 'description' | 'is_default' | 'archived_at'>
  initialItems?: MaintenancePlanItem[]
}

// ─── PlanForm ────────────────────────────────────────────────────────────────

export function PlanForm({ planId, initialPlan, initialItems }: PlanFormProps) {
  const isEditMode = !!planId
  const isArchived = (initialPlan?.archived_at ?? null) !== null
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const datalistId = useId()

  // Form state
  const [name, setName] = useState(initialPlan?.name ?? '')
  const [description, setDescription] = useState(initialPlan?.description ?? '')
  const [isDefault, setIsDefault] = useState(initialPlan?.is_default ?? false)
  const [items, setItems] = useState<ItemDraft[]>(() =>
    initialItems && initialItems.length > 0 ? initialItems.map(itemToDraft) : [emptyItemDraft()],
  )
  const originalItemIds = useMemo(
    () => (initialItems ?? []).map((i) => i.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [globalError, setGlobalError] = useState<string | null>(null)

  // Clone in-page
  const [showCloneInput, setShowCloneInput] = useState(false)
  const [cloneNameInput, setCloneNameInput] = useState('')
  const [cloning, setCloning] = useState(false)
  const [archiving, setArchiving] = useState(false)

  // ── Sidebar IntersectionObserver ─────────────────────────────────────────
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})
  const [activeSection, setActiveSection] = useState('sec-identification')

  // Re-observe sempre que o número de itens muda (adição/remoção)
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible.length === 0) return
        // Prioriza o item mais próximo do topo do viewport
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        setActiveSection(visible[0].target.id)
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    )
    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [items.length, isEditMode])

  function scrollTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Item management ───────────────────────────────────────────────────────

  function addItem() { setItems((prev) => [...prev, emptyItemDraft()]) }

  function removeItem(key: string) {
    setItems((prev) => {
      const next = prev.filter((it) => it.key !== key)
      delete sectionRefs.current[`item-${key}`]
      return next.length > 0 ? next : [emptyItemDraft()]
    })
  }

  function updateItem(key: string, patch: Partial<ItemDraft>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  function moveItem(key: string, direction: -1 | 1) {
    const doSwap = () =>
      flushSync(() =>
        setItems((prev) => {
          const idx = prev.findIndex((it) => it.key === key)
          if (idx < 0) return prev
          const next = idx + direction
          if (next < 0 || next >= prev.length) return prev
          const arr = [...prev]
          ;[arr[idx], arr[next]] = [arr[next], arr[idx]]
          return arr
        }),
      )

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      document.startViewTransition(doSwap)
    } else {
      doSwap()
    }
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────

  const autocompleteOptions = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    const normalize = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
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

  // ── Validation ────────────────────────────────────────────────────────────

  type ParsedItem = {
    name: string; interval_km: number | null; interval_days: number | null
    warn_threshold_pct: number | null; is_critical: boolean; tip: string | null
    sort_order: number
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
      if (!hasName && !hasAnyInterval && !hasAnyOptional) continue
      if (!hasName) return { ok: false, message: `Item #${i + 1}: nome é obrigatório.` }
      const interval_km = parseIntOrNull(it.interval_km)
      const interval_days = parseIntOrNull(it.interval_days)
      if (it.interval_km.trim() && interval_km == null) return { ok: false, message: `Item "${it.name}": intervalo km deve ser inteiro positivo.` }
      if (it.interval_days.trim() && interval_days == null) return { ok: false, message: `Item "${it.name}": intervalo dias deve ser inteiro positivo.` }
      if (interval_km == null && interval_days == null) return { ok: false, message: `Item "${it.name}": informe ao menos um intervalo (km ou dias).` }
      const warn = parsePctOrNull(it.warn_threshold_pct)
      if (it.warn_threshold_pct.trim() && warn == null) return { ok: false, message: `Item "${it.name}": threshold deve ser inteiro entre 1 e 100.` }
      validItems.push({
        draft: it,
        parsed: {
          name: it.name.trim(), interval_km, interval_days, warn_threshold_pct: warn,
          is_critical: it.is_critical, tip: it.tip.trim() || null,
          sort_order: validItems.length,
        },
      })
    }
    return { ok: true, planName: trimmedName, planDescription: description.trim() || null, validItems }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)
    const v = validate()
    if (!v.ok) { setGlobalError(v.message); return }

    startTransition(async () => {
      if (isEditMode) {
        const res = await updateMaintenancePlan(planId!, {
          name: v.planName, description: v.planDescription, is_default: isDefault,
        })
        if (res.error) { setGlobalError(res.error); return }

        const keptIds = new Set(v.validItems.map((vi) => vi.draft.existingId).filter(Boolean) as string[])
        const toDelete = originalItemIds.filter((id) => !keptIds.has(id))
        for (const id of toDelete) {
          const r = await deleteMaintenancePlanItem(id)
          if (r.error) { setGlobalError(`Erro ao remover item: ${r.error}`); return }
        }
        for (const vi of v.validItems) {
          if (vi.draft.existingId) {
            const r = await updateMaintenancePlanItem(vi.draft.existingId, vi.parsed)
            if (r.error) { setGlobalError(`Erro ao atualizar "${vi.parsed.name}": ${r.error}`); return }
          } else {
            const r = await createMaintenancePlanItem({ ...vi.parsed, plan_id: planId! })
            if (r.error) { setGlobalError(`Erro ao adicionar "${vi.parsed.name}": ${r.error}`); return }
          }
        }
        router.push(`/planos-manutencao/${planId}`)
      } else {
        const res = await createMaintenancePlan({ name: v.planName, description: v.planDescription, is_default: isDefault })
        if (res.error || !res.data) { setGlobalError(res.error ?? 'Falha ao criar plano.'); return }
        const newId = (res.data as { id: string }).id
        for (const vi of v.validItems) {
          const r = await createMaintenancePlanItem({ ...vi.parsed, plan_id: newId })
          if (r.error) {
            setGlobalError(`Plano criado, mas falhou ao adicionar "${vi.parsed.name}": ${r.error}`)
            router.push(`/planos-manutencao/${newId}/editar`)
            return
          }
        }
        router.push(`/planos-manutencao/${newId}`)
      }
    })
  }

  // ── Archive / Clone ───────────────────────────────────────────────────────

  async function handleArchive() {
    if (!planId) return
    setArchiving(true)
    try {
      const res = await archiveMaintenancePlan(planId)
      if (res.error) { setGlobalError(res.error); return }
      router.push('/planos-manutencao')
    } finally { setArchiving(false) }
  }

  async function handleUnarchive() {
    if (!planId) return
    setArchiving(true)
    try {
      const res = await unarchiveMaintenancePlan(planId)
      if (res.error) { setGlobalError(res.error); return }
      router.push(`/planos-manutencao/${planId}`)
    } finally { setArchiving(false) }
  }

  async function handleClone() {
    if (!planId) return
    const trimmed = cloneNameInput.trim()
    if (!trimmed) return
    setCloning(true)
    try {
      const res = await cloneMaintenancePlan(planId, trimmed)
      if (res.error) { setGlobalError(res.error); return }
      router.push(`/planos-manutencao/${res.data!.id}/editar`)
    } finally { setCloning(false) }
  }

  // ── Sidebar nav items (dinâmicos) ─────────────────────────────────────────

  const backHref  = isEditMode ? `/planos-manutencao/${planId}` : '/planos-manutencao'
  const backLabel = isEditMode ? (initialPlan?.name || 'Plano') : 'Planos de manutenção'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-bg backdrop-blur border-b border-border px-6 h-14 flex items-center gap-3">
        <Link href={backHref} className="text-[13px] text-fg-mute hover:text-fg transition-colors whitespace-nowrap">
          ← {backLabel}
        </Link>
        <span className="text-fg-mute">/</span>
        <h1 className="text-[15px] font-bold text-fg flex-1 truncate">
          {isEditMode ? 'Editar plano' : 'Novo plano de manutenção'}
        </h1>
        <Link
          href={backHref}
          className="h-8 px-4 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors inline-flex items-center"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          form="plan-form"
          disabled={isPending}
          className="h-8 px-5 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
        >
          {isPending ? 'Salvando…' : isEditMode ? 'Salvar' : 'Criar plano'}
        </button>
      </div>

      {/* ── Corpo: sidebar + formulário ────────────────────────────────────── */}
      <div className="flex gap-0 max-w-4xl mx-auto">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-48 flex-shrink-0 hidden md:block">
          <nav className="sticky top-14 pt-8 pb-8 pr-4 overflow-y-auto max-h-[calc(100vh-3.5rem)]">

            {/* Identificação */}
            <NavButton id="sec-identification" label="Identificação" activeSection={activeSection} onScrollTo={scrollTo} />

            {/* Grupo: Itens */}
            <div className="mt-1">
              <p className="px-3 py-1.5 text-[11px] font-semibold text-border uppercase tracking-wider">
                Itens
              </p>
              <div className="space-y-0.5">
                {items.map((it, idx) => {
                  const id       = `item-${it.key}`
                  const isActive = activeSection === id
                  const label    = it.name.trim() || `Item ${idx + 1}`
                  return (
                    <button
                      key={it.key}
                      type="button"
                      onClick={() => scrollTo(id)}
                      title={label}
                      className={`w-full text-left pl-5 pr-3 py-1.5 rounded-lg text-[12px] transition-colors flex items-center gap-2 ${
                        isActive ? 'bg-surface-2 text-fg' : 'text-fg-mute hover:text-fg-mute hover:bg-divider'
                      }`}
                    >
                      <span className={`inline-block w-1 h-1 rounded-full flex-shrink-0 transition-colors ${isActive ? 'bg-primary' : 'bg-fg-mute'}`} />
                      <span className="truncate">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Configurações (edit only) */}
            {isEditMode && (
              <div className="mt-1">
                <NavButton id="sec-settings" label="Configurações" activeSection={activeSection} onScrollTo={scrollTo} />
              </div>
            )}
          </nav>
        </aside>

        {/* ── Formulário ──────────────────────────────────────────────────── */}
        <form
          id="plan-form"
          onSubmit={handleSubmit}
          className="flex-1 min-w-0 px-6 py-8 space-y-14"
        >

          {/* ══ Identificação ═════════════════════════════════════════════ */}
          <section
            id="sec-identification"
            ref={(el) => { sectionRefs.current['sec-identification'] = el }}
          >
            <SectionHeader title="Identificação" />
            <div className="space-y-4">
              <Field label="Nome do plano *">
                <input
                  className={inputCls}
                  placeholder="Ex.: Honda CG 160, Frota Premium..."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={200}
                  autoFocus={!isEditMode}
                />
              </Field>
              <Field label="Descrição" hint="(opcional)">
                <textarea
                  className={`${inputCls} h-20 py-2 resize-none`}
                  placeholder="Quando usar este plano, particularidades..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                />
              </Field>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <p className="text-[13px] text-fg font-medium">Tornar plano padrão</p>
                  <p className="text-[12px] text-fg-mute">
                    Pré-selecionado no cadastro de novos veículos. O padrão anterior é desmarcado automaticamente.
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* ══ Itens do plano ════════════════════════════════════════════ */}
          <section>
            <SectionHeader title="Itens do plano" hint="comece a digitar para ver sugestões" />

            <datalist id={datalistId}>
              {autocompleteOptions.map((n) => <option key={n} value={n} />)}
            </datalist>

            <div className="space-y-3">
              {items.map((it, idx) => (
                <ItemRow
                  key={it.key}
                  ref={(el) => { sectionRefs.current[`item-${it.key}`] = el }}
                  item={it}
                  index={idx}
                  datalistId={datalistId}
                  onChange={(patch) => updateItem(it.key, patch)}
                  onRemove={() => removeItem(it.key)}
                  onMoveUp={() => moveItem(it.key, -1)}
                  onMoveDown={() => moveItem(it.key, 1)}
                  canMoveUp={idx > 0}
                  canMoveDown={idx < items.length - 1}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={addItem}
              className="mt-3 flex items-center justify-center gap-2 w-full h-10 rounded-xl border border-dashed border-border text-[13px] text-fg-mute hover:border-primary hover:text-primary transition-colors"
            >
              <Plus className="w-4 h-4" /> Adicionar item
            </button>
          </section>

          {/* ══ Configurações (edição) ═════════════════════════════════════ */}
          {isEditMode && (
            <section
              id="sec-settings"
              ref={(el) => { sectionRefs.current['sec-settings'] = el }}
            >
              <SectionHeader title="Configurações" />
              <div className="space-y-3">

                {/* Clonar */}
                <div className="rounded-xl border border-border bg-surface overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      if (!showCloneInput) setCloneNameInput(`${initialPlan?.name ?? 'Plano'} (cópia)`)
                      setShowCloneInput((p) => !p)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3 text-[13px] text-fg hover:bg-[#222] transition-colors"
                  >
                    <Copy className="h-4 w-4 text-fg-mute flex-shrink-0" />
                    <span className="flex-1 text-left">Clonar este plano</span>
                    <ChevronRight className={`h-4 w-4 text-fg-mute transition-transform duration-200 ${showCloneInput ? 'rotate-90' : ''}`} />
                  </button>
                  {showCloneInput && (
                    <div className="px-4 pb-4 pt-1 border-t border-border space-y-3">
                      <p className="text-[12px] text-fg-mute">
                        Cria uma cópia independente com todos os itens. O clone nunca herda o status padrão.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={cloneNameInput}
                          onChange={(e) => setCloneNameInput(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void handleClone() } }}
                          placeholder="Nome do novo plano"
                          maxLength={200}
                          className="flex-1 h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all"
                        />
                        <button
                          type="button"
                          disabled={!cloneNameInput.trim() || cloning}
                          onClick={handleClone}
                          className="h-9 px-4 rounded-lg bg-surface-2 border border-border text-[13px] text-fg hover:border-primary hover:text-primary transition-all disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap"
                        >
                          {cloning ? 'Clonando…' : <><Check className="h-3.5 w-3.5" /> Clonar</>}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Arquivar / Reativar */}
                <div className="rounded-xl border border-border bg-surface p-4">
                  {isArchived ? (
                    <div className="flex items-start gap-3">
                      <ArchiveRestore className="h-4 w-4 text-fg-mute flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[13px] text-fg font-medium mb-1">Plano arquivado</p>
                        <p className="text-[12px] text-fg-mute mb-3">
                          Veículos atribuídos continuam com ele, mas não aparece para novos cadastros.
                        </p>
                        <button
                          type="button"
                          disabled={archiving}
                          onClick={handleUnarchive}
                          className="h-8 px-4 rounded-full border border-border text-[13px] text-fg hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
                        >
                          {archiving ? 'Reativando…' : 'Reativar plano'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <Archive className="h-4 w-4 text-fg-mute flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-[13px] text-fg font-medium mb-1">Arquivar plano</p>
                        <p className="text-[12px] text-fg-mute mb-3">
                          Remove da seleção de novos cadastros. Veículos atribuídos não são afetados.
                        </p>
                        <button
                          type="button"
                          disabled={archiving}
                          onClick={handleArchive}
                          className="h-8 px-4 rounded-full border border-danger-bg text-[13px] text-danger hover:bg-danger-bg transition-colors disabled:opacity-50"
                        >
                          {archiving ? 'Arquivando…' : 'Arquivar plano'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* ── Erro global ─────────────────────────────────────────────── */}
          {globalError && (
            <div className="flex items-start gap-3 px-4 py-3 bg-danger-bg border border-danger rounded-xl">
              <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-danger">{globalError}</p>
            </div>
          )}

          {/* ── Footer ──────────────────────────────────────────────────── */}
          <div className="flex gap-3 justify-end pt-4 pb-16 border-t border-border">
            <Link
              href={backHref}
              className="inline-flex items-center h-9 px-5 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="h-9 px-6 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
            >
              {isPending ? 'Salvando…' : isEditMode ? 'Salvar alterações' : 'Criar plano'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── NavButton ────────────────────────────────────────────────────────────────

function NavButton({ id, label, activeSection, onScrollTo }: {
  id: string; label: string; activeSection: string; onScrollTo: (id: string) => void
}) {
  const isActive = activeSection === id
  return (
    <button
      type="button"
      onClick={() => onScrollTo(id)}
      className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
        isActive ? 'bg-surface-2 text-fg' : 'text-fg-mute hover:text-fg-mute hover:bg-divider'
      }`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2.5 mb-0.5 transition-colors ${isActive ? 'bg-primary' : 'bg-fg-mute'}`} />
      {label}
    </button>
  )
}
