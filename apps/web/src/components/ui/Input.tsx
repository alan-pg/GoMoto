/**
 * @file Input.tsx
 * @description Conjunto de componentes de entrada de dados para formulários do sistema GoMoto.
 * 
 * @summary
 * O "porquê" deste arquivo é unificar os componentes de formulário mais comuns (`Input`,
 * `Select`, `Textarea`) em um único local, garantindo que todos compartilhem o mesmo
 * padrão visual (dark mode, bordas, cores de foco) e a mesma estrutura de
 * funcionalidades (suporte a rótulo, erro e dica). Isso cria uma experiência de
 * desenvolvimento e de usuário coesa e previsível.
 * 
 * @arquitetura
 * - **`forwardRef`**: Todos os componentes utilizam `forwardRef` para permitir que
 *   referências sejam passadas diretamente aos elementos de input nativos. Isso é
 *   essencial para integração com bibliotecas de formulários como React Hook Form.
 * - **Acessibilidade**: A geração automática de `id` e seu uso no atributo `htmlFor`
 *   do `label` garantem a correta associação entre o rótulo e o campo, melhorando
 *   a acessibilidade para leitores de tela.
 */

import { cn } from '@/lib/utils'
import { forwardRef } from 'react'

/**
 * @interface InputProps
 * @description Estende as propriedades nativas do `<input>` HTML com funcionalidades adicionais.
 */
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Texto descritivo exibido acima do campo. */
  label?: string
  /** Mensagem de erro de validação, exibida abaixo do campo com destaque. */
  error?: string
  /** Texto de ajuda ou dica, exibido abaixo do campo se não houver erro. */
  hint?: string
}

/**
 * @component Input
 * @description Componente para campos de entrada de texto padrão.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, hint, className, id, ...props }, ref) => {
    // Gera um ID único para o input a partir do label, se nenhum ID for fornecido.
    // O "porquê": Essencial para a acessibilidade, vinculando o <label> ao <input>.
    const inputId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    
    return (
      <div className="flex flex-col gap-1.5">
        {/* Renderiza o rótulo (label) se a prop for fornecida. */}
        {label && (
          <label htmlFor={inputId} className="text-[14px] text-[#c7c7c7]">
            {label}
          </label>
        )}
        
        {/* O elemento <input> nativo, estilizado com Tailwind CSS. */}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            // Estilos base: dimensões, cores, fontes e bordas.
            'w-full px-3 py-3 rounded-lg text-[13px] text-[#f5f5f5] h-12',
            'bg-[#323232] border border-[#474747]',
            'placeholder:text-[#616161]',
            // Estilos de estado: foco, desabilitado, etc.
            'focus:outline-none focus:border-[#BAFF1A]',
            'transition-colors duration-150',
            // Estilo condicional: aplicado apenas se houver um erro.
            error && 'border-[#bf1d1e]',
            // Permite a passagem de classes customizadas de fora.
            className
          )}
          {...props}
        />
        
        {/* Mensagem de erro: tem prioridade sobre a dica. */}
        {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}

        {/* Dica de ajuda: exibida apenas se não houver um erro. */}
        {hint && !error && <p className="text-[12px] text-[#9e9e9e]">{hint}</p>}
      </div>
    )
  }
)

// Define um nome de exibição para facilitar a depuração no React DevTools.
Input.displayName = 'Input'

/**
 * @interface SelectProps
 * @description Estende as propriedades nativas do `<select>` HTML.
 */
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  /** Lista de opções a serem exibidas no menu suspenso. */
  options: { value: string; label: string }[]
}

/**
 * @component Select
 * @description Componente de menu suspenso (dropdown) para seleção de opções.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, options, className, id, ...props }, ref) => {
    const selectId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={selectId} className="text-[14px] text-[#c7c7c7]">
            {label}
          </label>
        )}
        
        <select
          ref={ref}
          id={selectId}
          className={cn(
            'w-full px-3 py-3 rounded-lg text-[13px] text-[#f5f5f5] h-12 appearance-none', // `appearance-none` remove o estilo padrão do navegador.
            'bg-[#323232] border border-[#474747]',
            'focus:outline-none focus:border-[#BAFF1A]',
            'transition-colors duration-150',
            error && 'border-[#ff9c9a]',
            className
          )}
          {...props}
        >
          {/* Mapeia o array de `options` para elementos <option> do HTML. */}
          {options.map((option) => (
            <option key={option.value} value={option.value} className="bg-[#323232]">
              {option.label}
            </option>
          ))}
        </select>
        
        {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}
      </div>
    )
  }
)

Select.displayName = 'Select'

/**
 * @interface TextareaProps
 * @description Estende as propriedades nativas do `<textarea>` HTML.
 */
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

/**
 * @component Textarea
 * @description Campo de entrada de texto para múltiplas linhas.
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, '-')
    
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={textareaId} className="text-[14px] text-[#c7c7c7]">
            {label}
          </label>
        )}
        
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(
            'w-full px-3 py-3 rounded-lg text-[13px] text-[#f5f5f5] min-h-[100px]', // Altura mínima padrão.
            'bg-[#323232] border border-[#474747]',
            'placeholder:text-[#616161]',
            'focus:outline-none focus:border-[#BAFF1A]',
            'transition-colors duration-150 resize-none', // `resize-none` impede que o usuário redimensione o campo.
            error && 'border-[#ff9c9a]',
            className
          )}
          {...props}
        />
        
        {error && <p className="text-[12px] text-[#ff9c9a]">{error}</p>}
      </div>
    )
  }
)

Textarea.displayName = 'Textarea'
