import { useCallback, useMemo } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useRouter } from 'expo-router'
import {
  useMyCharges,
  useMaintenances,
  useRentals,
  useVehicles,
} from '@gomoto/data'
import type { MyChargeRow } from '@gomoto/data'
import {
  calculateMaintenanceStatus,
  type Maintenance,
  type Rental,
  type Vehicle,
} from '@gomoto/core'
import { useAuth } from '../../src/contexts/auth'
import { useTheme, type ThemeTokens } from '../../src/theme'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

const CYCLE_LABEL: Record<string, string> = {
  monthly: '/mês',
  weekly: '/semana',
}

function getMaintenanceStatusTone(theme: ThemeTokens): Record<string, { bg: string; fg: string }> {
  return {
    overdue:   { bg: theme.dangerBg, fg: theme.danger },
    upcoming:  { bg: theme.pendingBg, fg: theme.pending },
    scheduled: { bg: theme.successBg, fg: theme.success },
    completed: { bg: theme.surfaceAlt, fg: theme.textMute },
  }
}

type StatusTone = ReturnType<typeof getMaintenanceStatusTone>
type Styles = ReturnType<typeof createStyles>

const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  overdue:   'Vencida',
  upcoming:  'Próxima',
  scheduled: 'Agendada',
  completed: 'Concluída',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ text, styles }: { text: string; styles: Styles }) {
  return <Text style={styles.sectionLabel}>{text}</Text>
}

function RentalHeroCard({ rental, styles }: { rental: Rental; styles: Styles }) {
  const vehicle = rental.vehicle
  return (
    <View style={styles.heroCard}>
      {vehicle?.photo_url ? (
        <Image source={{ uri: vehicle.photo_url }} style={styles.heroPhoto} resizeMode="cover" />
      ) : (
        <View style={styles.heroPhotoPlaceholder}>
          <Text style={styles.heroPhotoPlaceholderText}>Sem foto</Text>
        </View>
      )}
      <View style={styles.heroInfo}>
        <Text style={styles.heroPlate}>{vehicle?.license_plate ?? '—'}</Text>
        <Text style={styles.heroModel}>
          {vehicle ? `${vehicle.make} ${vehicle.model}` : '—'}
        </Text>
        <View style={styles.heroBadge}>
          <Text style={styles.heroBadgeText}>Ativo</Text>
        </View>
      </View>
    </View>
  )
}

function OverdueBillingAlert({
  billing,
  onPress,
  styles,
}: {
  billing: MyChargeRow
  onPress: () => void
  styles: Styles
}) {
  const amount = billing.amount_due
  return (
    <Pressable style={styles.alertCard} onPress={onPress}>
      <View style={styles.alertLeft}>
        <Text style={styles.alertTitle}>Cobrança vencida</Text>
        <Text style={styles.alertDesc} numberOfLines={1}>
          {billing.description ?? 'Cobrança'}
        </Text>
        <Text style={styles.alertDue}>Venceu em {formatDate(billing.due_date)}</Text>
      </View>
      <View style={styles.alertRight}>
        <Text style={styles.alertAmount}>{formatCurrency(amount)}</Text>
        <Text style={styles.alertCta}>Ver cobranças →</Text>
      </View>
    </Pressable>
  )
}

function NextBillingCard({
  billing,
  onPress,
  styles,
}: {
  billing: MyChargeRow
  onPress: () => void
  styles: Styles
}) {
  const amount = billing.amount_due
  return (
    <Pressable style={styles.infoCard} onPress={onPress}>
      <View style={styles.infoCardRow}>
        <View style={styles.infoCardLeft}>
          <Text style={styles.infoCardTitle}>Próximo pagamento</Text>
          <Text style={styles.infoCardDesc} numberOfLines={1}>
            {billing.description ?? 'Cobrança'}
          </Text>
          <Text style={styles.infoCardMeta}>Vence em {formatDate(billing.due_date)}</Text>
        </View>
        <View style={styles.infoCardRight}>
          <Text style={styles.infoCardAmount}>{formatCurrency(amount)}</Text>
          <Text style={styles.infoCardCta}>Pagar →</Text>
        </View>
      </View>
    </Pressable>
  )
}

function MaintenanceCard({
  maintenance,
  vehicle,
  onPress,
  styles,
  statusTone,
}: {
  maintenance: Maintenance
  vehicle: Vehicle | undefined
  onPress: () => void
  styles: Styles
  statusTone: StatusTone
}) {
  const status = calculateMaintenanceStatus({
    completed: maintenance.completed,
    predicted_km: maintenance.predicted_km,
    scheduled_date: maintenance.scheduled_date,
    current_km: vehicle?.km_current ?? 0,
  })
  const tone = statusTone[status]
  return (
    <Pressable style={styles.infoCard} onPress={onPress}>
      <View style={styles.infoCardRow}>
        <View style={styles.infoCardLeft}>
          <Text style={styles.infoCardTitle}>Próxima manutenção</Text>
          <Text style={styles.infoCardDesc} numberOfLines={1}>
            {maintenance.description}
          </Text>
          {maintenance.scheduled_date ? (
            <Text style={styles.infoCardMeta}>
              Prevista: {formatDate(maintenance.scheduled_date)}
            </Text>
          ) : maintenance.predicted_km ? (
            <Text style={styles.infoCardMeta}>
              KM previsto: {maintenance.predicted_km.toLocaleString('pt-BR')} km
            </Text>
          ) : null}
        </View>
        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.statusPillText, { color: tone.fg }]}>
            {MAINTENANCE_STATUS_LABEL[status]}
          </Text>
        </View>
      </View>
    </Pressable>
  )
}

