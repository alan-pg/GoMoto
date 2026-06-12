import { StatusBar } from 'expo-status-bar'
import { StyleSheet, Text, View } from 'react-native'

export default function Index() {
  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <Text style={styles.title}>GoMoto Mobile</Text>
      <Text style={styles.subtitle}>Bootstrap funcionando — Fase 4-bis.</Text>
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
    marginBottom: 8,
  },
  subtitle: {
    color: '#9e9e9e',
    fontSize: 16,
  },
})
