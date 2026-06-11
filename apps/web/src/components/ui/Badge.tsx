/**
 * @file Badge.tsx
 * @description Componente de etiqueta (Badge) e seu componente especializado `StatusBadge`.
 * 
 * @summary
 * O "porquê" deste arquivo é centralizar a estilização de pequenas informações de
 * destaque, como status, categorias ou tags. Ele oferece um componente `Badge` base,
 * que é flexível, e um `StatusBadge` especializado, que mapeia automaticamente
 * os status do sistema (ex: 'pending', 'available') para um texto e uma cor
 * correspondentes. Isso garante consistência visual e semântica em toda a aplicação.
 */

import { cn } from '@/lib/utils'

/**
 * @type BadgeVariant
 * @description Define as variantes de estilo visual disponíveis para o Badge.
 * O "porquê" deste tipo é criar um contrato claro para as opções de estilo,
 * onde cada variante tem um significado semântico:
 * - 'success': Sucesso, concluído, positivo (verde).
 * - 'warning': Atenção, pendente, em andamento (âmbar).
 * - 'danger': Erro, perigo, estado crítico (vermelho).
 * - 'info': Informação neutra, status de alocação (azul).
 * - 'muted': Discreto, para informações secundárias ou inativas (cinza).
 * - 'brand': Cor principal da marca GoMoto (verde limão).
 * - 'orange': Variante laranja para estados específicos como prejuízo.
 */
type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'muted' | 'brand' | 'orange'

/**
 * @interface BadgeProps
 * @description Propriedades para o componente base `Badge`.
 */
interface BadgeProps {
  /** A variante de cor/estilo a ser aplicada. O padrão é 'muted'. */
  variant?: BadgeVariant
  /** O conteúdo a ser exibido dentro da etiqueta (geralmente texto). */
  children: React.ReactNode
  /** Classes CSS adicionais para customizações pontuais. */
  className?: string
}

/**
 * @constant variants
 * @description Mapeamento de estilos Tailwind CSS para cada variante do Badge.
 * O "porquê": Centraliza a lógica de estilização em um único objeto, facilitando
 * a manutenção do design system. Se uma cor precisar ser alterada, a mudança é
 * feita aqui e reflete em todos os Badges da aplicação.
 */
const variants: Record<BadgeVariant, string> = {
  success: 'bg-[#0e2f13] text-[#229731]',
  warning: 'bg-[#3a180f] text-[#e65e24]',
  danger: 'bg-[#7c1c1c] text-[#ff9c9a]',
  info: 'bg-[#2d0363] text-[#a880ff]',
  muted: 'bg-[#323232] text-[#9e9e9e]',
  brand: 'bg-[#243300] text-[#BAFF1A]',
  orange: 'bg-[#3a180f] text-[#e65e24]',
}

/**
 * @constant statusLabels
 * @description Mapeamento centralizado que traduz chaves de status do sistema
 * para textos legíveis (rótulos) e suas variantes de cor correspondentes.
 * O "porquê": Este é o coração do `StatusBadge`. Ele desacopla a lógica de negócio
 * (ex: a string 'rented' vinda do banco) da sua representação na UI ('Alugada' com
 * a cor 'info'). Isso torna o sistema extremamente manutenível, pois para adicionar
 * um novo status ou mudar a cor de um existente, basta alterar esta constante.
 */
const statusLabels: Record<string, { label: string; variant: BadgeVariant }> = {
  /** Status de Motos e Contratos */
  available: { label: 'Disponível', variant: 'success' },
  rented: { label: 'Alugada', variant: 'info' },
  maintenance: { label: 'Manutenção', variant: 'warning' },
  inactive: { label: 'Inativa', variant: 'muted' },
  
  /** Status Financeiros e Cobranças */
  paid: { label: 'Pago', variant: 'success' },
  pending: { label: 'Pendente', variant: 'warning' },
  overdue: { label: 'Vencido', variant: 'danger' },
  loss: { label: 'Prejuízo', variant: 'orange' },

  /** Status de Manutenção */
  completed: { label: 'Concluída', variant: 'success' },
  
  /** Status de Clientes ou Registros Gerais */
  active: { label: 'Ativo', variant: 'success' },
  closed: { label: 'Encerrado', variant: 'muted' },
  cancelled: { label: 'Cancelado', variant: 'danger' },
  broken: { label: 'Rescindido', variant: 'warning' },
  
  /** Tipos de Manutenção */
  preventive: { label: 'Preventiva', variant: 'info' },
  corrective: { label: 'Corretiva', variant: 'warning' },
  
  /** Eventos e Processos */
  inspection: { label: 'Vistoria', variant: 'muted' },
  delivery: { label: 'Entrega', variant: 'success' },
  return: { label: 'Devolução', variant: 'warning' },
  
  /** Responsáveis */
  customer: { label: 'Cliente', variant: 'danger' },
  company: { label: 'Empresa', variant: 'muted' },
}

/**
 * @component StatusBadge
 * @description Componente especializado que recebe uma chave de status e renderiza
 * automaticamente o `Badge` correto com o texto e a cor configurados em `statusLabels`.
 * @param {object} props - Propriedades do componente.
 * @param {string} props.status - O identificador do status (ex: 'paid', 'available').
 */
export function StatusBadge({ status }: { status: string }) {
  /** 
   * Busca a configuração no mapeamento, ignorando maiúsculas/minúsculas.
   * Se não encontrar, usa o próprio texto do status com a variante 'muted' como fallback.
   * O "porquê" do fallback: Garante que o sistema não quebre se receber um status
   * inesperado, exibindo-o de forma discreta.
   */
  const config = statusLabels[status.toLowerCase()] ?? { label: status, variant: 'muted' as BadgeVariant }
  
  return <Badge variant={config.variant}>{config.label}</Badge>
}

/**
 * @component Badge
 * @description Componente funcional base para exibição de etiquetas.
 * @param {BadgeProps} props - Propriedades para estilização e conteúdo.
 */
export function Badge({ variant = 'muted', children, className }: BadgeProps) {
  return (
    <span
      // A função `cn` (classnames) mescla as classes de forma inteligente.
      className={cn(
        // Classes base: definem a estrutura fundamental do Badge.
        'inline-flex items-center px-2 py-0.5 rounded-full text-[12px] font-medium',
        // Classes dinâmicas: aplicam o estilo da variante escolhida.
        variants[variant],
        // Classes externas: permitem customizações adicionais ao usar o componente.
        className
      )}
    >
      {children}
    </span>
  )
}
