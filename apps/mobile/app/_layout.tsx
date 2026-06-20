import { Stack, useRouter, useSegments } from 'expo-router'
import { useEffect, useMemo, type ReactNode } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SupabaseProvider } from '@gomoto/data'

import { AuthProvider, useAuth } from '../src/contexts/auth'
import { supabase } from '../src/lib/supabase'

// QueryClient é estável durante o ciclo do app. Defaults conservadores: dados
// considerados frescos por 30 s (mobile alterna foreground/background bastante).
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
})

function DataProviders({ children }: { children: ReactNode }) {
  const { activeTenantId } = useAuth()
  // Re-cria o value só quando o tenant ativo muda — evita render desnecessário
  // nos consumidores do contexto.
  const tenantId = useMemo(() => activeTenantId, [activeTenantId])
  return (
    <SupabaseProvider client={supabase} tenantId={tenantId}>
      {children}
    </SupabaseProvider>
  )
}

function RootGate() {
  const { session, loading, needsPasswordSetup, needsTenantSelection } = useAuth()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (loading) return
    const onLogin = segments[0] === 'login'
    const onSetPassword = segments[0] === 'set-password'
    const onSelectTenant = segments[0] === 'select-tenant'

    if (!session && !onLogin) {
      router.replace('/login')
      return
    }
    if (session && needsPasswordSetup && !onSetPassword) {
      router.replace('/set-password')
      return
    }
    if (session && !needsPasswordSetup && needsTenantSelection && !onSelectTenant) {
      router.replace('/select-tenant')
      return
    }
    if (
      session &&
      !needsPasswordSetup &&
      !needsTenantSelection &&
      (onLogin || onSetPassword || onSelectTenant)
    ) {
      router.replace('/')
    }
  }, [session, loading, needsPasswordSetup, needsTenantSelection, segments, router])

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator color="#BAFF1A" size="large" />
      </View>
    )
  }

  return <Stack screenOptions={{ headerShown: false }} />
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DataProviders>
          <RootGate />
        </DataProviders>
      </AuthProvider>
    </QueryClientProvider>
  )
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
