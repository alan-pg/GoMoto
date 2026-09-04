'use client'

import { useState, useRef } from 'react'
import { Upload, Trash2, FileText, ExternalLink, AlertCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useSupabaseContext, useRequiredTenantId } from '@gomoto/data'
import { addFineAttachment, deleteFineAttachment } from '../../actions'

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type AttachmentType =
  | 'ait'
  | 'nip'
  | 'payment_slip'
  | 'payment_receipt'
  | 'appeal'
  | 'appeal_decision'
  | 'driver_indication'
  | 'other'

export const ATTACHMENT_TYPE_LABELS: Record<AttachmentType, string> = {
  ait:               'NA — Notificação de Autuação',
  nip:               'NP — Notificação de Penalidade',
  payment_slip:      'Boleto',
  payment_receipt:   'Comprovante de Pagamento',
  appeal:            'Recurso / Defesa Prévia',
  appeal_decision:   'Decisão do Recurso',
  driver_indication: 'Indicação de Condutor',
  other:             'Outro',
}

const ATTACHMENT_TYPE_HINT: Record<AttachmentType, string> = {
  ait:               'Documento que abre a multa — sempre existe, traz o prazo de defesa prévia e o de identificação do condutor',
  nip:               'Chega depois da NA, só se a responsabilidade não passar pro condutor — traz o prazo de recurso e o vencimento com desconto',
  payment_slip:      'Boleto/guia com código de barras para pagar a multa',
  payment_receipt:   'Comprovante de quitação — guarda para contabilidade e processos',
  appeal:            'Petição de recurso ou defesa prévia enviada ao órgão',
  appeal_decision:   'Resposta do órgão ao recurso (deferido ou indeferido)',
  driver_indication: 'Obrigatório quando o veículo é da empresa — transfere pontos ao condutor',
  other:             'Documentos de suporte adicionais',
}

export interface FineAttachment {
  id: string
  fine_id: string
  type: AttachmentType
  label: string | null
  file_url: string
  notes: string | null
  created_at: string
  signedUrl?: string
}

interface Props {
  fineId: string
  attachments: FineAttachment[]
  /** RF-010: calculado server-side via `isDriverUnidentified` (@gomoto/core). */
  driverUnidentified?: boolean
}

const UPLOAD_TYPES: AttachmentType[] = [
  'ait', 'nip', 'payment_slip', 'payment_receipt', 'appeal', 'appeal_decision', 'driver_indication', 'other',
]

// ─── FineAttachments ──────────────────────────────────────────────────────────

