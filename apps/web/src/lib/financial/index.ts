/**
 * Camada de escrita financeira (Spec 0014 / ADR 0024).
 *
 * Server Actions consomem daqui; nenhuma delas escreve em `financial_entries`
 * diretamente. A tradução evento → contas vive em @gomoto/core.
 */
export * from './ledger'
export * from './charges'
export * from './payments'
export * from './payables'
