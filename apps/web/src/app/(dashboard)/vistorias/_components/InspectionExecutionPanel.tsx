'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Camera, Check, Loader2, X } from 'lucide-react'
import { useSupabaseContext, useRequiredTenantId, useInspectionForExecution } from '@gomoto/data'
import { submitAdminInspection, approveInspection, rejectInspection } from '../actions'

const KIND_LABEL: Record<string, string> = {
  checkin: 'Check-in',
  checkout: 'Check-out',
  periodic: 'Vistoria periódica',
}

interface AnswerDraft {
  status: 'ok' | 'not_ok' | null
  note: string
}

interface PhotoDraft {
  storage_path: string | null
  previewUrl: string | null
  uploading: boolean
}

interface Props {
  inspectionId: string
  /** Chamado após salvar com sucesso — útil quando embutido em outra tela (ex.: locação). */
  onSaved?: () => void
}

export function InspectionExecutionPanel({ inspectionId, onSaved }: Props) {
  const router = useRouter()
  const qc = useQueryClient()
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const { data, isLoading, error: loadError } = useInspectionForExecution(inspectionId)

  // Invalida todas as queries de vistoria (execução, pendências, histórico,
  // comparação) — o hook desta tela é TanStack Query, não Server Component,
  // então router.refresh() sozinho não atualiza o cache e a tela ficava
  // "travada" no formulário mesmo após salvar com sucesso.
  function invalidateInspectionQueries() {
    qc.invalidateQueries({
      predicate: (query) => typeof query.queryKey[0] === 'string' && query.queryKey[0].includes('inspection'),
    })
  }

  const [answers, setAnswers] = useState<Record<string, AnswerDraft>>({})
  const [photos, setPhotos] = useState<Record<string, PhotoDraft>>({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [reviewing, setReviewing] = useState(false)
  const [showRejectReason, setShowRejectReason] = useState(false)
  const [rejectReason, setRejectReason] = useState('')

  useEffect(() => {
    if (!data) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const item of data.profile.checklist_items ?? []) {
        if (!next[item.id]) next[item.id] = { status: null, note: '' }
      }
      return next
    })
    setPhotos((prev) => {
      const next = { ...prev }
      for (const item of data.profile.photo_items ?? []) {
        if (!next[item.id]) next[item.id] = { storage_path: null, previewUrl: null, uploading: false }
      }
      return next
    })
  }, [data])

  const isReadOnly = data?.inspection.status !== 'pending'

  const readOnlyPhotoUrls = useReadOnlySignedUrls(data?.inspection.status === 'completed' ? data.inspection.photos : [])

  async function handlePhotoChange(itemId: string, file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setFormError('Use JPG, PNG ou WebP.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setFormError('Foto deve ter no máximo 10MB.')
      return
    }
    setFormError(null)
    setPhotos((prev) => ({ ...prev, [itemId]: { ...prev[itemId], uploading: true } }))

    const tenantId = getTenantId()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${tenantId}/${inspectionId}/${itemId}.${ext}`

    const { error } = await supabase.storage.from('inspection-photos').upload(path, file, {
      contentType: file.type,
      upsert: true,
    })
    if (error) {
      setFormError(`Erro no upload: ${error.message}`)
      setPhotos((prev) => ({ ...prev, [itemId]: { ...prev[itemId], uploading: false } }))
      return
    }

    const previewUrl = URL.createObjectURL(file)
    setPhotos((prev) => ({ ...prev, [itemId]: { storage_path: path, previewUrl, uploading: false } }))
  }

  async function handleSubmit() {
    if (!data) return
    setFormError(null)

    const checklistItems = data.profile.checklist_items ?? []
    const photoItems = data.profile.photo_items ?? []

    for (const item of checklistItems) {
      if (!answers[item.id]?.status) {
        setFormError(`Responda o item "${item.name}".`)
        return
      }
    }
    const missingRequired = photoItems.find((item) => item.is_required && !photos[item.id]?.storage_path)
    if (missingRequired) {
      setFormError(`Foto obrigatória ausente: ${missingRequired.label}`)
      return
    }

    setSubmitting(true)
    try {
      const payload = {
        answers: checklistItems.map((item) => ({
          item_id: item.id,
          status: answers[item.id].status as 'ok' | 'not_ok',
          note: answers[item.id].note.trim() || undefined,
        })),
        photos: photoItems
          .filter((item) => photos[item.id]?.storage_path)
          .map((item) => ({ item_id: item.id, storage_path: photos[item.id].storage_path as string })),
      }
      const res = await submitAdminInspection(inspectionId, payload)
      if (!res.ok) { setFormError(res.error.message); return }
      onSaved?.()
      invalidateInspectionQueries()
      router.refresh()
    } finally {
      setSubmitting(false)
    }
  }

  async function handleApprove() {
    setFormError(null)
    setReviewing(true)
    try {
      const res = await approveInspection(inspectionId)
      if (!res.ok) { setFormError(res.error.message); return }
      invalidateInspectionQueries()
      router.refresh()
    } finally {
      setReviewing(false)
    }
  }

  async function handleReject() {
    setFormError(null)
    if (!rejectReason.trim()) { setFormError('Informe o motivo da rejeição.'); return }
    setReviewing(true)
    try {
      const res = await rejectInspection(inspectionId, { review_notes: rejectReason.trim() })
      if (!res.ok) { setFormError(res.error.message); return }
      invalidateInspectionQueries()
      router.refresh()
    } finally {
      setReviewing(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="w-6 h-6 text-[#BAFF1A] animate-spin" />
      </div>
    )
  }
  if (loadError || !data) {
    return <p className="text-[13px] text-[#ff9c9a] py-8 text-center">Vistoria não encontrada.</p>
  }

  const { inspection, profile } = data

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-7 items-center rounded-full bg-[#323232] px-3 text-[13px] font-medium text-[#f5f5f5]">
          {KIND_LABEL[inspection.kind] ?? inspection.kind}
        </span>
        <span className="text-[13px] text-[#9e9e9e]">Perfil: {profile.name}</span>
      </div>

      {isReadOnly && inspection.status === 'completed' && (
        <div className="rounded-xl bg-[#0e2f13] border border-[#229731] px-4 py-3">
          <p className="text-[13px] text-[#229731] font-medium">
            Vistoria registrada em {inspection.executed_at ? new Date(inspection.executed_at).toLocaleString('pt-BR') : '—'}
          </p>
        </div>
      )}

      {/* ── Checklist ─────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[13px] font-bold text-[#9e9e9e] uppercase tracking-wide">Checklist</h3>
        {(isReadOnly ? inspection.answers : profile.checklist_items ?? []).map((raw) => {
          const isRO = isReadOnly
          const item = isRO ? { id: (raw as { item_id: string }).item_id, name: (raw as { name: string }).name } : (raw as { id: string; name: string })
          const draft = answers[item.id]
          const roAnswer = isRO ? (raw as { status: 'ok' | 'not_ok'; note?: string }) : null
          return (
            <div key={item.id} className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 space-y-2">
              <p className="text-[13px] text-[#f5f5f5] font-medium">{item.name}</p>
              {isRO ? (
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[11px] font-semibold ${
                    roAnswer?.status === 'ok' ? 'bg-[#0e2f13] text-[#229731]' : 'bg-[#7c1c1c] text-[#ff9c9a]'
                  }`}>
                    {roAnswer?.status === 'ok' ? 'OK' : 'Não OK'}
                  </span>
                  {roAnswer?.note && <span className="text-[12px] text-[#9e9e9e]">{roAnswer.note}</span>}
                </div>
              ) : (
                <>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: 'ok' } }))}
                      className={`h-11 px-4 rounded-full text-[12px] font-semibold transition-colors ${
                        draft?.status === 'ok' ? 'bg-[#229731] text-[#0e2f13]' : 'bg-[#282828] text-[#9e9e9e] hover:text-[#f5f5f5]'
                      }`}
                    >
                      OK
                    </button>
                    <button
                      type="button"
                      onClick={() => setAnswers((prev) => ({ ...prev, [item.id]: { ...prev[item.id], status: 'not_ok' } }))}
                      className={`h-11 px-4 rounded-full text-[12px] font-semibold transition-colors ${
                        draft?.status === 'not_ok' ? 'bg-[#ff9c9a] text-[#7c1c1c]' : 'bg-[#282828] text-[#9e9e9e] hover:text-[#f5f5f5]'
                      }`}
                    >
                      Não OK
                    </button>
                  </div>
                  <input
                    placeholder="Observação (opcional)"
                    value={draft?.note ?? ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [item.id]: { ...prev[item.id], note: e.target.value } }))}
                    maxLength={1000}
                    className="w-full h-8 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[12px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all"
                  />
                </>
              )}
            </div>
          )
        })}
      </section>

      {/* ── Fotos ─────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-[13px] font-bold text-[#9e9e9e] uppercase tracking-wide">Fotos</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {isReadOnly
            ? inspection.photos.map((p) => (
                <div key={p.item_id} className="space-y-1.5">
                  <div className="aspect-square rounded-lg bg-[#202020] border border-[#323232] overflow-hidden flex items-center justify-center">
                    {readOnlyPhotoUrls[p.storage_path] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={readOnlyPhotoUrls[p.storage_path]} alt={p.label} className="w-full h-full object-cover" />
                    ) : (
                      <Loader2 className="w-4 h-4 text-[#616161] animate-spin" />
                    )}
                  </div>
                  <p className="text-[11px] text-[#9e9e9e] truncate">{p.label}</p>
                </div>
              ))
            : (profile.photo_items ?? []).map((item) => {
                const draft = photos[item.id]
                return (
                  <div key={item.id} className="space-y-1.5">
                    <label className="relative aspect-square rounded-lg bg-[#202020] border border-dashed border-[#474747] overflow-hidden flex items-center justify-center cursor-pointer hover:border-[#BAFF1A] transition-colors block">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handlePhotoChange(item.id, file)
                        }}
                      />
                      {draft?.uploading ? (
                        <Loader2 className="w-5 h-5 text-[#BAFF1A] animate-spin" />
                      ) : draft?.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={draft.previewUrl} alt={item.label} className="w-full h-full object-cover" />
                      ) : (
                        <Camera className="w-5 h-5 text-[#616161]" />
                      )}
                      {draft?.storage_path && !draft.uploading && (
                        <span className="absolute top-1 right-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-[#229731]">
                          <Check className="w-2.5 h-2.5 text-[#0e2f13]" />
                        </span>
                      )}
                    </label>
                    <p className="text-[11px] text-[#9e9e9e] truncate">
                      {item.label} {item.is_required && <span className="text-[#ff9c9a]">*</span>}
                    </p>
                  </div>
                )
              })}
        </div>
      </section>

      {/* ── Análise (vistoria periódica submetida) ───────────────────────── */}
      {inspection.kind === 'periodic' && inspection.status === 'submitted' && (
        <section className="rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] p-4 space-y-3">
          <h3 className="text-[13px] font-bold text-[#f5f5f5]">Análise</h3>
          {!showRejectReason ? (
            <div className="flex gap-2">
              <button
                type="button"
                disabled={reviewing}
                onClick={handleApprove}
                className="h-9 px-5 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e616] transition-colors disabled:opacity-60"
              >
                {reviewing ? 'Aprovando…' : 'Aprovar'}
              </button>
              <button
                type="button"
                disabled={reviewing}
                onClick={() => setShowRejectReason(true)}
                className="h-9 px-5 rounded-full border border-[#7c1c1c] text-[13px] text-[#ff9c9a] hover:bg-[#7c1c1c]/30 transition-colors"
              >
                Rejeitar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                placeholder="Motivo da rejeição (obrigatório)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                maxLength={1000}
                className="w-full h-20 px-3 py-2 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all resize-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={reviewing}
                  onClick={handleReject}
                  className="h-9 px-5 rounded-full bg-[#ff9c9a] text-[#7c1c1c] text-[13px] font-bold hover:bg-[#ffb3b1] transition-colors disabled:opacity-60"
                >
                  {reviewing ? 'Rejeitando…' : 'Confirmar rejeição'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowRejectReason(false); setRejectReason('') }}
                  className="h-9 px-4 rounded-full border border-[#474747] text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors inline-flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" /> Cancelar
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {inspection.status === 'approved' && (
        <div className="rounded-xl bg-[#0e2f13] border border-[#229731] px-4 py-3">
          <p className="text-[13px] text-[#229731] font-medium">Vistoria aprovada.</p>
        </div>
      )}
      {inspection.status === 'rejected' && (
        <div className="rounded-xl bg-[#7c1c1c] border border-[#ff9c9a]/30 px-4 py-3">
          <p className="text-[13px] text-[#ff9c9a] font-medium">Vistoria rejeitada</p>
          {inspection.review_notes && <p className="text-[12px] text-[#ff9c9a] mt-1">{inspection.review_notes}</p>}
        </div>
      )}

      {formError && (
        <div className="flex items-start gap-3 px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a]/30 rounded-xl">
          <AlertCircle className="w-4 h-4 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
          <p className="text-[13px] text-[#ff9c9a]">{formError}</p>
        </div>
      )}

      {!isReadOnly && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="h-11 px-6 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e616] transition-colors disabled:opacity-60"
          >
            {submitting ? 'Salvando…' : 'Salvar vistoria'}
          </button>
        </div>
      )}
    </div>
  )
}

/** Gera signed URLs (1h) para as fotos de uma vistoria já concluída/submetida. */
function useReadOnlySignedUrls(photos: { storage_path: string }[]): Record<string, string> {
  const supabase = useSupabaseContext()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const paths = useMemo(() => photos.map((p) => p.storage_path).join(','), [photos])

  useEffect(() => {
    if (!paths) return
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        paths.split(',').map(async (path) => {
          const { data } = await supabase.storage.from('inspection-photos').createSignedUrl(path, 3600)
          return [path, data?.signedUrl ?? ''] as const
        }),
      )
      if (!cancelled) setUrls(Object.fromEntries(entries))
    })()
    return () => { cancelled = true }
  }, [paths, supabase])

  return urls
}
