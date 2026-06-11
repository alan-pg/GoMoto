import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import {
  listQueueEntries,
  createQueueEntry,
  updateQueueEntry,
  deleteQueueEntry,
} from '../repositories/queue'
import type { QueueEntry } from '@gomoto/core'

const KEY = 'queue_entries'

export function useQueueEntries() {
  const supabase = useSupabaseContext()
  return useQuery({ queryKey: [KEY], queryFn: () => listQueueEntries(supabase) })
}

export function useCreateQueueEntry() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: Omit<QueueEntry, 'id' | 'created_at' | 'updated_at' | 'customers'>) =>
      createQueueEntry(supabase, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useUpdateQueueEntry() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: Partial<Omit<QueueEntry, 'id' | 'created_at' | 'updated_at' | 'customers'>>
    }) => updateQueueEntry(supabase, id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}

export function useDeleteQueueEntry() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteQueueEntry(supabase, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: [KEY] }),
  })
}
