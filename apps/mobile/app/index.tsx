import { StatusBar } from 'expo-status-bar'
import { Pressable, StyleSheet, Text, View } from 'react-native'

import { useAuth } from '../src/contexts/auth'

export default function Index() {
  const { session, signOut } = useAuth()
  const email = session?.user?.email ?? '—'

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>GoMoto Mobile</Text>
      <Text style={styles.subtitle}>Logado como</Text>
      <Text style={styles.email}>{email}</Text>

      <Pressable style={styles.button} onPress={signOut}>
        <Text style={styles.buttonText}>Sair</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1a1a1a',
    padding: 24,
  },
  title: {
    color: '#f5f5f5',
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 24,
  },
  subtitle: {
    color: '#9e9e9e',
    fontSize: 14,
  },
  email: {
    color: '#BAFF1A',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 4,
    marginBottom: 32,
  },
  button: {
    borderColor: '#474747',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '500',
  },
})
