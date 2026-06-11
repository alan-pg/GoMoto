/**
 * @file src/app/(dashboard)/clientes/page.tsx
 *
 * @description
 * Página de gerenciamento de clientes (locatários) do sistema GoMoto.
 * Exibe KPIs de clientes ativos e ex-clientes, filtros por status e estado,
 * busca textual e CRUD completo via modais.
 * Layout segue 100% o padrão da tela de manutenção e o design system Bonze.
 *
 * FUNCIONALIDADES:
 * 1. KPIs: total de clientes ativos e ex-clientes.
 * 2. Filtros rápidos por status (Todos / Ativos / Ex-Clientes) + estado + busca textual.
 * 3. Tabela com moto atual de cada cliente via join com contratos ativos.
 * 4. Edição completa de dados cadastrais via modal.
 * 5. Exclusão protegida: bloqueia se houver contrato ativo vinculado.
 * 6. Modal de detalhes com todos os campos e documentos anexados.
 * 7. Link direto para WhatsApp a partir do telefone do cliente.
 */

'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Edit2, Trash2, Eye, Search, MessageCircle,
  Users, UserMinus,
} from 'lucide-react'
import { Header } from '@/components/layout/Header'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import type { Customer } from '@/types'

// ---------------------------------------------------------------------------
// Cliente Supabase — instância única no módulo (mesmo padrão da manutenção)
// ---------------------------------------------------------------------------

/** @constant supabase - Instância do cliente Supabase para operações client-side. */
const supabase = createClient()

// ---------------------------------------------------------------------------
// Constantes de apoio
// ---------------------------------------------------------------------------

/**
 * @constant STATE_OPTIONS - UFs brasileiras para o select de estado.
 * Usado no formulário de edição e no filtro de estado da barra de filtros.
 */
const STATE_OPTIONS = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS',
  'MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
].map((uf) => ({ value: uf, label: uf }))

/**
 * @constant CNH_CATEGORY_OPTIONS - Categorias de habilitação disponíveis no Brasil.
 * Usado no select de categoria CNH do formulário de edição.
 */
const CNH_CATEGORY_OPTIONS = [
  { value: 'A',  label: 'A'  },
  { value: 'B',  label: 'B'  },
  { value: 'AB', label: 'AB' },
  { value: 'C',  label: 'C'  },
  { value: 'D',  label: 'D'  },
  { value: 'E',  label: 'E'  },
]

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

/**
 * @type StatusFilter
 * @description Valores possíveis para o filtro de status da barra de pílulas.
 * - all: todos os clientes
 * - active: somente clientes com active !== false
 * - former: somente ex-clientes (active === false)
 */
type StatusFilter = 'all' | 'active' | 'former'

/**
 * @type ContractInfo
 * @description Dados da moto vinculada ao cliente via contrato ativo.
 * Apenas placa e modelo são exibidos na tabela — monthly_amount não é necessário aqui.
 */
type ContractInfo = {
  license_plate: string
  model: string
}

/**
 * @interface FormState
 * @description Formato plano dos campos do formulário de edição do cliente.
 * Usa camelCase no front-end; mapeado para snake_case ao enviar ao Supabase.
 */
interface FormState {
  name: string
  cpf: string
  rg: string
  state: string
  phone: string
  email: string
  address: string
  zipCode: string
  emergencyContact: string
  cnh: string
  cnhExpiry: string
  cnhCategory: string
  birthDate: string
  paymentStatus: string
  notes: string
}

/**
 * @constant defaultFormState - Estado inicial do formulário (campos vazios com defaults seguros).
 * Usado ao abrir o modal de edição antes de popular com os dados do cliente.
 */
const defaultFormState: FormState = {
  name: '', cpf: '', rg: '', state: 'RJ',
  phone: '', email: '', address: '', zipCode: '',
  emergencyContact: '', cnh: '', cnhExpiry: '',
  cnhCategory: 'A', birthDate: '', paymentStatus: '', notes: '',
}

