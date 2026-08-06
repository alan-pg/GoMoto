'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Building2, Plus, Eye, Edit2, Pause, Play, Search, AlertCircle,
} from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { suspendTenant, reactivateTenant } from '../actions'
import type { TenantRow } from '../page'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type StatusFilter = 'all' | 'active' | 'suspended'

// ─── Componente ───────────────────────────────────────────────────────────────

export function EmpresasListClient({
  tenants,
  loadError,
}: {
  tenants: TenantRow[]
  loadError: string | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch]             = useState('')
  const [suspendingTenant, setSuspendingTenant] = useState<TenantRow | null>(null)
  const [suspendReason, setSuspendReason]       = useState('')
  const [actionError, setActionError]           = useState<string | null>(null)

  // ── KPIs ──────────────────────────────────────────────────────────────────

  const kpis = useMemo(() => ({
    active:    tenants.filter((t) => !t.suspended_at).length,
    suspended: tenants.filter((t) => !!t.suspended_at).length,
  }), [tenants])

  // ── Filtro + busca ────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let list = tenants
    if (statusFilter === 'active')    list = list.filter((t) => !t.suspended_at)
    if (statusFilter === 'suspended') list = list.filter((t) => !!t.suspended_at)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.slug.toLowerCase().includes(q) ||
          (t.address_city ?? '').toLowerCase().includes(q) ||
          (t.contact_email ?? '').toLowerCase().includes(q),
      )
    }
    return list
  }, [tenants, statusFilter, search])

  const tabs: { value: StatusFilter; label: string; count: number }[] = [
    { value: 'all',       label: 'Todas',     count: tenants.length },
    { value: 'active',    label: 'Ativas',    count: kpis.active    },
    { value: 'suspended', label: 'Suspensas', count: kpis.suspended },
  ]

  // ── Handlers de ação ──────────────────────────────────────────────────────

  function openSuspend(tenant: TenantRow) {
    setSuspendingTenant(tenant)
    setSuspendReason('')
    setActionError(null)
  }

  function handleSuspendConfirm() {
    if (!suspendingTenant) return
    startTransition(async () => {
      const result = await suspendTenant(suspendingTenant.id, { reason: suspendReason })
      if ('error' in result && result.error) {
        setActionError(result.error as string)
        return
      }
      setSuspendingTenant(null)
      router.refresh()
    })
  }

  function handleReactivate(tenant: TenantRow) {
    setActionError(null)
    startTransition(async () => {
      const result = await reactivateTenant(tenant.id)
      if ('error' in result && result.error) {
        setActionError(result.error as string)
        return
      }
      router.refresh()
    })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col bg-bg">

      {/* Header — sticky no topo do contêiner de scroll */}
      <div className="sticky top-0 z-10 bg-bg border-b border-surface-2 px-6 h-20 flex items-center gap-4">
        <Building2 className="w-6 h-6 text-primary shrink-0" />
        <h1 className="text-[28px] font-bold text-fg">Empresas</h1>
        <span className="text-[13px] font-normal text-fg-mute">{tenants.length} cadastradas</span>
        <div className="ml-auto">
          <Link
            href="/admin/empresas/novo"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nova empresa
          </Link>
        </div>
      </div>

      {/* Barra de filtros — sticky abaixo do header (80px) */}
      <div className="sticky top-[80px] z-[9] bg-bg border-b border-surface-2 px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap border-b border-fg-mute">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setStatusFilter(tab.value)}
              className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${
                statusFilter === tab.value
                  ? 'border-primary text-fg'
                  : 'border-transparent text-fg-mute hover:text-fg'
              }`}
            >
              {tab.label}
              <span className="ml-1.5 text-fg-mute">({tab.count})</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-fg-mute" />
          <input
            type="text"
            placeholder="Buscar nome, slug, cidade…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 rounded-full border border-border bg-surface-2 pl-9 pr-4 text-[13px] text-fg placeholder:text-fg-mute focus:border-primary focus:outline-none w-60"
          />
        </div>
      </div>

      {/* Conteúdo scrollável */}
      <div className="px-6 py-4 space-y-4">

        {/* Erro de carregamento */}
        {loadError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-danger-bg border border-danger rounded-xl">
            <AlertCircle className="w-4 h-4 text-danger shrink-0" />
            <p className="text-[13px] text-danger">Falha ao carregar empresas: {loadError}</p>
          </div>
        )}

        {/* Erro de ação */}
        {actionError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-danger-bg border border-danger rounded-xl">
            <AlertCircle className="w-4 h-4 text-danger shrink-0" />
            <p className="text-[13px] text-danger">{actionError}</p>
            <button
              onClick={() => setActionError(null)}
              className="ml-auto text-[12px] text-danger hover:underline"
            >
              Fechar
            </button>
          </div>
        )}

        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-surface rounded-2xl border border-border px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-normal text-fg-mute">Empresas Ativas</p>
              <p className="text-[28px] font-bold text-fg">{kpis.active}</p>
            </div>
            <div className="rounded-full bg-success-bg p-3">
              <Building2 className="h-6 w-6 text-success" />
            </div>
          </div>
          <div className="bg-surface rounded-2xl border border-border px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-normal text-fg-mute">Suspensas</p>
              <p className="text-[28px] font-bold text-fg">{kpis.suspended}</p>
            </div>
            <div className="rounded-full bg-danger-bg p-3">
              <Pause className="h-6 w-6 text-danger" />
            </div>
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-xl bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-fg">
              <thead className="border-b border-surface-2">
                <tr>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute">Nome</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute hidden sm:table-cell">Slug</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute hidden md:table-cell">Cidade / UF</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute">Status</th>
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-fg-mute">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={5}>
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <div className="w-12 h-12 bg-surface-2 rounded-full flex items-center justify-center">
                          <Building2 className="w-6 h-6 text-fg-mute" />
                        </div>
                        <p className="text-[13px] text-fg-mute">
                          {search ? `Nenhuma empresa para "${search}"` : 'Nenhuma empresa cadastrada.'}
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
                  filtered.map((tenant) => {
                    const suspended = !!tenant.suspended_at
                    const cityUf = [tenant.address_city, tenant.address_state]
                      .filter(Boolean)
                      .join(' — ')
                    return (
                      <tr
                        key={tenant.id}
                        className="h-9 border-b border-surface-2 last:border-0 hover:bg-surface-2 transition-colors"
                      >
                        <td className="px-4 text-[13px]">
                          <Link
                            href={`/admin/empresas/${tenant.id}`}
                            className="font-medium text-fg hover:text-primary transition-colors"
                          >
                            {tenant.name}
                          </Link>
                          {tenant.legal_name && (
                            <p className="text-[11px] text-fg-mute leading-tight">{tenant.legal_name}</p>
                          )}
                        </td>
                        <td className="px-4 text-[13px] font-mono text-fg-mute hidden sm:table-cell">
                          {tenant.slug}
                        </td>
                        <td className="px-4 text-[13px] text-fg-mute hidden md:table-cell">
                          {cityUf || <span className="text-fg-mute">—</span>}
                        </td>
                        <td className="px-4 text-[13px]">
                          {suspended ? (
                            <Badge variant="danger">Suspensa</Badge>
                          ) : (
                            <Badge variant="success">Ativa</Badge>
                          )}
                        </td>
                        <td className="px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link
                              href={`/admin/empresas/${tenant.id}`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-border hover:text-fg transition-colors"
                              title="Ver detalhes"
                            >
                              <Eye className="h-4 w-4" />
                            </Link>
                            <Link
                              href={`/admin/empresas/${tenant.id}/editar`}
                              className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-border hover:text-fg transition-colors"
                              title="Editar"
                            >
                              <Edit2 className="h-4 w-4" />
                            </Link>
                            {suspended ? (
                              <button
                                onClick={() => handleReactivate(tenant)}
                                disabled={isPending}
                                title="Reativar"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-success-bg text-success hover:bg-[#1a4a1f] transition-colors disabled:opacity-50"
                              >
                                <Play className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => openSuspend(tenant)}
                                disabled={isPending}
                                title="Suspender"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-danger-bg hover:text-danger transition-colors disabled:opacity-50"
                              >
                                <Pause className="h-4 w-4" />
                              </button>
                            )}
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

      {/* Modal: Suspender empresa */}
      <Modal
        open={!!suspendingTenant}
        onClose={() => setSuspendingTenant(null)}
        title={`Suspender ${suspendingTenant?.name ?? 'empresa'}`}
        size="sm"
      >
        <div className="space-y-4">
          <div className="p-3 bg-danger-bg border border-danger rounded-xl">
            <p className="text-[13px] text-fg-soft leading-relaxed">
              A empresa não conseguirá acessar dados enquanto suspensa. O time interno
              continua vendo o login com a mensagem de suspensão.
            </p>
          </div>
          <Input
            label="Motivo da suspensão"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Ex.: inadimplência da mensalidade"
            disabled={isPending}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => setSuspendingTenant(null)}
              disabled={isPending}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSuspendConfirm}
              disabled={isPending || suspendReason.trim().length === 0}
            >
              {isPending ? 'Suspendendo…' : 'Confirmar suspensão'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
