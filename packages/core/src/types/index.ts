/**
 * @file index.ts
 * @description Definições de tipos e interfaces globais para o sistema GoMoto.
 * Este arquivo serve como a única fonte de verdade para a estrutura de dados do sistema,
 * abrangendo desde o status das motocicletas até estatísticas do painel de controle.
 * Todas as definições seguem o padrão internacional em Inglês para o código,
 * com documentação detalhada em Português Brasil.
 */

/**
 * @type MotorcycleStatus
 * @description Define os estados possíveis em que uma motocicleta pode se encontrar no sistema.
 * - available: Disponível para nova locação.
 * - rented: Atualmente vinculada a um contrato ativo.
 * - maintenance: Em processo de reparo ou revisão técnica.
 * - inactive: Retirada de operação por tempo indeterminado.
 */
export type MotorcycleStatus = 'available' | 'rented' | 'maintenance' | 'inactive';

/**
 * @type DocumentType
 * @description Especifica as categorias de documentos que podem ser anexados a clientes ou contratos.
 * - drivers_license: Carteira Nacional de Habilitação (CNH).
 * - proof_of_residence: Comprovante de endereço atualizado.
 * - contract: Documento contratual assinado.
 * - identification: RG ou outro documento de identidade oficial.
 * - deposit: Comprovante de pagamento de caução.
 * - other: Qualquer outro documento suplementar necessário.
 */
export type DocumentType =
  | 'drivers_license'
  | 'proof_of_residence'
  | 'contract'
  | 'identification'
  | 'deposit'
  | 'other';

/**
 * @interface Document
 * @description Estrutura que representa um arquivo de documento digitalizado no sistema.
 * Armazena metadados essenciais e a localização do arquivo no armazenamento em nuvem.
 */
export interface Document {
  /** @property id - Identificador único universal do documento (UUID). */
  id: string;
  /** @property type - Categoria do documento conforme o tipo DocumentType. */
  type: DocumentType;
  /** @property name - Nome descritivo do arquivo ou documento. */
  name: string;
  /** @property url - Link público ou privado para acesso ao arquivo no Supabase Storage. */
  url?: string;
  /** @property uploaded_at - Carimbo de data/hora indicando quando o upload foi realizado. */
  uploaded_at: string;
}

/**
 * @type ChargeStatus
 * @description Determina o estado financeiro de uma cobrança gerada pelo sistema.
 * - pending: Aguardando o pagamento por parte do cliente.
 * - paid: Liquidação confirmada no sistema financeiro.
 * - overdue: Prazo de vencimento ultrapassado sem confirmação de recebimento.
 * - loss: Cobrança considerada incobrável após tentativas frustradas.
 */
export type ChargeStatus = 'pending' | 'paid' | 'overdue' | 'loss';

/**
 * @type ContractStatus
 * @description Define a situação jurídica e operacional de um contrato de locação.
 * - active: Vigente e em plena execução.
 * - closed: Finalizado regularmente dentro do prazo ou por acordo.
 * - cancelled: Cancelado antes do início da vigência ou por desistência.
 * - broken: Encerrado por quebra de cláusulas contratuais ou inadimplência grave.
 */
export type ContractStatus = 'active' | 'closed' | 'cancelled' | 'broken';

/**
 * @interface Motorcycle
 * @description Entidade principal que representa uma moto da frota do Sistema GoMoto.
 * Contém todas as informações técnicas, legais e administrativas do veículo.
 */
