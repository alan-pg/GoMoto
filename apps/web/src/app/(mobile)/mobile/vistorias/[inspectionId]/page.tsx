'use client'

import Link from 'next/link'
import { InspectionExecutionPanel } from '@/app/(dashboard)/vistorias/_components/InspectionExecutionPanel'

/**
 * Execução de vistoria no pátio (ADR 0018) — wrapper fino em torno do mesmo
 * `InspectionExecutionPanel` usado no desktop (`/vistorias/execute/[id]`) e
 * embutido em `/locacoes/[id]`. Nenhuma lógica de negócio duplicada; só o
 * layout muda (sem chrome de Sidebar/Topbar do dashboard).
 */
export default function MobileExecuteInspectionPage({
  params,
}: {
  params: { inspectionId: string }
}) {
  const { inspectionId } = params

  return (
    <div>
      <div className="sticky top-12 z-20 bg-[#121212]/95 backdrop-blur border-b border-[#2a2a2a] px-4 h-11 flex items-center gap-3">
        <Link href="/mobile/vistorias" className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors whitespace-nowrap">
          ← Vistorias
        </Link>
      </div>
      <div className="px-4 py-6">
        <InspectionExecutionPanel inspectionId={inspectionId} />
      </div>
    </div>
  )
}
