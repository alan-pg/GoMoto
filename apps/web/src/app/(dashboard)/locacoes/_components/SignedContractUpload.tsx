'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Upload, FileText, AlertCircle } from 'lucide-react'
import { useSupabaseContext, useRequiredTenantId } from '@gomoto/data'
import { attachSignedContract } from '../actions'

const BUCKET = 'rental-documents'

interface Props {
  rentalId: string
  currentFileName?: string | null
  signedUrl?: string | null
}

export function SignedContractUpload({ rentalId, currentFileName, signedUrl }: Props) {
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const router = useRouter()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null)

    if (file.type !== 'application/pdf') {
      setError('Envie um arquivo PDF.')
      return
    }

    setUploading(true)
    try {
      const tenantId = getTenantId()
      const path = `${tenantId}/${rentalId}/${Date.now()}.pdf`
      const { error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, file, { upsert: true, contentType: file.type })
      if (uploadErr) {
        setError(`Upload falhou: ${uploadErr.message}`)
        return
      }

      const result = await attachSignedContract({ lease_id: rentalId, storage_path: path, file_name: file.name })
      if (!result.ok) {
        setError(result.error.message)
        return
      }
      router.refresh()
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="rounded-xl bg-surface p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 shrink-0 text-fg-mute" />
          {signedUrl && currentFileName ? (
            <a
              href={signedUrl}
              target="_blank"
              rel="noreferrer"
              className="truncate text-[13px] text-primary hover:underline"
            >
              {currentFileName}
            </a>
          ) : (
            <p className="text-[13px] text-fg-mute">Nenhum contrato assinado anexado</p>
          )}
        </div>
        <label className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-border px-4 text-[13px] text-fg transition-colors hover:border-primary hover:text-primary">
          <Upload className="h-3.5 w-3.5" />
          {uploading ? 'Enviando…' : currentFileName ? 'Trocar' : 'Anexar assinado'}
          <input type="file" accept="application/pdf" className="hidden" disabled={uploading} onChange={handleFileChange} />
        </label>
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}
