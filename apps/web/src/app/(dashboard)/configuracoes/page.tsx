/**
 * @file src/app/(dashboard)/configuracoes/page.tsx
 * @description Página de Configurações do Sistema GoMoto.
 *
 * @summary
 * Esta página conecta as configurações da empresa e da conta do usuário
 * diretamente ao Supabase. A tabela `configuracoes` usa estrutura chave-valor,
 * portanto os campos são mapeados de/para pares { chave, valor } nas operações
 * de leitura e escrita.
 *
 * @funcionalidades
 * 1. **Dados da Empresa**: Busca e salva na tabela `configuracoes` via upsert.
 * 2. **Segurança**: Altera a senha do usuário via `supabase.auth.updateUser`.
 * 3. **Informações da Conta**: Exibe e-mail e data de criação do usuário logado.
 */

'use client'

import React, { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Building2, Lock, User, Save, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, CreditCard, Link2, Link2Off, Palette } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { usePaymentConnection, useThemePreference } from '@gomoto/data'
import type { ThemeBrand, ColorMode } from '@gomoto/core'
import { connectMercadoPagoAction, disconnectPaymentAction, updateThemePreferenceAction } from './actions'

const THEME_BRANDS: { value: ThemeBrand; label: string; description: string; swatch: string[] }[] = [
  { value: 'frota-confiavel', label: 'Frota Confiável', description: 'Azul, neutros frios — recomendado', swatch: ['#F8FAFC', '#2563EB', '#0F172A'] },
  { value: 'estrada', label: 'Estrada', description: 'Petróleo, neutros quentes', swatch: ['#FAFAF9', '#0D9488', '#1C1917'] },
  { value: 'sinalizacao', label: 'Sinalização', description: 'Laranja-ember, escuro por padrão', swatch: ['#0B0C10', '#F2790A', '#F4F5F7'] },
  { value: 'classico', label: 'Clássico', description: 'Verde-limão sobre preto — visual original', swatch: ['#121212', '#BAFF1A', '#FFFFFF'] },
]

