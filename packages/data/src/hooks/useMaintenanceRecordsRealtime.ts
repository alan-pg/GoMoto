import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSupabaseContext } from '../context'

/**
 * Assina mudanças na publication `supabase_realtime` para `maintenance_records`
 * e invalida ['maintenance_records'] + ['maintenances'] a cada evento.
 *
 * RLS continua aplicada — cada cliente só recebe eventos das linhas que
 * pode ler. Por isso o mesmo hook serve operador e cliente sem condicional.
 *
 * Montar em alto nível (Providers do web, DataProviders do mobile). O
 * dedup com a flag de subscribed evita warning de StrictMode em dev e
 * remove o channel no cleanup quando o componente desmonta.
 */
export function useMaintenanceRecordsRealtime() {
  const supabase = useSupabaseContext()
  const qc = useQueryClient()

  useEffect(() => {
    const channel = supabase
      .channel('maintenance_records:changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'maintenance_records' },
        () => {
          qc.invalidateQueries({ queryKey: ['maintenance_records'] })
          qc.invalidateQueries({ queryKey: ['maintenances'] })
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [supabase, qc])
}
