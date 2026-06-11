/**
 * @file page.tsx (Login)
 * @description Página de autenticação do sistema GoMoto.
 * 
 * Este arquivo implementa a interface de usuário para login, 
 * permitindo que os operadores acessem o dashboard administrativo.
 * 
 * Funcionalidades:
 * - Formulário de login com campos de e-mail e senha.
 * - Integração com o Supabase Auth para validação de credenciais.
 * - Tratamento de erros de autenticação com feedback visual.
 * - Gerenciamento de estado de carregamento (loading) durante o processo de entrada.
 * - Redirecionamento automático para o dashboard após login bem-sucedido.
 * - Layout responsivo e estilizado com o branding da aplicação.
 */

'use client'

// Hooks do React para gerenciamento de estado local.
import { useState } from 'react'
// Hook de navegação do Next.js para redirecionamento no lado do cliente.
import { useRouter } from 'next/navigation'
// Cliente Supabase configurado para operações no lado do navegador (Client Side).
import { createClient } from '@/lib/supabase/client'
// Componentes de interface reaproveitáveis (UI Library).
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
// Ícone de moto para reforço visual da marca.
import { Bike } from 'lucide-react'

/**
 * @function LoginPage
 * @description Componente principal da página de login.
 * Renderiza o formulário centralizado com logo e campos de entrada.
 * 
 * @returns {JSX.Element} A interface completa da tela de login.
 */
export default function LoginPage() {
  /**
   * Instância do router para possibilitar navegação programática.
   */
  const router = useRouter()

  /**
   * @state email
   * @description Armazena o valor do campo de e-mail digitado pelo usuário.
   */
  const [email, setEmail] = useState('')

  /**
   * @state password
   * @description Armazena o valor do campo de senha digitado pelo usuário.
   */
  const [password, setPassword] = useState('')

  /**
   * @state error
   * @description Armazena mensagens de erro retornadas pelo servidor ou validações locais.
   */
  const [error, setError] = useState('')

  /**
   * @state loading
   * @description Controla o estado de submissão do formulário para exibir indicadores visuais no botão.
   */
  const [loading, setLoading] = useState(false)

  /**
   * @function handleLogin
   * @async
   * @description Processa a tentativa de login do usuário.
   * 
   * @param {React.FormEvent} event - O evento de submissão do formulário.
   */
  async function handleLogin(event: React.FormEvent) {
    // Evita o recarregamento padrão da página ao submeter o formulário.
    event.preventDefault()
    // Limpa erros anteriores antes de iniciar uma nova tentativa.
    setError('')
    // Ativa o estado de carregamento.
    setLoading(true)

    // Inicializa o cliente do Supabase para autenticação via navegador.
    const supabase = createClient()
    
    /**
     * Tenta autenticar o usuário utilizando e-mail e senha.
     * O método signInWithPassword retorna um objeto contendo data ou error.
     */
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })

    /**
     * Tratamento de falha na autenticação:
     * Se houver um erro, exibe uma mensagem amigável e desativa o loading.
     */
    if (authError) {
      setError('Email ou senha incorretos.')
      setLoading(false)
      return
    }

    /**
     * Sucesso no Login:
     * Redireciona o usuário para a página principal do sistema.
     */
    router.push('/dashboard')
  }

  return (
    // Container principal: Centraliza o conteúdo vertical e horizontalmente.
    <div className="min-h-screen bg-[#121212] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        
        {/* 
            Seção de Identidade Visual (Logo):
            Reforça a marca GoMoto com ícone e tipografia em negrito.
        */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-14 h-14 bg-[#BAFF1A] rounded-2xl flex items-center justify-center">
            <Bike className="w-7 h-7 text-[#121212]" />
          </div>
          <div className="text-center">
            <h1 className="text-[28px] font-bold text-[#f5f5f5]">GoMoto</h1>
            <p className="text-[20px] text-[#9e9e9e] mt-1">Sistema de Gestão</p>
          </div>
        </div>

        {/* 
            Card de Formulário:
            Concentra os campos de interação do usuário com bordas e fundo destacados.
        */}
        <div className="bg-[#202020] border border-[#474747] rounded-2xl p-6">
          <h2 className="text-[20px] font-semibold text-[#f5f5f5] mb-5">Entrar na conta</h2>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Campo de entrada para o E-mail. */}
            <Input
              label="Email"
              type="email"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
            {/* Campo de entrada para a Senha com máscara de caracteres. */}
            <Input
              label="Senha"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />

            {/* 
                Exibição de Erros:
                Renderização condicional de um alerta caso a autenticação falhe.
            */}
            {error && (
              <div className="rounded-2xl px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a]">
                <p className="text-[13px] text-[#ff9c9a]">{error}</p>
              </div>
            )}

            {/* 
                Botão de Ação:
                Inicia o processo de login. Exibe spinner se estiver em estado de loading.
            */}
            <Button type="submit" className="w-full mt-2" loading={loading} size="lg">
              {loading ? 'Entrando...' : 'Entrar'}
            </Button>
          </form>
        </div>

        {/* Rodapé com Direitos Autorais e Ano Dinâmico. */}
        <p className="text-center text-[12px] text-[#9e9e9e] mt-6">
          GoMoto © {new Date().getFullYear()}
        </p>
      </div>
    </div>
  )
}
