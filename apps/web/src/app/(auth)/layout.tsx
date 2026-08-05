/**
 * @file layout.tsx (Auth)
 * @description Layout específico para as rotas de autenticação (ex: Login, Cadastro, Recuperação de Senha).
 * 
 * Este arquivo utiliza o padrão de 'Route Groups' do Next.js (pasta com parênteses).
 * Ele define um layout compartilhado para todas as páginas que estão dentro do grupo (auth),
 * permitindo isolar a estrutura visual do login do restante do dashboard.
 * 
 * Atualmente, este layout atua como um 'pass-through', ou seja, ele apenas renderiza 
 * os seus filhos sem adicionar elementos visuais extras (como Sidebars ou Headers), 
 * garantindo que as páginas de autenticação tenham foco total no formulário.
 * 
 * Caso queira adicionar um fundo padrão ou uma logo fixa em todas as telas de auth, 
 * este é o lugar correto para implementar.
 */

/**
 * @function AuthLayout
 * @description Componente de layout para o grupo de rotas de autenticação.
 * 
 * @param {Object} props - Propriedades do componente.
 * @param {React.ReactNode} props.children - Representa o conteúdo das páginas de autenticação
 *                                          (ex: o formulário de login no arquivo login/page.tsx).
 * 
 * @returns {React.ReactNode} Retorna os elementos filhos sem embrulhá-los em containers extras.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  /**
   * Renderização Simples:
   * Por enquanto, este layout não adiciona nenhuma camada visual (DOM) extra.
   * Ele apenas garante que as rotas de autenticação sigam uma hierarquia própria 
   * separada do layout principal do Dashboard.
   */
  return children
}
