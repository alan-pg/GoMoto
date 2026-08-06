import { useMemo } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'

import { useAuth } from '../src/contexts/auth'
import { useTheme, useStatusBarStyle, type ThemeTokens } from '../src/theme'

export default function SelectTenantScreen() {
  const { tenants, selectTenant, signOut } = useAuth()
  const theme = useTheme()
  const statusBarStyle = useStatusBarStyle()
  const styles = useMemo(() => createStyles(theme), [theme])

  return (
    <View style={styles.container}>
      <StatusBar style={statusBarStyle} />
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

const createStyles = (theme: ThemeTokens) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: theme.textMute,
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
    backgroundColor: theme.bg,
    borderColor: theme.border,
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
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
  optionNameDisabled: {
    color: theme.textMute,
  },
  optionBadge: {
    color: theme.textMute,
    fontSize: 11,
    marginTop: 2,
  },
  optionChevron: {
    color: theme.primary,
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
    color: theme.textMute,
    fontSize: 13,
  },
})