export function FineAttachments({ fineId, attachments: initial, driverUnidentified }: Props) {
  const router       = useRouter()
  const supabase     = useSupabaseContext()
  const getTenantId  = useRequiredTenantId()

  const [attachments, setAttachments] = useState<FineAttachment[]>(initial)
  const [uploadType,  setUploadType]  = useState<AttachmentType>('ait')
  const [uploadLabel, setUploadLabel] = useState('')
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploading,   setUploading]   = useState(false)
  const [deleting,    setDeleting]    = useState<string | null>(null)
  const [error,       setError]       = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleUpload(file: File) {
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Use PDF, JPG, PNG ou WebP.')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Arquivo deve ter no máximo 10MB.')
      return
    }

    setError(null)
    setUploading(true)
    try {
      const tenantId = getTenantId()
      const ext  = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      const path = `${tenantId}/${fineId}/${uploadType}/${Date.now()}.${ext}`

      const { error: storageError } = await supabase.storage
        .from('fine-documents')
        .upload(path, file, { contentType: file.type })

      if (storageError) {
        setError(`Erro no upload: ${storageError.message}`)
        return
      }

      const result = await addFineAttachment(
        fineId,
        uploadType,
        path,
        uploadLabel || undefined,
        uploadNotes || undefined,
      )

      if ('error' in result) {
        await supabase.storage.from('fine-documents').remove([path])
        setError(result.error ?? 'Erro desconhecido')
        return
      }

      // Gera URL assinada para exibir imediatamente sem reload
      const { data: signed } = await supabase.storage
        .from('fine-documents')
        .createSignedUrl(path, 3600)

      setAttachments((prev) => [
        ...prev,
        { ...result.data, signedUrl: signed?.signedUrl ?? undefined } as FineAttachment,
      ])
      setUploadLabel('')
      setUploadNotes('')
      if (fileInputRef.current) fileInputRef.current.value = ''
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(att: FineAttachment) {
    setDeleting(att.id)
    try {
      const result = await deleteFineAttachment(att.id, fineId, att.file_url)
      if ('error' in result) { setError(result.error ?? 'Erro ao remover'); return }
      setAttachments((prev) => prev.filter((a) => a.id !== att.id))
      router.refresh()
    } finally {
      setDeleting(null)
    }
  }

  // Agrupa anexos por tipo
  const byType = UPLOAD_TYPES.reduce<Record<AttachmentType, FineAttachment[]>>(
    (acc, t) => ({ ...acc, [t]: attachments.filter((a) => a.type === t) }),
    {} as Record<AttachmentType, FineAttachment[]>,
  )
  const hasAny = attachments.length > 0

  return (
    <div className="space-y-5">

      {/* ── Badge: condutor não identificado (RF-010) ────────────────────── */}
      {driverUnidentified && (
        <div className="flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger rounded-xl">
          <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
          <p className="text-[13px] text-danger">
            Condutor não identificado — prazo em aberto. Registre a indicação de condutor (anexo abaixo) a qualquer momento.
          </p>
        </div>
      )}

      {/* ── Upload ────────────────────────────────────────────────────────── */}
      <div className="bg-surface border border-border rounded-xl p-4 space-y-3">
        <p className="text-[13px] font-bold text-fg">Adicionar documento</p>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-fg-mute mb-1.5">Tipo</label>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value as AttachmentType)}
              className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg outline-none focus:border-primary transition-all"
            >
              {UPLOAD_TYPES.map((t) => (
                <option key={t} value={t}>{ATTACHMENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <p className="text-[11px] text-fg-mute mt-1">{ATTACHMENT_TYPE_HINT[uploadType]}</p>
          </div>
          <div>
            <label className="block text-[12px] text-fg-mute mb-1.5">Rótulo (opcional)</label>
            <input
              className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all"
              placeholder="Ex.: NIP recebida em 02/07"
              value={uploadLabel}
              onChange={(e) => setUploadLabel(e.target.value)}
              maxLength={200}
            />
          </div>
        </div>

        <div>
          <label className="block text-[12px] text-fg-mute mb-1.5">Observações (opcional)</label>
          <input
            className="w-full h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all"
            placeholder="Prazo, número de protocolo..."
            value={uploadNotes}
            onChange={(e) => setUploadNotes(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <label className={`inline-flex items-center gap-2 h-9 px-4 rounded-full border text-[13px] font-medium cursor-pointer transition-colors ${
            uploading
              ? 'border-border text-fg-mute pointer-events-none'
              : 'border-border text-fg-mute hover:border-primary hover:text-primary'
          }`}>
            <Upload className="w-3.5 h-3.5" />
            {uploading ? 'Enviando…' : 'Selecionar arquivo'}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleUpload(file)
              }}
            />
          </label>
          <span className="text-[12px] text-fg-mute">PDF, JPG, PNG ou WebP · máx. 10MB</span>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-[12px] text-danger">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>

      {/* ── Lista por tipo ────────────────────────────────────────────────── */}
      {!hasAny ? (
        <p className="text-[13px] text-fg-mute text-center py-4">
          Nenhum documento anexado ainda.
        </p>
      ) : (
        <div className="space-y-2">
          {UPLOAD_TYPES.filter((t) => byType[t].length > 0).map((type) => (
            <div key={type} className="bg-surface rounded-xl overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border">
                <span className="text-[12px] font-bold text-fg-mute uppercase tracking-wide">
                  {ATTACHMENT_TYPE_LABELS[type]}
                </span>
              </div>
              {byType[type].map((att) => (
                <div key={att.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-border last:border-0 hover:bg-divider transition-colors">
                  <FileText className="w-4 h-4 text-fg-mute flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-fg truncate">
                      {att.label || att.file_url.split('/').pop()}
                    </p>
                    {att.notes && (
                      <p className="text-[11px] text-fg-mute truncate">{att.notes}</p>
                    )}
                    <p className="text-[11px] text-border">
                      {new Date(att.created_at).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {att.signedUrl && (
                      <a
                        href={att.signedUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-fg-mute hover:text-primary transition-colors"
                        title="Abrir arquivo"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                    <button
                      onClick={() => void handleDelete(att)}
                      disabled={deleting === att.id}
                      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-fg-mute hover:text-danger hover:bg-danger-bg transition-colors disabled:opacity-40"
                      title="Remover"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