export interface Motorcycle {
  /** @property id - UUID único da motocicleta. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property license_plate - Placa de identificação oficial do veículo. */
  license_plate: string;
  /** @property model - Modelo comercial da moto (ex: CG 160 Start). */
  model: string;
  /** @property make - Fabricante ou marca do veículo (ex: Honda, Yamaha). */
  make: string;
  /** @property year_manufacture - Ano de fabricação do veículo. */
  year_manufacture: string;
  /** @property year_model - Ano do modelo do veículo. */
  year_model?: string;
  /** @property color - Cor predominante conforme o documento do veículo. */
  color: string;
  /** @property renavam - Registro Nacional de Veículos Automotores. */
  renavam: string;
  /** @property chassis - Número de identificação do chassi para conferência técnica. */
  chassis: string;
  /** @property fuel - Tipo de combustível utilizado (Gasolina, Flex, etc). */
  fuel?: string;
  /** @property engine_capacity - Potência ou cilindrada do motor (ex: 160cc). */
  engine_capacity?: string;
  /** @property previous_owner - Nome do proprietário anterior, se aplicável. */
  previous_owner?: string;
  /** @property previous_owner_cpf - CPF do proprietário anterior para histórico legal. */
  previous_owner_cpf?: string;
  /** @property purchase_date - Data em que a moto foi adquirida pela frota. */
  purchase_date?: string;
  /** @property fipe_value - Valor de mercado baseado na tabela FIPE na data de aquisição. */
  fipe_value?: number;
  /** @property maintenance_up_to_date - Indicador se todas as revisões obrigatórias foram feitas. */
  maintenance_up_to_date?: boolean;
  /** @property status - Situação operacional atual da motocicleta. */
  status: MotorcycleStatus;
  /** @property photo_url - Link para a imagem principal da motocicleta. */
  photo_url?: string;
  /** @property km_current - Quilometragem atual registrada do veículo. */
  km_current?: number;
  /** @property observations - Notas adicionais sobre o estado ou histórico do veículo. */
  observations?: string;
  /** @property registered_owner_name - Proprietário registrado HOJE no CRV/CRLV vigente (PRD 0002). */
  registered_owner_name?: string | null;
  /** @property registered_owner_document - CPF/CNPJ do proprietário registrado vigente. */
  registered_owner_document?: string | null;
  /** @property registered_owner_type - Tipo do documento do proprietário registrado vigente. */
  registered_owner_type?: 'cpf' | 'cnpj' | null;
  /** @property registration_state - UF (livre, 2 letras) em que o veículo está emplacado. */
  registration_state?: string | null;
  /** @property ownership_transferred - Indica se a transferência para a locadora foi concluída. */
  ownership_transferred?: boolean;
  /** @property ownership_transfer_date - Data da transferência efetivada. */
  ownership_transfer_date?: string | null;
  /** @property acquisition_type - Como a empresa adquiriu o veículo (≠ FIPE). */
  acquisition_type?: 'zero_km' | 'purchase' | 'consignment' | 'lease' | 'donation' | 'other' | null;
  /** @property acquisition_amount - Valor pago pela empresa na aquisição. */
  acquisition_amount?: number | null;
  /** @property maintenance_plan_id - Plano de manutenção atribuído (PRD 0003 F1). Nullable; bootstrap retroativo. */
  maintenance_plan_id?: string | null;
  /** @property created_at - Data de inserção do registro no banco de dados. */
  created_at: string;
  /** @property updated_at - Data da última modificação dos dados do veículo. */
  updated_at: string;
}

/**
 * @type VehicleDocumentType
 * @description Categoria do documento físico/digital do veículo (PRD 0002).
 */
export type VehicleDocumentType = 'crv' | 'crlv' | 'transfer_receipt' | 'other';

/**
 * @interface VehicleDocument
 * @description Histórico do dossiê documental por veículo (PRD 0002).
 * Apenas um documento por (motorcycle_id, type) pode ter is_current=true
 * — restrição garantida por índice parcial no banco.
 */
