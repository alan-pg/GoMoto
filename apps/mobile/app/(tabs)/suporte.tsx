import { useEffect, useState } from 'react'
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

function SectionTitle({ text }: { text: string }) {
  return <Text style={styles.sectionTitle}>{text}</Text>
}

function InfoRow({ label, value }: { label: string; value: string }) {
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
}: {
  label: string
  sublabel?: string
  onPress: () => void
  accent?: boolean
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

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

type CustomerProfile = { name: string | null; phone: string | null }

export default function ContaTab() {
  const { session, tenants, activeTenantId, signOut } = useAuth()

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
        <SectionTitle text="Meu perfil" />
        <View style={styles.card}>
          <InfoRow label="Nome" value={profile.name ?? '—'} />
          {profile.phone ? (
            <InfoRow label="Telefone" value={profile.phone} />
          ) : null}
        </View>

        {/* Minha locadora */}
        {activeTenant ? (
          <>
            <SectionTitle text="Minha locadora" />
            <View style={styles.card}>
              <InfoRow label="Empresa" value={activeTenant.name} />
              {tenantPhone ? (
                <ActionRow
                  label="WhatsApp"
                  sublabel={tenantPhone}
                  onPress={() => openWhatsApp(tenantPhone)}
                  accent
                />
              ) : null}
              {tenantEmail ? (
                <ActionRow
                  label="E-mail"
                  sublabel={tenantEmail}
                  onPress={() => openMail(tenantEmail)}
                  accent
                />
              ) : null}
              {!tenantPhone && !tenantEmail ? (
                <InfoRow label="Contato" value="Não informado" />
              ) : null}
            </View>
          </>
        ) : null}

        {/* Sobre */}
        <SectionTitle text="Sobre o app" />
        <View style={styles.card}>
          <InfoRow label="Versão" value={appVersion} />
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#121212',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  headerTitle: {
    color: '#f5f5f5',
    fontSize: 22,
    fontWeight: '700',
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 6,
  },
  sectionTitle: {
    color: '#9e9e9e',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 16,
    marginBottom: 4,
    marginLeft: 2,
  },
  card: {
    backgroundColor: '#202020',
    borderColor: '#323232',
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
    borderBottomColor: '#2a2a2a',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoLabel: {
    color: '#9e9e9e',
    fontSize: 13,
  },
  infoValue: {
    color: '#f5f5f5',
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
    borderBottomColor: '#2a2a2a',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  actionRowPressed: {
    backgroundColor: '#2a2a2a',
  },
  actionRowLeft: {
    flex: 1,
    gap: 2,
  },
  actionRowLabel: {
    color: '#f5f5f5',
    fontSize: 13,
    fontWeight: '500',
  },
  actionRowLabelAccent: {
    color: '#BAFF1A',
  },
  actionRowSublabel: {
    color: '#9e9e9e',
    fontSize: 12,
  },
  actionRowChevron: {
    color: '#474747',
    fontSize: 18,
  },
  signOutBtn: {
    marginTop: 24,
    borderColor: '#3a1a1a',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#1e0f0f',
  },
  signOutBtnPressed: {
    backgroundColor: '#2a1212',
  },
  signOutText: {
    color: '#e65e24',
    fontSize: 15,
    fontWeight: '600',
  },
})
