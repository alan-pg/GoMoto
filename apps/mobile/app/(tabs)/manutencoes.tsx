import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  useCustomers,
  useMaintenanceRecords,
  useMaintenances,
  useVehicles,
} from '@gomoto/data'
import {
  calculateMaintenanceStatus,
  type Maintenance,
  type MaintenanceRecord,
  type MaintenanceStatus,
  type Vehicle,
} from '@gomoto/core'
import { useAuth } from '../../src/contexts/auth'
import { RegisterMaintenanceModal } from '../../src/components/RegisterMaintenanceModal'

const STATUS_ORDER: Record<MaintenanceStatus, number> = {
  overdue: 0,
  upcoming: 1,
  scheduled: 2,
  completed: 3,
}

const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  overdue: 'Vencida',
  upcoming: 'Próxima',
  scheduled: 'Agendada',
  completed: 'Concluída',
}

const STATUS_TONE: Record<MaintenanceStatus, { bg: string; fg: string }> = {
  overdue: { bg: '#7c1c1c', fg: '#ff9c9a' },
  upcoming: { bg: '#5e3a00', fg: '#ffba49' },
  scheduled: { bg: '#0e2f13', fg: '#229731' },
  completed: { bg: '#323232', fg: '#9e9e9e' },
}

const TYPE_LABEL: Record<string, string> = {
  preventive: 'Preventiva',
  corrective: 'Corretiva',
  inspection: 'Vistoria',
}

type MaintenanceWithStatus = Maintenance & { _status: MaintenanceStatus }

function deriveStatus(m: Maintenance, vehicle: Vehicle | undefined): MaintenanceStatus {
  return calculateMaintenanceStatus({
    completed: m.completed,
    predicted_km: m.predicted_km,
    scheduled_date: m.scheduled_date,
    current_km: vehicle?.km_current ?? 0,
  })
}

function formatKm(km: number | null): string {
  if (km == null) return '—'
  return `${km.toLocaleString('pt-BR')} km`
}

function formatDate(date: string | null): string {
  if (!date) return '—'
  const [y, mo, d] = date.split('-')
  return `${d}/${mo}/${y}`
}

export default function ManutencoesTab() {
  const { activeTenantId } = useAuth()
  const maintenancesQuery = useMaintenances()
  const vehiclesQuery = useVehicles()
  const recordsQuery = useMaintenanceRecords()
  const customersQuery = useCustomers()

  const [selected, setSelected] = useState<Maintenance | null>(null)

  const loading =
    maintenancesQuery.isLoading || vehiclesQuery.isLoading || customersQuery.isLoading
  const refreshing = maintenancesQuery.isFetching && !maintenancesQuery.isLoading
  const error = maintenancesQuery.error ?? vehiclesQuery.error ?? recordsQuery.error

  const vehiclesById = useMemo(() => {
    const map = new Map<string, Vehicle>()
    for (const m of vehiclesQuery.data ?? []) map.set(m.id, m)
    return map
  }, [vehiclesQuery.data])

  // Cliente tem 1 customer por tenant — pega o da locadora ativa.
  const customerId = useMemo(() => {
    const list = customersQuery.data ?? []
    return list.find((c) => c.tenant_id === activeTenantId)?.id ?? null
  }, [customersQuery.data, activeTenantId])

  // Mapa de pending por maintenance_id: presença = "Aguardando aprovação"
  // → desabilita botão e troca o CTA pela tag.
  const pendingByMaintenanceId = useMemo(() => {
    const map = new Map<string, MaintenanceRecord>()
    for (const r of recordsQuery.data ?? []) {
      if (r.status === 'pending' && r.maintenance_id) map.set(r.maintenance_id, r)
    }
    return map
  }, [recordsQuery.data])

  const { upcoming, history } = useMemo(() => {
    const items = (maintenancesQuery.data ?? []).map((m) => ({
      ...m,
      _status: deriveStatus(m, vehiclesById.get(m.vehicle_id)),
    }))
    const upcoming = items
      .filter((m) => m._status !== 'completed')
      .sort((a, b) => {
        const s = STATUS_ORDER[a._status] - STATUS_ORDER[b._status]
        if (s !== 0) return s
        const aDate = a.scheduled_date ?? ''
        const bDate = b.scheduled_date ?? ''
        return aDate.localeCompare(bDate)
      })
    const history = items
      .filter((m) => m._status === 'completed')
      .sort((a, b) => (b.completed_date ?? '').localeCompare(a.completed_date ?? ''))
      .slice(0, 10)
    return { upcoming, history }
  }, [maintenancesQuery.data, vehiclesById])

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>Manutenções</Text>
        <Text style={styles.subtitle}>Próximas e histórico do seu veículo</Text>
      </View>
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        refreshControl={
          <RefreshControl
            tintColor="#BAFF1A"
            refreshing={refreshing}
            onRefresh={() => {
              maintenancesQuery.refetch()
              vehiclesQuery.refetch()
              recordsQuery.refetch()
            }}
          />
        }
      >
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#BAFF1A" />
          </View>
        ) : error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>Não foi possível carregar agora. Puxe pra baixo para tentar de novo.</Text>
          </View>
        ) : (
          <>
            <Section title={`Próximas (${upcoming.length})`}>
              {upcoming.length === 0 ? (
                <EmptyCard text="Nenhuma manutenção pendente — seu veículo está em dia." />
              ) : (
                upcoming.map((m) => (
                  <MaintenanceCard
                    key={m.id}
                    item={m}
                    vehicle={vehiclesById.get(m.vehicle_id)}
                    pendingRecord={pendingByMaintenanceId.get(m.id)}
                    canRegister={!!customerId}
                    onRegister={() => setSelected(m)}
                  />
                ))
              )}
            </Section>

            <Section title={`Histórico (${history.length})`}>
              {history.length === 0 ? (
                <EmptyCard text="Nenhuma manutenção concluída ainda." />
              ) : (
                history.map((m) => (
                  <MaintenanceCard
                    key={m.id}
                    item={m}
                    vehicle={vehiclesById.get(m.vehicle_id)}
                  />
                ))
              )}
            </Section>
          </>
        )}
      </ScrollView>
      {customerId ? (
        <RegisterMaintenanceModal
          visible={selected !== null}
          onClose={() => setSelected(null)}
          customerId={customerId}
          maintenance={selected}
        />
      ) : null}
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  )
}

