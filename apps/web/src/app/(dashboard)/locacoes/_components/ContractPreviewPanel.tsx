'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Eye, Download, AlertCircle } from 'lucide-react'
import { useContractTemplate } from '@gomoto/data'
import { resolveContractVariables, substituteVariables } from '@gomoto/core'
import type { ResolveContractVariablesInput } from '@gomoto/core'
import { renderContractTemplateHtml } from '@/lib/contract-render'
import { openHtmlDocument, printHtmlDocument } from '@/lib/contract-print'

interface ContractPreviewPanelProps {
  rentalId: string
  currentTemplateId: string | null
  customer: ResolveContractVariablesInput['customer']
  vehicle: ResolveContractVariablesInput['vehicle']
  rental: ResolveContractVariablesInput['rental']
  tenantName: string
}

// Só leitura: o modelo vinculado só muda na tela de Editar (RentalForm,
// modo edição) — aqui só visualiza/baixa o contrato com o modelo atual.
export function ContractPreviewPanel({
  rentalId, currentTemplateId, customer, vehicle, rental, tenantName,
}: ContractPreviewPanelProps) {
  const selectedTemplateQuery = useContractTemplate(currentTemplateId ?? '')
  const [busy, setBusy] = useState<'view' | 'download' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function buildContractHtml(): string | null {
    const template = selectedTemplateQuery.data
    if (!template) return null
    const html = renderContractTemplateHtml(template.content)
    if (!html) return null
    const variables = resolveContractVariables({ customer, vehicle, rental, tenantName })
    return substituteVariables(html, variables)
  }

  async function handleView() {
    setError(null)
    const html = buildContractHtml()
    if (!html) { setError('Este modelo ainda não possui conteúdo.'); return }
    setBusy('view')
    try {
      openHtmlDocument(html, selectedTemplateQuery.data!.name)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível abrir a visualização.')
    } finally {
      setBusy(null)
    }
  }

  async function handleDownload() {
    setError(null)
    const html = buildContractHtml()
    if (!html) { setError('Este modelo ainda não possui conteúdo.'); return }
    setBusy('download')
    try {
      await printHtmlDocument(html, selectedTemplateQuery.data!.name)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl bg-[#202020] p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-[#9e9e9e]">Modelo de contrato</p>
          {currentTemplateId ? (
            <Link
              href={`/contratos/modelos/${currentTemplateId}`}
              className="text-[13px] text-[#f5f5f5] transition-colors hover:text-[#BAFF1A]"
            >
              {selectedTemplateQuery.data?.name ?? '…'} →
            </Link>
          ) : (
            <p className="text-[13px] text-[#616161]">Nenhum modelo vinculado</p>
          )}
          <Link
            href={`/locacoes/${rentalId}/editar`}
            className="mt-1 block text-[12px] text-[#616161] transition-colors hover:text-[#BAFF1A]"
          >
            Trocar modelo (Editar) →
          </Link>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleView}
            disabled={!currentTemplateId || busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#474747] px-4 text-[13px] text-[#f5f5f5] transition-colors hover:border-[#BAFF1A] hover:text-[#BAFF1A] disabled:opacity-50"
          >
            <Eye className="h-3.5 w-3.5" />
            {busy === 'view' ? 'Abrindo…' : 'Visualizar'}
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!currentTemplateId || busy !== null}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#474747] px-4 text-[13px] text-[#f5f5f5] transition-colors hover:border-[#BAFF1A] hover:text-[#BAFF1A] disabled:opacity-50"
          >
            <Download className="h-3.5 w-3.5" />
            {busy === 'download' ? 'Gerando…' : 'Baixar (PDF)'}
          </button>
        </div>
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-[#ff9c9a]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  )
}
