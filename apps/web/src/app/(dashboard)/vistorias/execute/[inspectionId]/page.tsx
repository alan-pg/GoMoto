'use client'

import Link from 'next/link'
import { InspectionExecutionPanel } from '../../_components/InspectionExecutionPanel'

export default function ExecuteInspectionPage({
  params,
}: {
  params: { inspectionId: string }
}) {
  const { inspectionId } = params

  return (
    <div className="min-h-screen bg-[#121212]">
      <div className="sticky top-0 z-20 bg-[#121212]/95 backdrop-blur border-b border-[#2a2a2a] px-6 h-14 flex items-center gap-3">
        <Link href="/vistorias" className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors whitespace-nowrap">
          ← Vistorias
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="text-[15px] font-bold text-[#f5f5f5] flex-1 truncate">Vistoria</h1>
      </div>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <InspectionExecutionPanel inspectionId={inspectionId} />
      </div>
    </div>
  )
}
