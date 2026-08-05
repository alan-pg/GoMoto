import { useQuery } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'
import { listRentals, listActiveRentals } from '../repositories/rentals'
import type { Rental } from '@gomoto/core'

const KEY = 'rentals'

export function useRentals(filter?: { status?: 'active' | 'closed' | 'transferred' }) {
  const supabase = useSupabaseContext()
  return useQuery<Rental[]>({
    queryKey: [KEY, filter],
    queryFn: () => listRentals(supabase, filter),
  })
}

export function useActiveRentals() {
  const supabase = useSupabaseContext()
  return useQuery<Rental[]>({
    queryKey: [KEY, 'active'],
    queryFn: () => listActiveRentals(supabase),
  })
}
