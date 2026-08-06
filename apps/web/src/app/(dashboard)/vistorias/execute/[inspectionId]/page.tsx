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
    <div className="min-h-screen bg-bg">
      <div className="sticky top-0 z-20 bg-bg backdrop-blur border-b border-border px-6 h-14 flex items-center gap-3">
        <Link href="/vistorias" className="text-[13px] text-fg-mute hover:text-fg transition-colors whitespace-nowrap">
          ← Vistorias
        </Link>
        <span className="text-fg-mute">/</span>
        <h1 className="text-[15px] font-bold text-fg flex-1 truncate">Vistoria</h1>
      </div>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <InspectionExecutionPanel inspectionId={inspectionId} />
      </div>
    </div>
  )
}
