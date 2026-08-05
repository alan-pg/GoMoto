/**
 * @file Button.tsx
 * @description Componente de botão reutilizável para o design system do GoMoto.
 * 
 * @summary
 * O "porquê" deste componente é criar um ponto único de verdade para todos os botões
 * da aplicação. Ao centralizar a estilização e o comportamento, garantimos consistência
 * visual e facilitamos a manutenção. Ele suporta variantes (cores), tamanhos e um
 * estado de carregamento, cobrindo 99% dos casos de uso de botões no sistema.
 * 
 * @arquitetura
 * - **`forwardRef`**: Permite que componentes pais obtenham uma referência ao elemento
 *   DOM `<button>` interno, essencial para integrações com bibliotecas de formulários
 *   (como React Hook Form) ou para manipulação de foco.
 * - **`cva` (Class Variance Authority) pattern**: Embora não use a biblioteca `cva`
 *   diretamente, ele segue o mesmo padrão: mapeia `props` (variant, size) para
 *   classes CSS do Tailwind, mantendo a lógica de estilo declarativa e organizada.
 */

import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

/**
 * @type ButtonVariant
 * @description Define as variantes visuais (cores e estilos) para o botão.
 * Cada variante tem um propósito semântico:
 * - 'primary': Ação principal, de maior destaque (verde limão da marca).
 * - 'secondary': Ação secundária, menos proeminente (fundo escuro).
 * - 'ghost': Ação terciária, sem fundo, para links ou ações sutis.
 * - 'danger': Ações destrutivas ou que exigem atenção (excluir, cancelar).
 * - 'outline': Ação alternativa, com ênfase moderada (apenas bordas).
 */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'white' | 'white-lg' | 'neutral-sm' | 'actions-sm'

/**
 * @type ButtonSize
 * @description Define as opções de tamanho para o botão.
 * - 'sm': Pequeno, usado em contextos densos como tabelas ou modais compactos.
 * - 'md': Médio, o tamanho padrão para a maioria das interações.
 * - 'lg': Grande, para chamadas de ação (CTAs) de alta importância, como no login.
 */
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon-sm'

/**
 * @interface ButtonProps
 * @description Estende os atributos nativos de um `<button>` HTML, adicionando
 * propriedades customizadas para controlar o estilo e comportamento do componente.
 */
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** A variante de estilo visual do botão. Padrão: 'primary'. */
  variant?: ButtonVariant
  /** As dimensões físicas do botão. Padrão: 'md'. */
  size?: ButtonSize
  /** Se `true`, exibe um spinner e desabilita o botão. */
  loading?: boolean
  /** O conteúdo interno (texto, ícones, etc.). */
  children: React.ReactNode
}

/**
 * @constant variants
 * @description Mapeamento que associa cada `ButtonVariant` a um conjunto de classes Tailwind CSS.
 * O "porquê": Centraliza a lógica de estilo, tornando o design system mais robusto.
 * Alterar uma cor aqui (ex: o `hover` do botão primário) atualiza todos os botões
 * primários da aplicação consistentemente.
 */
const variants: Record<ButtonVariant, string> = {
  primary: 'bg-[#BAFF1A] text-[#000000] font-medium hover:bg-[#a8e617]',
  secondary: 'bg-[#323232] text-[#ffffff] hover:bg-[#474747]',
  ghost: 'bg-transparent text-[#c7c7c7] hover:bg-[#323232] hover:text-[#f5f5f5]',
  danger: 'bg-[#bf1d1e] text-[#f5f5f5] hover:bg-[#a01819]',
  outline: 'bg-transparent border border-[#474747] text-[#f5f5f5] hover:border-[#BAFF1A] hover:text-[#BAFF1A]',
  white: 'bg-[#ffffff] text-[#121212] hover:bg-[#f0f0f0]',
  'white-lg': 'bg-[#ffffff] text-[#121212] hover:bg-[#f0f0f0]',
  'neutral-sm': 'bg-[#eeeeee] text-[#000000]',
  'actions-sm': 'bg-[#323232] text-[#ffffff] hover:bg-[#474747]',
}

/**
 * @constant sizes
 * @description Mapeamento que associa cada `ButtonSize` a um conjunto de classes Tailwind CSS.
 * O "porquê": Controla o `padding`, `font-size` e `border-radius`, garantindo uma
 * hierarquia visual clara e consistente entre os diferentes tamanhos de botão.
 */
const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-4 text-[14px] rounded-full',
  md: 'h-10 px-6 text-[16px] rounded-full',
  lg: 'h-12 px-6 text-[16px] rounded-full',
  'icon-sm': 'h-8 w-8 p-0 rounded-full',
}

/**
 * @component Button
 * @description O componente funcional que renderiza o elemento `<button>`.
 * 
 * @param {ButtonProps} props - As propriedades para customizar o botão.
 * @param {React.ForwardedRef<HTMLButtonElement>} ref - A referência encaminhada para o elemento DOM.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', loading, className, children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        // O botão é desabilitado se a prop `disabled` for `true` OU se estiver no estado `loading`.
        disabled={disabled || loading}
        // A função `cn` mescla as classes de forma inteligente, evitando conflitos.
        className={cn(
          // 1. Classes base: aplicadas a TODAS as variantes de botão.
          'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150',
          'hover:scale-[1.025] active:scale-95',
          'disabled:bg-[#323232] disabled:text-[#9e9e9e] disabled:cursor-not-allowed disabled:hover:scale-100 disabled:active:scale-100',
          // 2. Classes de variante: aplica o estilo da variante selecionada.
          variants[variant],
          // 3. Classes de tamanho: aplica as dimensões do tamanho selecionado.
          sizes[size],
          // 4. Classes externas: permite sobrescrever ou adicionar classes ao usar o componente.
          className
        )}
        {...props}
      >
        {/* Renderização condicional do ícone de carregamento (spinner). */}
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {/* Renderiza o conteúdo (ex: texto ou outros ícones) passado para o botão. */}
        {children}
      </button>
    )
  }
)

// Define um nome de exibição para facilitar a depuração no React DevTools.
Button.displayName = 'Button'
