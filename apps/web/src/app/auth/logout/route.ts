/**
 * @file route.ts (Logout)
 * @description Rota de API (Route Handler) para gerenciar o encerramento de sessões.
 * 
 * Este arquivo define um endpoint do lado do servidor que lida com o logout do usuário.
 * Ele utiliza o cliente do Supabase configurado para o ambiente de servidor (Server Side)
 * para invalidar os tokens de autenticação e as sessões ativas.
 * 
 * Por que usar um Route Handler para Logout?
 * - Garante que a limpeza da sessão ocorra de forma segura no servidor.
 * - Permite remover cookies HTTP-only que não são acessíveis via JavaScript no navegador.
 * - Centraliza a lógica de saída, facilitando chamadas a partir de formulários (Actions) ou fetch API.
 */

// Importação da função de criação do cliente Supabase para ambiente de servidor.
import { createClient } from '@/lib/supabase/server'
// Importação da função utilitária de navegação do Next.js para redirecionamento.
import { redirect } from 'next/navigation'

/**
 * @function POST
 * @async
 * @description Handler para o método HTTP POST na rota /auth/logout.
 * Realiza o encerramento da sessão do usuário e o redireciona para a tela de login.
 * 
 * Fluxo de execução do Logout:
 * 1. Inicializa o cliente do Supabase no contexto do servidor.
 * 2. Invoca o método signOut do Supabase Auth para limpar os cookies de sessão.
 * 3. Redireciona o usuário para a página de login para que ele possa entrar novamente se desejar.
 * 
 * @returns {Promise<never>} - Esta função nunca retorna um corpo de resposta HTTP 
 *                             pois o redirect interrompe o fluxo e envia um cabeçalho de redirecionamento.
 */
export async function POST() {
  /**
   * Instancia o cliente do Supabase.
   * Ele lerá automaticamente os cookies enviados pelo navegador para identificar a sessão atual.
   */
  const supabase = await createClient()
  
  /**
   * Chama a API de autenticação do Supabase para invalidar a sessão.
   * Isso remove os cookies do navegador e limpa o estado de autenticação no banco de dados.
   */
  await supabase.auth.signOut()

  /**
   * Após a limpeza bem-sucedida da sessão, redireciona o usuário 
   * de volta à tela inicial de login (/login).
   */
  redirect('/login')
}
