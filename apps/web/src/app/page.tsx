import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getPlatformRole } from '@/lib/auth/platform'

/**
 * Raiz da app: roteia o caller para o universo correto.
 *
 * - Não autenticado → middleware joga para /login antes de chegar aqui.
 * - platform_admin  → control plane (/admin/dashboard).
 * - tenant_member   → cockpit do tenant (/dashboard).
 *
 * Mantém em um único lugar a decisão de "qual home". O middleware
 * apenas garante que o usuário está autenticado.
 */
export default async function Home() {
  const supabase = await createClient()
  const role = await getPlatformRole(supabase)
  redirect(role ? '/admin/dashboard' : '/dashboard')
}
