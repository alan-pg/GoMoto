/**
 * @file src/app/(dashboard)/planos-manutencao/page.tsx
 * @description Listagem read-only de planos de manutenção (PRD 0003 F2.1).
 *
 * Esta é a primeira fatia de F2 — só leitura, sem mutação. Serve para validar
 * layout (lista + detalhe expansível com itens) antes de F2.2 (CRUD completo
 * com chips de sugestões). Mutação fica desabilitada explicitamente para
 * sinalizar a intenção.
 */

'use client'

import { useState, useMemo } from 'react'
import { Wrench, ChevronDown, ChevronUp, Search, Plus, Star, Archive } from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useMaintenancePlans, useMaintenancePlan } from '@gomoto/data'
import type { MaintenancePlan, MaintenancePlanItem, MaintenancePlanItemCategory } from '@gomoto/core'

const CATEGORY_LABELS: Record<MaintenancePlanItemCategory, string> = {
  oil: 'Óleo',
  filter: 'Filtro',
  brake: 'Freio',
  tire: 'Pneu',
  wear_part: 'Peça de desgaste',
  inspection: 'Vistoria',
  fluid: 'Fluido',
  transmission: 'Transmissão',
  other: 'Outros',
}

const CATEGORY_VARIANT: Record<MaintenancePlanItemCategory, 'info' | 'success' | 'warning' | 'muted' | 'brand' | 'danger' | 'orange'> = {
  oil: 'brand',
  filter: 'info',
  brake: 'danger',
  tire: 'warning',
  wear_part: 'muted',
  inspection: 'info',
  fluid: 'success',
  transmission: 'orange',
  other: 'muted',
}

function formatInterval(item: MaintenancePlanItem): string {
  const parts: string[] = []
  if (item.interval_km) parts.push(`${item.interval_km.toLocaleString('pt-BR')} km`)
  if (item.interval_days) parts.push(`${item.interval_days} dias`)
  return parts.join(' • ')
}

function PlanItemsList({ planId }: { planId: string }) {
  const { data: plan, isLoading } = useMaintenancePlan(planId)
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
      </div>
    )
  }
  const items = plan?.items ?? []
  if (items.length === 0) {
    return (
      <div className="px-4 py-6 text-center">
        <p className="text-[13px] text-[#9e9e9e]">Plano sem itens.</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="h-9 border-b border-[#323232]">
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Item</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Categoria</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Intervalo</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Alerta</th>
            <th className="h-9 px-4 text-[#9e9e9e] text-[13px] font-medium">Crítico</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="h-9 border-b border-[#323232]">
              <td className="px-4">
                <p className="font-medium text-[#f5f5f5] text-[13px]">{item.name}</p>
                {item.tip && (
                  <p className="text-[12px] text-[#616161]">{item.tip}</p>
                )}
              </td>
              <td className="px-4">
                <Badge variant={CATEGORY_VARIANT[item.category]}>{CATEGORY_LABELS[item.category]}</Badge>
              </td>
              <td className="px-4 text-[#f5f5f5] text-[13px]">{formatInterval(item)}</td>
              <td className="px-4 text-[#9e9e9e] text-[13px]">
                {item.warn_threshold_pct != null ? `${item.warn_threshold_pct}%` : '—'}
              </td>
              <td className="px-4">
                {item.is_critical ? (
                  <Badge variant="danger">Crítico</Badge>
                ) : (
                  <span className="text-[13px] text-[#616161]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PlanCard({ plan, expanded, onToggle }: {
  plan: MaintenancePlan
  expanded: boolean
  onToggle: () => void
}) {
  const isArchived = plan.archived_at !== null
  return (
    <div className="bg-[#202020] rounded-xl overflow-hidden">
      <button
        className="w-full min-h-[56px] flex items-center justify-between gap-4 p-4 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
          <p className="font-medium text-[#f5f5f5] text-[13px]">{plan.name}</p>
          {plan.is_default && (
            <Badge variant="brand">
              <Star className="inline-block w-3 h-3 mr-1 -mt-0.5" />
              Default
            </Badge>
          )}
          {isArchived && (
            <Badge variant="muted">
              <Archive className="inline-block w-3 h-3 mr-1 -mt-0.5" />
              Arquivado
            </Badge>
          )}
          {plan.description && (
            <span className="text-[12px] text-[#9e9e9e] ml-2 truncate">{plan.description}</span>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-[#9e9e9e]" />
          ) : (
            <ChevronDown className="w-4 h-4 text-[#9e9e9e]" />
          )}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#323232]">
          <PlanItemsList planId={plan.id} />
        </div>
      )}
    </div>
  )
}

export default function MaintenancePlansPage() {
  const { data: plans = [], isLoading } = useMaintenancePlans()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showArchived, setShowArchived] = useState(false)

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (!showArchived && p.archived_at !== null) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [plans, search, showArchived])

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title="Planos de Manutenção"
        subtitle={`${plans.length} plano(s) cadastrado(s)`}
        actions={
          <Button disabled title="Disponível na próxima fatia (F2.2)">
            <Plus className="w-4 h-4" />
            Novo plano
          </Button>
        }
      />

      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 px-4 bg-[#323232] border border-[#474747] rounded-full h-10 w-72 focus-within:border-[#616161]">
            <Search className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
            <input
              type="text"
              placeholder="Buscar plano por nome ou descrição..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 bg-transparent text-[#f5f5f5] text-[13px] outline-none placeholder:text-[#616161]"
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-[#9e9e9e] cursor-pointer">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="accent-[#BAFF1A]"
            />
            Mostrar arquivados
          </label>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <Wrench className="w-12 h-12 text-[#616161] mx-auto mb-3" />
              <p className="text-[13px] text-[#9e9e9e]">
                {search ? `Nenhum plano para "${search}"` : 'Nenhum plano cadastrado'}
              </p>
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="mt-2 text-[13px] text-[#BAFF1A] hover:underline"
                >
                  Limpar busca
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((plan) => (
              <PlanCard
                key={plan.id}
                plan={plan}
                expanded={expandedId === plan.id}
                onToggle={() => setExpandedId((prev) => (prev === plan.id ? null : plan.id))}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
