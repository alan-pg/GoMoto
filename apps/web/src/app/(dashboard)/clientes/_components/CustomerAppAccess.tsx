'use client'

import { useState } from 'react'
import { Smartphone, CheckCircle2, Eye, EyeOff } from 'lucide-react'
import { inviteCustomerToApp, setCustomerPassword, resetCustomerPassword } from '../actions'

interface Props {
  customerId: string
  customerEmail?: string | null
  hasAppAccess: boolean
}

export function CustomerAppAccess({ customerId, customerEmail, hasAppAccess }: Props) {
  const [mode, setMode] = useState<'idle' | 'password'>('idle')
  const [passwordValue, setPasswordValue] = useState('')
  const [showPasswordText, setShowPasswordText] = useState(false)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleInvite() {
    setLoading(true)
    const result = await inviteCustomerToApp(customerId)
    if (result.error) { alert(`Erro: ${result.error}`) }
    else if (result.link) { setGeneratedLink(result.link) }
    setLoading(false)
  }

  async function handleSetPassword() {
    if (passwordValue.length < 8) { alert('A senha precisa ter ao menos 8 caracteres.'); return }
    setLoading(true)
    const result = await setCustomerPassword(customerId, passwordValue)
    if (result.error) { alert(`Erro: ${result.error}`) }
    else {
      alert('Senha definida com sucesso. O cliente já pode acessar o app.')
      setMode('idle')
      setPasswordValue('')
    }
    setLoading(false)
  }

  async function handleResetPassword() {
    setLoading(true)
    const result = await resetCustomerPassword(customerId)
    if (result.error) { alert(`Erro: ${result.error}`) }
    else if (result.link) { setGeneratedLink(result.link) }
    setLoading(false)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-3">
        <Smartphone className="h-4 w-4 text-[#BAFF1A]" />
        <h2 className="text-[14px] font-bold text-[#BAFF1A]">Acesso ao App</h2>
      </div>

      {!customerEmail ? (
        <p className="text-[13px] text-[#9e9e9e]">
          Cadastre um email para liberar o acesso ao app mobile.
        </p>
      ) : hasAppAccess ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-[13px] text-[#4ade80]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>Cliente tem acesso ao app mobile.</span>
          </div>
          {mode === 'password' ? (
            <PasswordForm
              value={passwordValue}
              showText={showPasswordText}
              loading={loading}
              onChangeValue={setPasswordValue}
              onToggleShow={() => setShowPasswordText((v) => !v)}
              onConfirm={handleSetPassword}
              onCancel={() => { setMode('idle'); setPasswordValue('') }}
            />
          ) : (
            <div className="flex gap-2 flex-wrap">
              <ActionButton onClick={() => setMode('password')} loading={false}>
                Redefinir senha
              </ActionButton>
              <ActionButton onClick={handleResetPassword} loading={loading}>
                Gerar link de recuperação
              </ActionButton>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[13px] text-[#9e9e9e]">
            Escolha como liberar o acesso para{' '}
            <span className="text-[#f5f5f5]">{customerEmail}</span>:
          </p>
          {mode === 'password' ? (
            <PasswordForm
              value={passwordValue}
              showText={showPasswordText}
              loading={loading}
              onChangeValue={setPasswordValue}
              onToggleShow={() => setShowPasswordText((v) => !v)}
              onConfirm={handleSetPassword}
              onCancel={() => { setMode('idle'); setPasswordValue('') }}
            />
          ) : (
            <div className="flex gap-2 flex-wrap">
              <ActionButton onClick={() => setMode('password')} loading={false}>
                Definir senha
              </ActionButton>
              <ActionButton onClick={handleInvite} loading={loading} primary>
                Gerar link de acesso
              </ActionButton>
            </div>
          )}
        </div>
      )}

      {generatedLink && (
        <div className="p-3 bg-[#1a2600] border border-[#3a5200] rounded-xl space-y-2">
          <p className="text-[12px] font-medium text-[#BAFF1A]">
            Link gerado — compartilhe com o cliente (ex: WhatsApp):
          </p>
          <div className="flex items-start gap-2">
            <p className="text-[11px] text-[#9e9e9e] font-mono break-all flex-1 leading-relaxed select-all">
              {generatedLink}
            </p>
            <button
              onClick={() => navigator.clipboard.writeText(generatedLink)}
              className="shrink-0 h-8 px-3 rounded-lg bg-[#323232] text-[#f5f5f5] text-[12px] font-medium hover:bg-[#474747] transition-colors"
            >
              Copiar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Primitivas internas ──────────────────────────────────────────────────────

function ActionButton({
  children,
  onClick,
  loading,
  primary = false,
}: {
  children: React.ReactNode
  onClick: () => void
  loading: boolean
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`h-8 px-3 rounded-lg text-[13px] font-medium transition-colors disabled:opacity-50 ${
        primary
          ? 'bg-[#BAFF1A] text-[#121212] hover:bg-[#a8e818]'
          : 'bg-[#323232] text-[#f5f5f5] hover:bg-[#474747]'
      }`}
    >
      {loading ? 'Aguarde…' : children}
    </button>
  )
}

function PasswordForm({
  value,
  showText,
  loading,
  onChangeValue,
  onToggleShow,
  onConfirm,
  onCancel,
}: {
  value: string
  showText: boolean
  loading: boolean
  onChangeValue: (v: string) => void
  onToggleShow: () => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex-1">
        <input
          type={showText ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChangeValue(e.target.value)}
          placeholder="Mínimo 8 caracteres"
          className="w-full h-9 rounded-lg border border-[#474747] bg-[#323232] px-3 pr-10 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none"
        />
        <button
          type="button"
          onClick={onToggleShow}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#616161] hover:text-[#f5f5f5] transition-colors"
        >
          {showText ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      <button
        onClick={onCancel}
        className="h-9 px-3 rounded-lg bg-[#323232] text-[#f5f5f5] text-[13px] font-medium hover:bg-[#474747] transition-colors"
      >
        Cancelar
      </button>
      <button
        onClick={onConfirm}
        disabled={loading}
        className="h-9 px-3 rounded-lg bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e818] transition-colors disabled:opacity-50"
      >
        {loading ? 'Salvando…' : 'Confirmar'}
      </button>
    </div>
  )
}
