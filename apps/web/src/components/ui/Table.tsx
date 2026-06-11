/**
 * @file Table.tsx
 * @description Componente de tabela genérico e reutilizável para o sistema GoMoto.
 * 
 * @summary
 * O "porquê" deste componente é criar uma base única para todas as listagens de dados
 * tabulares da aplicação. Ao usar Generics do TypeScript (`<T>`), ele se torna
 * fortemente tipado e adaptável a qualquer tipo de dado (clientes, motos, cobranças, etc.).
 * Isso padroniza a aparência, o comportamento e a forma de construir tabelas,
 * suportando estados de carregamento, listas vazias e renderização customizada de células.
 */

import { cn } from '@/lib/utils'

/**
 * @interface Column
 * @description Define a estrutura de uma coluna da tabela.
 * 
 * @template T - O tipo do objeto de dados que a linha representa (ex: `User`, `Motorcycle`).
 */
interface Column<T> {
  /** Identificador único da coluna, geralmente o nome da propriedade no objeto de dados. */
  key: string
  /** O rótulo que será exibido no cabeçalho da tabela (`<thead>`). */
  header: string
  /** 
   * Função opcional para renderizar conteúdo customizado na célula.
   * O "porquê": Essencial para exibir componentes como Badges, ícones, ou botões,
   * ao invés de apenas texto simples. Recebe o objeto da linha (`row`) como argumento.
   */
  render?: (row: T) => React.ReactNode
  /** Classes CSS adicionais para estilização específica da coluna (ex: largura, alinhamento). */
  className?: string
}

/**
 * @interface TableProps
 * @description Propriedades para configurar e popular o componente `Table`.
 * 
 * @template T - Tipo genérico para os dados da tabela, garantindo consistência com as colunas.
 */
interface TableProps<T> {
  /** Array com a configuração das colunas a serem exibidas. */
  columns: Column<T>[]
  /** Array de objetos contendo os dados a serem listados. */
  data: T[]
  /** 
   * Função para extrair uma chave (`key`) única de cada linha.
   * O "porquê": O React exige uma `key` estável e única para cada item em uma lista
   * para otimizar a renderização e o gerenciamento de estado.
   */
  keyExtractor: (row: T) => string
  /** Callback opcional acionado quando o usuário clica em uma linha. */
  onRowClick?: (row: T) => void
  /** Mensagem exibida quando não há dados. Padrão: 'Nenhum registro encontrado'. */
  emptyMessage?: string
  /** Se `true`, exibe um indicador de carregamento ao invés da tabela. */
  loading?: boolean
}

/**
 * @component Table
 * @description Renderiza uma tabela HTML estilizada para o tema escuro do GoMoto,
 * com suporte a estados de carregamento, vazio e interatividade.
 * 
 * @template T - O tipo de dado de cada linha da tabela.
 * @deprecated FORBIDDEN by the design system. Use raw HTML `<table>` instead of this reusable component.
 */
export function Table<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  emptyMessage = 'Nenhum registro encontrado',
  loading,
}: TableProps<T>) {
  
  // 1. Estado de Carregamento (Loading)
  // O "porquê": Fornece feedback visual imediato ao usuário de que os dados estão sendo
  // buscados, melhorando a percepção de performance.
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          {/* Ícone de spinner animado */}
          <svg className="animate-spin h-8 w-8 text-[#BAFF1A]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-[#c7c7c7]">Carregando dados...</p>
        </div>
      </div>
    )
  }

  // 2. Estado Vazio (Empty State)
  // O "porquê": Informa claramente ao usuário que a operação foi concluída, mas
  // não há registros para exibir, evitando uma tela em branco confusa.
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-[#c7c7c7] text-sm italic">{emptyMessage}</p>
      </div>
    )
  }

  // 3. Renderização da Tabela
  return (
    // Contêiner que permite rolagem horizontal em telas pequenas para evitar quebra de layout.
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        {/* Cabeçalho da Tabela */}
        <thead className="text-[#c7c7c7]">
          <tr className="h-9 border-b border-[#474747]">
            {columns.map((column) => (
              <th
                key={column.key}
                className={cn(
                  'h-9 px-4 text-left font-bold text-[#c7c7c7]',
                  column.className
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        
        {/* Corpo da Tabela */}
        <tbody>
          {data.map((rowData) => (
            <tr
              key={keyExtractor(rowData)}
              onClick={() => onRowClick?.(rowData)}
              className={cn(
                'h-9 transition-colors duration-100 even:bg-[#323232]',
                // Estilo interativo (cursor e hover) aplicado apenas se a linha for clicável.
                onRowClick && 'cursor-pointer hover:bg-[#474747]'
              )}
            >
              {/* Células da linha */}
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn('px-4 text-[#f5f5f5]', column.className)}
                >
                  {/**
                   * Lógica de renderização da célula:
                   * - Se a coluna tiver uma função `render`, ela é usada para criar conteúdo customizado.
                   * - Caso contrário, tenta acessar a propriedade do objeto pela `column.key`.
                   * - Se o valor não for encontrado, exibe um traço '—' como fallback.
                   */}
                  {column.render
                    ? column.render(rowData)
                    : String((rowData as Record<string, unknown>)[column.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
