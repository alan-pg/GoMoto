/**
 * @file Modal.tsx
 * @description Componente de janela modal (diálogo sobreposto) para o sistema GoMoto.
 * 
 * @summary
 * O "porquê" deste componente é fornecer uma maneira de exibir conteúdo (como formulários
 * ou alertas) em uma camada sobre a interface principal, sem que o usuário perca o
 * contexto da página atual. Isso é fundamental para ações focadas, como cadastros,
 * edições ou confirmações, melhorando o fluxo de trabalho do operador.
 * 
 * @arquitetura
 * - **Gerenciamento de Estado Externo**: A visibilidade da modal é controlada por um
 *   estado externo (`open`), dando ao componente pai total controle sobre quando
 *   exibi-la ou ocultá-la.
 * - **Bloqueio de Scroll**: Utiliza um `useEffect` para manipular o CSS do `<body>`,
 *   impedindo a rolagem da página principal enquanto a modal estiver aberta. Isso é
 *   crucial para a experiência do usuário.
 * - **Acessibilidade**: Ações como fechar ao clicar no fundo (backdrop) e o `aria-label`
 *   no botão de fechar melhoram a usabilidade.
 */

'use client'

import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import { useEffect } from 'react'

/**
 * @interface ModalProps
 * @description Propriedades para o controle e exibição do componente Modal.
 */
interface ModalProps {
  /** Estado booleano que controla a visibilidade da modal. */
  open: boolean
  /** Função de callback chamada para fechar a modal (ex: ao clicar no 'X' ou no fundo). */
  onClose: () => void
  /** Título opcional exibido no cabeçalho da modal. */
  title?: string
  /** Conteúdo principal a ser renderizado dentro da modal. */
  children: React.ReactNode
  /** Define a largura máxima da modal, permitindo diferentes tamanhos para diferentes contextos. */
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

/**
 * @constant sizes
 * @description Mapeamento que associa cada `size` a uma classe de largura máxima do Tailwind.
 * O "porquê": Garante que as modais tenham tamanhos padronizados e consistentes em todo o sistema.
 */
const sizes = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

/**
 * @component Modal
 * @description Renderiza uma janela de diálogo sobreposta controlada por estado.
 */
export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  /**
   * @effect
   * @description Gerencia o `overflow` do `<body>` para bloquear a rolagem da página principal.
   * O "porquê": Quando a modal está aberta, a página ao fundo não deve ser rolável.
   * Este efeito adiciona e remove o estilo `overflow: hidden` do body. A função de
   * limpeza (`return`) garante que o estilo seja removido se a modal for desmontada,
   * prevenindo bugs de "página travada".
   */
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    
    // Função de limpeza (cleanup) do efeito.
    return () => { 
      document.body.style.overflow = '' 
    }
  }, [open]) // O efeito é re-executado apenas quando a prop `open` muda.

  // "Early Return": Se a modal não estiver aberta, o componente não renderiza nada no DOM.
  // O "porquê": É uma otimização de performance que evita renderizações desnecessárias.
  if (!open) return null

  return (
    // Contêiner principal, fixo na tela (inset-0), com z-index alto (z-50) para ficar acima de tudo.
    // Usa flexbox para centralizar o conteúdo da modal.
    <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 animate-in fade-in">
      
      {/** 
       * Camada de fundo (Backdrop):
       * Cobre toda a tela com uma cor preta semitransparente e um efeito de desfoque.
       * O `onClick={onClose}` permite que o usuário feche a modal clicando fora dela.
       */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/** 
       * Corpo da Modal:
       * Posicionado de forma relativa para ficar acima do backdrop.
       * A animação `slide-in-from-top` cria um efeito suave de entrada.
       */}
      <div
        className={cn(
          'relative w-full bg-[#202020] border border-[#474747] rounded-2xl',
          'max-h-[96vh] overflow-y-auto custom-scrollbar', // Garante que modais altas tenham rolagem interna.
          sizes[size], // Aplica a classe de largura correspondente.
          'animate-in fade-in zoom-in-95 slide-in-from-top-4'
        )}
      >
        {/* Cabeçalho da Modal: Renderizado apenas se um `title` for fornecido. */}
        {title && (
          <div className="flex items-center justify-between p-5 border-b border-[#474747] sticky top-0 bg-[#202020] z-10">
            <h2 className="text-lg font-medium text-[#f5f5f5]">{title}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-[#c7c7c7] hover:text-[#f5f5f5] hover:bg-[#323232] transition-colors"
              aria-label="Fechar modal"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        )}
        
        {/* Área de conteúdo principal, onde o `children` é renderizado. */}
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
