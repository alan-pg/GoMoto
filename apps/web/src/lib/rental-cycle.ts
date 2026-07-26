export const WEEK_DAY_OPTIONS = [
  { value: '7', label: 'Domingo' },
  { value: '1', label: 'Segunda-feira' },
  { value: '2', label: 'Terça-feira' },
  { value: '3', label: 'Quarta-feira' },
  { value: '4', label: 'Quinta-feira' },
  { value: '5', label: 'Sexta-feira' },
  { value: '6', label: 'Sábado' },
]

export function formatDueDay(cycle: 'weekly' | 'monthly', dueDay: string): string {
  if (cycle === 'monthly') return `Dia ${dueDay}`
  return WEEK_DAY_OPTIONS.find(o => o.value === dueDay)?.label ?? dueDay
}
