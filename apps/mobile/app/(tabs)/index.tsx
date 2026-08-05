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
  useBillingsForCustomer,
  useMaintenances,
  useRentals,
  useVehicles,
} from '@gomoto/data'
import {
  calculateFinalAmount,
  calculateMaintenanceStatus,
  type Billing,
  type Maintenance,
  type Rental,
  type Vehicle,
} from '@gomoto/core'
import { useAuth } from '../../src/contexts/auth'

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

const MAINTENANCE_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  overdue:   { bg: '#7c1c1c', fg: '#ff9c9a' },
  upcoming:  { bg: '#5e3a00', fg: '#ffba49' },
  scheduled: { bg: '#0e2f13', fg: '#229731' },
  completed: { bg: '#323232', fg: '#9e9e9e' },
}

const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  overdue:   'Vencida',
  upcoming:  'Próxima',
  scheduled: 'Agendada',
  completed: 'Concluída',
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionLabel({ text }: { text: string }) {
  return <Text style={styles.sectionLabel}>{text}</Text>
}

function RentalHeroCard({ rental }: { rental: Rental }) {
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
}: {
  billing: Billing
  onPress: () => void
}) {
  const amount = calculateFinalAmount(billing.original_amount ?? 0, billing.discount_amount ?? 0)
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
}: {
  billing: Billing
  onPress: () => void
}) {
  const amount = calculateFinalAmount(billing.original_amount ?? 0, billing.discount_amount ?? 0)
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
}: {
  maintenance: Maintenance
  vehicle: Vehicle | undefined
  onPress: () => void
}) {
  const status = calculateMaintenanceStatus({
    completed: maintenance.completed,
    predicted_km: maintenance.predicted_km,
    scheduled_date: maintenance.scheduled_date,
    current_km: vehicle?.km_current ?? 0,
  })
  const tone = MAINTENANCE_STATUS_TONE[status]
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

function ContractDetailsCard({ rental }: { rental: Rental }) {
  const cycleLabel = CYCLE_LABEL[rental.cycle ?? ''] ?? ''
  return (
    <View style={styles.detailsCard}>
      <Text style={styles.detailsTitle}>Detalhes do contrato</Text>
      <View style={styles.detailsGrid}>
        <DetailRow label="Início" value={formatDate(rental.start_date)} />
        {rental.end_date ? (
          <DetailRow label="Término previsto" value={formatDate(rental.end_date)} />
        ) : null}
        {rental.cycle_amount ? (
          <DetailRow
            label="Valor"
            value={`${formatCurrency(rental.cycle_amount)}${cycleLabel}`}
          />
        ) : null}
        {rental.cycle ? (
          <DetailRow
            label="Ciclo"
            value={rental.cycle === 'monthly' ? 'Mensal' : 'Semanal'}
          />
        ) : null}
      </View>
    </View>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  )
}

function NoRentalCard() {
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

  const rentalsQuery    = useRentals({ status: 'active' })
  const billingsQuery   = useBillingsForCustomer()
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
        b.status === 'overdue' ||
        (b.status === 'pending' && b.due_date < today),
    )
  }, [billingsQuery.data, today])

  // Próxima cobrança pendente (não vencida) — mais próxima por due_date
  const nextBilling: Billing | undefined = useMemo(() => {
    return (billingsQuery.data ?? [])
      .filter((b) => b.status === 'pending' && b.due_date >= today)
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
          <ActivityIndicator color="#BAFF1A" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor="#BAFF1A"
            />
          }
        >
          {!activeRental ? (
            <NoRentalCard />
          ) : (
            <>
              {/* Meu veículo */}
              <SectionLabel text="Meu veículo" />
              <RentalHeroCard rental={activeRental} />

              {/* Cobrança vencida */}
              {overdueBillings.length > 0 && (
                <>
                  <SectionLabel text={`${overdueBillings.length > 1 ? `${overdueBillings.length} cobranças vencidas` : 'Cobrança vencida'}`} />
                  <OverdueBillingAlert
                    billing={overdueBillings[0]!}
                    onPress={goToCobrancas}
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
                  <SectionLabel text="Próximo pagamento" />
                  <NextBillingCard billing={nextBilling} onPress={goToCobrancas} />
                </>
              )}

              {/* Manutenção urgente */}
              {urgentMaintenance && (
                <>
                  <SectionLabel text="Manutenção" />
                  <MaintenanceCard
                    maintenance={urgentMaintenance}
                    vehicle={vehiclesById.get(urgentMaintenance.vehicle_id)}
                    onPress={goToManutencoes}
                  />
                </>
              )}

              {/* Detalhes do contrato */}
              <SectionLabel text="Contrato" />
              <ContractDetailsCard rental={activeRental} />
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
  greeting: {
    color: '#f5f5f5',
    fontSize: 22,
    fontWeight: '700',
  },
  tenantName: {
    color: '#9e9e9e',
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
    color: '#9e9e9e',
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
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  heroPhoto: {
    width: '100%',
    height: 160,
    backgroundColor: '#2a2a2a',
  },
  heroPhotoPlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPhotoPlaceholderText: {
    color: '#474747',
    fontSize: 13,
  },
  heroInfo: {
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  heroPlate: {
    color: '#BAFF1A',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  heroModel: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '500',
    flex: 1,
  },
  heroBadge: {
    backgroundColor: '#0e2f13',
    borderColor: '#229731',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  heroBadgeText: {
    color: '#229731',
    fontSize: 11,
    fontWeight: '700',
  },

  // Alert card (overdue)
  alertCard: {
    backgroundColor: '#3a0f0f',
    borderColor: '#7c1c1c',
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
    color: '#ff9c9a',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  alertDesc: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '500',
  },
  alertDue: {
    color: '#ff9c9a',
    fontSize: 12,
  },
  alertRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  alertAmount: {
    color: '#ff9c9a',
    fontSize: 16,
    fontWeight: '700',
  },
  alertCta: {
    color: '#ff9c9a',
    fontSize: 12,
    fontWeight: '600',
  },

  // Info card (next billing, maintenance)
  infoCard: {
    backgroundColor: '#202020',
    borderColor: '#323232',
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
    color: '#9e9e9e',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  infoCardDesc: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '500',
  },
  infoCardMeta: {
    color: '#9e9e9e',
    fontSize: 12,
  },
  infoCardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  infoCardAmount: {
    color: '#BAFF1A',
    fontSize: 16,
    fontWeight: '700',
  },
  infoCardCta: {
    color: '#BAFF1A',
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
    color: '#ff9c9a',
    fontSize: 13,
    fontWeight: '500',
  },

  // Contract details card
  detailsCard: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  detailsTitle: {
    color: '#9e9e9e',
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
    color: '#9e9e9e',
    fontSize: 13,
  },
  detailValue: {
    color: '#f5f5f5',
    fontSize: 13,
    fontWeight: '500',
  },

  // Empty state
  emptyCard: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
  },
  emptyTitle: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyText: {
    color: '#9e9e9e',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
})