export interface VehicleDocument {
  id: string;
  tenant_id: string;
  motorcycle_id: string;
  type: VehicleDocumentType;
  exercise_year?: number | null;
  document_number?: string | null;
  issued_at?: string | null;
  registered_owner_name?: string | null;
  registered_owner_document?: string | null;
  registered_owner_type?: 'cpf' | 'cnpj' | null;
  file_url?: string | null;
  is_current: boolean;
  observations?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * @type VehicleObligationType
 * @description Tipos de pagamento obrigatório (recorrente) ou opcional do veículo.
 */
export type VehicleObligationType =
  | 'ipva'
  | 'licensing'
  | 'dpvat'
  | 'insurance'
  | 'crv_issuance'
  | 'detran_fee'
  | 'other';

/**
 * @type VehicleObligationStatus
 * @description Estado de uma obrigação. `overdue` é derivado em runtime
 * (rules/documentation) — só será gravado quando o PRD de alertas vier.
 */
export type VehicleObligationStatus = 'pending' | 'paid' | 'overdue' | 'exempt' | 'cancelled';

/**
 * @interface VehicleObligation
 * @description Pagamento anual obrigatório (IPVA, licenciamento, DPVAT) ou
 * opcional (seguro, taxa de emissão de CRV) por veículo (PRD 0002).
 */
export interface VehicleObligation {
  id: string;
  tenant_id: string;
  motorcycle_id: string;
  type: VehicleObligationType;
  reference_year: number;
  description?: string | null;
  amount: number;
  due_date: string;
  status: VehicleObligationStatus;
  paid_at?: string | null;
  payment_method?: string | null;
  payment_reference?: string | null;
  receipt_url?: string | null;
  observations?: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * @interface MotorcycleCostSummary
 * @description Linha da view `motorcycle_cost_summary` (PRD 0002 F1).
 * Agregado de TCO por moto, sem duplicar lançamentos.
 */
export interface MotorcycleCostSummary {
  motorcycle_id: string;
  tenant_id: string;
  obligations_paid: number;
  obligations_due: number;
  maintenance_cost: number;
  fines_company_paid: number;
  fines_customer_paid: number;
  expenses_paid: number;
}

/**
 * @type MotorcycleFinancialEventSource
 * @description Origem do evento na view `motorcycle_financial_events`.
 */
export type MotorcycleFinancialEventSource = 'obligation' | 'maintenance' | 'fine' | 'expense';

/**
 * @interface MotorcycleFinancialEvent
 * @description Linha da view `motorcycle_financial_events` (PRD 0002 F1).
 * Schema uniforme cross-tipo para a aba "Custo total" e relatórios.
 */
export interface MotorcycleFinancialEvent {
  event_id: string;
  tenant_id: string;
  motorcycle_id: string;
  source: MotorcycleFinancialEventSource;
  subtype: string;
  description: string | null;
  amount: number | null;
  event_date: string | null;
  paid_at: string | null;
  status: string;
  attachment_url: string | null;
}

/**
 * @interface CustomerRentalHistory
 * @description Resumo de uma locação anterior realizada por um cliente específico.
 * Utilizado para compor o histórico de confiabilidade e uso do locatário.
 */
export interface CustomerRentalHistory {
  /** @property start_date - Início da vigência do contrato anterior. */
  start_date: string;
  /** @property end_date - Data de término ou rescisão do contrato. */
  end_date?: string;
  /** @property motorcycle_license_plate - Placa da moto utilizada no período. */
  motorcycle_license_plate?: string;
  /** @property motorcycle_model - Modelo da moto utilizada no período. */
  motorcycle_model?: string;
  /** @property departure_reason - Motivo pelo qual o contrato foi encerrado. */
  departure_reason: string;
  /** @property amount_due - Eventual saldo devedor remanescente desta locação. */
  amount_due?: number;
}

/**
 * @interface Customer
 * @description Entidade que representa um cliente ou locatário no sistema.
 * Armazena dados pessoais, documentos e status de participação na fila de espera.
 */
export interface Customer {
  /** @property id - UUID único do cliente. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property user_id - Vínculo opcional com auth.users; presente quando o cliente recebeu acesso ao mobile. Ver ADR 0003. */
  user_id?: string | null;
  /** @property name - Nome completo do locatário. */
  name: string;
  /** @property cpf - Cadastro de Pessoa Física. */
  cpf: string;
  /** @property rg - Registro Geral (Identidade). */
  rg?: string;
  /** @property state - Unidade Federativa de emissão dos documentos ou residência. */
  state?: string;
  /** @property phone - Telefone principal de contato (geralmente WhatsApp). */
  phone: string;
  /** @property email - Endereço de correio eletrônico para notificações legais. */
  email?: string;
  /** @property address - Endereço residencial completo. */
  address?: string;
  /** @property zip_code - Código de Endereçamento Postal (CEP). */
  zip_code?: string;
  /** @property emergency_contact - Nome e telefone de um terceiro para emergências. */
  emergency_contact?: string;
  /** @property drivers_license - Número da CNH. */
  drivers_license: string;
  /** @property drivers_license_validity - Data de vencimento da habilitação. */
  drivers_license_validity?: string;
  /** @property drivers_license_category - Categorias habilitadas (ex: A, AB). */
  drivers_license_category?: string;
  /** @property birth_date - Data de nascimento para validação de idade. */
  birth_date?: string;
  /** @property payment_status - Resumo da situação financeira do cliente (ex: Em dia, Inadimplente). */
  payment_status?: string;
  /** @property drivers_license_photo_url - Link para a foto da CNH. */
  drivers_license_photo_url?: string;
  /** @property document_photo_url - Link para a foto de outro documento de identificação. */
  document_photo_url?: string;
  /** @property observations - Notas internas sobre o comportamento ou perfil do cliente. */
  observations?: string;
  /** @property documents - Lista de objetos Document vinculados ao cliente. */
  documents?: Document[];
  /** @property in_queue - Indica se o cliente está aguardando uma moto na fila. */
  in_queue: boolean;
  /** @property active - Define se o cadastro do cliente está ativo para novas operações. */
  active?: boolean;
  /** @property departure_date - Data em que o cliente deixou de ser locatário ativo. */
  departure_date?: string;
  /** @property departure_reason - Justificativa da saída (ex: Comprou moto própria, Desistência). */
  departure_reason?: string;
  /** @property rental_history - Lista de registros CustomerRentalHistory do cliente. */
  rental_history?: CustomerRentalHistory[];
  /** @property created_at - Registro de quando o cliente foi cadastrado. */
  created_at: string;
  /** @property updated_at - Última atualização dos dados cadastrais. */
  updated_at: string;
}

/**
 * @interface Contract
 * @description Representa o vínculo jurídico entre um cliente e uma motocicleta.
 * Consolida as regras de negócio, valores e datas da locação.
 */
export interface Contract {
  /** @property id - UUID único do contrato. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property customer_id - Referência ao ID do cliente locatário. */
  customer_id: string;
  /** @property motorcycle_id - Referência ao ID da moto alugada. */
  motorcycle_id: string;
  /** @property start_date - Data oficial de início da locação. */
  start_date: string;
  /** @property end_date - Data prevista ou real de término da locação. */
  end_date?: string;
  /** @property monthly_amount - Valor da parcela mensal acordada. */
  monthly_amount: number;
  /** @property status - Situação atual do contrato (active, closed, etc). */
  status: ContractStatus;
  /** @property pdf_url - Link para o arquivo PDF do contrato assinado. */
  pdf_url?: string;
  /** @property contract_type - Tipo do contrato: rental (mínimo 3 meses) ou loyalty (promessa de compra, 2 anos). */
  contract_type?: 'rental' | 'loyalty';
  /** @property observations - Notas específicas sobre este contrato. */
  observations?: string;
  /** @property created_at - Data de geração do contrato no sistema. */
  created_at: string;
  /** @property updated_at - Data da última alteração contratual. */
  updated_at: string;
  /** @property customer - Objeto opcional contendo os dados completos do cliente (Join). */
  customer?: Customer;
  /** @property motorcycle - Objeto opcional contendo os dados completos da moto (Join). */
  motorcycle?: Motorcycle;
}

/**
 * @interface Income
 * @description Registro de qualquer valor financeiro que entra no caixa da empresa.
 * Diferencia-se de 'Charge' por representar a entrada real já consolidada.
 */
export interface Income {
  /** @property id - UUID único da entrada. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property description - Descrição livre da entrada (ex: "Aluguel semana 10/03"). */
  description?: string;
  /** @property vehicle - Identificador do veículo relacionado (geralmente a placa). */
  vehicle: string;
  /** @property date - Data em que o recurso financeiro foi recebido. */
  date: string;
  /** @property lessee - Nome do cliente que realizou o pagamento. */
  lessee: string;
  /** @property amount - Valor monetário recebido. */
  amount: number;
  /** @property reference - Categoria da entrada (ex: Semanal, Caução, Multa). */
  reference: string;
  /** @property payment_method - Meio utilizado (ex: PIX, Cartão, Dinheiro). */
  payment_method: string;
  /** @property period_from - Início do período que este pagamento cobre. */
  period_from?: string;
  /** @property period_to - Fim do período que este pagamento cobre. */
  period_to?: string;
  /** @property observations - Notas explicativas sobre a entrada. */
  observations?: string;
  /** @property created_at - Carimbo de criação do registro. */
  created_at: string;
}

/**
 * @interface Expense
 * @description Registro de saídas financeiras e custos operacionais da empresa.
 * Pode estar vinculada a uma moto específica ou ser uma despesa geral.
 */
export interface Expense {
  /** @property id - UUID único da despesa. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property description - Detalhamento do gasto realizado. */
  description: string;
  /** @property amount - Valor pago na despesa. */
  amount: number;
  /** @property category - Classificação da despesa (Manutenção, Administrativo, etc). */
  category: string;
  /** @property date - Data oficial do gasto. */
  date: string;
  /** @property motorcycle_id - ID da moto relacionada, se for um custo de manutenção. */
  motorcycle_id?: string;
  /** @property observations - Observações suplementares sobre o gasto. */
  observations?: string;
  /** @property invoice_url - URL da nota fiscal no Supabase Storage. */
  invoice_url?: string | null;
  /** @property attachment_url - URL do arquivo adicional no Supabase Storage. */
  attachment_url?: string | null;
  /** @property payment_status - Estado de pagamento (PRD 0002). Default 'paid' preserva semântica atual. */
  payment_status?: 'pending' | 'paid' | null;
  /** @property paid_at - Data em que a despesa foi efetivamente paga (PRD 0002). */
  paid_at?: string | null;
  /** @property created_at - Registro de quando a despesa foi lançada. */
  created_at: string;
  /** @property updated_at - Última alteração no registro. */
  updated_at?: string;
  /** @property motorcycle - Dados da moto vinculada para relatórios por veículo. */
  motorcycle?: Motorcycle;
}

/**
 * @interface Maintenance
 * @description Registro de uma intervenção técnica realizada ou planejada em um veículo.
 * Armazena custos, datas, quilometragem e comprovantes.
 */
export interface Maintenance {
  /** @property id - UUID único da manutenção. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property motorcycle_id - ID da moto que recebe a manutenção. */
  motorcycle_id: string;
  /** @property standard_item_id - Vínculo com um item padrão, se aplicável. */
  standard_item_id: string | null;
  /** @property type - Tipo da intervenção (preventive, corrective, inspection). */
  type: 'preventive' | 'corrective' | 'inspection';
  /** @property description - Detalhamento do que foi ou será feito. */
  description: string;
  /** @property predicted_km - Quilometragem estimada para a realização. */
  predicted_km: number | null;
  /** @property actual_km - Quilometragem real no momento da realização. */
  actual_km: number | null;
  /** @property scheduled_date - Data agendada para o serviço. */
  scheduled_date: string | null;
  /** @property completed_date - Data em que o serviço foi finalizado. */
  completed_date: string | null;
  /** @property cost - Valor total pago pelo serviço e peças. */
  cost: number | null;
  /** @property responsibility - Campo legado (nunca persistido em DB). Será removido em F3b junto com a refatoração da UI do modal. */
  responsibility: 'company' | 'customer' | 'split' | null;
  /** @property effective_executor - Snapshot de quem leva à oficina, escolhido pelo operador no modal de conclusão (PRD 0003 D4). */
  effective_executor: 'company' | 'customer' | null;
  /** @property effective_customer_payer_pct - Snapshot do % do custo que o cliente arca; empresa = 100 − cliente (PRD 0003 D4). */
  effective_customer_payer_pct: number | null;
  /** @property completed - Indicador booleano de finalização. */
  completed: boolean;
  /** @property workshop - Nome da oficina ou mecânico responsável. */
  workshop: string | null;
  /** @property odometer_photo_url - Comprovante fotográfico do painel da moto. */
  odometer_photo_url: string | null;
  /** @property invoice_photo_url - Foto da nota fiscal ou recibo. */
  invoice_photo_url: string | null;
  /** @property observations - Notas sobre peças trocadas ou problemas encontrados. */
  observations: string | null;
  /** @property created_at - Data de abertura do registro de manutenção. */
  created_at: string;
  /** @property updated_at - Última alteração no registro. */
  updated_at: string;
  /** @property motorcycle - Dados da moto em manutenção. */
  motorcycle?: Motorcycle;
}

/**
 * @interface MaintenancePlan
 * @description Plano nomeado de manutenção criado pelo tenant (PRD 0003 §5.1).
 * Cada tenant pode ter vários planos; apenas um pode ter `is_default=true`
 * ativo simultaneamente (índice parcial único).
 */
export interface MaintenancePlan {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  /** Carregado quando a query pede join de itens. Opcional pra leituras só-lista. */
  items?: MaintenancePlanItem[];
}

/**
 * @interface MaintenancePlanItem
 * @description Item canônico de um plano de manutenção (PRD 0003 §5.2).
 * Pelo menos um de `interval_km`/`interval_days` é exigido por CHECK no banco.
 * `warn_threshold_pct` sobrescreve o default global (10%) para este item.
 * `is_critical` é flag reservada para o PRD futuro de bloqueio por crítica vencida.
 */
export interface MaintenancePlanItem {
  id: string;
  tenant_id: string;
  plan_id: string;
  name: string;
  interval_km: number | null;
  interval_days: number | null;
  warn_threshold_pct: number | null;
  is_critical: boolean;
  tip: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

/**
 * @interface Process
 * @description Define etapas ou perguntas de um fluxo de processo interno (ex: Triagem).
 * Utilizado para guiar o atendimento ou a configuração do sistema.
 */
export interface Process {
  /** @property id - UUID único do processo/pergunta. */
  id: string;
  /** @property tenant_id - Tenant ao qual o registro pertence (Fase 5). */
  tenant_id: string;
  /** @property question - Pergunta ou instrução do processo. */
  question: string;
  /** @property answer - Resposta configurada ou preenchida. */
  answer: string;
  /** @property category - Grupo ao qual o processo pertence. */
  category: string;
  /** @property order - Sequência de exibição no fluxo. */
  order: number;
  /** @property created_at - Data de criação. */
  created_at: string;
  /** @property updated_at - Última atualização. */
  updated_at: string;
}

/**
 * @interface Billing
 * @description Cobrança gerada para um cliente, vinculada ou não a um contrato.
 */
export interface Billing {
  id: string;
  tenant_id: string;
  contract_id: string | null;
  customer_id: string;
  description: string;
  amount: number;
  due_date: string;
  status: ChargeStatus;
  payment_date: string | null;
  observations: string | null;
  created_at: string;
  updated_at: string;
  customers?: { name: string; phone: string } | null;
  contracts?: { id: string } | null;
}

/**
 * @interface Fine
 * @description Multa de trânsito (PRD 0002): pertence ao veículo. O cliente
 * é opcional — pode ser atribuído quando o condutor é identificado.
 */
export interface Fine {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  motorcycle_id: string;
  description: string;
  amount: number;
  infraction_date: string;
  due_date: string | null;
  status: 'pending' | 'paid';
  payment_date: string | null;
  responsible: 'customer' | 'company';
  observations: string | null;
  // PRD 0002 — campos do AIT
  ait_number?: string | null;
  infraction_code?: string | null;
  infraction_location?: string | null;
  points?: number | null;
  source?: 'detran' | 'cetran' | 'municipal' | 'private_area' | 'other' | null;
  ticket_url?: string | null;
  created_at: string;
  updated_at: string;
  customers?: { name: string; phone: string } | null;
  motorcycles?: { license_plate: string; model: string; make: string } | null;
}

/**
 * @interface QueueEntry
 * @description Entrada na fila de espera de clientes por uma moto disponível.
 */
export interface QueueEntry {
  id: string;
  tenant_id: string;
  customer_id: string;
  position: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  customers?: {
    name: string;
    phone: string;
    drivers_license: string;
    drivers_license_validity: string | null;
  } | null;
}
