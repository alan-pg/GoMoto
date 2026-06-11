/**
 * @file page.tsx
 * @description Página de gestão de Entradas (Receitas) do Sistema GoMoto.
 *
 * Gerencia o registro de todas as entradas financeiras reais no caixa da empresa.
 * Diferente da tela de cobranças (que foca no que deve ser recebido), esta tela
 * foca no que já foi efetivamente pago pelos locatários.
 *
 * Funcionalidades principais:
 * - Listagem de entradas filtrada por mês com total destacado no topo.
 * - CRUD completo: criar, editar e excluir entradas via modais.
 * - Busca por placa, locatário ou tipo de referência.
 * - Autocomplete de placas a partir das motos cadastradas no Supabase.
 * - Cards de resumo: Total do Mês, Quantidade de Lançamentos, Ticket Médio.
 *
 * O código utiliza identificadores em Inglês para conformidade técnica e
 * comentários em Português Brasil para clareza da regra de negócio local.
 */

'use client';

// React
import { useState, useEffect, useMemo, useCallback } from 'react';

// Libs externas
import { Plus, Edit2, Trash2, TrendingUp, Calendar, DollarSign, Search, ChevronDown } from 'lucide-react';

// Tipos
import type { Income } from '@/types';

// Supabase
import { createClient } from '@/lib/supabase/client';

// Utilitários
import { formatCurrency, formatDate } from '@/lib/utils';

