/**
 * @file src/app/(dashboard)/relatorios/page.tsx
 * @description Página de Relatórios e Business Intelligence do sistema GoMoto.
 * 
 * @summary
 * Esta página é o centro de análise de dados do negócio. O "porquê" de sua existência
 * é transformar os dados operacionais (cobranças, despesas, contratos) em insights
 * estratégicos. Ela apresenta um resumo financeiro do mês corrente e serve como
 * ponto de partida para a geração de relatórios detalhados que ajudam na tomada de
 * decisões, como identificar a moto mais lucrativa ou o cliente com maior histórico de pagamentos.
 * 
 * @observacao
 * Atualmente, a maioria das funcionalidades de exportação (PDF, Excel) está em desenvolvimento,
 * sendo a UI um protótipo funcional para demonstrar os tipos de relatórios planejados.
 */

'use client'

import { useState, useCallback, useMemo } from 'react'
import {
  BarChart2,
  Bike,
  Users,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  DollarSign,
  FileText,
  Lock,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Card, StatCard } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatCurrency } from '@/lib/utils'

/**
 * @interface ReportCard
 * @description Define a estrutura de dados para cada card de relatório exibido na UI.
 * O "porquê" desta interface é padronizar como os relatórios são definidos,
 * garantindo que todos tenham título, descrição, ícone e status de disponibilidade.
 */
interface ReportCard {
  id: string          // Identificador único do tipo de relatório.
  title: string       // Título exibido no card.
  description: string // Descrição curta da finalidade do relatório.
  icon: React.ReactNode // Ícone do Lucide-react para representação visual.
  color: 'brand' | 'success' | 'warning' | 'danger' | 'info' // Tema de cor para o ícone.
  available: boolean  // Flag que indica se a funcionalidade de geração já está implementada.
}

/**
 * @constant reports
 * @description Lista estática de relatórios planejados para o sistema.
 * O "porquê": Funciona como um catálogo de funcionalidades, permitindo renderizar a grade
 * de opções na interface de forma dinâmica e controlar quais relatórios estão
 * disponíveis para o usuário.
 */
const reports: ReportCard[] = [
  {
    id: 'financeiro-mensal',
    title: 'Relatório Financeiro Mensal',
    description:
      'Visão completa das entradas e despesas do mês, saldo final e comparativo com mês anterior.',
    icon: <BarChart2 className="w-6 h-6" />,
    color: 'brand',
    available: false,
  },
  {
    id: 'por-moto',
    title: 'Relatório por Moto',
    description:
      'Histórico de locações, manutenções e receita gerada por cada moto da frota.',
    icon: <Bike className="w-6 h-6" />,
    color: 'info',
    available: false,
  },
  {
    id: 'por-cliente',
    title: 'Relatório por Cliente',
    description:
      'Histórico de contratos, cobranças e inadimplência por cliente.',
    icon: <Users className="w-6 h-6" />,
    color: 'success',
    available: false,
  },
  {
    id: 'fluxo-caixa',
    title: 'Fluxo de Caixa',
    description:
      'Projeção de entradas e saídas dos próximos 30, 60 e 90 dias.',
    icon: <ArrowLeftRight className="w-6 h-6" />,
    color: 'warning',
    available: false,
  },
]

/**
 * @constant monthlyStats
 * @description Objeto com estatísticas simuladas do mês para exibição nos cards de resumo.
 * O "porquê": Em um ambiente real, estes dados seriam o resultado de uma consulta
 * agregada ao banco de dados (via Supabase), mas o mock permite desenvolver
 * e testar a UI de forma independente.
 */
const monthlyStats = {
  revenue: 3850,              // Soma total de entradas (receita bruta).
  expenses: 2030,             // Soma total de saídas (despesas operacionais).
  balance: 1820,              // Saldo líquido (receita - despesas).
  activeContracts: 2,         // Contagem de contratos com status 'ativo'.
  pendingCharges: 2,          // Contagem de cobranças que ainda não foram pagas.
  totalFines: 618.86,         // Valor total acumulado de multas de trânsito no mês.
}

/**
 * @const REPORT_COLOR_MAP
 * @description Mapeamento de estilos por cor semântica do relatório.
 * Definido no módulo (fora do componente) para ser criado apenas uma vez.
 */
const REPORT_COLOR_MAP: Record<ReportCard['color'], { bg: string; text: string; border: string }> = {
  brand:   { bg: 'bg-[#243300]', text: 'text-[#BAFF1A]', border: 'border-[#6b9900]' },
  success: { bg: 'bg-[#0e2f13]', text: 'text-[#229731]', border: 'border-[#28b438]' },
  warning: { bg: 'bg-[#3a180f]', text: 'text-[#e65e24]', border: 'border-[#e65e24]' },
  danger:  { bg: 'bg-[#7c1c1c]', text: 'text-[#ff9c9a]', border: 'border-[#ff9c9a]' },
  info:    { bg: 'bg-[#2d0363]', text: 'text-[#a880ff]', border: 'border-[#a880ff]' },
}

/**
 * @component ReportsPage
 * @description Componente principal que renderiza o cabeçalho, o resumo mensal e a lista de relatórios.
 */
