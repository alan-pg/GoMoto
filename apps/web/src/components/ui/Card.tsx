/**
 * @file Card.tsx
 * @description Componentes de contêiner para a interface do GoMoto.
 * 
 * @summary
 * O "porquê" deste arquivo é fornecer componentes de "cartão" reutilizáveis, que são
 * a base para agrupar conteúdo visualmente na UI. Inclui um `Card` genérico e um
 * `StatCard` especializado para exibir métricas (KPIs), garantindo uma aparência
 * coesa e um layout estruturado em todo o sistema.
 */

import { cn } from '@/lib/utils'

/**
 * @interface CardProps
 * @description Propriedades para o componente `Card` base.
 */
interface CardProps {
  /** O conteúdo a ser renderizado dentro do card. */
  children: React.ReactNode
  /** Classes CSS adicionais para customizações pontuais. */
  className?: string
  /** Define o nível de espaçamento interno (padding) do card. Padrão: 'md'. */
  padding?: 'none' | 'sm' | 'md' | 'lg'
}

/**
 * @constant paddings
 * @description Mapeamento de `props` de padding para classes Tailwind CSS.
 * O "porquê": Permite controlar o espaçamento de forma declarativa, mantendo
 * os valores de padding consistentes com o design system.
 */
const paddings = {
  none: '',
  sm: 'p-4',
  md: 'p-5',
  lg: 'p-6',
}

/**
 * @component Card
 * @description Um contêiner de conteúdo fundamental com fundo escuro, bordas arredondadas e contorno sutil.
 * É a principal primitiva de layout para agrupar informações relacionadas na UI.
 */
export function Card({ children, className, padding = 'md' }: CardProps) {
  return (
    <div
      className={cn(
        // Estilo base do card: cor de fundo, arredondamento e borda.
        'bg-[#202020] rounded-2xl border border-[#474747]',
        // Aplica o padding selecionado a partir do mapeamento.
        paddings[padding],
        // Permite que classes externas sobrescrevam ou estendam o estilo.
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * @interface StatCardProps
 * @description Propriedades para o `StatCard`, um cartão especializado para estatísticas.
 */
interface StatCardProps {
  /** O título da métrica (ex: "Total de Motos"). */
  title: string
  /** O valor numérico ou textual da métrica. */
  value: string | number
  /** Texto de apoio opcional (ex: "+5% este mês"). */
  subtitle?: string
  /** Ícone do Lucide que representa a métrica (componente, não JSX). */
  icon: React.ElementType
  /** Esquema de cores para o ícone, derivado das variantes semânticas. */
  color?: 'brand' | 'success' | 'warning' | 'danger' | 'info'
  /** Classes CSS adicionais. */
  className?: string
}

/**
 * @component StatCard
 * @description Componente especializado para dashboards que exibe uma métrica (KPI) com um ícone estilizado.
 * Segue o padrão do design system Bonze: texto à esquerda, ícone à direita.
 */
export function StatCard({ title, value, subtitle, icon: Icon, className }: StatCardProps) {
  return (
    <div className={cn('flex items-center justify-between rounded-2xl border border-[#474747] bg-[#202020] px-6 py-4', className)}>
      {/* Seção de textos: Label, Valor principal e Sub (opcional). */}
      <div>
        <p className="text-[14px] font-normal text-[#9e9e9e]">{title}</p>
        <p className="text-[28px] font-bold text-[#f5f5f5]">{value}</p>
        {subtitle && <p className="text-[12px] mt-0.5 text-[#9e9e9e]">{subtitle}</p>}
      </div>
      <div className="rounded-full bg-[#323232] p-3 text-[#BAFF1A]">
        <Icon className="h-6 w-6" />
      </div>
    </div>
  )
}