// Componentes da UI
import { Button } from '@/components/ui/Button';
import { Input, Select, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';

// --- INTERFACES LOCAIS ---

/**
 * @interface Motorcycle
 * @description Estrutura simplificada de motocicleta usada no autocomplete de placas e seleção.
 */
interface Motorcycle {
  id: string;
  license_plate: string;
  model: string;
  make: string;
}

/**
 * @interface IncomeFormState
 * @description Interface para o estado do formulário de entrada.
 */
interface IncomeFormState {
  description: string;
  vehicle: string;
  date: string;
  lessee: string;
  amount: string;
  reference: string;
  payment_method: string;
  observations: string;
}

// --- CONSTANTES ---

/** @constant REFERENCES_TYPES — Tipos possíveis para uma entrada financeira avulsa (ex: Caução, Multa). */
const REFERENCES_TYPES: string[] = [
  'Caucao',
  'Multa',
  'Proporcional',
  'Outros',
];

/** @constant PAYMENT_METHODS — Formas de pagamento aceitas pela empresa (ex: PIX, Dinheiro). */
const PAYMENT_METHODS: string[] = [
  'PIX',
  'Dinheiro',
  'Cartão de Crédito',
  'Cartão de Débito',
  'Boleto',
  'Transferência',
];

/** @constant REFERENCE_OPTIONS — Opções formatadas para o componente Select de tipo de referência. */
const REFERENCE_OPTIONS = REFERENCES_TYPES.map(r => ({ value: r, label: r }));

/** @constant PAYMENT_OPTIONS — Opções formatadas para o componente Select de método de pagamento. */
const PAYMENT_OPTIONS = PAYMENT_METHODS.map(m => ({ value: m, label: m }));

/** @constant INITIAL_FORM_STATE — Estado padrão do formulário ao criar uma nova entrada. */
const INITIAL_FORM_STATE: IncomeFormState = {
  description: '',
  vehicle: '',
  date: new Date().toISOString().split('T')[0],
  lessee: '',
  amount: '',
  reference: 'Multa',
  payment_method: 'PIX',
  observations: '',
};

// --- COMPONENTE PRINCIPAL ---

/**
 * @component EntradasPage
 * @description Página principal de gestão de entradas financeiras do GoMoto.
 */
export default function EntradasPage() {
  const supabase = createClient();

  // --- Estados de Dados ---
  /**
   * @type {Income[]}
   * @description Armazena a lista de entradas financeiras carregadas do Supabase.
   */
  const [incomes, setIncomes] = useState<Income[]>([]);
  /**
   * @type {Motorcycle[]}
   * @description Armazena a lista de motocicletas carregadas do Supabase, usada para autocomplete e seleção.
   */
  const [motorcycles, setMotorcycles] = useState<Motorcycle[]>([]);

  // --- Estados de Carregamento e Ações ---
  /**
   * @type {boolean}
   * @description Indica se os dados estão sendo carregados do Supabase.
   */
  const [loading, setLoading] = useState<boolean>(true);
  /**
   * @type {boolean}
   * @description Indica se uma operação de salvar (criar/editar) está em andamento.
   */
  const [saving, setSaving] = useState<boolean>(false);
  /**
   * @type {boolean}
   * @description Indica se uma operação de exclusão está em andamento.
   */
  const [deleting, setDeleting] = useState<boolean>(false);

  // --- Estados de Filtro ---
  /**
   * @type {string}
   * @description Armazena o termo de busca textual para filtrar as entradas.
   */
  const [searchQuery, setSearchQuery] = useState<string>('');
  /**
   * @type {string}
   * @description Armazena o filtro de tipo de referência selecionado.
   */
  const [referenceFilter, setReferenceFilter] = useState<string>('');
  /**
   * @type {string}
   * @description Armazena o filtro de placa de motocicleta selecionado.
   */
  const [motorcycleFilter, setMotorcycleFilter] = useState<string>('');
  /**
   * @type {string}
   * @description Armazena o mês e ano selecionados para filtrar as entradas.
   */
  const [selectedMonth, setSelectedMonth] = useState<string>(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
  });

  // --- Estados de Controle de Modais ---
  /**
   * @type {boolean}
   * @description Controla a visibilidade do modal de criação/edição de entrada.
   */
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  /**
   * @type {boolean}
   * @description Controla a visibilidade do modal de confirmação de exclusão.
   */
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState<boolean>(false);
  /**
   * @type {Income | null}
   * @description Armazena os dados da entrada atualmente selecionada para edição ou exclusão.
   */
  const [currentIncome, setCurrentIncome] = useState<Income | null>(null);

  // --- Estado do Formulário ---
  /**
   * @type {IncomeFormState}
   * @description Armazena os dados do formulário de entrada.
   */
  const [formData, setFormData] = useState<IncomeFormState>(INITIAL_FORM_STATE);
  /**
   * @type {Record<string, string>}
   * @description Armazena os erros de validação do formulário.
   */
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  // --- BUSCA DE DADOS ---

  /**
   * @function fetchData
   * @description Busca as entradas e as motocicletas do Supabase, aplicando filtro por mês.
   */
  const fetchData = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [yearStr, monthStr] = selectedMonth.split('-');
      const year = parseInt(yearStr);
      const month = parseInt(monthStr);

      const firstDayOfMonth = `${year}-${String(month).padStart(2, '0')}-01`;
      const lastDayOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

      const [incomesResult, motorcyclesResult] = await Promise.all([
        supabase
          .from('incomes')
          .select('*')
          .gte('date', firstDayOfMonth)
          .lte('date', lastDayOfMonth)
          .order('date', { ascending: false }),
        supabase
          .from('motorcycles')
          .select('id, license_plate, model, make')
          .order('license_plate'),
      ]);

      if (incomesResult.error) throw incomesResult.error;
      if (motorcyclesResult.error) throw motorcyclesResult.error;

      setIncomes((incomesResult.data as Income[]) || []);
      setMotorcycles((motorcyclesResult.data as Motorcycle[]) || []);
    } catch {
    } finally {
      setLoading(false);
    }
  }, [selectedMonth, supabase]);

  /**
   * @hook useEffect
   * @description Efeito para carregar os dados sempre que `fetchData` for atualizado (ex: mudança de mês).
   */
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // --- OPÇÕES DO SELECT DE MOTOCICLETA ---

  /**
   * @constant motorcycleSelectOptions
   * @description Opções formatadas para o componente Select de placa de motocicleta,
   *              incluindo placa, marca e modelo para fácil identificação.
   */
  const motorcycleSelectOptions = useMemo(() => [
    { value: '', label: 'Selecione uma moto...' },
    ...motorcycles.map(m => ({ value: m.license_plate, label: `${m.license_plate} — ${m.make} ${m.model}` })),
  ], [motorcycles]);

  // --- BUSCA AUTOMÁTICA DE LOCATÁRIO ---

  /**
   * @function lookupLessee
   * @description Busca o cliente que tinha contrato ativo para a motocicleta na data informada.
   *              Utiliza a tabela 'contracts' com join em 'customers' para identificar o locatário.
   * @param {string} plate - A placa da motocicleta.
   * @param {string} date - A data para verificar o contrato (formato YYYY-MM-DD).
   */
  const lookupLessee = useCallback(async (plate: string, date: string): Promise<void> => {
    if (!plate || !date) return;

    const selectedMotorcycle = motorcycles.find(m => m.license_plate === plate);
    if (!selectedMotorcycle) return;

    try {
      const { data, error } = await supabase
        .from('contracts')
        .select('customers(name)')
        .eq('motorcycle_id', selectedMotorcycle.id)
        .lte('start_date', date)
        .or(`end_date.is.null,end_date.gte.${date}`)
        .order('start_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!error && data?.customers) {
        // Supabase infere joins embedded como array mesmo em relação one-to-one;
        // normaliza via unknown antes do cast final para satisfazer o compilador.
        const customers = data.customers as unknown as { name: string } | { name: string }[];
        const lesseeName = Array.isArray(customers) ? customers[0]?.name : customers.name;
        if (lesseeName) {
          setFormData(prev => ({ ...prev, lessee: lesseeName }));
        }
      }
    } catch {
    }
  }, [motorcycles, supabase]);

  // --- CÁLCULOS E FILTRAGEM ---

  /**
   * @constant filteredIncomes
   * @description Entradas financeiras filtradas com base na pesquisa, referência e motocicleta.
   */
  const filteredIncomes = useMemo((): Income[] => {
    return incomes.filter((income) => {
      const lowerQuery = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || (
        income.vehicle?.toLowerCase().includes(lowerQuery) ||
        income.lessee?.toLowerCase().includes(lowerQuery) ||
        income.reference?.toLowerCase().includes(lowerQuery)
      );
      const matchesReference = !referenceFilter || income.reference === referenceFilter;
      const matchesMotorcycle = !motorcycleFilter || income.vehicle === motorcycleFilter;
      return matchesSearch && matchesReference && matchesMotorcycle;
    });
  }, [incomes, searchQuery, referenceFilter, motorcycleFilter]);

  // --- ACCORDION ---

  /**
   * @type {Set<string>}
   * @description Mantém um registro dos grupos de referência que estão colapsados no acordeão.
   *              Se um ID está presente no Set, o grupo correspondente está colapsado; caso contrário, está expandido.
   */
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  /**
   * @function toggleGroup
   * @description Alterna o estado de expansão/colapso de um grupo no acordeão.
   * @param {string} groupId - O identificador do grupo a ser alternado.
   */
  const toggleGroup = useCallback((groupId: string): void => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      next.has(groupId) ? next.delete(groupId) : next.add(groupId);
      return next;
    });
  }, []);

  /**
   * @constant groupedIncomes
   * @description Agrupa as entradas filtradas por tipo de referência para exibição no acordeão.
   *              Mantém a ordem definida em `REFERENCES_TYPES` e calcula o total para cada grupo.
   */
  const groupedIncomes = useMemo(() => {
    const source = referenceFilter
      ? filteredIncomes.filter(i => i.reference === referenceFilter)
      : filteredIncomes;

    const grouped = source.reduce(
      (acc, i) => {
        if (!acc[i.reference]) acc[i.reference] = { items: [], total: 0 };
        acc[i.reference].items.push(i);
        acc[i.reference].total += Number(i.amount);
        return acc;
      },
      {} as Record<string, { items: Income[]; total: number }>
    );

    // Apenas tipos canônicos de REFERENCES_TYPES, na ordem definida
    return REFERENCES_TYPES
      .filter(ref => grouped[ref]?.items.length > 0)
      .map(ref => ({ reference: ref, ...grouped[ref] }));
  }, [filteredIncomes, referenceFilter]);

  /**
   * @constant referenceTabs
   * @description Gera os dados para as "pills" de filtro de referência, incluindo a contagem de lançamentos.
   */
  const referenceTabs = useMemo(() => {
    const counts: Record<string, number> = filteredIncomes.reduce((acc, i) => {
      acc[i.reference] = (acc[i.reference] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return [
      { id: '', label: 'Todas', count: filteredIncomes.length },
      ...REFERENCES_TYPES.map(ref => ({ id: ref, label: ref, count: counts[ref] ?? 0 })),
    ];
  }, [filteredIncomes]);

  /**
   * @constant totalAmount
   * @description O valor total de todas as entradas filtradas.
   * @constant launchCount
   * @description O número total de lançamentos de entradas filtradas.
   * @constant averageTicket
   * @description O valor médio por lançamento de entrada filtrado.
   */
  const { totalAmount, launchCount, averageTicket } = useMemo(() => {
    const total = filteredIncomes.reduce((acc, curr) => acc + Number(curr.amount), 0);
    const count = filteredIncomes.length;
    const avg = count > 0 ? total / count : 0;
    return { totalAmount: total, launchCount: count, averageTicket: avg };
  }, [filteredIncomes]);

  // --- HANDLERS DE MODAL ---

  /**
   * @function handleOpenModal
   * @description Abre o modal de criação/edição de entrada, preenchendo o formulário se uma entrada for fornecida.
   * @param {Income} [income] - A entrada a ser editada (opcional).
   */
  const handleOpenModal = useCallback((income?: Income): void => {
    if (income) {
      setCurrentIncome(income);
      setFormData({
        description: income.description || '',
        vehicle: income.vehicle || '',
        date: income.date || new Date().toISOString().split('T')[0],
        lessee: income.lessee || '',
        amount: String(income.amount || ''),
        reference: income.reference || 'Multa',
        payment_method: income.payment_method || 'PIX',
        observations: income.observations || '',
      });
    } else {
      setCurrentIncome(null);
      setFormData(INITIAL_FORM_STATE);
    }
    setFormErrors({});
    setIsModalOpen(true);
  }, []);

  /**
   * @function handleCloseModal
   * @description Fecha o modal de criação/edição e redefine os estados relacionados.
   */
  const handleCloseModal = useCallback((): void => {
    setIsModalOpen(false);
    setCurrentIncome(null);
    setFormData(INITIAL_FORM_STATE);
    setFormErrors({});
  }, []);

  /**
   * @function handleOpenDeleteModal
   * @description Abre o modal de confirmação de exclusão para uma entrada específica.
   * @param {Income} income - A entrada a ser excluída.
   */
  const handleOpenDeleteModal = useCallback((income: Income): void => {
    setCurrentIncome(income);
    setIsDeleteModalOpen(true);
  }, []);

  /**
   * @function handleCloseDeleteModal
   * @description Fecha o modal de confirmação de exclusão e redefine o estado.
   */
  const handleCloseDeleteModal = useCallback((): void => {
    setIsDeleteModalOpen(false);
    setCurrentIncome(null);
  }, []);

  // --- OPERAÇÕES CRUD ---

  /**
   * @function validateForm
   * @description Valida os campos do formulário de entrada e define os erros.
   * @returns {boolean} - Retorna `true` se o formulário for válido, `false` caso contrário.
   */
  const validateForm = useCallback((): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.description) errors.description = 'A descrição é obrigatória';
    if (!formData.vehicle) errors.vehicle = 'A placa é obrigatória';
    if (!formData.date) errors.date = 'A data é obrigatória';
    if (!formData.lessee) errors.lessee = 'O locatário é obrigatório';
    if (!formData.amount || isNaN(Number(formData.amount))) errors.amount = 'Informe um valor válido';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }, [formData]);

  /**
   * @function handleSave
   * @description Lida com o envio do formulário, salvando uma nova entrada ou atualizando uma existente.
   * @param {React.FormEvent} e - O evento de formulário.
   */
  const handleSave = useCallback(async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!validateForm()) return;
    setSaving(true);
    try {
      const payload = {
        description: formData.description || null,
        vehicle: formData.vehicle.toUpperCase(),
        date: formData.date,
        lessee: formData.lessee,
        amount: Number(formData.amount),
        reference: formData.reference,
        payment_method: formData.payment_method,
        observations: formData.observations || null,
      };

      if (currentIncome) {
        const { error } = await supabase.from('incomes').update(payload).eq('id', currentIncome.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('incomes').insert([payload]);
        if (error) throw error;
      }

      handleCloseModal();
      fetchData();
    } catch {
      alert('Erro ao salvar os dados. Verifique e tente novamente.');
    } finally {
      setSaving(false);
    }
  }, [formData, currentIncome, supabase, validateForm, handleCloseModal, fetchData]);

  /**
   * @function handleDelete
   * @description Lida com a exclusão de uma entrada.
   */
  const handleDelete = useCallback(async (): Promise<void> => {
    if (!currentIncome) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from('incomes').delete().eq('id', currentIncome.id);
      if (error) throw error;
      handleCloseDeleteModal();
      fetchData();
    } catch {
      alert('Erro ao excluir a entrada.');
    } finally {
      setDeleting(false);
    }
  }, [currentIncome, supabase, handleCloseDeleteModal, fetchData]);

  // --- RENDERIZAÇÃO ---

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">
      {/* Sticky toolbar */}
      <div className="sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-20 flex items-center gap-4">
        <h1 className="text-[28px] font-bold text-[#f5f5f5]">Entradas</h1>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="primary" onClick={() => handleOpenModal()}>
            <Plus className="w-5 h-5" />
            Nova Entrada
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-5">
        {/* KPI cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {/* Total do Mês */}
          <div className="bg-[#202020] rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Total do Mês</p>
              <p className="text-2xl font-bold text-[#f5f5f5]">{formatCurrency(totalAmount)}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <TrendingUp className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>

          {/* Lançamentos no Mês */}
          <div className="bg-[#202020] rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Lançamentos no Mês</p>
              <p className="text-2xl font-bold text-[#f5f5f5]">{launchCount}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <Calendar className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>

          {/* Ticket Médio */}
          <div className="bg-[#202020] rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="text-[13px] text-[#9e9e9e]">Ticket Médio</p>
              <p className="text-2xl font-bold text-[#f5f5f5]">{formatCurrency(averageTicket)}</p>
            </div>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#323232]">
              <DollarSign className="h-5 w-5 text-[#BAFF1A]" />
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">

          {/* Pills de referência */}
          <div className="flex flex-wrap border-b border-[#616161]">
            {referenceTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setReferenceFilter(tab.id)}
                className={`px-3 py-2 text-[16px] font-medium transition-all border-b-2 ${
                  referenceFilter === tab.id
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

          {/* Filtros secundários */}
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={motorcycleFilter}
              onChange={(e) => setMotorcycleFilter(e.target.value)}
              className="h-10 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            >
              <option value="">Todas as motos</option>
              {motorcycles.map((m) => (
                <option key={m.id} value={m.license_plate} className="bg-[#202020]">
                  {m.license_plate} — {m.make} {m.model}
                </option>
              ))}
            </select>

            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="h-10 rounded-lg border border-[#474747] bg-[#323232] px-3 text-[13px] text-[#f5f5f5] focus:border-[#BAFF1A] focus:outline-none"
            />

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#616161]" />
              <input
                type="text"
                placeholder="Buscar..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 rounded-lg border border-[#474747] bg-[#323232] pl-9 pr-4 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:outline-none w-44"
              />
            </div>
          </div>
        </div>

        {/* Accordion agrupado por tipo de referência */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : groupedIncomes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-[#323232] bg-[#202020] p-16 text-center">
            <TrendingUp className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-[15px] font-medium text-[#f5f5f5]">Nenhuma entrada encontrada.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Ajuste os filtros ou registre uma nova entrada.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {groupedIncomes.map(({ reference, items, total }) => {
              const isExpanded = !collapsedGroups.has(reference);
              return (
                <div key={reference} className="overflow-hidden rounded-xl border border-[#323232] bg-[#202020]">

                  {/* Cabeçalho clicável do accordion */}
                  <button
                    onClick={() => toggleGroup(reference)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[#323232] transition-colors text-left"
                  >
                    <ChevronDown className={`w-4 h-4 text-[#9e9e9e] shrink-0 transition-transform duration-150 ${isExpanded ? '' : '-rotate-90'}`} />
                    <span className="font-medium text-[#f5f5f5] text-[13px]">{reference}</span>
                    <div className="ml-auto flex items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-full text-[12px] font-medium bg-[#323232] text-[#9e9e9e]">
                        {items.length} lançamento{items.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-[13px] font-medium text-[#BAFF1A] ml-1">
                        {formatCurrency(total)}
                      </span>
                    </div>
                  </button>

                  {/* Tabela expandida */}
                  {isExpanded && (
                    <div className="border-t border-[#323232]">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-[13px] text-[#f5f5f5]">
                          <thead>
                            <tr className="border-b border-[#323232]">
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Data</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Placa</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Locatário</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Período</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Método</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e]">Valor</th>
                              <th className="h-9 px-4 text-[13px] font-medium text-[#9e9e9e] text-right">Ações</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((income: Income) => (
                              <tr key={income.id} className="h-9 border-b border-[#323232] transition-colors hover:bg-[#323232]">
                                <td className="px-4 text-[13px]">
                                  <p className="text-[#f5f5f5]">{formatDate(income.date)}</p>
                                </td>
                                <td className="px-4 text-[13px]">
                                  <span className="bg-[#323232] text-[#BAFF1A] px-2 py-0.5 rounded-full text-[12px] font-mono">
                                    {income.vehicle}
                                  </span>
                                </td>
                                <td className="px-4 text-[13px]">
                                  <p className="font-medium text-[#f5f5f5]">{income.lessee}</p>
                                </td>
                                <td className="px-4 text-[13px]">
                                  <p className="text-[#f5f5f5]">
                                    {income.period_from && income.period_to
                                      ? `${formatDate(income.period_from)} — ${formatDate(income.period_to)}`
                                      : '—'}
                                  </p>
                                </td>
                                <td className="px-4 text-[13px]">
                                  <p className="text-[#f5f5f5]">{income.payment_method}</p>
                                </td>
                                <td className="px-4 text-[13px]">
                                  <span className="font-medium text-[#BAFF1A]">
                                    {formatCurrency(Number(income.amount))}
                                  </span>
                                </td>
                                <td className="px-4 text-[13px] text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    <Button variant="secondary" size="sm" className="h-8 w-8 p-0"
                                      onClick={() => handleOpenModal(income)} title="Editar">
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                    <Button variant="danger" size="sm" className="h-8 w-8 p-0"
                                      onClick={() => handleOpenDeleteModal(income)} title="Excluir">
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de Nova Entrada / Edição */}
      <Modal
        open={isModalOpen}
        onClose={handleCloseModal}
        title={currentIncome ? 'Editar Entrada' : 'Nova Entrada'}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-3">

          {/* Descrição */}
          <Input
            label="Descrição"
            type="text"
            value={formData.description}
            onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            placeholder="Ex: Aluguel semana 10/03 — Placa ABC1234"
            required
          />

          {/* Tipo de Referência (equivale à Categoria do modal de Despesas) */}
          <Select
            label="Tipo de Referência"
            value={formData.reference}
            onChange={(e) => setFormData(prev => ({ ...prev, reference: e.target.value }))}
            options={REFERENCE_OPTIONS}
            required
          />

          {/* Valor + Data */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Valor (R$)"
              type="number"
              step="0.01"
              min="0"
              value={formData.amount}
              onChange={(e) => setFormData(prev => ({ ...prev, amount: e.target.value }))}
              placeholder="0,00"
              error={formErrors.amount}
              required
            />
            <Input
              label="Data"
              type="date"
              value={formData.date}
              onChange={async (e) => {
                const date = e.target.value;
                setFormData(prev => ({ ...prev, date }));
                if (formData.vehicle && date) await lookupLessee(formData.vehicle, date);
              }}
              error={formErrors.date}
              required
            />
          </div>

          {/* Método de Pagamento */}
          <Select
            label="Método de Pagamento"
            value={formData.payment_method}
            onChange={(e) => setFormData(prev => ({ ...prev, payment_method: e.target.value }))}
            options={PAYMENT_OPTIONS}
          />

          {/* Vínculo — ao selecionar a moto, preenche o locatário automaticamente */}
          <Select
            label="Vínculo"
            value={formData.vehicle}
            onChange={async (e) => {
              const plate = e.target.value;
              setFormData(prev => ({ ...prev, vehicle: plate }));
              if (plate && formData.date) await lookupLessee(plate, formData.date);
            }}
            options={motorcycleSelectOptions}
            error={formErrors.vehicle}
          />

          {/* Observações */}
          <Textarea
            label="Observações"
            value={formData.observations}
            onChange={(e) => setFormData(prev => ({ ...prev, observations: e.target.value }))}
            placeholder="Detalhes adicionais sobre este recebimento (opcional)"
          />

          {/* Rodapé do modal */}
          <div className="flex gap-3 justify-end pt-1">
            <Button type="button" variant="ghost" onClick={handleCloseModal} disabled={saving}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" loading={saving}>
              {currentIncome ? 'Salvar Alterações' : 'Salvar Entrada'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal de Confirmação de Exclusão */}
      <Modal
        open={isDeleteModalOpen}
        onClose={handleCloseDeleteModal}
        title="Confirmar Exclusão"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[#9e9e9e] leading-relaxed">
            Tem certeza que deseja excluir a entrada de{' '}
            <span className="font-medium text-[#BAFF1A]">
              {currentIncome ? formatCurrency(Number(currentIncome.amount)) : ''}
            </span>{' '}
            do locatário{' '}
            <span className="font-medium text-[#f5f5f5]">{currentIncome?.lessee}</span>?
            Esta ação não pode ser desfeita.
          </p>
          <div className="flex gap-3 justify-end pt-1">
            <Button variant="ghost" onClick={handleCloseDeleteModal} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting}>
              Excluir
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
