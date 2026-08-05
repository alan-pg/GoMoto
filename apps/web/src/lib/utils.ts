/**
 * @file utils.ts
 * @description Conjunto de funções utilitárias para formatação de dados, manipulação de classes CSS
 * e lógica auxiliar de interface do usuário para o Sistema GoMoto.
 * Este arquivo centraliza helper functions que garantem a consistência visual e de dados em todo o projeto.
 */

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Re-export utils puros do core para retrocompatibilidade dos imports existentes.
// Novos consumidores devem importar direto de '@gomoto/core'.
export { formatCurrency, formatDate } from '@gomoto/core'

/**
 * @function cn
 * @description Mescla classes CSS condicionalmente com resolução de conflitos do Tailwind.
 * Fica em apps/web porque depende de tailwind-merge (específico do web).
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

