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
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#323232] text-[#9e9e9e] text-[13px] font-medium hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors disabled:opacity-50"
        >
          <Link2 className="w-3.5 h-3.5" />
          {isPending ? 'Gerando…' : 'Gerar link de acesso'}
        </button>
        <span className="text-[12px] text-[#616161]">Válido por 3 dias · magic link</span>
      </div>

      {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}

      {link && (
        <div className="flex items-center gap-2 p-2 bg-[#121212] rounded-lg border border-[#323232]">
          <p className="text-[12px] font-mono text-[#9e9e9e] truncate flex-1">{link}</p>
          <button
            onClick={handleCopy}
            className="shrink-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-[#323232] text-[#9e9e9e] text-[12px] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
          >
            {copied
              ? <Check className="w-3.5 h-3.5 text-[#229731]" />
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
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg bg-[#323232] text-[#9e9e9e] text-[13px] font-medium hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" />
            Alterar senha
          </button>
          {success && (
            <span className="inline-flex items-center gap-1 text-[12px] text-[#229731]">
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
                className="h-8 pl-3 pr-9 w-64 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                tabIndex={-1}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#616161] hover:text-[#9e9e9e] transition-colors"
              >
                {showPwd
                  ? <EyeOff className="w-3.5 h-3.5" />
                  : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <button
              onClick={handleSave}
              disabled={isPending || password.length < 8}
              className="inline-flex items-center h-8 px-3 rounded-lg bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e818] transition-colors disabled:opacity-40"
            >
              {isPending ? 'Salvando…' : 'Salvar'}
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="inline-flex items-center h-8 px-3 rounded-lg bg-[#323232] text-[#9e9e9e] text-[13px] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
          {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}
          {password.length > 0 && remaining > 0 && (
            <p className="text-[12px] text-[#616161]">
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
      <div className="border-t border-[#323232]" />
      <PasswordSection tenantId={tenantId} />
    </div>
  )
}
