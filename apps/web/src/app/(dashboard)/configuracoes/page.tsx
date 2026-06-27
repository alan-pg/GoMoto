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

import React, { useState, useEffect } from 'react'
import { Building2, Lock, User, Save, Eye, EyeOff, CheckCircle2, AlertCircle, Loader2, CreditCard, Link2, Link2Off } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { usePaymentConnection } from '@gomoto/data'
import { connectMercadoPagoAction, disconnectPaymentAction } from './actions'

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
            ? 'bg-[#0e2f13] border border-[#229731] text-[#229731]'
            : 'bg-[#7c1c1c] border border-[#ff9c9a] text-[#ff9c9a]'
        }`}
      >
        {isSuccess ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
        <span>{feedback.message}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Cabeçalho padrão da página */}
      <Header
        title="Configurações"
        subtitle="Gerencie as informações da empresa e detalhes da sua conta"
      />

      <div className="p-6 space-y-8 max-w-5xl">

        {/* SEÇÃO 1: Dados da Empresa */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-[#323232]">
              <Building2 className="w-5 h-5 text-[#BAFF1A]" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-[#f5f5f5]">Dados da Empresa</h2>
              <p className="text-[13px] text-[#9e9e9e]">
                Informações que aparecerão em contratos e relatórios.
              </p>
            </div>
          </div>

          <Card>
            {isLoadingCompany ? (
              /* Estado de carregamento: exibe spinner centralizado */
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <Loader2 className="animate-spin text-[#BAFF1A]" size={32} />
                <p className="text-[#9e9e9e] text-[13px]">Carregando dados da empresa...</p>
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

        {/* SEÇÃO 2: Segurança — Alteração de Senha */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2.5 rounded-full bg-[#2d0363] border border-[#a880ff]">
              <Lock className="w-5 h-5 text-[#a880ff]" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-[#f5f5f5]">Segurança</h2>
              <p className="text-[13px] text-[#9e9e9e]">Altere sua senha de acesso ao painel.</p>
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
                  className="absolute right-3 top-[38px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors focus:outline-none"
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
            <div className="p-2.5 rounded-full bg-[#0d2240] border border-[#3b82f6]">
              <CreditCard className="w-5 h-5 text-[#3b82f6]" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-[#f5f5f5]">Integração de Pagamento</h2>
              <p className="text-[13px] text-[#9e9e9e]">
                Conecte a conta Mercado Pago para gerar cobranças Pix automaticamente.
              </p>
            </div>
          </div>

          <Card>
            {paymentConnectionQuery.isLoading ? (
              <div className="flex items-center gap-3 py-2">
                <Loader2 className="animate-spin text-[#9e9e9e]" size={20} />
                <p className="text-[13px] text-[#9e9e9e]">Verificando integração...</p>
              </div>
            ) : paymentConnectionQuery.data?.is_connected ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-[#0e2f13] border border-[#229731]">
                  <CheckCircle2 className="w-5 h-5 text-[#229731] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[#229731]">Mercado Pago conectado</p>
                    {paymentConnectionQuery.data.mp_account_email && (
                      <p className="text-[12px] text-[#9e9e9e] mt-0.5 truncate">
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
                <div className="flex items-center gap-3 p-4 rounded-xl bg-[#1a1a1a] border border-[#474747]">
                  <Link2 className="w-5 h-5 text-[#9e9e9e] shrink-0" />
                  <div className="flex-1">
                    <p className="text-[13px] font-medium text-[#f5f5f5]">Nenhuma conta conectada</p>
                    <p className="text-[12px] text-[#9e9e9e] mt-0.5">
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
            <div className="p-2.5 rounded-full bg-[#3a180f] border border-[#e65e24]">
              <User className="w-5 h-5 text-[#e65e24]" />
            </div>
            <div>
              <h2 className="text-[28px] font-semibold text-[#f5f5f5]">Informações da Conta</h2>
              <p className="text-[13px] text-[#9e9e9e]">Detalhes do usuário autenticado no sistema.</p>
            </div>
          </div>

          <Card>
            {isLoadingUser ? (
              /* Estado de carregamento do usuário */
              <div className="flex justify-center py-6">
                <Loader2 className="animate-spin text-[#9e9e9e]" size={28} />
              </div>
            ) : userData ? (
              /* Exibe os dados do usuário logado */
              <div className="space-y-4">
                <div>
                  <p className="text-[13px] text-[#9e9e9e] mb-1">E-mail de Acesso</p>
                  <p className="text-[#f5f5f5] font-medium">{userData.email}</p>
                </div>
                <div className="border-t border-[#323232]" />
                <div>
                  <p className="text-[13px] text-[#9e9e9e] mb-1">Membro desde</p>
                  <p className="text-[#f5f5f5] font-medium">{userData.createdAt}</p>
                </div>
              </div>
            ) : (
              /* Fallback quando os dados do usuário não puderam ser carregados */
              <div className="py-4 text-center">
                <p className="text-[#ff9c9a] text-[13px]">
                  Não foi possível carregar as informações do usuário.
                </p>
              </div>
            )}
          </Card>
        </section>
      </div>

      <Modal open={disconnectModalOpen} onClose={() => setDisconnectModalOpen(false)} title="Desconectar Mercado Pago" size="sm">
        <div className="space-y-4">
          <p className="text-[13px] text-[#9e9e9e]">
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
