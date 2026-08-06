import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { formatCpf, normalizeCpf } from '@gomoto/core'

import { useAuth } from '../src/contexts/auth'
import { useTheme, useStatusBarStyle, type ThemeTokens } from '../src/theme'

const NOT_A_CUSTOMER_ERROR = 'Esta conta não tem acesso ao app.'

export default function LoginScreen() {
  const { signIn } = useAuth()
  const [cpf, setCpf] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const theme = useTheme()
  const statusBarStyle = useStatusBarStyle()
  const styles = useMemo(() => createStyles(theme), [theme])

  function handleCpfChange(value: string) {
    const digits = normalizeCpf(value).slice(0, 11)
    // Mascara em tempo real quando o usuário já digitou os 11 dígitos —
    // antes disso, mostra os números crus pra não atrapalhar a digitação.
    setCpf(digits.length === 11 ? formatCpf(digits) : digits)
  }

  async function handleSubmit() {
    setError(null)
    setSubmitting(true)
    const { error: authError } = await signIn(cpf, password)
    if (authError) {
      if (authError === NOT_A_CUSTOMER_ERROR) {
        setError(authError)
      } else if (authError.startsWith('Informe')) {
        setError(authError)
      } else {
        setError('CPF ou senha incorretos.')
      }
      setSubmitting(false)
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <StatusBar style={statusBarStyle} />
      <View style={styles.card}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>GM</Text>
        </View>
        <Text style={styles.title}>GoMoto</Text>
        <Text style={styles.subtitle}>Entre com seu CPF</Text>

        <Text style={styles.label}>CPF</Text>
        <TextInput
          style={styles.input}
          value={cpf}
          onChangeText={handleCpfChange}
          placeholder="000.000.000-00"
          placeholderTextColor={theme.textMute}
          autoCapitalize="none"
          keyboardType="number-pad"
          editable={!submitting}
          maxLength={14}
        />

        <Text style={styles.label}>Senha</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor={theme.textMute}
          secureTextEntry
          autoComplete="current-password"
          editable={!submitting}
        />

        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <Pressable
          style={[styles.button, submitting && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={theme.primaryContrast} />
          ) : (
            <Text style={styles.buttonText}>Entrar</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
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
    maxWidth: 360,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 24,
  },
  logoBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 12,
  },
  logoText: {
    color: theme.primaryContrast,
    fontSize: 20,
    fontWeight: '700',
  },
  title: {
    color: theme.text,
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: theme.textMute,
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 24,
  },
  label: {
    color: theme.textSoft,
    fontSize: 13,
    marginBottom: 6,
    marginTop: 8,
  },
  input: {
    backgroundColor: theme.bg,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    color: theme.text,
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  errorBox: {
    backgroundColor: theme.dangerBg,
    borderColor: theme.danger,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
  },
  errorText: {
    color: theme.danger,
    fontSize: 13,
  },
  button: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: theme.primaryContrast,
    fontSize: 16,
    fontWeight: '600',
  },
})
