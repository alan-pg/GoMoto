import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import Constants from 'expo-constants'
import { useAuth } from '../../src/contexts/auth'
import { supabase } from '../../src/lib/supabase'
import { useTheme, useThemePreference, type ThemeTokens, type ThemePreference } from '../../src/theme'

type Styles = ReturnType<typeof createStyles>

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'auto', label: 'Sistema' },
  { value: 'light', label: 'Claro' },
  { value: 'dark', label: 'Escuro' },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.replace(/\D/g, '').length >= 10 ? raw : null
}

function openWhatsApp(phone: string) {
  const digits = phone.replace(/\D/g, '')
  const number = digits.startsWith('55') ? digits : `55${digits}`
  void Linking.openURL(`https://wa.me/${number}`)
}

function openMail(email: string) {
  void Linking.openURL(`mailto:${email}`)
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionTitle({ text, styles }: { text: string; styles: Styles }) {
  return <Text style={styles.sectionTitle}>{text}</Text>
}

function InfoRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  )
}

function ActionRow({
  label,
  sublabel,
  onPress,
  accent,
  styles,
}: {
  label: string
  sublabel?: string
  onPress: () => void
  accent?: boolean
  styles: Styles
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
      onPress={onPress}
    >
      <View style={styles.actionRowLeft}>
        <Text style={[styles.actionRowLabel, accent && styles.actionRowLabelAccent]}>
          {label}
        </Text>
        {sublabel ? <Text style={styles.actionRowSublabel}>{sublabel}</Text> : null}
      </View>
      <Text style={styles.actionRowChevron}>›</Text>
    </Pressable>
  )
}

function ThemeSelector({
  preference,
  onChange,
  styles,
}: {
  preference: ThemePreference
  onChange: (pref: ThemePreference) => void
  styles: Styles
}) {
  return (
    <View style={styles.themeOptions}>
      {THEME_OPTIONS.map((opt) => {
        const active = preference === opt.value
        return (
          <Pressable
            key={opt.value}
            style={[styles.themeOption, active && styles.themeOptionActive]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.themeOptionText, active && styles.themeOptionTextActive]}>
              {opt.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type CustomerProfile = { name: string | null; phone: string | null }

export default function ContaTab() {
  const { session, tenants, activeTenantId, signOut } = useAuth()
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const { preference, setPreference } = useThemePreference()

  const activeTenant = tenants.find((t) => t.id === activeTenantId) ?? null
  const appVersion = Constants.expoConfig?.version ?? '—'

  const [profile, setProfile] = useState<CustomerProfile>({ name: null, phone: null })

  useEffect(() => {
    const userId = session?.user.id
    if (!userId) return
    supabase
      .from('customers')
      .select('name, phone')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setProfile({ name: data.name ?? null, phone: data.phone ?? null })
      })
  }, [session?.user.id])

  function handleSignOut() {
    Alert.alert('Sair', 'Tem certeza que deseja encerrar a sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sair', style: 'destructive', onPress: () => void signOut() },
    ])
  }

  const tenantPhone = formatPhone(activeTenant?.contact_phone)
  const tenantEmail = activeTenant?.contact_email ?? null

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Conta</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* Meu perfil */}
        <SectionTitle text="Meu perfil" styles={styles} />
        <View style={styles.card}>
          <InfoRow label="Nome" value={profile.name ?? '—'} styles={styles} />
          {profile.phone ? (
            <InfoRow label="Telefone" value={profile.phone} styles={styles} />
          ) : null}
        </View>

        {/* Aparência */}
        <SectionTitle text="Aparência" styles={styles} />
        <View style={styles.card}>
          <ThemeSelector preference={preference} onChange={setPreference} styles={styles} />
        </View>

        {/* Minha locadora */}
        {activeTenant ? (
          <>
            <SectionTitle text="Minha locadora" styles={styles} />
            <View style={styles.card}>
              <InfoRow label="Empresa" value={activeTenant.name} styles={styles} />
              {tenantPhone ? (
                <ActionRow
                  label="WhatsApp"
                  sublabel={tenantPhone}
                  onPress={() => openWhatsApp(tenantPhone)}
                  accent
                  styles={styles}
                />
              ) : null}
              {tenantEmail ? (
                <ActionRow
                  label="E-mail"
                  sublabel={tenantEmail}
                  onPress={() => openMail(tenantEmail)}
                  accent
                  styles={styles}
                />
              ) : null}
              {!tenantPhone && !tenantEmail ? (
                <InfoRow label="Contato" value="Não informado" styles={styles} />
              ) : null}
            </View>
          </>
        ) : null}

        {/* Sobre */}
        <SectionTitle text="Sobre o app" styles={styles} />
        <View style={styles.card}>
          <InfoRow label="Versão" value={appVersion} styles={styles} />
        </View>

        {/* Sair */}
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutBtnPressed]}
          onPress={handleSignOut}
        >
          <Text style={styles.signOutText}>Sair da conta</Text>
        </Pressable>

      </ScrollView>
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const createStyles = (theme: ThemeTokens) => StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomColor: theme.surfaceAlt,
    borderBottomWidth: 1,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 6,
  },
  sectionTitle: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
    marginLeft: 2,
  },
  card: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    color: theme.textMute,
    fontSize: 13,
  },
  infoValue: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
    maxWidth: '60%',
    textAlign: 'right',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomColor: theme.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  actionRowPressed: {
    backgroundColor: theme.border,
  },
  actionRowLeft: {
    flex: 1,
    gap: 2,
  },
  actionRowLabel: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
  },
  actionRowLabelAccent: {
    color: theme.primary,
  },
  actionRowSublabel: {
    color: theme.textMute,
    fontSize: 12,
  },
  actionRowChevron: {
    color: theme.border,
    fontSize: 18,
  },
  themeOptions: {
    flexDirection: 'row',
    gap: 8,
    padding: 10,
  },
  themeOption: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: theme.surfaceAlt,
    borderColor: theme.border,
    borderWidth: 1,
  },
  themeOptionActive: {
    backgroundColor: theme.primaryTint,
    borderColor: theme.primary,
  },
  themeOptionText: {
    color: theme.textSoft,
    fontSize: 13,
    fontWeight: '600',
  },
  themeOptionTextActive: {
    color: theme.primary,
  },
  signOutBtn: {
    marginTop: 24,
    borderColor: theme.danger,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: theme.dangerBg,
  },
  signOutBtnPressed: {
    backgroundColor: theme.dangerBg,
  },
  signOutText: {
    color: theme.warning,
    fontSize: 15,
    fontWeight: '600',
  },
})
