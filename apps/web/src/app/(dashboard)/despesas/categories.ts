/**
 * Categorias de despesa mapeadas às contas do plano (Spec 0014).
 *
 * Vive fora de `actions.ts` por restrição do Next.js: um arquivo `'use server'`
 * só pode exportar funções async. Constantes exportadas de lá são removidas do
 * bundle do cliente e chegam como `undefined` — falha que só aparece no build,
 * não no typecheck.
 *
 * Substitui o `category VARCHAR(100)` de texto livre, que não tinha relação
 * nenhuma com o modelo financeiro.
 */

import { ACCOUNTS, type AccountCode } from '@gomoto/core'

export const EXPENSE_CATEGORIES: { value: AccountCode; label: string }[] = [
  { value: ACCOUNTS.MAINTENANCE_EXPENSE,   label: 'Manutenção' },
  { value: ACCOUNTS.DOCUMENTATION_EXPENSE, label: 'Documentação' },
  { value: ACCOUNTS.INSURANCE_EXPENSE,     label: 'Seguro' },
  { value: ACCOUNTS.FINE_EXPENSE,          label: 'Multa' },
  { value: ACCOUNTS.OPERATIONAL_EXPENSE,   label: 'Operacional' },
]
