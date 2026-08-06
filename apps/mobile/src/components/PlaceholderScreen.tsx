import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { SafeAreaView, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { useTheme, useStatusBarStyle, type ThemeTokens } from '../theme'

type Props = {
  title: string
  subtitle?: string
  description: string
  footer?: React.ReactNode
}

// Casca padrão das telas do cliente até as regras do ADR 0003 §6 serem destrinchadas.
// Cada placeholder lista o que entra na próxima fase pra revisão rápida do produto.
export function PlaceholderScreen({ title, subtitle, description, footer }: Props) {
  const theme = useTheme()
  const statusBarStyle = useStatusBarStyle()
  const styles = useMemo(() => createStyles(theme), [theme])
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style={statusBarStyle} />
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      <View style={styles.body}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>EM CONSTRUÇÃO</Text>
          </View>
          <Text style={styles.description}>{description}</Text>
        </View>
        {footer ? <View style={styles.footer as ViewStyle}>{footer}</View> : null}
      </View>
    </SafeAreaView>
  )
}

const createStyles = (theme: ThemeTokens) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomColor: theme.border,
    borderBottomWidth: 1,
  },
  title: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.textMute,
    fontSize: 13,
    marginTop: 2,
  },
  body: {
    flex: 1,
    padding: 20,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  badgeText: {
    color: theme.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  description: {
    color: theme.textSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    marginTop: 24,
  },
})