// ---------------------------------------------------------------------------
// Utilitário: converte Customer → FormState
// ---------------------------------------------------------------------------

/**
 * @function customerToForm
 * @description Converte um objeto Customer (formato Supabase/snake_case) para
 * o formato plano do formulário React (camelCase), tratando nulos como string vazia.
 * @param {Customer} customer - Objeto do banco de dados.
 * @returns {FormState} Objeto pronto para popular os campos controlados do formulário.
 */
function customerToForm(customer: Customer): FormState {
  return {
    name:             customer.name || '',
    cpf:              customer.cpf || '',
    rg:               customer.rg || '',
    state:            customer.state || 'RJ',
    phone:            customer.phone || '',
    email:            customer.email || '',
    address:          customer.address || '',
    zipCode:          customer.zip_code || '',
    emergencyContact: customer.emergency_contact || '',
    cnh:              customer.drivers_license || '',
    cnhExpiry:        customer.drivers_license_validity || '',
    cnhCategory:      customer.drivers_license_category || 'A',
    birthDate:        customer.birth_date || '',
    paymentStatus:    customer.payment_status || '',
    notes:            customer.observations || '',
  }
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

/**
 * @component ClientesPage
 * @description Página principal de gestão de clientes conectada ao Supabase.
 */
export default function ClientesPage() {

  // ── Dados ──────────────────────────────────────────────────────────────────

  /** @state customers - Lista completa de clientes retornada pelo Supabase. */
  const [customers, setCustomers] = useState<Customer[]>([])

  /**
   * @state activeContractsMap - Mapa de customer_id → dados da moto do contrato ativo.
   * Populado em paralelo com a busca de clientes para exibir a moto atual na tabela.
   */
  const [activeContractsMap, setActiveContractsMap] = useState<Map<string, ContractInfo>>(new Map())

  /** @state loading - Controla o spinner de carregamento da tabela. */
  const [loading, setLoading] = useState(true)

  /** @state error - Mensagem de erro de rede, exibida como banner no topo. */
  const [error, setError] = useState<string | null>(null)

  // ── Filtros ────────────────────────────────────────────────────────────────

  /** @state searchTerm - Texto da busca livre (filtra por nome, CPF ou telefone). */
  const [searchTerm, setSearchTerm] = useState('')

  /** @state statusFilter - Pílula de status ativa: all | active | former. */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  /** @state stateFilter - UF selecionada no dropdown de estados (vazio = todos). */
  const [stateFilter, setStateFilter] = useState('')

  // ── Modais ─────────────────────────────────────────────────────────────────

  /** @state showForm - Controla a visibilidade do modal de edição. */
  const [showForm, setShowForm] = useState(false)

  /** @state editingCustomer - Cliente sendo editado; null quando o modal está fechado. */
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)

  /** @state deletingCustomer - Cliente aguardando confirmação de exclusão. */
  const [deletingCustomer, setDeletingCustomer] = useState<Customer | null>(null)

  /** @state viewingCustomer - Cliente aberto no modal de detalhes. */
  const [viewingCustomer, setViewingCustomer] = useState<Customer | null>(null)

  // ── Loading de ações ───────────────────────────────────────────────────────

  /** @state saving - True enquanto o botão Salvar do formulário aguarda resposta do Supabase. */
  const [saving, setSaving] = useState(false)

  /** @state deleting - True enquanto o botão Excluir aguarda resposta do Supabase. */
  const [deleting, setDeleting] = useState(false)

  // ── Formulário ─────────────────────────────────────────────────────────────

  /** @state formState - Valores atuais de todos os campos do modal de edição. */
  const [formState, setFormState] = useState<FormState>(defaultFormState)

  // ---------------------------------------------------------------------------
  // Busca de dados
  // ---------------------------------------------------------------------------

  /**
   * @function fetchCustomers
   * @description Busca clientes e contratos ativos em paralelo via Promise.all.
   * - Clientes: todos com in_queue = false, ordenados por nome.
   * - Contratos: apenas os ativos, com join na tabela motorcycles (placa e modelo).
   * O mapa resultante de contratos permite O(1) lookup na renderização da tabela.
   */
  const fetchCustomers = async () => {
    setLoading(true)
    setError(null)

    const [customersResult, contractsResult] = await Promise.all([
      supabase
        .from('customers')
        .select('*')
        .eq('in_queue', false)
        .order('name', { ascending: true }),
      supabase
        .from('contracts')
        .select('customer_id, motorcycles(license_plate, model)')
        .eq('status', 'active'),
    ])

    if (customersResult.error) {
      console.error('[SUPABASE]', customersResult.error.message)
      setError('Falha ao carregar clientes. Tente novamente.')
    } else {
      setCustomers(customersResult.data ?? [])
    }

    if (contractsResult.data) {
      const map = new Map<string, ContractInfo>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      contractsResult.data.forEach((contract: any) => {
        const moto = Array.isArray(contract.motorcycles)
          ? contract.motorcycles[0]
          : contract.motorcycles
        if (moto) {
          map.set(contract.customer_id, {
            license_plate: moto.license_plate,
            model: moto.model,
          })
        }
      })
      setActiveContractsMap(map)
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchCustomers()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Handlers de modais
  // ---------------------------------------------------------------------------

  /**
   * @function handleEditClick
   * @description Popula o formulário com os dados do cliente e abre o modal de edição.
   * @param {Customer} customer - Cliente selecionado para edição.
   */
  const handleEditClick = (customer: Customer) => {
    setFormState(customerToForm(customer))
    setEditingCustomer(customer)
    setShowForm(true)
  }

  // ---------------------------------------------------------------------------
  // Handler: Salvar edição
  // ---------------------------------------------------------------------------

  /**
   * @function handleSave
   * @description Envia os dados do formulário ao Supabase para atualizar o cliente.
   * Mapeia os campos camelCase do form para os nomes snake_case das colunas do banco.
   * Após salvar com sucesso, fecha o modal e recarrega a lista.
   */
  const handleSave = async () => {
    if (!editingCustomer) return
    setSaving(true)

    const { error: updateError } = await supabase
      .from('customers')
      .update({
        name:                      formState.name,
        cpf:                       formState.cpf,
        rg:                        formState.rg              || null,
        state:                     formState.state            || null,
        phone:                     formState.phone,
        email:                     formState.email            || null,
        address:                   formState.address          || null,
        zip_code:                  formState.zipCode          || null,
        emergency_contact:         formState.emergencyContact || null,
        drivers_license:           formState.cnh              || null,
        drivers_license_validity:  formState.cnhExpiry        || null,
        drivers_license_category:  formState.cnhCategory      || null,
        birth_date:                formState.birthDate        || null,
        payment_status:            formState.paymentStatus    || null,
        observations:              formState.notes            || null,
      })
      .eq('id', editingCustomer.id)

    if (updateError) {
      alert(`Erro ao atualizar cliente: ${updateError.message}`)
    } else {
      setShowForm(false)
      await fetchCustomers()
    }
    setSaving(false)
  }

  // ---------------------------------------------------------------------------
  // Handler: Excluir
  // ---------------------------------------------------------------------------

  /**
   * @function handleDelete
   * @description Verifica se há contrato ativo antes de excluir.
   * Bloqueia a exclusão com alerta se o cliente ainda tiver contrato vigente,
   * evitando registros órfãos na tabela de contratos.
   * @param {Customer} customer - Cliente a ser excluído.
   */
  const handleDelete = async (customer: Customer) => {
    setDeleting(true)

    const { data: contratos } = await supabase
      .from('contracts')
      .select('id')
      .eq('customer_id', customer.id)
      .eq('status', 'active')
      .limit(1)

    if (contratos && contratos.length > 0) {
      alert('Não é possível excluir: cliente possui contrato ativo.')
      setDeleting(false)
      return
    }

    const { error: deleteError } = await supabase
      .from('customers')
      .delete()
      .eq('id', customer.id)

    if (deleteError) {
      alert(`Erro ao excluir cliente: ${deleteError.message}`)
    } else {
      setDeletingCustomer(null)
      await fetchCustomers()
    }
    setDeleting(false)
  }

  // ---------------------------------------------------------------------------
  // KPIs — calculados via useMemo para evitar recomputação a cada render
  // ---------------------------------------------------------------------------

  /**
   * @memo kpis
   * @description Contadores exibidos nos cards de KPI no topo da página.
   * Recalculado apenas quando a lista de clientes muda.
   */
  const kpis = useMemo(() => ({
    active: customers.filter((c) => c.active !== false).length,
    former: customers.filter((c) => c.active === false).length,
  }), [customers])

  // ---------------------------------------------------------------------------
  // Lista filtrada — aplicada na tabela
  // ---------------------------------------------------------------------------

  /**
   * @memo filteredCustomers
   * @description Aplica os três filtros em cascata sobre a lista completa:
   * 1. Pílula de status (all / active / former)
   * 2. Estado (UF)
   * 3. Busca textual (nome, CPF ou telefone — case-insensitive)
   */
  const filteredCustomers = useMemo(() => {
    let list = customers
    if (statusFilter === 'active')      list = list.filter((c) => c.active !== false)
    else if (statusFilter === 'former') list = list.filter((c) => c.active === false)
    if (stateFilter) list = list.filter((c) => c.state === stateFilter)
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase()
      list = list.filter(
        (c) => c.name?.toLowerCase().includes(term) ||
               c.cpf?.includes(term) ||
               c.phone?.includes(term)
      )
    }
    return list
  }, [customers, statusFilter, stateFilter, searchTerm])

  /**
   * @memo tabs - Pílulas de filtro rápido com contadores dinâmicos.
   * O contador da pílula "Todos" reflete o total sem filtro de status.
   * Memoizado para evitar recriar o array a cada render.
   */
  const tabs = useMemo<{ value: StatusFilter; label: string; count: number }[]>(() => [
    { value: 'all',    label: 'Todos',       count: customers.length },
    { value: 'active', label: 'Ativos',      count: kpis.active },
    { value: 'former', label: 'Ex-Clientes', count: kpis.former },
  ], [customers.length, kpis.active, kpis.former])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">

      <Header
        title="Clientes"
        subtitle="Clientes promovidos da fila de espera"
      />

      <div className="p-6 space-y-5">

        {/* ── KPI CARDS ──────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4">

          <div className="bg-[#202020] rounded-2xl border border-[#474747] px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-normal text-[#9e9e9e]">Clientes Ativos</p>
              <p className="text-[28px] font-bold text-[#f5f5f5]">{kpis.active}</p>
            </div>
            <div className="rounded-full bg-[#323232] p-3">
              <Users className="h-6 w-6 text-[#BAFF1A]" />
            </div>
          </div>

          <div className="bg-[#202020] rounded-2xl border border-[#474747] px-6 py-4 flex items-center justify-between">
            <div>
              <p className="text-[14px] font-normal text-[#9e9e9e]">Ex-Clientes</p>
              <p className="text-[28px] font-bold text-[#f5f5f5]">{kpis.former}</p>
            </div>
            <div className="rounded-full bg-[#323232] p-3">
              <UserMinus className="h-6 w-6 text-[#BAFF1A]" />
            </div>
          </div>

        </div>

        {/* Banner de erro de rede */}
        {error && (
          <div className="bg-[#7c1c1c] border border-[#ff9c9a] rounded-2xl px-4 py-3 text-[#ff9c9a]">
            Erro ao carregar dados: {error}
          </div>
        )}

        {/* ── BARRA DE FILTROS ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Abas de status — esquerda */}
          <div className="flex flex-wrap border-b border-[#616161]">
            {tabs.map((tab) => (
              <button
                key={tab.value}
                onClick={() => setStatusFilter(tab.value)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  statusFilter === tab.value
                    ? 'border-[#BAFF1A] text-[#f5f5f5]'
                    : 'border-transparent text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className="ml-1.5 text-[#616161]">({tab.count})</span>
                )}
              </button>
            ))}
          </div>

          {/* Dropdown de estado + busca textual — direita */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value)}
              className="h-10 rounded-full border border-[#474747] bg-[#323232] px-4 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              <option value="">Todos os estados</option>
              {STATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} className="bg-[#202020]">
                  {opt.label}
                </option>
              ))}
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#616161]" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 rounded-full border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none w-44"
              />
            </div>
          </div>
        </div>

        {/* ── TABELA ───────────────────────────────────────────────────────── */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : filteredCustomers.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <Users className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Nenhum cliente encontrado.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou verifique a fila de espera.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl bg-[#202020]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px] text-[#f5f5f5]">
                <thead className="text-[#9e9e9e]">
                  <tr className="border-b border-[#323232]">
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Nome</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">CPF</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Telefone</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Moto Atual</th>
                    <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Status</th>
                    <th className="h-9 px-4 text-right text-[13px] font-medium text-[#9e9e9e]">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((customer) => {
                    const contractInfo = activeContractsMap.get(customer.id)
                    return (
                      <tr
                        key={customer.id}
                        className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232] cursor-pointer"
                        onClick={() => setViewingCustomer(customer)}
                      >
                        <td className="px-4 text-[13px]">
                          <p className="font-medium text-[#f5f5f5]">{customer.name}</p>
                        </td>
                        <td className="px-4 text-[13px]">
                          <p className="font-mono text-[#f5f5f5]">{customer.cpf}</p>
                        </td>
                        <td className="px-4 text-[13px]">
                          <a
                            href={`https://wa.me/55${customer.phone?.replace(/\D/g, '')}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-[#f5f5f5] hover:text-[#BAFF1A] transition-colors w-fit"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                            {customer.phone}
                          </a>
                        </td>
                        <td className="px-4 text-[13px]">
                          {contractInfo ? (
                            <Badge variant="brand">
                              {contractInfo.license_plate} — {contractInfo.model}
                            </Badge>
                          ) : (
                            <span className="text-[#616161]">—</span>
                          )}
                        </td>
                        <td className="px-4 text-[13px]">
                          {customer.active !== false ? (
                            <Badge variant="success">Ativo</Badge>
                          ) : (
                            <Badge variant="danger">Ex-Cliente</Badge>
                          )}
                        </td>
                        <td className="px-4 text-right text-[13px]">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Ver detalhes"
                              onClick={(e) => { e.stopPropagation(); setViewingCustomer(customer) }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Editar"
                              onClick={(e) => { e.stopPropagation(); handleEditClick(customer) }}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button variant="danger" size="sm" className="h-8 w-8 p-0" title="Excluir"
                              onClick={(e) => { e.stopPropagation(); setDeletingCustomer(customer) }}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: Edição de Cliente                                            */}
      {/* ------------------------------------------------------------------ */}
      <Modal open={showForm} onClose={() => setShowForm(false)} title="Editar Cliente" size="lg">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="md:col-span-2">
            <Input label="Nome completo" value={formState.name} placeholder="Nome completo do cliente"
              onChange={(e) => setFormState({ ...formState, name: e.target.value })} />
          </div>
          <Input label="CPF" value={formState.cpf} placeholder="000.000.000-00"
            onChange={(e) => setFormState({ ...formState, cpf: e.target.value })} />
          <Input label="RG" value={formState.rg} placeholder="Número do RG"
            onChange={(e) => setFormState({ ...formState, rg: e.target.value })} />
          <Input label="Telefone" value={formState.phone} placeholder="(21) 99999-9999"
            onChange={(e) => setFormState({ ...formState, phone: e.target.value })} />
          <Input label="Email" type="email" value={formState.email} placeholder="email@exemplo.com"
            onChange={(e) => setFormState({ ...formState, email: e.target.value })} />
          <Select label="Estado" value={formState.state}
            options={[{ value: '', label: 'Selecione...' }, ...STATE_OPTIONS]}
            onChange={(e) => setFormState({ ...formState, state: e.target.value })} />
          <Input label="Data de Nascimento" type="date" value={formState.birthDate}
            onChange={(e) => setFormState({ ...formState, birthDate: e.target.value })} />
          <div className="md:col-span-2">
            <Input label="Endereço" value={formState.address} placeholder="Rua, número, complemento, bairro"
              onChange={(e) => setFormState({ ...formState, address: e.target.value })} />
          </div>
          <Input label="CEP" value={formState.zipCode} placeholder="00000-000"
            onChange={(e) => setFormState({ ...formState, zipCode: e.target.value })} />
          <Input label="Status de Pagamento" value={formState.paymentStatus} placeholder="Ex: Caução pago"
            onChange={(e) => setFormState({ ...formState, paymentStatus: e.target.value })} />
          <Input label="Número da CNH" value={formState.cnh} placeholder="Número da habilitação"
            onChange={(e) => setFormState({ ...formState, cnh: e.target.value })} />
          <Select label="Categoria CNH" value={formState.cnhCategory} options={CNH_CATEGORY_OPTIONS}
            onChange={(e) => setFormState({ ...formState, cnhCategory: e.target.value })} />
          <Input label="Validade CNH" type="date" value={formState.cnhExpiry}
            onChange={(e) => setFormState({ ...formState, cnhExpiry: e.target.value })} />
          <div className="md:col-span-2">
            <Input label="Contato de Emergência" value={formState.emergencyContact}
              placeholder="Nome e telefone de familiar ou responsável"
              onChange={(e) => setFormState({ ...formState, emergencyContact: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Textarea label="Observações" value={formState.notes} placeholder="Notas internas sobre o cliente..."
              onChange={(e) => setFormState({ ...formState, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-3 justify-end pt-1 mt-4">
          <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={handleSave}>Salvar</Button>
        </div>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: Confirmação de Exclusão                                       */}
      {/* ------------------------------------------------------------------ */}
      <Modal open={deletingCustomer !== null} onClose={() => setDeletingCustomer(null)}
        title="Confirmar Exclusão" size="sm">
        <p className="text-[13px] text-[#9e9e9e] leading-relaxed mb-6">
          Tem certeza que deseja excluir o cliente{' '}
          <span className="font-medium text-[#f5f5f5]">{deletingCustomer?.name}</span>?
          Esta ação não pode ser desfeita.
        </p>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeletingCustomer(null)}>Cancelar</Button>
          <Button variant="danger" loading={deleting}
            onClick={() => deletingCustomer && handleDelete(deletingCustomer)}>
            Excluir
          </Button>
        </div>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* MODAL: Detalhes do Cliente                                           */}
      {/* ------------------------------------------------------------------ */}
      <Modal open={viewingCustomer !== null} onClose={() => setViewingCustomer(null)}
        title="Detalhes do Cliente" size="lg">
        {viewingCustomer && (
          <div className="space-y-5 text-[#f5f5f5]">

            {/* Cabeçalho: nome + badge de status */}
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-2xl font-bold text-[#f5f5f5] leading-tight">{viewingCustomer.name}</h3>
              {viewingCustomer.active !== false
                ? <Badge variant="success">Ativo</Badge>
                : <Badge variant="danger">Ex-Cliente</Badge>}
            </div>

            {/* Grid de campos do cadastro */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
              <DetailsField label="CPF" value={viewingCustomer.cpf} mono />
              <DetailsField label="RG" value={viewingCustomer.rg} />
              <DetailsField label="Telefone" value={viewingCustomer.phone} />
              <DetailsField label="Email" value={viewingCustomer.email} />
              <DetailsField label="Estado" value={viewingCustomer.state} />
              <DetailsField label="CEP" value={viewingCustomer.zip_code} />
              <div className="md:col-span-2">
                <DetailsField label="Endereço" value={viewingCustomer.address} />
              </div>
              <DetailsField
                label="Data de Nascimento"
                value={viewingCustomer.birth_date
                  ? new Date(viewingCustomer.birth_date + 'T12:00:00').toLocaleDateString('pt-BR')
                  : undefined}
              />
              <DetailsField label="Contato de Emergência" value={viewingCustomer.emergency_contact} />
              <DetailsField label="CNH" value={viewingCustomer.drivers_license} />
              <DetailsField label="Categoria CNH" value={viewingCustomer.drivers_license_category} />
              <DetailsField
                label="Validade CNH"
                value={viewingCustomer.drivers_license_validity
                  ? new Date(viewingCustomer.drivers_license_validity + 'T12:00:00').toLocaleDateString('pt-BR')
                  : undefined}
              />
              <DetailsField label="Status de Pagamento" value={viewingCustomer.payment_status} />
              {viewingCustomer.departure_date && (
                <DetailsField
                  label="Data de Saída"
                  value={new Date(viewingCustomer.departure_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                />
              )}
              {viewingCustomer.departure_reason && (
                <div className="md:col-span-2">
                  <DetailsField label="Motivo da Saída" value={viewingCustomer.departure_reason} />
                </div>
              )}
              {viewingCustomer.observations && (
                <div className="md:col-span-2">
                  <p className="text-[12px] font-medium text-[#9e9e9e] mb-1">Observações</p>
                  <p className="text-[13px] text-[#f5f5f5] bg-[#323232] border border-[#474747] rounded-lg px-3 py-2 leading-relaxed">
                    {viewingCustomer.observations}
                  </p>
                </div>
              )}
            </div>

            {/* Documentos anexados (CNH e comprovante) — exibe somente se existirem */}
            {(viewingCustomer.drivers_license_photo_url || viewingCustomer.document_photo_url) && (
              <div className="pt-4 border-t border-[#323232]">
                <h4 className="font-medium text-[#f5f5f5] mb-4">Documentos Anexados</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {viewingCustomer.drivers_license_photo_url && (
                    <DocumentThumb
                      url={viewingCustomer.drivers_license_photo_url}
                      label="Foto da CNH"
                      alt="CNH do Cliente"
                    />
                  )}
                  {viewingCustomer.document_photo_url && (
                    <DocumentThumb
                      url={viewingCustomer.document_photo_url}
                      label="Comprovante / Outro"
                      alt="Documento do Cliente"
                    />
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end pt-4 border-t border-[#323232]">
              <Button variant="secondary" onClick={() => setViewingCustomer(null)}>Fechar</Button>
            </div>
          </div>
        )}
      </Modal>

    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-componentes auxiliares
// ---------------------------------------------------------------------------

/**
 * @component DetailsField
 * @description Renderiza um par label/valor no modal de detalhes.
 * Valores nulos ou vazios exibem um traço em cinza.
 */
function DetailsField({
  label,
  value,
  mono = false,
}: {
  label: string
  value?: string | null
  mono?: boolean
}) {
  return (
    <div>
      <p className="text-[12px] font-medium text-[#9e9e9e] mb-0.5">{label}</p>
      <p className={`text-[13px] text-[#f5f5f5] ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-[#616161] italic">—</span>}
      </p>
    </div>
  )
}

/**
 * @component DocumentThumb
 * @description Exibe a miniatura de um documento com overlay de "Ver tamanho original" ao passar o mouse.
 * Evita duplicação de markup para CNH e comprovante no modal de detalhes.
 */
function DocumentThumb({ url, label, alt }: { url: string; label: string; alt: string }) {
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-[#9e9e9e]">{label}</p>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="block relative group rounded-xl overflow-hidden border border-[#323232]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={alt} className="w-full h-48 object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="text-white font-medium bg-black/60 px-3 py-1.5 rounded-full">Ver tamanho original</span>
        </div>
      </a>
    </div>
  )
}
