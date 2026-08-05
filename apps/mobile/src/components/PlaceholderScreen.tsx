import { StatusBar } from 'expo-status-bar'
import { SafeAreaView, StyleSheet, Text, View, type ViewStyle } from 'react-native'

type Props = {
  title: string
  subtitle?: string
  description: string
  footer?: React.ReactNode
}

// Casca padrão das telas do cliente até as regras do ADR 0003 §6 serem destrinchadas.
// Cada placeholder lista o que entra na próxima fase pra revisão rápida do produto.
export function PlaceholderScreen({ title, subtitle, description, footer }: Props) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  title: {
    color: '#f5f5f5',
    fontSize: 22,
    fontWeight: '700',
  },
  subtitle: {
    color: '#9e9e9e',
    fontSize: 13,
    marginTop: 2,
  },
  body: {
    flex: 1,
    padding: 20,
  },
  card: {
    backgroundColor: '#202020',
    borderColor: '#474747',
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: '#323232',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 12,
  },
  badgeText: {
    color: '#BAFF1A',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  description: {
    color: '#bdbdbd',
    fontSize: 14,
    lineHeight: 20,
  },
  footer: {
    marginTop: 24,
  },
})