const COLOR_MODES: { value: ColorMode; label: string }[] = [
  { value: 'system', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
]

/**
 * @interface CompanyData
 * @description Define a estrutura dos dados da empresa gerenciados nesta página.
 * Cada campo corresponde a uma chave na tabela `configuracoes`.
 */
interface CompanyData {
  /** Chave: empresa_nome */
  company_name: string
  /** Chave: empresa_cnpj */
  cnpj: string
  /** Chave: empresa_telefone */
  phone: string
  /** Chave: empresa_email */
  email: string
  /** Chave: empresa_endereco */
  address: string
}

/**
 * @interface UserData
 * @description Define as informações exibidas do usuário logado obtidas via Supabase Auth.
 */
interface UserData {
  email: string
  createdAt: string
}

/**
 * @interface FeedbackState
 * @description Estado das mensagens de feedback inline exibidas após operações assíncronas.
 */
interface FeedbackState {
  type: 'success' | 'error'
  message: string
}

/**
 * @component SettingsPage
 * @description Componente principal da página de Configurações.
 * Gerencia os dados da empresa, segurança e informações da conta do usuário logado.
 */
export default function SettingsPage() {
  /**
   * Cliente Supabase criado fora do ciclo de render para evitar
   * a criação de novas instâncias a cada atualização de estado.
   */
  const supabase = React.useMemo(() => createClient(), [])
  const router = useRouter()

  // --- ESTADOS: Dados da Empresa ---

  /** @state companyData — Formulário com os dados da empresa. */
  const [companyData, setCompanyData] = useState<CompanyData>({
    company_name: '',
    cnpj: '',
    phone: '',
    email: '',
    address: '',
  })

  /** @state isLoadingCompany — Exibe o spinner enquanto os dados são carregados. */
  const [isLoadingCompany, setIsLoadingCompany] = useState<boolean>(true)

  /** @state isSavingCompany — Bloqueia o botão e exibe loading durante o salvamento. */
  const [isSavingCompany, setIsSavingCompany] = useState<boolean>(false)

  /** @state companyFeedback — Mensagem inline de sucesso ou erro do formulário da empresa. */
  const [companyFeedback, setCompanyFeedback] = useState<FeedbackState | null>(null)

  // --- ESTADOS: Segurança (Senha) ---

  /** @state newPassword — Campo de nova senha. */
  const [newPassword, setNewPassword] = useState<string>('')

  /** @state confirmPassword — Campo de confirmação da nova senha. */
  const [confirmPassword, setConfirmPassword] = useState<string>('')

  /** @state showPassword — Alterna a visibilidade dos campos de senha. */
  const [showPassword, setShowPassword] = useState<boolean>(false)

  /** @state isSavingPassword — Bloqueia o botão durante a operação de troca de senha. */
  const [isSavingPassword, setIsSavingPassword] = useState<boolean>(false)

  /** @state passwordFeedback — Mensagem inline de sucesso ou erro da seção de senha. */
  const [passwordFeedback, setPasswordFeedback] = useState<FeedbackState | null>(null)

  // --- ESTADOS: Informações da Conta ---

  /** @state userData — E-mail e data de criação do usuário autenticado. */
  const [userData, setUserData] = useState<UserData | null>(null)

  /** @state isLoadingUser — Exibe o spinner enquanto os dados do usuário carregam. */
  const [isLoadingUser, setIsLoadingUser] = useState<boolean>(true)

  // --- ESTADOS: Integração de Pagamento ---

  const paymentConnectionQuery = usePaymentConnection()
  const [paymentFeedback, setPaymentFeedback] = useState<FeedbackState | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isDisconnecting, setIsDisconnecting] = useState(false)
  const [disconnectModalOpen, setDisconnectModalOpen] = useState(false)

  // --- ESTADOS: Aparência (ADR 0019) ---

  const themePreferenceQuery = useThemePreference()
  const [themeBrand, setThemeBrand] = useState<ThemeBrand>('frota-confiavel')
  const [colorMode, setColorMode] = useState<ColorMode>('system')
  const [isSavingTheme, setIsSavingTheme] = useState(false)
  const [themeFeedback, setThemeFeedback] = useState<FeedbackState | null>(null)

  useEffect(() => {
    if (themePreferenceQuery.data) {
      setThemeBrand(themePreferenceQuery.data.theme_brand)
      setColorMode(themePreferenceQuery.data.color_mode)
    }
  }, [themePreferenceQuery.data])

  /**
   * Pré-visualização ao vivo (ADR 0019): escrever os atributos direto no
   * <html> mostra o tema escolhido na hora, sem esperar salvar. Só roda em
   * resposta a clique do usuário — nunca no mount/carregamento da
   * preferência salva, pra não piscar o tema real por um instante.
   *
   * O layout raiz (Server Component) só reexecuta em reload completo ou
   * depois de `router.refresh()` — navegação client-side entre páginas do
   * dashboard não remonta ele. Sem o cleanup abaixo, uma pré-visualização
   * não salva "vazaria" pro resto do app ao trocar de tela pela sidebar.
   * `themeSavedRef` guarda se o usuário confirmou com "Salvar Aparência";
   * se não confirmou, o unmount desta página restaura o que estava
   * persistido antes de qualquer clique.
   */
  const originalThemeRef = useRef<{ brand: string | null; mode: string | null } | null>(null)
  const themeSavedRef = useRef(false)

  useEffect(() => {
    if (originalThemeRef.current === null) {
      originalThemeRef.current = {
        brand: document.documentElement.getAttribute('data-brand'),
        mode: document.documentElement.getAttribute('data-mode'),
      }
    }
    return () => {
      if (themeSavedRef.current || !originalThemeRef.current) return
      const { brand, mode } = originalThemeRef.current
      if (brand) document.documentElement.setAttribute('data-brand', brand)
      if (mode) document.documentElement.setAttribute('data-mode', mode)
      else document.documentElement.removeAttribute('data-mode')
    }
  }, [])

  function handleSelectThemeBrand(brand: ThemeBrand) {
    setThemeBrand(brand)
    document.documentElement.setAttribute('data-brand', brand)
  }

  function handleSelectColorMode(mode: ColorMode) {
    setColorMode(mode)
    if (mode === 'system') {
      document.documentElement.removeAttribute('data-mode')
    } else {
      document.documentElement.setAttribute('data-mode', mode)
    }
  }

  async function handleSaveTheme() {
    setIsSavingTheme(true)
    setThemeFeedback(null)
    const result = await updateThemePreferenceAction({ theme_brand: themeBrand, color_mode: colorMode })
    if (!result.ok) {
      setThemeFeedback({ type: 'error', message: result.error?.message ?? 'Erro ao salvar aparência.' })
    } else {
      themeSavedRef.current = true
      setThemeFeedback({ type: 'success', message: 'Aparência atualizada.' })
      router.refresh()
    }
    setIsSavingTheme(false)
  }

  /**
   * @effect fetchInitialData
   * @description Busca os dados da empresa na tabela `configuracoes` e
   * as informações do usuário logado via Supabase Auth ao montar o componente.
   */
  useEffect(() => {
    async function fetchInitialData() {
      try {
        // Busca o usuário autenticado para exibir na seção "Informações da Conta"
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser()

        if (user && !userError) {
          setUserData({
            email: user.email ?? 'E-mail não disponível',
            createdAt: new Date(user.created_at).toLocaleDateString('pt-BR', {
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            }),
          })
        }
      } catch {
        // Falha silenciosa: o card de conta exibirá mensagem de erro
      } finally {
        setIsLoadingUser(false)
      }

      try {
        // Busca todos os registros da tabela de configurações (estrutura chave-valor)
        const { data: settingsData, error: settingsError } = await supabase
          .from('settings')
          .select('key, value')

        if (settingsData && !settingsError) {
          /**
           * Transforma o array [{chave, valor}] em um objeto estruturado,
           * mapeando cada chave do banco para a propriedade correspondente.
           */
          const find = (key: string) =>
            settingsData.find((item) => item.key === key)?.value ?? ''

          setCompanyData({
            company_name: find('empresa_nome'),
            cnpj: find('empresa_cnpj'),
            phone: find('empresa_telefone'),
            email: find('empresa_email'),
            address: find('empresa_endereco'),
          })
        }
      } catch {
        // Falha silenciosa: o formulário iniciará vazio
      } finally {
        setIsLoadingCompany(false)
      }
    }

    fetchInitialData()
  }, [supabase])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const payment = params.get('payment')
    const reason  = params.get('reason')
    if (payment === 'connected') {
      setPaymentFeedback({ type: 'success', message: 'Conta Mercado Pago conectada com sucesso!' })
      paymentConnectionQuery.refetch()
    } else if (payment === 'cancelled') {
      setPaymentFeedback({ type: 'error', message: 'Conexão cancelada. Nenhuma conta foi vinculada.' })
    } else if (payment === 'error') {
      const messages: Record<string, string> = {
        state_mismatch:   'Falha de segurança (CSRF). Tente novamente.',
        token_exchange:   'Não foi possível conectar ao Mercado Pago. Tente novamente.',
        misconfiguration: 'Integração não configurada. Contate o suporte.',
      }
      setPaymentFeedback({ type: 'error', message: messages[reason ?? ''] ?? 'Erro desconhecido ao conectar.' })
    }
    if (payment) {
      window.history.replaceState({}, '', '/configuracoes')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleConnect() {
    setIsConnecting(true)
    setPaymentFeedback(null)
    const result = await connectMercadoPagoAction()
    if (!result.ok || !result.data) {
      setPaymentFeedback({ type: 'error', message: result.error?.message ?? 'Erro ao iniciar conexão.' })
      setIsConnecting(false)
      return
    }
    window.location.href = result.data.authUrl
  }

  async function handleDisconnect() {
    setIsDisconnecting(true)
    const result = await disconnectPaymentAction()
    setDisconnectModalOpen(false)
    if (!result.ok) {
      setPaymentFeedback({ type: 'error', message: result.error?.message ?? 'Erro ao desconectar.' })
    } else {
      setPaymentFeedback({ type: 'success', message: 'Conta Mercado Pago desconectada.' })
      paymentConnectionQuery.refetch()
    }
    setIsDisconnecting(false)
  }

  /**
   * @function handleSaveCompany
   * @description Salva todos os campos da empresa na tabela `configuracoes`
   * usando Promise.all para executar os upserts em paralelo.
   */
  const handleSaveCompany = async () => {
    setIsSavingCompany(true)
    setCompanyFeedback(null)

    try {
      const updates = [
        { key: 'empresa_nome', value: companyData.company_name },
        { key: 'empresa_cnpj', value: companyData.cnpj },
        { key: 'empresa_telefone', value: companyData.phone },
        { key: 'empresa_email', value: companyData.email },
        { key: 'empresa_endereco', value: companyData.address },
      ]

      await Promise.all(
        updates.map((update) =>
          supabase.from('settings').upsert(update, { onConflict: 'key' })
        )
      )

      setCompanyFeedback({
        type: 'success',
        message: 'Dados da empresa salvos com sucesso!',
      })
    } catch {
      setCompanyFeedback({
        type: 'error',
        message: 'Erro ao salvar os dados. Tente novamente.',
      })
    } finally {
      setIsSavingCompany(false)
    }
  }

  /**
   * @function handleSavePassword
   * @description Valida e altera a senha do usuário via Supabase Auth.
   * Após sucesso, limpa os campos e exibe confirmação.
   */
  const handleSavePassword = async () => {
    setPasswordFeedback(null)

    // Validação: mínimo de 6 caracteres
    if (newPassword.length < 6) {
      setPasswordFeedback({
        type: 'error',
        message: 'A nova senha deve ter pelo menos 6 caracteres.',
      })
      return
    }

    // Validação: senhas devem ser iguais
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({
        type: 'error',
        message: 'A confirmação de senha não coincide com a nova senha.',
      })
      return
    }

    setIsSavingPassword(true)

    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword })

      if (error) throw error

      setPasswordFeedback({
        type: 'success',
        message: 'Senha alterada com sucesso!',
      })
      // Limpa os campos após a alteração bem-sucedida
      setNewPassword('')
      setConfirmPassword('')
    } catch {
      setPasswordFeedback({
        type: 'error',
        message: 'Erro ao alterar a senha. Verifique sua conexão e tente novamente.',
      })
    } finally {
      setIsSavingPassword(false)
    }
  }

  /**
   * @component FeedbackMessage
   * @description Componente interno que renderiza mensagens de sucesso ou erro inline.
   * Usa ícones semânticos para reforçar visualmente o tipo de feedback.
   */
  const FeedbackMessage = ({ feedback }: { feedback: FeedbackState | null }) => {
    if (!feedback) return null
    const isSuccess = feedback.type === 'success'
    return (
      <div
        className={`flex items-center gap-2 rounded-2xl px-4 py-3 text-[13px] font-medium ${
          isSuccess
            ? 'bg-success-bg border border-success text-success'
            : 'bg-danger-bg border border-danger text-danger'
        }`}
      >
        {isSuccess ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        <span>{feedback.message}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      <PageTitle title="Configurações" subtitle="Gerencie as informações da empresa e detalhes da sua conta" />
      <div className="p-6 space-y-8 max-w-5xl">

        {/* SEÇÃO 1: Dados da Empresa */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-surface-2">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-fg">Dados da Empresa</h2>
              <p className="text-[13px] text-fg-mute">
                Informações que aparecerão em contratos e relatórios.
              </p>
            </div>
          </div>

          <Card>
            {isLoadingCompany ? (
              /* Estado de carregamento: exibe spinner centralizado */
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="animate-spin text-primary" size={32} />
                <p className="text-fg-mute text-[13px]">Carregando dados da empresa...</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Nome da Empresa"
                    value={companyData.company_name}
                    onChange={(e) =>
                      setCompanyData({ ...companyData, company_name: e.target.value })
                    }
                  />
                  <Input
                    label="CNPJ"
                    value={companyData.cnpj}
                    onChange={(e) =>
                      setCompanyData({ ...companyData, cnpj: e.target.value })
                    }
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Telefone"
                    value={companyData.phone}
                    onChange={(e) =>
                      setCompanyData({ ...companyData, phone: e.target.value })
                    }
                  />
                  <Input
                    label="E-mail"
                    type="email"
                    value={companyData.email}
                    onChange={(e) =>
                      setCompanyData({ ...companyData, email: e.target.value })
                    }
                  />
                </div>
                <Input
                  label="Endereço Completo"
                  value={companyData.address}
                  onChange={(e) =>
                    setCompanyData({ ...companyData, address: e.target.value })
                  }
                />

                {/* Área de ações com feedback inline */}
                <div className="flex items-center justify-between pt-2 gap-4">
                  <FeedbackMessage feedback={companyFeedback} />
                  <Button
                    variant="primary"
                    size="md"
                    loading={isSavingCompany}
                    onClick={handleSaveCompany}
                    className="ml-auto flex-shrink-0"
                  >
                    <Save className="w-4 h-4" />
                    Salvar Dados da Empresa
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </section>

        {/* SEÇÃO 1.5: Aparência (ADR 0019) */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-primary-tint">
              <Palette className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-fg">Aparência</h2>
              <p className="text-[13px] text-fg-mute">
                Escolha a identidade visual e o modo de cor do sistema — vale só pra você, não muda pros outros operadores.
              </p>
            </div>
          </div>

          <Card>
            <div className="space-y-5">
              <div>
                <p className="text-[13px] text-fg-soft mb-2">Tema</p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {THEME_BRANDS.map((brand) => (
                    <button
                      key={brand.value}
                      type="button"
                      onClick={() => handleSelectThemeBrand(brand.value)}
                      className={cn(
                        'text-left rounded-xl border p-3 transition-colors',
                        themeBrand === brand.value ? 'border-primary bg-primary-tint' : 'border-border hover:border-fg-mute',
                      )}
                    >
                      <div className="flex gap-1 mb-2">
                        {brand.swatch.map((hex) => (
                          <span
                            key={hex}
                            className="w-5 h-5 rounded-full border border-black/10"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </div>
                      <p className="text-[13px] font-medium text-fg">{brand.label}</p>
                      <p className="text-[11px] text-fg-mute mt-0.5">{brand.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[13px] text-fg-soft mb-2">Modo de cor</p>
                <div className="inline-flex rounded-full border border-border p-1 gap-1">
                  {COLOR_MODES.map((mode) => (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => handleSelectColorMode(mode.value)}
                      className={cn(
                        'h-8 px-4 rounded-full text-[12px] font-medium transition-colors',
                        colorMode === mode.value ? 'bg-primary text-primary-contrast' : 'text-fg-soft hover:text-fg',
                      )}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 gap-4">
                <FeedbackMessage feedback={themeFeedback} />
                <Button
                  variant="primary"
                  size="md"
                  loading={isSavingTheme}
                  onClick={handleSaveTheme}
                  className="ml-auto flex-shrink-0"
                >
                  <Save className="w-4 h-4" />
                  Salvar Aparência
                </Button>
              </div>
            </div>
          </Card>
        </section>

        {/* SEÇÃO 2: Segurança — Alteração de Senha */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-info-bg border border-info">
              <Lock className="w-5 h-5 text-info" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-fg">Segurança</h2>
              <p className="text-[13px] text-fg-mute">Altere sua senha de acesso ao painel.</p>
            </div>
          </div>

          <Card>
            <div className="space-y-4">
              {/* Campo: Nova Senha com botão de visibilidade */}
              <div className="relative">
                <Input
                  label="Nova Senha"
                  type={showPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  hint="Mínimo de 6 caracteres."
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-[38px] text-fg-mute hover:text-fg transition-colors focus:outline-none"
                  title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Campo: Confirmação de Senha */}
              <div className="relative">
                <Input
                  label="Confirmar Nova Senha"
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              {/* Área de ações com feedback inline */}
              <div className="flex items-center justify-between pt-2 gap-4">
                <FeedbackMessage feedback={passwordFeedback} />
                <Button
                  variant="primary"
                  size="md"
                  loading={isSavingPassword}
                  onClick={handleSavePassword}
                  className="ml-auto flex-shrink-0"
                >
                  <Save className="w-4 h-4" />
                  Alterar Senha
                </Button>
              </div>
            </div>
          </Card>
        </section>

        {/* SEÇÃO 3: Integração de Pagamento */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-info-bg border border-info">
              <CreditCard className="w-5 h-5 text-info" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-fg">Integração de Pagamento</h2>
              <p className="text-[13px] text-fg-mute">
                Conecte a conta Mercado Pago para gerar cobranças Pix automaticamente.
              </p>
            </div>
          </div>

          <Card>
            {paymentConnectionQuery.isLoading ? (
              <div className="flex items-center gap-3 py-2">
                <Loader2 className="animate-spin text-fg-mute" size={20} />
                <p className="text-[13px] text-fg-mute">Verificando integração...</p>
              </div>
            ) : paymentConnectionQuery.data?.is_connected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-success-bg border border-success">
                  <CheckCircle2 className="w-5 h-5 text-success shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-success">Mercado Pago conectado</p>
                    {paymentConnectionQuery.data.mp_account_email && (
                      <p className="text-[12px] text-fg-mute mt-0.5 truncate">
                        {paymentConnectionQuery.data.mp_account_email}
                      </p>
                    )}
                  </div>
                  <Button variant="danger" size="sm" onClick={() => setDisconnectModalOpen(true)}>
                    <Link2Off className="w-4 h-4" />
                    Desconectar
                  </Button>
                </div>
                {paymentFeedback && <FeedbackMessage feedback={paymentFeedback} />}
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-surface border border-border">
                  <Link2 className="w-5 h-5 text-fg-mute shrink-0" />
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-fg">Nenhuma conta conectada</p>
                    <p className="text-[12px] text-fg-mute mt-0.5">
                      Conecte a conta Mercado Pago da locadora para gerar cobranças Pix.
                    </p>
                  </div>
                  <Button onClick={handleConnect} loading={isConnecting} size="sm">
                    <Link2 className="w-4 h-4" />
                    Conectar Mercado Pago
                  </Button>
                </div>
                {paymentFeedback && <FeedbackMessage feedback={paymentFeedback} />}
              </div>
            )}
          </Card>
        </section>

        {/* SEÇÃO 4: Informações da Conta */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-warning-bg border border-warning">
              <User className="w-5 h-5 text-warning" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-fg">Informações da Conta</h2>
              <p className="text-[13px] text-fg-mute">Detalhes do usuário autenticado no sistema.</p>
            </div>
          </div>

          <Card>
            {isLoadingUser ? (
              /* Estado de carregamento do usuário */
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-fg-mute" size={28} />
              </div>
            ) : userData ? (
              /* Exibe os dados do usuário logado */
              <div className="space-y-4">
                <div>
                  <p className="text-[13px] text-fg-mute mb-1">E-mail de Acesso</p>
                  <p className="text-fg font-medium">{userData.email}</p>
                </div>
                <div className="border-t border-border" />
                <div>
                  <p className="text-[13px] text-fg-mute mb-1">Membro desde</p>
                  <p className="text-fg font-medium">{userData.createdAt}</p>
                </div>
              </div>
            ) : (
              /* Fallback quando os dados do usuário não puderam ser carregados */
              <div className="py-4 text-center">
                <p className="text-danger text-[13px]">
                  Não foi possível carregar as informações do usuário.
                </p>
              </div>
            )}
          </Card>
        </section>
      </div>

      <Modal open={disconnectModalOpen} onClose={() => setDisconnectModalOpen(false)} title="Desconectar Mercado Pago" size="sm">
        <div className="space-y-4">
          <p className="text-[13px] text-fg-mute">
            Ao desconectar, o sistema não poderá gerar novos Pix de cobrança. Pix já gerados continuam válidos até o vencimento.
          </p>
          <div className="flex gap-3 justify-end">
            <Button variant="ghost" onClick={() => setDisconnectModalOpen(false)}>Cancelar</Button>
            <Button variant="danger" onClick={handleDisconnect} loading={isDisconnecting}>
              <Link2Off className="w-4 h-4" />
              Confirmar Desconexão
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
