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
  active:      { bg: 'bg-[#BAFF1A22]', text: 'text-[#BAFF1A]', label: 'Ativa'       },
  closed:      { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Encerrada'   },
  transferred: { bg: 'bg-[#60a5fa22]', text: 'text-[#60a5fa]', label: 'Transferida' },
}

export const SCHEDULE_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Pendente'          },
  overdue:   { bg: 'bg-[#7c1c1c]',   text: 'text-[#ff9c9a]', label: 'Atrasada'          },
  submitted: { bg: 'bg-[#5e3a00]',   text: 'text-[#ffba49]', label: 'Aguardando análise' },
  approved:  { bg: 'bg-[#0e2f13]',   text: 'text-[#229731]', label: 'Aprovada'          },
  rejected:  { bg: 'bg-[#7c1c1c]',   text: 'text-[#ff9c9a]', label: 'Rejeitada'         },
}

export const INSPECTION_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Pendente'  },
  completed: { bg: 'bg-[#0e2f13]',   text: 'text-[#229731]', label: 'Concluída' },
}

export const MAINTENANCE_STATUS_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  pending:   { bg: 'bg-[#32323222]', text: 'text-[#9e9e9e]', label: 'Pendente'  },
  completed: { bg: 'bg-[#0e2f13]',   text: 'text-[#229731]', label: 'Concluída' },
}

export const MAINTENANCE_TYPE_LABEL: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Revisão',
}
