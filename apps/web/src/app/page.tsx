/**
 * @file page.tsx (Raiz)
 * @description Ponto de entrada padrão da aplicação (rota '/').
 * 
 * Este arquivo atua como um redirecionador inteligente para a página inicial real 
 * do sistema, que neste caso é o Dashboard.
 * 
 * Por que usar um redirecionamento em vez de renderizar conteúdo?
 * - Garante que o usuário sempre caia em uma seção relevante após o login.
 * - Facilita a manutenção, permitindo mudar a rota inicial em um único lugar.
 * - Mantém a estrutura de URLs limpa e organizada.
 * 
 * Este componente é um Server Component do Next.js por padrão.
 */

// Importação da função utilitária de navegação do Next.js para redirecionamento no servidor.
import { redirect } from 'next/navigation'

/**
 * @function Home
 * @description O componente funcional Home é o primeiro a ser chamado na rota raiz.
 * Ele não renderiza nenhuma interface visual, apenas executa a lógica de redirecionamento.
 * 
 * Fluxo de Execução:
 * 1. O servidor recebe a requisição para a rota '/' (home).
 * 2. A função Home é invocada.
 * 3. A função redirect() é executada, enviando uma resposta HTTP 307 (Temporary Redirect).
 * 4. O navegador é direcionado para a rota '/dashboard'.
 * 
 * @returns {never} - Esta função tecnicamente nunca retorna JSX porque o redirect interrompe o fluxo.
 */
export default function Home() {
  /**
   * Redireciona o fluxo de navegação para a URL '/dashboard'.
   * 
   * Se o usuário não estiver autenticado, o middleware de segurança 
   * da aplicação se encarregará de interceptar esta rota e levá-lo para /login.
   */
  redirect('/dashboard')
}
