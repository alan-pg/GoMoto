import { Stack, useRouter, useSegments } from 'expo-router'
import { useEffect } from 'react'
import { ActivityIndicator, StyleSheet, View } from 'react-native'

import { AuthProvider, useAuth } from '../src/contexts/auth'

function RootGate() {
  const { session, loading, needsPasswordSetup } = useAuth()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    if (loading) return
    const onLogin = segments[0] === 'login'
    const onSetPassword = segments[0] === 'set-password'

    if (!session && !onLogin) {
      router.replace('/login')
      return
    }
    if (session && needsPasswordSetup && !onSetPassword) {
      router.replace('/set-password')
      return
    }
    if (session && !needsPasswordSetup && (onLogin || onSetPassword)) {
      router.replace('/')
    }
  }, [session, loading, needsPasswordSetup, segments, router])

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
    <AuthProvider>
      <RootGate />
    </AuthProvider>
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
