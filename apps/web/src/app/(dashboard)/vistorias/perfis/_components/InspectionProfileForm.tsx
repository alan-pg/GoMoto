'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { Plus, Trash2, AlertCircle, Archive, ArchiveRestore } from 'lucide-react'
import type { InspectionProfile } from '@gomoto/core'
import {
  createInspectionProfile,
  updateInspectionProfile,
  archiveInspectionProfile,
  unarchiveInspectionProfile,
} from '../actions'

// ─── Types ───────────────────────────────────────────────────────────────────

type ChecklistDraft = { key: string; name: string }
type PhotoDraft = { key: string; label: string; is_required: boolean }

function newDraftKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const inputCls =
  'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] text-[#9e9e9e] mb-1.5">
        {label}
        {hint && <span className="ml-1.5 text-[12px] text-[#616161]">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface InspectionProfileFormProps {
  profileId?: string
  initialProfile?: InspectionProfile
}

export function InspectionProfileForm({ profileId, initialProfile }: InspectionProfileFormProps) {
  const isEditMode = !!profileId
  const isArchived = (initialProfile?.archived_at ?? null) !== null
  const router = useRouter()
  const qc = useQueryClient()
  const [isPending, startTransition] = useTransition()

  const [name, setName] = useState(initialProfile?.name ?? '')
  const [description, setDescription] = useState(initialProfile?.description ?? '')
  const [checklistItems, setChecklistItems] = useState<ChecklistDraft[]>(() =>
    initialProfile?.checklist_items && initialProfile.checklist_items.length > 0
      ? initialProfile.checklist_items.map((i) => ({ key: i.id, name: i.name }))
      : [{ key: newDraftKey(), name: '' }],
  )
  const [photoItems, setPhotoItems] = useState<PhotoDraft[]>(() =>
    initialProfile?.photo_items && initialProfile.photo_items.length > 0
      ? initialProfile.photo_items.map((i) => ({ key: i.id, label: i.label, is_required: i.is_required }))
      : [{ key: newDraftKey(), label: '', is_required: true }],
  )
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  function addChecklistItem() {
    setChecklistItems((prev) => [...prev, { key: newDraftKey(), name: '' }])
  }
  function removeChecklistItem(key: string) {
    setChecklistItems((prev) => {
      const next = prev.filter((i) => i.key !== key)
      return next.length > 0 ? next : [{ key: newDraftKey(), name: '' }]
    })
  }
  function updateChecklistItem(key: string, name: string) {
    setChecklistItems((prev) => prev.map((i) => (i.key === key ? { ...i, name } : i)))
  }

  function addPhotoItem() {
    setPhotoItems((prev) => [...prev, { key: newDraftKey(), label: '', is_required: true }])
  }
  function removePhotoItem(key: string) {
    setPhotoItems((prev) => {
      const next = prev.filter((i) => i.key !== key)
      return next.length > 0 ? next : [{ key: newDraftKey(), label: '', is_required: true }]
    })
  }
  function updatePhotoItem(key: string, patch: Partial<PhotoDraft>) {
    setPhotoItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)

    const trimmedName = name.trim()
    if (!trimmedName) { setGlobalError('Nome do perfil é obrigatório.'); return }

    const validChecklist = checklistItems
      .map((i, idx) => ({ name: i.name.trim(), sort_order: idx }))
      .filter((i) => i.name.length > 0)
    if (validChecklist.length === 0) { setGlobalError('Adicione ao menos um item de checklist.'); return }

    const validPhotos = photoItems
      .map((i, idx) => ({ label: i.label.trim(), is_required: i.is_required, sort_order: idx }))
      .filter((i) => i.label.length > 0)
    if (validPhotos.length === 0) { setGlobalError('Adicione ao menos um item de imagem.'); return }

    startTransition(async () => {
      const payload = {
        name: trimmedName,
        description: description.trim() || null,
        checklist_items: validChecklist,
        photo_items: validPhotos,
      }

      if (isEditMode) {
        const res = await updateInspectionProfile(profileId!, payload)
        if (!res.ok) { setGlobalError(res.error.message); return }
        qc.invalidateQueries({ queryKey: ['inspection-profiles'] })
        router.push('/vistorias/perfis')
      } else {
        const res = await createInspectionProfile(payload)
        if (!res.ok) { setGlobalError(res.error.message); return }
        qc.invalidateQueries({ queryKey: ['inspection-profiles'] })
        router.push('/vistorias/perfis')
      }
    })
  }

  async function handleArchive() {
    if (!profileId) return
    setArchiving(true)
    try {
      const res = await archiveInspectionProfile(profileId)
      if (!res.ok) { setGlobalError(res.error.message); return }
      qc.invalidateQueries({ queryKey: ['inspection-profiles'] })
      router.push('/vistorias/perfis')
    } finally { setArchiving(false) }
  }

  async function handleUnarchive() {
    if (!profileId) return
    setArchiving(true)
    try {
      const res = await unarchiveInspectionProfile(profileId)
      if (!res.ok) { setGlobalError(res.error.message); return }
      qc.invalidateQueries({ queryKey: ['inspection-profiles'] })
      router.refresh()
    } finally { setArchiving(false) }
  }

  return (
    <div className="min-h-screen bg-[#121212]">
      <div className="sticky top-0 z-20 bg-[#121212]/95 backdrop-blur border-b border-[#2a2a2a] px-6 h-14 flex items-center gap-3">
        <Link href="/vistorias/perfis" className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors whitespace-nowrap">
          ← Perfis de Vistoria
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="text-[15px] font-bold text-[#f5f5f5] flex-1 truncate">
          {isEditMode ? 'Editar perfil' : 'Novo Perfil de Vistoria'}
        </h1>
        <button
          type="submit"
          form="inspection-profile-form"
          disabled={isPending}
          className="h-8 px-5 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e616] transition-colors disabled:opacity-60"
        >
          {isPending ? 'Salvando…' : isEditMode ? 'Salvar' : 'Criar perfil'}
        </button>
      </div>

      <form
        id="inspection-profile-form"
        onSubmit={handleSubmit}
        className="max-w-3xl mx-auto px-6 py-8 space-y-10"
      >
        {/* ══ Identificação ═════════════════════════════════════════════ */}
        <section>
          <h2 className="text-[15px] font-bold text-[#f5f5f5] mb-5">Identificação</h2>
          <div className="space-y-4">
            <Field label="Nome do perfil *">
              <input
                className={inputCls}
                placeholder="Ex.: Perfil Padrão Motocicleta"
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
                placeholder="Quando usar este perfil, particularidades..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
              />
            </Field>
          </div>
        </section>

        {/* ══ Itens de checklist ════════════════════════════════════════ */}
        <section>
          <h2 className="text-[15px] font-bold text-[#f5f5f5] mb-5">
            Itens de checklist
            <span className="ml-2 text-[12px] font-normal text-[#616161]">respondidos como OK / Não OK na execução</span>
          </h2>
          <div className="space-y-2">
            {checklistItems.map((item, idx) => (
              <div key={item.key} className="flex items-center gap-2">
                <span className="text-[11px] text-[#474747] font-mono w-5 text-center flex-shrink-0">{idx + 1}</span>
                <input
                  placeholder="Ex.: Faróis funcionando"
                  value={item.name}
                  onChange={(e) => updateChecklistItem(item.key, e.target.value)}
                  maxLength={200}
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => removeChecklistItem(item.key)}
                  className="flex-shrink-0 h-8 w-8 rounded-md text-[#616161] hover:bg-[#7c1c1c]/30 hover:text-[#ff9c9a] transition-colors flex items-center justify-center"
                  title="Remover item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addChecklistItem}
            className="mt-3 flex items-center justify-center gap-2 w-full h-10 rounded-xl border border-dashed border-[#474747] text-[13px] text-[#616161] hover:border-[#BAFF1A] hover:text-[#BAFF1A] transition-colors"
          >
            <Plus className="w-4 h-4" /> Adicionar item de checklist
          </button>
        </section>

        {/* ══ Itens de imagem ═══════════════════════════════════════════ */}
        <section>
          <h2 className="text-[15px] font-bold text-[#f5f5f5] mb-5">
            Itens de imagem
            <span className="ml-2 text-[12px] font-normal text-[#616161]">fotos exigidas na execução</span>
          </h2>
          <div className="space-y-2">
            {photoItems.map((item, idx) => (
              <div key={item.key} className="flex items-center gap-2">
                <span className="text-[11px] text-[#474747] font-mono w-5 text-center flex-shrink-0">{idx + 1}</span>
                <input
                  placeholder="Ex.: Frente, Lateral Esquerda, Painel/Odômetro"
                  value={item.label}
                  onChange={(e) => updatePhotoItem(item.key, { label: e.target.value })}
                  maxLength={100}
                  className={inputCls}
                />
                <label className="flex items-center gap-1.5 flex-shrink-0 cursor-pointer h-9 px-2">
                  <input
                    type="checkbox"
                    checked={item.is_required}
                    onChange={(e) => updatePhotoItem(item.key, { is_required: e.target.checked })}
                    className="accent-[#BAFF1A]"
                  />
                  <span className="text-[12px] text-[#9e9e9e] whitespace-nowrap">Obrigatória</span>
                </label>
                <button
                  type="button"
                  onClick={() => removePhotoItem(item.key)}
                  className="flex-shrink-0 h-8 w-8 rounded-md text-[#616161] hover:bg-[#7c1c1c]/30 hover:text-[#ff9c9a] transition-colors flex items-center justify-center"
                  title="Remover item"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addPhotoItem}
            className="mt-3 flex items-center justify-center gap-2 w-full h-10 rounded-xl border border-dashed border-[#474747] text-[13px] text-[#616161] hover:border-[#BAFF1A] hover:text-[#BAFF1A] transition-colors"
          >
            <Plus className="w-4 h-4" /> Adicionar item de imagem
          </button>
        </section>

        {/* ══ Arquivar / Reativar (edição) ═══════════════════════════════ */}
        {isEditMode && (
          <section className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4">
            {isArchived ? (
              <div className="flex items-start gap-3">
                <ArchiveRestore className="h-4 w-4 text-[#9e9e9e] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[13px] text-[#f5f5f5] font-medium mb-1">Perfil arquivado</p>
                  <p className="text-[12px] text-[#616161] mb-3">
                    Locações que já usam este perfil continuam válidas — ele só some do seletor de novas associações.
                  </p>
                  <button
                    type="button"
                    disabled={archiving}
                    onClick={handleUnarchive}
                    className="h-8 px-4 rounded-full border border-[#474747] text-[13px] text-[#f5f5f5] hover:border-[#BAFF1A] hover:text-[#BAFF1A] transition-colors disabled:opacity-50"
                  >
                    {archiving ? 'Reativando…' : 'Reativar perfil'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <Archive className="h-4 w-4 text-[#9e9e9e] flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-[13px] text-[#f5f5f5] font-medium mb-1">Arquivar perfil</p>
                  <p className="text-[12px] text-[#616161] mb-3">
                    Remove da seleção de novas associações. Locações que já usam este perfil não são afetadas.
                  </p>
                  <button
                    type="button"
                    disabled={archiving}
                    onClick={handleArchive}
                    className="h-8 px-4 rounded-full border border-[#7c1c1c] text-[13px] text-[#ff9c9a] hover:bg-[#7c1c1c]/30 transition-colors disabled:opacity-50"
                  >
                    {archiving ? 'Arquivando…' : 'Arquivar perfil'}
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {globalError && (
          <div className="flex items-start gap-3 px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a]/30 rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
            <p className="text-[13px] text-[#ff9c9a]">{globalError}</p>
          </div>
        )}

        <div className="flex gap-3 justify-end pt-4 pb-16 border-t border-[#2a2a2a]">
          <Link
            href="/vistorias/perfis"
            className="inline-flex items-center h-9 px-5 rounded-full border border-[#474747] text-[#9e9e9e] text-[13px] font-medium hover:text-[#f5f5f5] hover:border-[#616161] transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="h-9 px-6 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e616] transition-colors disabled:opacity-60"
          >
            {isPending ? 'Salvando…' : isEditMode ? 'Salvar alterações' : 'Criar perfil'}
          </button>
        </div>
      </form>
    </div>
  )
}