function ContractDetailsCard({ rental, styles }: { rental: Rental; styles: Styles }) {
  const cycleLabel = CYCLE_LABEL[rental.cycle ?? ''] ?? ''
  return (
    <View style={styles.detailsCard}>
      <Text style={styles.detailsTitle}>Detalhes do contrato</Text>
      <View style={styles.detailsGrid}>
        <DetailRow label="Início" value={formatDate(rental.start_date)} styles={styles} />
        {rental.end_date ? (
          <DetailRow label="Término previsto" value={formatDate(rental.end_date)} styles={styles} />
        ) : null}
        {rental.cycle_amount ? (
          <DetailRow
            label="Valor"
            value={`${formatCurrency(rental.cycle_amount)}${cycleLabel}`}
            styles={styles}
          />
        ) : null}
        {rental.cycle ? (
          <DetailRow
            label="Ciclo"
            value={rental.cycle === 'monthly' ? 'Mensal' : 'Semanal'}
            styles={styles}
          />
        ) : null}
      </View>
    </View>
  )
}

function DetailRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

function NoRentalCard({ styles }: { styles: Styles }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyTitle}>Sem contrato ativo</Text>
      <Text style={styles.emptyText}>
        Quando você tiver uma locação ativa, os detalhes aparecerão aqui.
      </Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export default function HomeTab() {
  const router = useRouter()
  const { tenants, activeTenantId } = useAuth()
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const statusTone = useMemo(() => getMaintenanceStatusTone(theme), [theme])

  const rentalsQuery    = useRentals({ status: 'active' })
  const billingsQuery   = useMyCharges(true)
  const maintenancesQuery = useMaintenances()
  const vehiclesQuery   = useVehicles()

  useFocusEffect(
    useCallback(() => {
      void rentalsQuery.refetch()
      void billingsQuery.refetch()
      void maintenancesQuery.refetch()
      void vehiclesQuery.refetch()
    }, [rentalsQuery.refetch, billingsQuery.refetch, maintenancesQuery.refetch, vehiclesQuery.refetch]),
  )

  const isLoading = rentalsQuery.isLoading || billingsQuery.isLoading

  const isRefreshing =
    (rentalsQuery.isFetching && !rentalsQuery.isLoading) ||
    (billingsQuery.isFetching && !billingsQuery.isLoading)

  async function handleRefresh() {
    await Promise.all([
      rentalsQuery.refetch(),
      billingsQuery.refetch(),
      maintenancesQuery.refetch(),
      vehiclesQuery.refetch(),
    ])
  }

  // Locadora ativa
  const activeTenant = tenants.find((t) => t.id === activeTenantId)

  // Locação ativa (primeira — clientes normalmente têm uma)
  const activeRental: Rental | undefined = (rentalsQuery.data ?? [])[0]

  // Mapa de veículos para calcular status de manutenção
  const vehiclesById = useMemo(() => {
    const m = new Map<string, Vehicle>()
    for (const v of vehiclesQuery.data ?? []) m.set(v.id, v)
    return m
  }, [vehiclesQuery.data])

  const today = new Date().toISOString().slice(0, 10)

  // Cobranças vencidas (status overdue, ou pending com due_date < hoje)
  const overdueBillings = useMemo(() => {
    return (billingsQuery.data ?? []).filter(
      (b) =>
        b.is_overdue ||
        (b.status === 'open' && b.due_date < today),
    )
  }, [billingsQuery.data, today])

  // Próxima cobrança pendente (não vencida) — mais próxima por due_date
  const nextBilling: MyChargeRow | undefined = useMemo(() => {
    return (billingsQuery.data ?? [])
      .filter((b) => b.status === 'open' && b.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0]
  }, [billingsQuery.data, today])

  // Manutenção mais urgente (overdue > upcoming > scheduled) filtrando só o veículo ativo
  const urgentMaintenance: Maintenance | undefined = useMemo(() => {
    const activeVehicleId = activeRental?.vehicle_id
    const STATUS_ORDER: Record<string, number> = { overdue: 0, upcoming: 1, scheduled: 2, completed: 99 }
    return (maintenancesQuery.data ?? [])
      .filter((m) => !m.completed && (!activeVehicleId || m.vehicle_id === activeVehicleId))
      .map((m) => ({
        m,
        status: calculateMaintenanceStatus({
          completed: m.completed,
          predicted_km: m.predicted_km,
          scheduled_date: m.scheduled_date,
          current_km: vehiclesById.get(m.vehicle_id)?.km_current ?? 0,
        }),
      }))
      .filter(({ status }) => status !== 'completed')
      .sort((a, b) => (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99))
      .map(({ m }) => m)[0]
  }, [maintenancesQuery.data, activeRental?.vehicle_id, vehiclesById])

  function goToCobrancas() {
    router.navigate('/(tabs)/cobrancas' as never)
  }

  function goToManutencoes() {
    router.navigate('/(tabs)/manutencoes' as never)
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{greeting()}</Text>
        {activeTenant ? (
          <Text style={styles.tenantName}>{activeTenant.name}</Text>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={theme.primary}
            />
          }
        >
          {!activeRental ? (
            <NoRentalCard styles={styles} />
          ) : (
            <>
              {/* Meu veículo */}
              <SectionLabel text="Meu veículo" styles={styles} />
              <RentalHeroCard rental={activeRental} styles={styles} />

              {/* Cobrança vencida */}
              {overdueBillings.length > 0 && (
                <>
                  <SectionLabel text={`${overdueBillings.length > 1 ? `${overdueBillings.length} cobranças vencidas` : 'Cobrança vencida'}`} styles={styles} />
                  <OverdueBillingAlert
                    billing={overdueBillings[0]!}
                    onPress={goToCobrancas}
                    styles={styles}
                  />
                  {overdueBillings.length > 1 && (
                    <Pressable style={styles.moreLink} onPress={goToCobrancas}>
                      <Text style={styles.moreLinkText}>
                        Ver todas as {overdueBillings.length} cobranças vencidas →
                      </Text>
                    </Pressable>
                  )}
                </>
              )}

              {/* Próximo pagamento */}
              {nextBilling && (
                <>
                  <SectionLabel text="Próximo pagamento" styles={styles} />
                  <NextBillingCard billing={nextBilling} onPress={goToCobrancas} styles={styles} />
                </>
              )}

              {/* Manutenção urgente */}
              {urgentMaintenance && (
                <>
                  <SectionLabel text="Manutenção" styles={styles} />
                  <MaintenanceCard
                    maintenance={urgentMaintenance}
                    vehicle={vehiclesById.get(urgentMaintenance.vehicle_id)}
                    onPress={goToManutencoes}
                    styles={styles}
                    statusTone={statusTone}
                  />
                </>
              )}

              {/* Detalhes do contrato */}
              <SectionLabel text="Contrato" styles={styles} />
              <ContractDetailsCard rental={activeRental} styles={styles} />
            </>
          )}
        </ScrollView>
      )}
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
  greeting: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  tenantName: {
    color: theme.textMute,
    fontSize: 13,
    marginTop: 2,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },

  // Section label
  sectionLabel: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: 8,
    marginBottom: 4,
    marginLeft: 2,
  },

  // Hero card
  heroCard: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  heroPhoto: {
    width: '100%',
    height: 160,
    backgroundColor: theme.border,
  },
  heroPhotoPlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPhotoPlaceholderText: {
    color: theme.border,
    fontSize: 13,
  },
  heroInfo: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroPlate: {
    color: theme.primary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroModel: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  heroBadge: {
    backgroundColor: theme.successBg,
    borderColor: theme.success,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  heroBadgeText: {
    color: theme.success,
    fontSize: 11,
    fontWeight: '700',
  },

  // Alert card (overdue)
  alertCard: {
    backgroundColor: theme.dangerBg,
    borderColor: theme.dangerBg,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  alertLeft: {
    flex: 1,
    gap: 3,
  },
  alertTitle: {
    color: theme.danger,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  alertDesc: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
  },
  alertDue: {
    color: theme.danger,
    fontSize: 12,
  },
  alertRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  alertAmount: {
    color: theme.danger,
    fontSize: 16,
    fontWeight: '700',
  },
  alertCta: {
    color: theme.danger,
    fontSize: 12,
    fontWeight: '600',
  },

  // Info card (next billing, maintenance)
  infoCard: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  infoCardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  infoCardLeft: {
    flex: 1,
    gap: 3,
  },
  infoCardTitle: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  infoCardDesc: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
  },
  infoCardMeta: {
    color: theme.textMute,
    fontSize: 12,
  },
  infoCardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  infoCardAmount: {
    color: theme.primary,
    fontSize: 16,
    fontWeight: '700',
  },
  infoCardCta: {
    color: theme.primary,
    fontSize: 12,
    fontWeight: '600',
  },

  // Maintenance status pill
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  // "More" link
  moreLink: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  moreLinkText: {
    color: theme.danger,
    fontSize: 13,
    fontWeight: '500',
  },

  // Contract details card
  detailsCard: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  detailsTitle: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  detailsGrid: {
    gap: 10,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    color: theme.textMute,
    fontSize: 13,
  },
  detailValue: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
  },

  // Empty state
  emptyCard: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    color: theme.textMute,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
})
