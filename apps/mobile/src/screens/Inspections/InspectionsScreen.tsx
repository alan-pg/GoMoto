import { useCallback, useState } from 'react'
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import {
  usePendingInspectionSchedulesForCustomer,
  usePeriodicInspectionsForCustomer,
} from '@gomoto/data'
import type { Inspection, InspectionScheduleWithStatus } from '@gomoto/core'
import { InspectionSubmitModal } from './InspectionSubmitModal'

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  overdue: 'Atrasada',
  rejected: 'Rejeitada — reenviar',
}

const SCHEDULE_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  pending: { bg: '#202020', fg: '#9e9e9e' },
  overdue: { bg: '#3a1a00', fg: '#e65e24' },
  rejected: { bg: '#3a0f0f', fg: '#ff9c9a' },
}

const HISTORY_STATUS_LABEL: Record<string, string> = {
  submitted: 'Aguardando análise',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
}

const HISTORY_STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  submitted: { bg: '#2a1f00', fg: '#e0a500' },
  approved: { bg: '#0e2f13', fg: '#229731' },
  rejected: { bg: '#3a0f0f', fg: '#ff9c9a' },
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function InspectionsScreen() {
  const [refreshing, setRefreshing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selected, setSelected] = useState<InspectionScheduleWithStatus | null>(null)

  const pendingQuery = usePendingInspectionSchedulesForCustomer()
  const historyQuery = usePeriodicInspectionsForCustomer()

  useFocusEffect(
    useCallback(() => {
      void pendingQuery.refetch()
    }, [pendingQuery.refetch]),
  )

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([pendingQuery.refetch(), historyOpen ? historyQuery.refetch() : Promise.resolve()])
    setRefreshing(false)
  }

  const pending = pendingQuery.data ?? []

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Vistorias</Text>
        <Text style={styles.headerSubtitle}>Vistoria periódica do seu veículo</Text>
      </View>

      {pendingQuery.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color="#BAFF1A" size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#BAFF1A" />}
        >
          {pending.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nenhuma vistoria pendente</Text>
              <Text style={styles.emptyText}>Vistorias periódicas aparecem aqui conforme a frequência configurada.</Text>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Pendentes ({pending.length})</Text>
              <View style={styles.sectionBody}>
                {pending.map((s) => {
                  const tone = SCHEDULE_STATUS_TONE[s.status] ?? SCHEDULE_STATUS_TONE.pending
                  return (
                    <Pressable
                      key={s.id}
                      style={({ pressed }) => [styles.scheduleRow, pressed && styles.rowPressed]}
                      onPress={() => setSelected(s)}
                    >
                      <View style={styles.scheduleRowLeft}>
                        <Text style={styles.scheduleRowTitle}>Vistoria periódica</Text>
                        <Text style={styles.scheduleRowMeta}>Prazo: {formatDate(s.target_date)}</Text>
                        {s.status === 'rejected' && s.latest_inspection?.review_notes && (
                          <Text style={styles.scheduleRowRejection} numberOfLines={2}>
                            Motivo: {s.latest_inspection.review_notes}
                          </Text>
                        )}
                      </View>
                      <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                        <Text style={[styles.statusPillText, { color: tone.fg }]}>
                          {SCHEDULE_STATUS_LABEL[s.status] ?? s.status}
                        </Text>
                      </View>
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )}

          <View style={styles.section}>
            <Pressable style={styles.historyToggle} onPress={() => setHistoryOpen((v) => !v)}>
              <Text style={styles.historyToggleText}>{historyOpen ? 'Ocultar histórico' : 'Ver histórico'}</Text>
              <Text style={styles.historyToggleChevron}>{historyOpen ? '▲' : '▼'}</Text>
            </Pressable>
            {historyOpen &&
              (historyQuery.isLoading ? (
                <View style={styles.historyLoading}>
                  <ActivityIndicator color="#BAFF1A" size="small" />
                </View>
              ) : (historyQuery.data ?? []).length === 0 ? (
                <View style={styles.historyEmpty}>
                  <Text style={styles.historyEmptyText}>Nenhuma vistoria enviada ainda.</Text>
                </View>
              ) : (
                <View style={styles.sectionBody}>
                  {(historyQuery.data ?? []).map((insp: Inspection) => {
                    const tone = HISTORY_STATUS_TONE[insp.status] ?? HISTORY_STATUS_TONE.submitted
                    return (
                      <View key={insp.id} style={styles.historyRow}>
                        <View style={styles.historyRowLeft}>
                          <Text style={styles.historyRowTitle}>
                            {insp.executed_at ? formatDate(insp.executed_at.slice(0, 10)) : formatDate(insp.created_at.slice(0, 10))}
                          </Text>
                          {insp.status === 'rejected' && insp.review_notes && (
                            <Text style={styles.historyRowNote} numberOfLines={2}>{insp.review_notes}</Text>
                          )}
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: tone.bg }]}>
                          <Text style={[styles.statusPillText, { color: tone.fg }]}>
                            {HISTORY_STATUS_LABEL[insp.status] ?? insp.status}
                          </Text>
                        </View>
                      </View>
                    )
                  })}
                </View>
              ))}
          </View>
        </ScrollView>
      )}

      <InspectionSubmitModal
        schedule={selected}
        onClose={() => setSelected(null)}
        onSubmitted={() => {
          setSelected(null)
          void pendingQuery.refetch()
          void historyQuery.refetch()
        }}
      />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#121212' },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  headerTitle: { color: '#f5f5f5', fontSize: 22, fontWeight: '700' },
  headerSubtitle: { color: '#9e9e9e', fontSize: 13, marginTop: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 8 },

  section: { gap: 8, marginTop: 8 },
  sectionTitle: {
    color: '#9e9e9e',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 2,
  },
  sectionBody: { gap: 8 },

  scheduleRow: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowPressed: { opacity: 0.8 },
  scheduleRowLeft: { flex: 1, gap: 3 },
  scheduleRowTitle: { color: '#f5f5f5', fontSize: 14, fontWeight: '600' },
  scheduleRowMeta: { color: '#9e9e9e', fontSize: 12 },
  scheduleRowRejection: { color: '#ff9c9a', fontSize: 11, marginTop: 2 },

  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  historyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 10,
  },
  historyToggleText: { color: '#9e9e9e', fontSize: 13, fontWeight: '600' },
  historyToggleChevron: { color: '#9e9e9e', fontSize: 10 },
  historyLoading: { paddingVertical: 20, alignItems: 'center' },
  historyEmpty: { paddingVertical: 16, alignItems: 'center' },
  historyEmptyText: { color: '#9e9e9e', fontSize: 13 },

  historyRow: {
    backgroundColor: '#1a1a1a',
    borderColor: '#2a2a2a',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyRowLeft: { flex: 1, gap: 2 },
  historyRowTitle: { color: '#c0c0c0', fontSize: 13, fontWeight: '500' },
  historyRowNote: { color: '#ff9c9a', fontSize: 11 },

  emptyCard: {
    backgroundColor: '#202020',
    borderColor: '#323232',
    borderWidth: 1,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    marginHorizontal: 16,
  },
  emptyTitle: { color: '#f5f5f5', fontSize: 16, fontWeight: '700' },
  emptyText: { color: '#9e9e9e', fontSize: 13, textAlign: 'center', lineHeight: 20 },
})
