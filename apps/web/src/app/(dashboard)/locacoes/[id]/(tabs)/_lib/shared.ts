export function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

export const CONTRACT_LABEL: Record<string, string> = {
  rental:      'Locação',
  rent_to_own: 'Compra Programada',
}

export const CYCLE_LABEL: Record<string, string> = {
  weekly:  'Semanal',
  monthly: 'Mensal',
}

export const STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  active:      { bg: 'bg-success-bg', text: 'text-success', label: 'Ativa'       },
  closed:      { bg: 'bg-surface-2',  text: 'text-fg-mute', label: 'Encerrada'   },
  transferred: { bg: 'bg-info-bg',    text: 'text-info',    label: 'Transferida' },
}

export const SCHEDULE_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-surface-2',  text: 'text-fg-mute', label: 'Pendente'          },
  overdue:   { bg: 'bg-danger-bg',  text: 'text-danger',  label: 'Atrasada'          },
  submitted: { bg: 'bg-pending-bg', text: 'text-pending', label: 'Aguardando análise' },
  approved:  { bg: 'bg-success-bg', text: 'text-success', label: 'Aprovada'          },
  rejected:  { bg: 'bg-danger-bg',  text: 'text-danger',  label: 'Rejeitada'         },
}

export const INSPECTION_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-surface-2',  text: 'text-fg-mute', label: 'Pendente'  },
  completed: { bg: 'bg-success-bg', text: 'text-success', label: 'Concluída' },
}

export const MAINTENANCE_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-surface-2',  text: 'text-fg-mute', label: 'Pendente'  },
  completed: { bg: 'bg-success-bg', text: 'text-success', label: 'Concluída' },
}

export const MAINTENANCE_TYPE_LABEL: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Revisão',
}
