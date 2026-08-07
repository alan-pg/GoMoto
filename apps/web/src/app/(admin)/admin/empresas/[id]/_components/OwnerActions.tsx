'use client'

import { useState, useTransition } from 'react'
import { Link2, Copy, Check, KeyRound, Eye, EyeOff } from 'lucide-react'
import { regenerateOwnerLink, changeOwnerPassword } from '../../actions'

// ─── Gerar magic link ─────────────────────────────────────────────────────────

function LinkSection({ tenantId }: { tenantId: string }) {
  const [isPending, startTransition] = useTransition()
  const [link, setLink]     = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function handleGenerate() {
    setError(null)
    setLink(null)
    startTransition(async () => {
      const result = await regenerateOwnerLink(tenantId)
      if ('error' in result && result.error) {
        setError(result.error as string)
        return
      }
      setLink((result as { link: string | null }).link)
    })
  }

  async function handleCopy() {
    if (!link) return
    await navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          onClick={handleGenerate}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-2 text-fg-mute text-[13px] font-medium hover:bg-border hover:text-fg transition-colors disabled:opacity-50"
        >
          <Link2 className="w-3.5 h-3.5" />
          {isPending ? 'Gerando…' : 'Gerar link de acesso'}
        </button>
        <span className="text-[12px] text-fg-mute">Válido por 3 dias · magic link</span>
      </div>

      {error && <p className="text-[12px] text-danger">{error}</p>}

      {link && (
        <div className="flex items-center gap-2 p-2 bg-bg rounded-lg border border-divider">
          <p className="text-[12px] font-mono text-fg-mute truncate flex-1">{link}</p>
          <button
            onClick={handleCopy}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-surface-2 text-fg-mute text-[12px] hover:bg-border hover:text-fg transition-colors"
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-success" />
              : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Alterar senha ────────────────────────────────────────────────────────────

function PasswordSection({ tenantId }: { tenantId: string }) {
  const [isPending, startTransition] = useTransition()
  const [open, setOpen]         = useState(false)
  const [password, setPassword] = useState('')
  const [showPwd, setShowPwd]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [success, setSuccess]   = useState(false)

  function handleOpen() {
    setOpen(true)
    setPassword('')
    setError(null)
    setSuccess(false)
  }

  function handleCancel() {
    setOpen(false)
    setPassword('')
    setError(null)
  }

  function handleSave() {
    setError(null)
    startTransition(async () => {
      const result = await changeOwnerPassword(tenantId, password)
      if ('error' in result && result.error) {
        setError(result.error as string)
        return
      }
      setSuccess(true)
      setPassword('')
      setOpen(false)
      setTimeout(() => setSuccess(false), 3000)
    })
  }

  const remaining = Math.max(0, 8 - password.length)

  return (
    <div className="space-y-2">
      {!open ? (
        <div className="flex items-center gap-2">
          <button
            onClick={handleOpen}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-surface-2 text-fg-mute text-[13px] font-medium hover:bg-border hover:text-fg transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Alterar senha
          </button>
          {success && (
            <span className="inline-flex items-center gap-1 text-[12px] text-success">
              <Check className="w-3.5 h-3.5" /> Senha alterada com sucesso
            </span>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <input
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && !isPending && password.length >= 8 && handleSave()}
                placeholder="Nova senha (mín. 8 caracteres)"
                disabled={isPending}
                // eslint-disable-next-line jsx-a11y/no-autofocus
                autoFocus
                className="h-8 pl-3 pr-9 w-64 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-fg-mute hover:text-fg-mute transition-colors"
              >
                {showPwd
                  ? <EyeOff className="w-3.5 h-3.5" />
                  : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={isPending || password.length < 8}
              className="inline-flex items-center h-8 px-3 rounded-lg bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors disabled:opacity-40"
            >
              {isPending ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="inline-flex items-center h-8 px-3 rounded-lg bg-surface-2 text-fg-mute text-[13px] hover:bg-border hover:text-fg transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {password.length > 0 && remaining > 0 && (
            <p className="text-[12px] text-fg-mute">
              Faltam {remaining} caractere{remaining > 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Export principal ─────────────────────────────────────────────────────────

export function OwnerActions({ tenantId }: { tenantId: string }) {
  return (
    <div className="space-y-3">
      <LinkSection     tenantId={tenantId} />
      <div className="border-t border-divider" />
      <PasswordSection tenantId={tenantId} />
    </div>
  )
}
