'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { PageTitle } from '@/components/layout/PageTitle'
import {
  ClipboardList, Plus, Archive, ArchiveRestore, Edit2, MoreVertical, Search, Image as ImageIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { useInspectionProfiles } from '@gomoto/data'
import type { InspectionProfile } from '@gomoto/core'
import { archiveInspectionProfile, unarchiveInspectionProfile } from './actions'

const FILTERS = [
  { label: 'Ativos',     value: 'active'   },
  { label: 'Arquivados', value: 'archived' },
  { label: 'Todos',      value: 'all'      },
]

export default function InspectionProfilesPage() {
  const qc = useQueryClient()
  const { data: profiles = [], isLoading } = useInspectionProfiles()

  const [filter, setFilter]         = useState('active')
  const [search, setSearch]         = useState('')
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)

  const counts = useMemo(() => ({
    active:   profiles.filter((p) => p.archived_at === null).length,
    archived: profiles.filter((p) => p.archived_at !== null).length,
    all:      profiles.length,
  }), [profiles])

  const filtered = useMemo(() => {
    return profiles.filter((p) => {
      const passesFilter =
        filter === 'active'   ? p.archived_at === null :
        filter === 'archived' ? p.archived_at !== null :
        true
      if (!passesFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return p.name.toLowerCase().includes(q) || (p.description?.toLowerCase().includes(q) ?? false)
    })
  }, [profiles, filter, search])

  async function handleArchive(profile: InspectionProfile) {
    setMenuOpenId(null)
    const res = await archiveInspectionProfile(profile.id)
    if (!res.ok) alert(res.error.message)
    qc.invalidateQueries({ queryKey: ['inspection-profiles'] })
  }

  async function handleUnarchive(profile: InspectionProfile) {
    setMenuOpenId(null)
    const res = await unarchiveInspectionProfile(profile.id)
    if (!res.ok) alert(res.error.message)
    qc.invalidateQueries({ queryKey: ['inspection-profiles'] })
  }

  return (
    <div className="flex flex-col bg-bg">
      <PageTitle
        title="Perfis de Vistoria"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/vistorias"
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors"
            >
              Pendências de vistoria
            </Link>
            <Link
              href="/vistorias/perfis/novo"
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo perfil
            </Link>
          </div>
        }
      />

      <div className="sticky top-[60px] z-[9] bg-bg border-b border-surface-2 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap border-b border-fg-mute">
          {FILTERS.map((opt) => {
            const isActive = filter === opt.value
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${
                  isActive
                    ? 'border-primary text-fg'
                    : 'border-transparent text-fg-mute hover:text-fg'
                }`}
              >
                {opt.label}
                <span className="ml-1.5 text-fg-mute">
                  ({counts[opt.value as keyof typeof counts]})
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-mute" />
          <input
            type="text"
            placeholder="Buscar por nome ou descrição..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 pl-10 pr-4 rounded-full bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all w-72"
          />
        </div>
      </div>

      <div className="p-6">
        <div className="overflow-hidden rounded-xl bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-fg">
              <thead className="border-b border-surface-2">
                <tr>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute">Nome</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute hidden sm:table-cell">Descrição</th>
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-fg-mute">Ações</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={3}>
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <div className="w-12 h-12 bg-surface-2 rounded-full flex items-center justify-center">
                          <ClipboardList className="w-6 h-6 text-fg-mute" />
                        </div>
                        <p className="text-[13px] text-fg-mute">
                          {search
                            ? `Nenhum perfil encontrado para "${search}"`
                            : filter === 'archived'
                              ? 'Nenhum perfil arquivado'
                              : 'Nenhum perfil de vistoria cadastrado'}
                        </p>
                        {search && (
                          <button
                            onClick={() => setSearch('')}
                            className="text-[13px] text-primary hover:underline"
                          >
                            Limpar busca
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map((profile) => {
                    const isArchived = profile.archived_at !== null
                    const menuOpen   = menuOpenId === profile.id
                    return (
                      <tr
                        key={profile.id}
                        className="h-9 text-[13px] border-b border-surface-2 last:border-0 hover:bg-surface-2 transition-colors"
                      >
                        <td className="px-4">
                          <div className="flex items-center gap-2">
                            <ImageIcon className="w-3.5 h-3.5 text-fg-mute flex-shrink-0" />
                            <span className="font-medium text-fg truncate max-w-[240px]">
                              {profile.name}
                            </span>
                            {isArchived && (
                              <Badge variant="muted">
                                <Archive className="inline-block w-2.5 h-2.5 mr-1 -mt-0.5" />
                                Arquivado
                              </Badge>
                            )}
                          </div>
                        </td>

                        <td className="px-4 text-fg-mute hidden sm:table-cell">
                          <span className="truncate max-w-xs block">
                            {profile.description ?? '—'}
                          </span>
                        </td>

                        <td className="px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/vistorias/perfis/${profile.id}/editar`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-border hover:text-fg transition-colors"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Link>

                            <div className="relative">
                              <button
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-border hover:text-fg transition-colors"
                                onClick={() => setMenuOpenId(menuOpen ? null : profile.id)}
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
                                  <div className="absolute right-0 top-9 z-40 w-44 bg-surface-2 border border-border rounded-xl shadow-lg overflow-hidden">
                                    {isArchived ? (
                                      <button
                                        className="w-full px-3 py-2.5 text-left text-[13px] text-fg hover:bg-surface-2 flex items-center gap-2.5"
                                        onClick={() => handleUnarchive(profile)}
                                      >
                                        <ArchiveRestore className="h-4 w-4 text-fg-mute" />
                                        Reativar perfil
                                      </button>
                                    ) : (
                                      <button
                                        className="w-full px-3 py-2.5 text-left text-[13px] text-danger hover:bg-surface-2 flex items-center gap-2.5"
                                        onClick={() => handleArchive(profile)}
                                      >
                                        <Archive className="h-4 w-4" />
                                        Arquivar perfil
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
