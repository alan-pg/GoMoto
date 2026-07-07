'use client'

import { useState, useMemo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import {
  Eye, Search, FileText, Settings2,
  CheckCircle, XCircle, ChevronLeft,
  User, Bike, AlertTriangle, Building2, UserRound,
  CalendarDays, Clock,
} from 'lucide-react'
import { useContracts } from '@gomoto/data'
import {
  terminateContractByCustomer,
  terminateContractByCompany,
} from './actions'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { PageTitle } from '@/components/layout/PageTitle'
import { Modal } from '@/components/ui/Modal'
import type { Contract, Customer, Vehicle } from '@gomoto/core'
import {
  CONTRACT_TERMINATION_FINE_BRL,
  calculateExpectedEndDate,
  calculateMinimumEndDate,
  getContractValidityLevel,
} from '@gomoto/core'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface ContractRow extends Omit<Contract, 'customer' | 'vehicle'> {
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'cpf' | 'rg' | 'state' | 'drivers_license' | 'drivers_license_category' | 'address' | 'zip_code'> | null
  vehicle: Pick<Vehicle, 'id' | 'model' | 'make' | 'license_plate' | 'km_current' | 'year_manufacture' | 'year_model' | 'renavam' | 'chassis' | 'color' | 'fuel'> | null
}

type TerminateStep = 'choice' | 'client' | 'company'
type StatusFilter = 'all' | 'active' | 'closed' | 'cancelled' | 'broken'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all',       label: 'Todos' },
  { key: 'active',    label: 'Ativos' },
  { key: 'closed',    label: 'Encerrados' },
  { key: 'cancelled', label: 'Cancelados' },
  { key: 'broken',    label: 'Rescindidos' },
]

const FINE_AMOUNT = CONTRACT_TERMINATION_FINE_BRL

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR')
}

