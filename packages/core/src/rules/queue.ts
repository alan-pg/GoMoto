/**
 * @file rules/queue.ts
 * @description Regras puras para a fila de espera de candidatos a contrato.
 *
 * As notas auditáveis registradas no swap de posições viviam duplicadas entre
 * `actions.ts` (server) e `page.tsx` (legado). Centralizar aqui evita drift e
 * mantém a auditoria consistente — o `notes` exibido no histórico vem sempre
 * do mesmo lugar.
 */

/**
 * Mapeamento dos motivos de subida na fila para a nota registrada no candidato
 * que foi ULTRAPASSADO. Mantém simetria narrativa: se A subiu porque "Possui
 * caução e documentos completos", o registro de B explica que perdeu posição
 * justamente por esse motivo, e não por uma reordenação genérica.
 */
const DOWN_NOTE_BY_UP_REASON: Record<string, string> = {
  'Possui caução e documentos completos':
    'Desceu na fila: Outro candidato possui caução e documentos completos',
  'Aguardando há mais tempo na fila':
    'Desceu na fila: Outro candidato aguardava há mais tempo',
}

/**
 * Nota que o candidato ULTRAPASSADO recebe quando outro subiu de posição.
 * Fallback genérico quando o motivo não tem mapeamento explícito.
 */
export function getMoveDownNote(upReason: string): string {
  return DOWN_NOTE_BY_UP_REASON[upReason] ?? 'Desceu na fila: Reordenação da fila'
}

/**
 * Nota que o candidato que SUBIU registra com o motivo escolhido pelo operador.
 * Sempre prefixa "Subiu na fila:" para que o histórico fique legível sem
 * contexto adicional.
 */
export function getMoveUpNote(upReason: string): string {
  return `Subiu na fila: ${upReason}`
}

/**
 * Nota usada no candidato que SUBIU por consequência da descida de outro
 * (não por motivo próprio). Mantida como string canônica para que dois swaps
 * gravem o mesmo texto.
 */
export const QUEUE_REORDER_UP_NOTE = 'Subiu na fila: Reordenação da fila'

/**
 * Nota usada no candidato que DESCEU por motivo próprio (não por consequência
 * de outro subir).
 */
export function getMoveDownReasonNote(downReason: string): string {
  return `Desceu na fila: ${downReason}`
}
