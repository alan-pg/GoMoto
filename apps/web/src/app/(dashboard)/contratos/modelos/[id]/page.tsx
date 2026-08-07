import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { Edit2, Clock, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import type { ContractTemplate } from '@gomoto/core'
import { TemplatePreview } from './_components/TemplatePreview'

function fmt(d: string) {
  return new Date(d).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default async function ModeloDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const { data, error } = await supabase
    .from('contract_templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) notFound()

  const template = data as ContractTemplate

  return (
    // h-full preenche o <main> do LayoutShell sem vazar
    <div className="h-full flex flex-col bg-bg overflow-hidden">

      {/* Header com metadados */}
      <div className="shrink-0 bg-bg border-b border-divider px-6 py-3 space-y-2">
        {/* Linha 1: nav + ações */}
        <div className="flex items-center gap-2 min-w-0">
          <Link
            href="/contratos/modelos"
            className="flex items-center gap-1.5 text-[13px] text-fg-mute hover:text-fg transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            Modelos
          </Link>
          <span className="text-border shrink-0">/</span>
          <span className="text-[14px] font-semibold text-fg truncate flex-1">{template.name}</span>
          <Link href={`/contratos/modelos/${id}/editar`} className="shrink-0">
            <Button variant="secondary" size="sm" className="gap-2">
              <Edit2 className="w-4 h-4" />
              Editar
            </Button>
          </Link>
        </div>

        {/* Linha 2: meta info */}
        <div className="flex items-center gap-4">
          {template.description && (
            <p className="text-[13px] text-fg-mute truncate flex-1">{template.description}</p>
          )}
          <div className="flex items-center gap-1.5 text-[12px] text-fg-mute shrink-0 ml-auto">
            <Clock className="w-3.5 h-3.5" />
            {fmt(template.updated_at)}
          </div>
        </div>
      </div>

      {/* Preview — flex-1 preenche o restante */}
      <div className="flex-1 min-h-0 p-4">
        <TemplatePreview template={template} />
      </div>
    </div>
  )
}
