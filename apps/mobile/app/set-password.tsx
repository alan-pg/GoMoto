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

import { useAuth } from '../src/contexts/auth'
import { useTheme, useStatusBarStyle, type ThemeTokens } from '../src/theme'

export default function SetPasswordScreen() {
  const { setPassword, signOut } = useAuth()
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const theme = useTheme()
  const statusBarStyle = useStatusBarStyle()
  const styles = useMemo(() => createStyles(theme), [theme])

  async function handleSubmit() {
    setError(null)
    if (password.length < 8) {
      setError('A senha precisa ter pelo menos 8 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }
    setSubmitting(true)
    const { error: updateError } = await setPassword(password)
    if (updateError) {
      setError(updateError)
      setSubmitting(false)
    }
    // sucesso: o gate em _layout.tsx redireciona para "/" assim que needsPasswordSetup vira false.
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
        <Text style={styles.title}>Definir senha</Text>
        <Text style={styles.subtitle}>
          Crie uma senha para usar nos próximos acessos.
        </Text>

        <Text style={styles.label}>Nova senha</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPasswordValue}
          placeholder="Mínimo 8 caracteres"
          placeholderTextColor={theme.textMute}
          secureTextEntry
          autoComplete="new-password"
          editable={!submitting}
        />

        <Text style={styles.label}>Confirmar senha</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          placeholder="Repita a senha"
          placeholderTextColor={theme.textMute}
          secureTextEntry
          autoComplete="new-password"
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
            <Text style={styles.buttonText}>Salvar senha</Text>
          )}
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={signOut} disabled={submitting}>
          <Text style={styles.secondaryText}>Cancelar e sair</Text>
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
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  subtitle: {
    color: theme.textMute,
    fontSize: 14,
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
  secondaryButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryText: {
    color: theme.textMute,
    fontSize: 13,
  },
})
