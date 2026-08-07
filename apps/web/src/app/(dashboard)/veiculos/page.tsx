'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Edit2, Trash2, Eye, Bike, AlertCircle, Search } from 'lucide-react'
import { PageTitle } from '@/components/layout/PageTitle'

import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'

import { useVehicles, useDeleteVehicle } from '@gomoto/data'
import type { Vehicle } from '@gomoto/core'

// ─── Constantes ──────────────────────────────────────────────────────────────

const filterOptions = [
  { label: 'Ativas',      value: 'active' },
  { label: 'Disponíveis', value: 'available' },
  { label: 'Alugadas',    value: 'rented' },
  { label: 'Reservadas',  value: 'reserved' },
  { label: 'Manutenção',  value: 'maintenance' },
  { label: 'Sinistradas', value: 'sinister' },
  { label: 'Vendidas',    value: 'sold' },
  { label: 'Desativadas', value: 'inactive' },
  { label: 'Todas',       value: 'all' },
]

const ACTIVE_STATUSES = ['available', 'rented', 'reserved', 'maintenance', 'sinister']

const statusColorMap: Record<string, string> = {
  available:   '#28b438',
  rented:      '#a880ff',
  reserved:    '#818cf8',
  maintenance: '#e65e24',
  sinister:    '#f87171',
  sold:        '#9e9e9e',
  inactive:    '#474747',
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function VehiclesPage() {
  const vehiclesQuery    = useVehicles()
  const deleteMutation   = useDeleteVehicle()

  const vehicles  = (vehiclesQuery.data ?? []) as Vehicle[]
  const loading   = vehiclesQuery.isLoading
  const fetchError = vehiclesQuery.error
    ? 'Não foi possível carregar a frota. Verifique a conexão e tente novamente.'
    : null

  const [filter, setFilter]               = useState('active')
  const [search, setSearch]               = useState('')
  const [deletingVehicle, setDeletingVehicle] = useState<Vehicle | null>(null)

  const vehiclesWithoutPlanCount = useMemo(
    () => vehicles.filter((v) => !v.maintenance_plan_id).length,
    [vehicles],
  )

  const filteredVehicles = useMemo(
    () => vehicles.filter((v) => {
      const passesFilter =
        filter === 'all'    ? true :
        filter === 'active' ? ACTIVE_STATUSES.includes(v.status) :
                              v.status === filter
      const passesSearch = !search || [v.license_plate, v.model, v.make, v.color].some(
        (f) => f?.toLowerCase().includes(search.toLowerCase()),
      )
      return passesFilter && passesSearch
    }),
    [vehicles, filter, search],
  )

  async function confirmDeletion() {
    if (!deletingVehicle) return
    try {
      await deleteMutation.mutateAsync(deletingVehicle.id)
    } finally {
      setDeletingVehicle(null)
    }
  }

  return (
    <div className="flex flex-col bg-bg">
      <PageTitle
        title="Veículos"
        actions={
          <Link
            href="/veiculos/novo"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Veículo
          </Link>
        }
      />

      {/* Barra de filtros — sticky abaixo do PageTitle */}
      <div className="sticky top-[60px] z-[9] bg-bg border-b border-divider px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap border-b border-fg-mute">
          {filterOptions.map((opt) => {
            const isActive = filter === opt.value
            const count =
              opt.value === 'all'    ? vehicles.length :
              opt.value === 'active' ? vehicles.filter((v) => ACTIVE_STATUSES.includes(v.status)).length :
                                       vehicles.filter((v) => v.status === opt.value).length
            return (
              <button
                key={opt.value}
                onClick={() => setFilter(opt.value)}
                className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${isActive ? 'border-primary text-fg' : 'border-transparent text-fg-mute hover:text-fg'}`}
              >
                {opt.label}
                <span className="ml-1.5 text-fg-mute">({count})</span>
              </button>
            )
          })}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-fg-mute" />
          <input
            type="text"
            placeholder="Buscar placa, modelo, marca ou cor..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-full bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* Conteúdo scrollável: banners + tabela */}
      <div className="p-6 space-y-4">
        {fetchError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-danger-bg border border-danger rounded-xl">
            <AlertCircle className="w-4 h-4 text-danger flex-shrink-0" />
            <p className="text-[13px] text-danger">{fetchError}</p>
            <button onClick={() => vehiclesQuery.refetch()} className="ml-auto text-[12px] text-primary hover:underline font-medium">
              Tentar novamente
            </button>
          </div>
        )}

        {!loading && vehiclesWithoutPlanCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-pending-bg border border-pending rounded-xl">
            <AlertCircle className="w-4 h-4 text-pending flex-shrink-0" />
            <p className="text-[13px] text-pending flex-1">
              <strong>{vehiclesWithoutPlanCount}</strong>{' '}
              {vehiclesWithoutPlanCount === 1 ? 'veículo está sem plano' : 'veículos estão sem plano'} de manutenção atribuído.
            </p>
            <Link href="/planos-manutencao" className="text-[12px] text-pending hover:underline font-medium whitespace-nowrap">
              Gerenciar planos →
            </Link>
          </div>
        )}

        <div className="overflow-hidden rounded-xl bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-fg">
              <thead className="text-fg-mute border-b border-divider">
                <tr>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute w-10" />
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute">Placa</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute">Veículo</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-fg-mute">Status</th>
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-fg-mute">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}><div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div></td></tr>
                ) : filteredVehicles.length === 0 ? (
                  <tr><td colSpan={5}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-12 h-12 bg-surface-2 rounded-full flex items-center justify-center">
                        <Bike className="w-6 h-6 text-fg-mute" />
                      </div>
                      <p className="text-[13px] text-fg-mute">Nenhum veículo encontrado.</p>
                      <button
                        onClick={() => { setFilter('active'); setSearch('') }}
                        className="text-[13px] text-primary hover:underline"
                      >
                        Limpar filtros
                      </button>
                    </div>
                  </td></tr>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="h-9 text-[13px] border-b border-divider transition-colors hover:bg-surface-2">
                      <td className="px-2">
                        {vehicle.photo_url ? (
                          <img src={vehicle.photo_url} alt="" className="w-7 h-7 rounded object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-surface-2 flex items-center justify-center">
                            <Bike className="w-3.5 h-3.5 text-fg-mute" />
                          </div>
                        )}
                      </td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColorMap[vehicle.status] ?? '#9e9e9e' }} />
                          <span className="font-mono font-bold text-fg">{vehicle.license_plate}</span>
                        </div>
                      </td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-fg">{vehicle.make} {vehicle.model}</p>
                          {!vehicle.maintenance_plan_id && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-pending bg-pending-bg border border-pending/40"
                              title="Sem plano de manutenção atribuído"
                            >
                              Sem plano
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4"><StatusBadge status={vehicle.status} /></td>
                      <td className="px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/veiculos/${vehicle.id}`}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-border hover:text-fg transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            href={`/veiculos/${vehicle.id}/editar`}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-surface-2 text-fg-mute hover:bg-border hover:text-fg transition-colors"
                            title="Editar"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Link>
                          <Button
                            variant="danger"
                            size="sm"
                            className="h-8 w-8 p-0"
                            title="Excluir"
                            onClick={() => setDeletingVehicle(vehicle)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal: confirmação de exclusão */}
      <Modal open={!!deletingVehicle} onClose={() => setDeletingVehicle(null)} title="Confirmar Exclusão" size="sm">
        <div className="space-y-6">
          <div className="p-4 bg-danger-bg border border-danger rounded-xl">
            <p className="text-fg-mute text-[13px] leading-relaxed text-center">
              Você está prestes a remover o veículo<br />
              <strong className="text-fg text-base font-bold">
                {deletingVehicle?.make} {deletingVehicle?.model} — {deletingVehicle?.license_plate}
              </strong>
              <br /><br />
              Esta operação <span className="text-danger font-bold underline">não pode ser desfeita</span>.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => setDeletingVehicle(null)} className="flex-1">
              CANCELAR
            </Button>
            <Button variant="danger" onClick={confirmDeletion} className="flex-1" loading={deleteMutation.isPending}>
              <Trash2 className="w-4 h-4" />
              EXCLUIR
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
