import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { useAuth } from '../src/contexts/auth'

export default function SelectTenantScreen() {
  const { tenants, selectTenant, signOut } = useAuth()

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.card}>
        <Text style={styles.title}>Escolha a empresa</Text>
        <Text style={styles.subtitle}>
          Você é cliente de mais de uma locadora. Selecione com qual deseja entrar agora.
        </Text>

        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {tenants.map((tenant) => {
            const suspended = !!tenant.suspended_at
            return (
              <Pressable
                key={tenant.id}
                style={[styles.option, suspended && styles.optionDisabled]}
                onPress={() => !suspended && selectTenant(tenant.id)}
              >
                <View style={styles.optionContent}>
                  <Text style={[styles.optionName, suspended && styles.optionNameDisabled]}>
                    {tenant.name}
                  </Text>
                  {suspended && (
                    <Text style={styles.optionBadge}>Temporariamente indisponível</Text>
                  )}
                </View>
                {!suspended && <Text style={styles.optionChevron}>›</Text>}
              </Pressable>
            )
          })}
        </ScrollView>

        <Pressable style={styles.secondaryButton} onPress={signOut}>
          <Text style={styles.secondaryText}>Sair</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#202020',
    borderColor: '#474747',
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
  },
  title: {
    color: '#f5f5f5',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: '#9e9e9e',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 16,
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    gap: 8,
    paddingVertical: 4,
  },
  option: {
    backgroundColor: '#181818',
    borderColor: '#474747',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionDisabled: {
    opacity: 0.5,
  },
  optionContent: {
    flex: 1,
  },
  optionName: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '600',
  },
  optionNameDisabled: {
    color: '#9e9e9e',
  },
  optionBadge: {
    color: '#9e9e9e',
    fontSize: 11,
    marginTop: 2,
  },
  optionChevron: {
    color: '#BAFF1A',
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 8,
  },
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  secondaryText: {
    color: '#9e9e9e',
    fontSize: 13,
  },
})
