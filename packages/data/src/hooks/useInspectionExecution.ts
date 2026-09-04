import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { getInspectionForExecution } from '../repositories/inspections'

/** Vistoria + itens do perfil vinculado — alimenta o formulário de execução/análise. */
export function useInspectionForExecution(inspectionId: string | null | undefined) {
  const supabase = useSupabaseContext()
  return useQuery({
    queryKey: ['inspection-execution', inspectionId],
    queryFn: () => getInspectionForExecution(supabase, inspectionId as string),
    enabled: !!inspectionId,
  })
}