export default function ReportsPage() {
  /**
   * @state showToast
   * @description Controla a visibilidade da notificação (toast) de "em breve".
   * O "porquê": Fornece feedback visual ao usuário quando ele tenta interagir com
   * uma funcionalidade que ainda não está disponível.
   */
  const [showToast, setShowToast] = useState(false)

  /**
   * @function handleGenerateReport
   * @description Função acionada ao clicar em um botão de gerar relatório.
   * O "porquê": Atualmente, sua função é apenas de feedback, exibindo um alerta
   * de que a funcionalidade está em construção. Em uma versão futura, esta função
   * iniciaria o processo de geração e download do relatório correspondente.
   */
  const handleGenerateReport = useCallback(() => {
    setShowToast(true)
    setTimeout(() => setShowToast(false), 3000) // Oculta a notificação após 3 segundos.
  }, [])

  /**
   * @const monthName
   * @description Formata a data atual para exibir o nome do mês e o ano em português.
   * Ex: "Março de 2026". Usado para dar contexto temporal aos dados exibidos.
   */
  const monthName = useMemo(
    () => new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date()),
    []
  )

  return (
    <div className="flex flex-col min-h-full">
      {/* Cabeçalho da página */}
      <Header title="Relatórios" subtitle="Análises e exportações do sistema" />

      <div className="p-6 space-y-6">
        {/* SEÇÃO: Resumo do Mês Atual */}
        <div>
          <p className="text-[12px] text-[#9e9e9e] mb-3">
            Resumo — {monthName.charAt(0).toUpperCase() + monthName.slice(1)}
          </p>
          
          {/* Grid de cartões com estatísticas rápidas do mês. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard
              title="Receita"
              value={formatCurrency(monthlyStats.revenue)}
              icon={TrendingUp}
              color="success"
            />
            <StatCard
              title="Despesas"
              value={formatCurrency(monthlyStats.expenses)}
              icon={TrendingDown}
              color="danger"
            />
            <StatCard
              title="Saldo"
              value={formatCurrency(monthlyStats.balance)}
              icon={DollarSign}
              color="brand"
            />
            <StatCard
              title="Contratos Ativos"
              value={monthlyStats.activeContracts}
              icon={FileText}
              color="brand"
            />
            <StatCard
              title="Cobranças Pendentes"
              value={monthlyStats.pendingCharges}
              icon={AlertTriangle}
              color="warning"
            />
            <StatCard
              title="Multas"
              value={formatCurrency(monthlyStats.totalFines)}
              icon={AlertCircle}
              color="danger"
            />
          </div>
        </div>

        {/* SEÇÃO: Lista de Cards de Relatórios disponíveis para geração. */}
        <div>
          <p className="text-[12px] text-[#9e9e9e] mb-3">
            Relatórios disponíveis
          </p>
          
          {/**
           * @const reportColorMap
           * @description Mapeamento de estilos baseado na propriedade `color` do relatório.
           * Definido fora do .map() para não ser recriado a cada iteração.
           */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {reports.map((report) => {
              const styles = REPORT_COLOR_MAP[report.color]

              return (
                <div
                  key={report.id}
                  className="bg-[#202020] rounded-xl p-4 flex items-start gap-4 hover:bg-[#262626] transition-colors"
                >
                  {/* Container do Ícone com cores dinâmicas */}
                  <div className={`p-3 rounded-full flex-shrink-0 ${styles.bg} border ${styles.border}`}>
                    <div className={styles.text}>{report.icon}</div>
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Título e Badge de disponibilidade */}
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-[14px] font-semibold text-[#f5f5f5]">{report.title}</h3>
                      {!report.available && (
                        <Badge variant="muted" className="text-[12px]">
                          Em breve
                        </Badge>
                      )}
                    </div>

                    <p className="text-[13px] text-[#9e9e9e] mb-4 leading-relaxed">{report.description}</p>
                    
                    {/* Botão de ação (desabilitado se o relatório não estiver disponível) */}
                    <Button
                      size="sm"
                      variant={report.available ? 'primary' : 'outline'}
                      onClick={handleGenerateReport}
                      disabled={!report.available}
                      className={!report.available ? 'bg-[#323232] text-[#9e9e9e] cursor-not-allowed' : ''}
                    >
                      {!report.available && <Lock className="w-3.5 h-3.5" />}
                      {report.available ? (
                        <>
                          <FileText className="w-3.5 h-3.5" />
                          Gerar Relatório
                        </>
                      ) : (
                        'Em desenvolvimento'
                      )}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* SEÇÃO: Aviso de rodapé sobre o estado de desenvolvimento dos relatórios. */}
        <Card className="text-center py-8">
          <BarChart2 className="w-12 h-12 text-[#616161] mx-auto mb-3" />
          <p className="text-[#f5f5f5] font-medium mb-1">Relatórios em desenvolvimento</p>
          <p className="text-[13px] text-[#9e9e9e] max-w-md mx-auto">
            Os relatórios completos com exportação em PDF e Excel estão sendo desenvolvidos e estarão
            disponíveis em breve.
          </p>
        </Card>
      </div>

      {/* NOTIFICAÇÃO (Toast): Feedback para relatórios bloqueados. */}
      {showToast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl bg-[#202020] border border-[#6b9900] shadow-2xl animate-in fade-in slide-in-from-bottom">
          <div className="w-2 h-2 rounded-full bg-[#BAFF1A]" />
          <p className="text-[13px] text-[#f5f5f5]">Este relatório ainda não está disponível.</p>
        </div>
      )}
    </div>
  )
}
