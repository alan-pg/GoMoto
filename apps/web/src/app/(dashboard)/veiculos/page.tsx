'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Plus, Edit2, Trash2, Eye, Bike, AlertCircle, Search } from 'lucide-react'

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
    <div className="min-h-screen bg-[#121212]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-20 flex items-center gap-4">
        <h1 className="text-[28px] font-bold text-[#f5f5f5]">Veículos</h1>
        <span className="text-[13px] font-normal text-[#9e9e9e]">{vehicles.length} na frota</span>
        <div className="ml-auto">
          <Link
            href="/veiculos/novo"
            className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e818] transition-colors"
          >
            <Plus className="w-4 h-4" />
            Novo Veículo
          </Link>
        </div>
      </div>

      <div className="px-6 py-4 space-y-4">
        {/* Banner de erro */}
        {fetchError && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#ff9c9a] flex-shrink-0" />
            <p className="text-[13px] text-[#ff9c9a]">{fetchError}</p>
            <button onClick={() => vehiclesQuery.refetch()} className="ml-auto text-[12px] text-[#BAFF1A] hover:underline font-medium">
              Tentar novamente
            </button>
          </div>
        )}

        {/* Banner: motos sem plano de manutenção */}
        {!loading && vehiclesWithoutPlanCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-[#2d2300] border border-[#ffd166] rounded-xl">
            <AlertCircle className="w-4 h-4 text-[#ffd166] flex-shrink-0" />
            <p className="text-[13px] text-[#ffd166] flex-1">
              <strong>{vehiclesWithoutPlanCount}</strong>{' '}
              {vehiclesWithoutPlanCount === 1 ? 'veículo está sem plano' : 'veículos estão sem plano'} de manutenção atribuído.
            </p>
            <Link href="/planos-manutencao" className="text-[12px] text-[#ffd166] hover:underline font-medium whitespace-nowrap">
              Gerenciar planos →
            </Link>
          </div>
        )}

        {/* Filtros e busca */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap border-b border-[#616161]">
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
                  className={`px-3 py-2 text-[13px] font-medium transition-all border-b-2 ${isActive ? 'border-[#BAFF1A] text-[#f5f5f5]' : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'}`}
                >
                  {opt.label}
                  <span className="ml-1.5 text-[#616161]">({count})</span>
                </button>
              )
            })}
          </div>
          <div className="ml-auto relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#616161]" />
            <input
              type="text"
              placeholder="Buscar placa, modelo, marca ou cor..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-10 pr-4 rounded-full bg-[#323232] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all"
            />
          </div>
        </div>
      </div>

      {/* Tabela */}
      <div className="px-6 pb-10">
        <div className="overflow-hidden rounded-xl bg-[#202020]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-[#f5f5f5]">
              <thead className="text-[#9e9e9e] border-b border-[#323232]">
                <tr>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e] w-10" />
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Placa</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Veículo</th>
                  <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Status</th>
                  <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5}><div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" /></div></td></tr>
                ) : filteredVehicles.length === 0 ? (
                  <tr><td colSpan={5}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-12 h-12 bg-[#323232] rounded-full flex items-center justify-center">
                        <Bike className="w-6 h-6 text-[#9e9e9e]" />
                      </div>
                      <p className="text-[13px] text-[#9e9e9e]">Nenhum veículo encontrado.</p>
                      <button
                        onClick={() => { setFilter('active'); setSearch('') }}
                        className="text-[13px] text-[#BAFF1A] hover:underline"
                      >
                        Limpar filtros
                      </button>
                    </div>
                  </td></tr>
                ) : (
                  filteredVehicles.map((vehicle) => (
                    <tr key={vehicle.id} className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232]">
                      <td className="px-2">
                        {vehicle.photo_url ? (
                          <img src={vehicle.photo_url} alt="" className="w-7 h-7 rounded object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded bg-[#323232] flex items-center justify-center">
                            <Bike className="w-3.5 h-3.5 text-[#616161]" />
                          </div>
                        )}
                      </td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColorMap[vehicle.status] ?? '#9e9e9e' }} />
                          <span className="font-mono font-bold text-[#f5f5f5]">{vehicle.license_plate}</span>
                        </div>
                      </td>
                      <td className="px-4">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-[#f5f5f5]">{vehicle.make} {vehicle.model}</p>
                          {!vehicle.maintenance_plan_id && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium text-[#ffd166] bg-[#3a2f00] border border-[#ffd166]/40"
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
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
                            title="Ver detalhes"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <Link
                            href={`/veiculos/${vehicle.id}/editar`}
                            className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-[#323232] text-[#9e9e9e] hover:bg-[#474747] hover:text-[#f5f5f5] transition-colors"
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
          <div className="p-4 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl">
            <p className="text-[#9e9e9e] text-[13px] leading-relaxed text-center">
              Você está prestes a remover o veículo<br />
              <strong className="text-[#f5f5f5] text-base font-bold">
                {deletingVehicle?.make} {deletingVehicle?.model} — {deletingVehicle?.license_plate}
              </strong>
              <br /><br />
              Esta operação <span className="text-[#ff9c9a] font-bold underline">não pode ser desfeita</span>.
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