function fmtBRL(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function timeRemaining(to: Date): string {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = to.getTime() - now.getTime()
  if (diff <= 0) return 'Prazo encerrado'
  const days = Math.floor(diff / 86400000)
  const months = Math.floor(days / 30)
  const years = Math.floor(months / 12)
  if (years > 0) {
    const rem = months - years * 12
    return rem > 0
      ? `${years} ano${years > 1 ? 's' : ''} e ${rem} mês${rem > 1 ? 'es' : ''}`
      : `${years} ano${years > 1 ? 's' : ''}`
  }
  if (months > 0) return `${months} mês${months > 1 ? 'es' : ''}`
  return `${days} dia${days > 1 ? 's' : ''}`
}

function getVigencia(contract: ContractRow) {
  const level = getContractValidityLevel(contract)
  if (!level) return null
  if (level === 'red') {
    return { level, label: 'Vencido', detail: 'Este contrato passou da data de encerramento prevista.' }
  }
  if (level === 'orange') {
    const minEnd = calculateMinimumEndDate(contract.start_date, contract.contract_type ?? 'rental')
    return {
      level,
      label: 'Dentro da vigência mínima',
      detail: `${timeRemaining(minEnd)} restantes. Encerramento antecipado gera multa de ${fmtBRL(FINE_AMOUNT)}.`,
    }
  }
  return {
    level,
    label: 'Vigência mínima cumprida',
    detail: contract.end_date ? `Previsto para encerrar em ${fmt(contract.end_date)}.` : 'Sem data de encerramento definida.',
  }
}

function expectedEndDate(contract: ContractRow): string {
  const end = calculateExpectedEndDate(contract)
  if (!end) return '—'
  return fmt(end.toISOString().split('T')[0])
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function ContratosPage() {
  const queryClient = useQueryClient()
  const { data: contractsData = [], isLoading: loading } = useContracts()
  const contracts = contractsData as unknown as ContractRow[]

  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const [selectedContract, setSelectedContract] = useState<ContractRow | null>(null)
  const [terminateStep, setTerminateStep] = useState<TerminateStep | null>(null)
  const [terminateReason, setTerminateReason] = useState('')
  const [terminating, setTerminating] = useState(false)

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }, [])

  const invalidateContracts = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['contracts'] }),
    [queryClient],
  )

  const filtered = useMemo(() => {
    let rows = contracts
    if (filter !== 'all') rows = rows.filter(c => c.status === filter)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(c =>
        c.customer?.name?.toLowerCase().includes(q) ||
        c.vehicle?.license_plate?.toLowerCase().includes(q) ||
        c.vehicle?.model?.toLowerCase().includes(q),
      )
    }
    return rows
  }, [contracts, filter, search])

  // ─── Encerrar ────────────────────────────────────────────────────────────

  async function handleTerminateClient() {
    if (!selectedContract) return
    setTerminating(true)
    try {
      const res = await terminateContractByCustomer(selectedContract.id)
      if (res.error) throw new Error(res.error)
      showToast('success', `Contrato encerrado. Multa de ${fmtBRL(FINE_AMOUNT)} gerada.`)
      closeDetailModal()
      invalidateContracts()
    } catch { showToast('error', 'Erro ao encerrar contrato') }
    finally { setTerminating(false) }
  }

  async function handleTerminateCompany() {
    if (!selectedContract || terminateReason.trim().length < 50) return
    setTerminating(true)
    try {
      const res = await terminateContractByCompany(selectedContract.id, terminateReason)
      if (res.error) throw new Error(res.error)
      showToast('success', 'Contrato encerrado pela empresa.')
      closeDetailModal()
      invalidateContracts()
    } catch { showToast('error', 'Erro ao encerrar contrato') }
    finally { setTerminating(false) }
  }

  function closeDetailModal() {
    setSelectedContract(null)
    setTerminateStep(null)
    setTerminateReason('')
  }

  // ─── Render ──────────────────────────────────────────────────────────────

  const vigencia = selectedContract ? getVigencia(selectedContract) : null

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">
      <PageTitle
        title="Contratos"
        actions={
          <Link href="/contratos/modelos">
            <Button variant="secondary" size="sm" className="gap-2">
              <Settings2 className="w-4 h-4" />
              Modelos
            </Button>
          </Link>
        }
      />

      {toast && (
        <div className="px-6 pt-4">
          <div className={`px-4 py-1.5 rounded-full text-[13px] font-medium flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300 w-fit ${
            toast.type === 'error' ? 'bg-[#7c1c1c] text-[#ff9c9a]' : 'bg-[#0e2f13] text-[#229731]'
          }`}>
            {toast.type === 'error' ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
            {toast.msg}
          </div>
        </div>
      )}

      <div className="p-6 space-y-5">

        {/* Filtros + Busca */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`text-[13px] pb-1 transition-colors duration-150 ${
                  filter === f.key
                    ? 'border-b-2 border-[#BAFF1A] text-[#BAFF1A]'
                    : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#616161]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cliente ou placa..."
              className="h-9 pl-9 pr-4 bg-[#202020] border border-[#474747] rounded-full text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:ring-1 focus:ring-[#BAFF1A] outline-none w-56"
            />
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-xl bg-[#202020]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-[#f5f5f5]">
              <thead className="border-b border-[#323232]">
                <tr>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Cliente</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Motocicleta</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Tipo</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Período</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Valor/mês</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex items-center justify-center py-16">
                        <div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" />
                      </div>
                    </td>
                  </tr>
                ) : filtered.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <div className="flex flex-col items-center justify-center py-16 gap-3">
                        <div className="w-12 h-12 bg-[#323232] rounded-full flex items-center justify-center">
                          <FileText className="w-6 h-6 text-[#9e9e9e]" />
                        </div>
                        <p className="text-[13px] text-[#9e9e9e]">Nenhum contrato encontrado.</p>
                        {(filter !== 'all' || search) && (
                          <button
                            onClick={() => { setFilter('all'); setSearch('') }}
                            className="text-[13px] text-[#BAFF1A] hover:underline"
                          >
                            Limpar filtros
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  filtered.map(contract => {
                    const v = getVigencia(contract)
                    return (
                      <tr
                        key={contract.id}
                        onClick={() => { setSelectedContract(contract); setTerminateStep(null) }}
                        className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232] cursor-pointer"
                      >
                        <td className="px-4">
                          {contract.customer
                            ? <div className="flex items-center gap-2">
                                <User className="w-4 h-4 text-[#a880ff] flex-shrink-0" />
                                <span className="font-medium text-[#f5f5f5] truncate max-w-[160px]">{contract.customer.name}</span>
                              </div>
                            : <span className="text-[#9e9e9e]">—</span>}
                        </td>
                        <td className="px-4">
                          {contract.vehicle
                            ? <div className="flex items-center gap-2">
                                <Bike className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
                                <span className="font-medium text-[#f5f5f5]">{contract.vehicle.make} {contract.vehicle.model}</span>
                                <span className="text-[#616161]">•</span>
                                <span className="font-mono font-bold text-[#f5f5f5]">{contract.vehicle.license_plate}</span>
                              </div>
                            : <span className="text-[#9e9e9e]">—</span>}
                        </td>
                        <td className="px-4">
                          <span className={`text-[12px] font-medium ${contract.contract_type === 'loyalty' ? 'text-[#a880ff]' : 'text-[#9e9e9e]'}`}>
                            {contract.contract_type === 'loyalty' ? 'Fidelidade' : 'Locação'}
                          </span>
                        </td>
                        <td className="px-4">
                          <span className="text-[#c7c7c7]">{fmt(contract.start_date)}</span>
                          <span className="text-[#616161] mx-1">→</span>
                          <span className="text-[#c7c7c7]">{expectedEndDate(contract)}</span>
                        </td>
                        <td className="px-4">
                          <span className="text-[#BAFF1A] font-medium">{fmtBRL(contract.monthly_amount)}</span>
                        </td>
                        <td className="px-4">
                          <div className="flex items-center gap-1.5">
                            {v && (
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                v.level === 'red' ? 'bg-[#ff9c9a]' : v.level === 'orange' ? 'bg-[#e65e24]' : 'bg-[#229731]'
                              }`} />
                            )}
                            <StatusBadge status={contract.status} />
                          </div>
                        </td>
                        <td className="px-4" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 w-8 p-0"
                              title="Ver detalhes"
                              onClick={() => { setSelectedContract(contract); setTerminateStep(null) }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
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

      {/* ── MODAL: DETALHES DO CONTRATO ──────────────────────────── */}
      <Modal open={!!selectedContract && !terminateStep} onClose={closeDetailModal} size="md">
        {selectedContract && (
          <div className="space-y-5">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <User className="w-5 h-5 text-[#a880ff]" />
                <h2 className="text-[18px] font-bold text-[#f5f5f5]">{selectedContract.customer?.name ?? '—'}</h2>
              </div>
              {selectedContract.vehicle && (
                <div className="flex items-center gap-2 text-[#9e9e9e]">
                  <Bike className="w-4 h-4" />
                  <span className="text-[13px]">{selectedContract.vehicle.make} {selectedContract.vehicle.model}</span>
                  <span className="text-[#616161]">•</span>
                  <span className="font-mono font-bold text-[#f5f5f5] text-[13px]">{selectedContract.vehicle.license_plate}</span>
                </div>
              )}
            </div>

            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium ${
              selectedContract.contract_type === 'loyalty'
                ? 'bg-[#2d0363] text-[#a880ff]'
                : 'bg-[#323232] text-[#c7c7c7]'
            }`}>
              <FileText className="w-4 h-4" />
              {selectedContract.contract_type === 'loyalty'
                ? 'Contrato com Fidelidade — Promessa de Compra'
                : 'Contrato de Locação Tradicional'}
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarDays className="w-3.5 h-3.5 text-[#9e9e9e]" />
                  <p className="text-[11px] text-[#9e9e9e] font-medium uppercase tracking-wide">Início</p>
                </div>
                <p className="text-[15px] font-bold text-[#f5f5f5]">{fmt(selectedContract.start_date)}</p>
              </div>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarDays className="w-3.5 h-3.5 text-[#9e9e9e]" />
                  <p className="text-[11px] text-[#9e9e9e] font-medium uppercase tracking-wide">Encerramento</p>
                </div>
                <p className="text-[15px] font-bold text-[#f5f5f5]">{expectedEndDate(selectedContract)}</p>
              </div>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5 text-[#9e9e9e]" />
                  <p className="text-[11px] text-[#9e9e9e] font-medium uppercase tracking-wide">Valor/mês</p>
                </div>
                <p className="text-[15px] font-bold text-[#BAFF1A]">{fmtBRL(selectedContract.monthly_amount)}</p>
              </div>
            </div>

            {vigencia ? (
              <div className={`flex items-start gap-3 rounded-xl p-4 border ${
                vigencia.level === 'red'
                  ? 'bg-[#2a0a0a] border-[#ff9c9a]/30'
                  : vigencia.level === 'orange'
                  ? 'bg-[#2a1500] border-[#e65e24]/30'
                  : 'bg-[#0a1f0a] border-[#229731]/30'
              }`}>
                {vigencia.level === 'red'
                  ? <XCircle className="w-5 h-5 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
                  : vigencia.level === 'orange'
                  ? <AlertTriangle className="w-5 h-5 text-[#e65e24] flex-shrink-0 mt-0.5" />
                  : <CheckCircle className="w-5 h-5 text-[#229731] flex-shrink-0 mt-0.5" />}
                <div>
                  <p className={`text-[14px] font-bold ${
                    vigencia.level === 'red' ? 'text-[#ff9c9a]' : vigencia.level === 'orange' ? 'text-[#e65e24]' : 'text-[#229731]'
                  }`}>{vigencia.label}</p>
                  <p className="text-[13px] text-[#c7c7c7] mt-0.5">{vigencia.detail}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[#9e9e9e] text-[13px]">
                <StatusBadge status={selectedContract.status} />
                {selectedContract.observations && <span>— {selectedContract.observations}</span>}
              </div>
            )}

            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 space-y-2">
              <p className="text-[12px] font-medium text-[#9e9e9e] uppercase tracking-wide">Regras deste contrato</p>
              {selectedContract.contract_type === 'loyalty' ? (
                <ul className="space-y-1.5 text-[13px] text-[#c7c7c7]">
                  <li className="flex items-start gap-2"><span className="text-[#a880ff] mt-0.5">•</span>Duração de <strong className="text-[#f5f5f5]">2 anos</strong> a partir da data de início</li>
                  <li className="flex items-start gap-2"><span className="text-[#e65e24] mt-0.5">•</span>Encerramento pelo <strong className="text-[#f5f5f5]">cliente</strong> antes do prazo gera multa de <strong className="text-[#ff9c9a]">{fmtBRL(FINE_AMOUNT)}</strong></li>
                  <li className="flex items-start gap-2"><span className="text-[#229731] mt-0.5">•</span>Encerramento pela <strong className="text-[#f5f5f5]">empresa</strong> não gera multa</li>
                </ul>
              ) : (
                <ul className="space-y-1.5 text-[13px] text-[#c7c7c7]">
                  <li className="flex items-start gap-2"><span className="text-[#9e9e9e] mt-0.5">•</span>Vigência mínima de <strong className="text-[#f5f5f5]">3 meses</strong></li>
                  <li className="flex items-start gap-2"><span className="text-[#e65e24] mt-0.5">•</span>Encerramento pelo <strong className="text-[#f5f5f5]">cliente</strong> gera multa de <strong className="text-[#ff9c9a]">{fmtBRL(FINE_AMOUNT)}</strong></li>
                  <li className="flex items-start gap-2"><span className="text-[#229731] mt-0.5">•</span>Encerramento pela <strong className="text-[#f5f5f5]">empresa</strong> não gera multa</li>
                </ul>
              )}
            </div>

            {selectedContract.status === 'active' && (
              <div className="pt-1 border-t border-[#2a2a2a]">
                <Button variant="danger" size="md" className="w-full" onClick={() => setTerminateStep('choice')}>
                  <XCircle className="w-4 h-4" />
                  Encerrar Contrato
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── MODAL: QUEM ESTÁ ENCERRANDO ─────────────────────────── */}
      <Modal
        open={!!selectedContract && terminateStep === 'choice'}
        onClose={closeDetailModal}
        title="Encerrar Contrato"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-[#c7c7c7]">Quem está solicitando o encerramento?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setTerminateStep('client')}
              className="flex flex-col items-center gap-3 p-5 bg-[#1a1a1a] border border-[#323232] rounded-xl hover:border-[#e65e24] hover:bg-[#2a1500] transition-all duration-150 group"
            >
              <div className="w-12 h-12 rounded-full bg-[#323232] flex items-center justify-center group-hover:bg-[#3a180f]">
                <UserRound className="w-6 h-6 text-[#c7c7c7] group-hover:text-[#e65e24]" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-medium text-[#f5f5f5]">Cliente</p>
                <p className="text-[12px] text-[#e65e24] mt-0.5">Gera multa de {fmtBRL(FINE_AMOUNT)}</p>
              </div>
            </button>
            <button
              onClick={() => setTerminateStep('company')}
              className="flex flex-col items-center gap-3 p-5 bg-[#1a1a1a] border border-[#323232] rounded-xl hover:border-[#229731] hover:bg-[#0a1f0a] transition-all duration-150 group"
            >
              <div className="w-12 h-12 rounded-full bg-[#323232] flex items-center justify-center group-hover:bg-[#0e2f13]">
                <Building2 className="w-6 h-6 text-[#c7c7c7] group-hover:text-[#229731]" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-medium text-[#f5f5f5]">Empresa</p>
                <p className="text-[12px] text-[#229731] mt-0.5">Sem multa</p>
              </div>
            </button>
          </div>
          <button
            onClick={() => setTerminateStep(null)}
            className="flex items-center gap-1.5 text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Voltar
          </button>
        </div>
      </Modal>

      {/* ── MODAL: ENCERRAR PELO CLIENTE ────────────────────────── */}
      <Modal
        open={!!selectedContract && terminateStep === 'client'}
        onClose={closeDetailModal}
        title="Encerrar pelo Cliente"
        size="sm"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 bg-[#2a0a0a] border border-[#ff9c9a]/30 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-bold text-[#ff9c9a]">Multa de {fmtBRL(FINE_AMOUNT)}</p>
              <p className="text-[13px] text-[#c7c7c7] mt-1">
                Este encerramento irá gerar uma multa de <strong className="text-[#ff9c9a]">{fmtBRL(FINE_AMOUNT)}</strong> para o cliente{' '}
                <strong className="text-[#f5f5f5]">{selectedContract?.customer?.name}</strong>.
                O valor será registrado como multa pendente.
              </p>
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setTerminateStep('choice')}>
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </Button>
            <Button variant="danger" size="md" className="flex-1" loading={terminating} onClick={handleTerminateClient}>
              Confirmar e Gerar Multa
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: ENCERRAR PELA EMPRESA ────────────────────────── */}
      <Modal
        open={!!selectedContract && terminateStep === 'company'}
        onClose={closeDetailModal}
        title="Encerrar pela Empresa"
        size="sm"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-[#c7c7c7] mb-2">
              Motivo do encerramento <span className="text-[#9e9e9e] font-normal">(mín. 50 caracteres)</span>
            </label>
            <textarea
              value={terminateReason}
              onChange={e => setTerminateReason(e.target.value)}
              rows={4}
              placeholder="Descreva o motivo pelo qual a empresa está encerrando este contrato..."
              className="w-full bg-[#121212] border border-[#474747] rounded-xl px-4 py-3 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:ring-1 focus:ring-[#BAFF1A] outline-none resize-none"
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[12px] text-[#9e9e9e]">Sem multa para o cliente</span>
              <span className={`text-[12px] font-medium ${terminateReason.trim().length >= 50 ? 'text-[#229731]' : 'text-[#9e9e9e]'}`}>
                {terminateReason.trim().length}/50
              </span>
            </div>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setTerminateStep('choice')}>
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              loading={terminating}
              disabled={terminateReason.trim().length < 50}
              onClick={handleTerminateCompany}
            >
              Confirmar Encerramento
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
