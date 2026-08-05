'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { PageTitle } from '@/components/layout/PageTitle'
import {
  Wrench, Plus, Star, Archive, Edit2, Eye,
  MoreVertical, ArchiveRestore, Search,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useMaintenancePlans } from '@gomoto/data'
import type { MaintenancePlan } from '@gomoto/core'
import {
  archiveMaintenancePlan,
  unarchiveMaintenancePlan,
} from './actions'

const FILTERS = [
  { label: 'Ativos',     value: 'active'   },
  { label: 'Arquivados', value: 'archived' },
  { label: 'Todos',      value: 'all'      },
]

export default function MaintenancePlansPage() {
  const qc = useQueryClient()
  const { data: plans = [], isLoading } = useMaintenancePlans()

  const [filter, setFilter]         = useState('active')
  const [search, setSearch]         = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const counts = useMemo(() => ({
    active:   plans.filter((p) => p.archived_at === null).length,
    archived: plans.filter((p) => p.archived_at !== null).length,
    all:      plans.length,
  }), [plans])

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      const passesFilter =
        filter === 'active'   ? p.archived_at === null :
        filter === 'archived' ? p.archived_at !== null :
        true
      if (!passesFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q) ?? false)
    })
  }, [plans, filter, search])

  async function handleArchive(plan: MaintenancePlan) {
    setMenuOpenId(null)
    const res = await archiveMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
  }

  async function handleUnarchive(plan: MaintenancePlan) {
    setMenuOpenId(null)
    const res = await unarchiveMaintenancePlan(plan.id)
    if (res.error) alert(res.error)
    qc.invalidateQueries({ queryKey: ['maintenance_plans'] })
  }

  return (
    <div className="flex flex-col bg-[#121212]">
      <PageTitle
        title="Planos de Manutenção"
        actions={
          <Link
            href="/planos-manutencao/novo"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e818] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo plano
          </Link>
        }
      />

      {/* Barra de filtros — sticky abaixo do PageTitle */}
      <div className="sticky top-[60px] z-[9] bg-[#121212] border-b border-[#323232] px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap border-b border-[#616161]">
          {FILTERS.map((opt) => {
            const isActive = filter === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${
                  isActive
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {opt.label}
                <span className="ml-1.5 text-[#616161]">
                  ({counts[opt.value as keyof typeof counts]})
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#616161]" />
          <input
            type="text"
            placeholder="Buscar por nome ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-10 pr-4 rounded-full bg-[#323232] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all w-72"
          />
        </div>
      </div>

      {/* Conteúdo scrollável */}
      <div className="p-6">
        <div className="overflow-hidden rounded-xl bg-[#202020]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-[#f5f5f5]">
              <thead className="border-b border-[#323232]">
                <tr>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Nome</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e] hidden sm:table-cell">Descrição</th>
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" />
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <div className="w-12 h-12 bg-[#323232] rounded-full flex items-center justify-center">
                          <Wrench className="w-6 h-6 text-[#9e9e9e]" />
                        </div>
                        <p className="text-[13px] text-[#9e9e9e]">
                          {search
                            ? `Nenhum plano encontrado para "${search}"`
                            : filter === 'archived'
                              ? 'Nenhum plano arquivado'
                              : 'Nenhum plano cadastrado'}
                        </p>
                        {search && (
                          <button
                            onClick={() => setSearch('')}
                            className="text-[13px] text-[#BAFF1A] hover:underline"
                          >
                            Limpar busca
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((plan) => {
                    const isArchived = plan.archived_at !== null
                    const menuOpen   = menuOpenId === plan.id
                    return (
                      <tr
                        key={plan.id}
                        className="h-9 text-[13px] border-b border-[#323232] last:border-0 hover:bg-[#282828] transition-colors"
                      >
                        {/* Nome + badges */}
                        <td className="px-4">
                          <div className="flex items-center gap-2">
                            <Wrench className="w-3.5 h-3.5 text-[#616161] flex-shrink-0" />
                            <span className="font-medium text-[#f5f5f5] truncate max-w-[200px]">
                              {plan.name}
                            </span>
                            {plan.is_default && (
                              <Badge variant="brand">
                                <Star className="inline-block w-2.5 h-2.5 mr-1 -mt-0.5" />
                                Padrão
                              </Badge>
                            )}
                            {isArchived && (
                              <Badge variant="muted">
                                <Archive className="inline-block w-2.5 h-2.5 mr-1 -mt-0.5" />
                                Arquivado
                              </Badge>
                            )}
                          </div>
                        </td>

                        {/* Descrição */}
                        <td className="px-4 text-[#9e9e9e] hidden sm:table-cell">
                          <span className="truncate max-w-xs block">
                            {plan.description ?? '—'}
                          </span>
                        </td>

                        {/* Ações */}
                        <td className="px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/planos-manutencao/${plan.id}`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                              title="Ver detalhes"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                            <Link
                              href={`/planos-manutencao/${plan.id}/editar`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Link>

                            {/* More menu */}
                            <div className="relative">
                              <button
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                                onClick={() => setMenuOpenId(menuOpen ? null : plan.id)}
                                title="Mais ações"
                              >
                                <MoreVertical className="h-4 w-4" />
                              </button>
                              {menuOpen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-30"
                                    onClick={() => setMenuOpenId(null)}
                                    aria-hidden
                                  />
                                  <div className="absolute right-0 top-9 z-40 w-44 bg-[#282828] border border-[#474747] rounded-xl shadow-lg overflow-hidden">
                                    {isArchived ? (
                                      <button
                                        className="w-full px-3 py-2.5 text-left text-[13px] text-[#f5f5f5] hover:bg-[#323232] flex items-center gap-2.5"
                                        onClick={() => handleUnarchive(plan)}
                                      >
                                        <ArchiveRestore className="h-4 w-4 text-[#9e9e9e]" />
                                        Reativar plano
                                      </button>
                                    ) : (
                                      <button
                                        className="w-full px-3 py-2.5 text-left text-[13px] text-[#ff9c9a] hover:bg-[#323232] flex items-center gap-2.5"
                                        onClick={() => handleArchive(plan)}
                                      >
                                        <Archive className="h-4 w-4" />
                                        Arquivar plano
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
