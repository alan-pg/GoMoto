import { describe, expect, it } from 'vitest'
import {
  QUEUE_REORDER_UP_NOTE,
  getMoveDownNote,
  getMoveDownReasonNote,
  getMoveUpNote,
} from './queue'

describe('getMoveDownNote', () => {
  it('mapeia "Possui caução e documentos completos" para a nota narrativa', () => {
    expect(getMoveDownNote('Possui caução e documentos completos')).toBe(
      'Desceu na fila: Outro candidato possui caução e documentos completos',
    )
  })

  it('mapeia "Aguardando há mais tempo na fila" para a nota narrativa', () => {
    expect(getMoveDownNote('Aguardando há mais tempo na fila')).toBe(
      'Desceu na fila: Outro candidato aguardava há mais tempo',
    )
  })

  it('motivos sem mapeamento caem no fallback genérico de reordenação', () => {
    expect(getMoveDownNote('Indicação ou prioridade interna')).toBe(
      'Desceu na fila: Reordenação da fila',
    )
  })

  it('string vazia também usa fallback (defensivo)', () => {
    expect(getMoveDownNote('')).toBe('Desceu na fila: Reordenação da fila')
  })
})

describe('getMoveUpNote', () => {
  it('prefixa "Subiu na fila:" e mantém o motivo original', () => {
    expect(getMoveUpNote('Necessidade urgente comprovada')).toBe(
      'Subiu na fila: Necessidade urgente comprovada',
    )
  })

  it('aceita qualquer motivo livre (não há lista enum a respeitar)', () => {
    expect(getMoveUpNote('Operador errou e está corrigindo')).toBe(
      'Subiu na fila: Operador errou e está corrigindo',
    )
  })
})

describe('getMoveDownReasonNote', () => {
  it('prefixa "Desceu na fila:" e mantém o motivo original', () => {
    expect(getMoveDownReasonNote('Documentação incompleta')).toBe(
      'Desceu na fila: Documentação incompleta',
    )
  })
})

describe('QUEUE_REORDER_UP_NOTE', () => {
  it('é a string canônica usada no candidato que sobe sem motivo próprio', () => {
    expect(QUEUE_REORDER_UP_NOTE).toBe('Subiu na fila: Reordenação da fila')
  })
})