function EmptyCard({ text }: { text: string }) {
  return (
    <View style={styles.emptyCard}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

function MaintenanceCard({
  item,
  vehicle,
  pendingRecord,
  canRegister,
  onRegister,
}: {
  item: MaintenanceWithStatus
  vehicle?: Vehicle
  pendingRecord?: MaintenanceRecord
  canRegister?: boolean
  onRegister?: () => void
}) {
  const tone = STATUS_TONE[item._status]
  const isOpen = item._status !== 'completed'
  const showRegisterCta = isOpen && !pendingRecord && canRegister && onRegister
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle} numberOfLines={1}>
          {item.description || TYPE_LABEL[item.type] || item.type}
        </Text>
        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
          <Text style={[styles.statusText, { color: tone.fg }]}>{STATUS_LABEL[item._status]}</Text>
        </View>
      </View>
      <Text style={styles.cardMeta}>
        {vehicle ? `${vehicle.license_plate} — ${vehicle.make} ${vehicle.model}` : 'Veículo não identificado'}
      </Text>
      <View style={styles.cardFields}>
        {item._status === 'completed' ? (
          <>
            <Field label="Concluída em" value={formatDate(item.completed_date)} />
            <Field label="KM no serviço" value={formatKm(item.actual_km)} />
          </>
        ) : (
          <>
            <Field label="Prevista" value={formatDate(item.scheduled_date)} />
            <Field label="KM previsto" value={formatKm(item.predicted_km)} />
          </>
        )}
      </View>
      {isOpen && pendingRecord ? (
        <View style={styles.pendingPill}>
          <Text style={styles.pendingText}>Aguardando aprovação da locadora</Text>
        </View>
      ) : null}
      {showRegisterCta ? (
        <Pressable
          style={({ pressed }) => [styles.registerBtn, pressed && styles.registerBtnPressed]}
          onPress={onRegister}
        >
          <Text style={styles.registerText}>Registrar conclusão</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  title: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  subtitle: { color: '#9e9e9e', fontSize: 13, marginTop: 2 },
  body: { flex: 1 },
  bodyContent: { padding: 20, paddingBottom: 40 },
  loading: { paddingVertical: 40, alignItems: 'center' },
  errorCard: {
    backgroundColor: '#7c1c1c',
    borderRadius: 12,
    padding: 16,
  },
  errorText: { color: '#ff9c9a', fontSize: 13 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#9e9e9e',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 10,
    textTransform: 'uppercase',
  },
  sectionBody: { gap: 10 },
  emptyCard: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
  },
  emptyText: { color: '#9e9e9e', fontSize: 13 },
  card: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 6,
  },
  cardTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '600', flex: 1 },
  cardMeta: { color: '#9e9e9e', fontSize: 12, marginBottom: 10 },
  cardFields: { flexDirection: 'row', gap: 16 },
  field: { flex: 1 },
  fieldLabel: { color: '#9e9e9e', fontSize: 11 },
  fieldValue: { color: '#f5f5f5', fontSize: 13, marginTop: 2 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  pendingPill: {
    marginTop: 12,
    backgroundColor: '#5e3a00',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  pendingText: { color: '#ffba49', fontSize: 12, fontWeight: '600' },
  registerBtn: {
    marginTop: 12,
    backgroundColor: '#BAFF1A',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  registerBtnPressed: { opacity: 0.85 },
  registerText: { color: '#121212', fontSize: 13, fontWeight: '700' },
})
