import { useCallback, useMemo, useState } from 'react'
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
import { useTheme, type ThemeTokens } from '../../theme'

const SCHEDULE_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  overdue: 'Atrasada',
  rejected: 'Rejeitada — reenviar',
}

function getScheduleStatusTone(theme: ThemeTokens): Record<string, { bg: string; fg: string }> {
  return {
    pending: { bg: theme.surfaceAlt, fg: theme.textMute },
    overdue: { bg: theme.warningBg, fg: theme.warning },
    rejected: { bg: theme.dangerBg, fg: theme.danger },
  }
}

const HISTORY_STATUS_LABEL: Record<string, string> = {
  submitted: 'Aguardando análise',
  approved: 'Aprovada',
  rejected: 'Rejeitada',
}

function getHistoryStatusTone(theme: ThemeTokens): Record<string, { bg: string; fg: string }> {
  return {
    submitted: { bg: theme.pendingBg, fg: theme.pending },
    approved: { bg: theme.successBg, fg: theme.success },
    rejected: { bg: theme.dangerBg, fg: theme.danger },
  }
}

function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function InspectionsScreen() {
  const [refreshing, setRefreshing] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [selected, setSelected] = useState<InspectionScheduleWithStatus | null>(null)
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const scheduleStatusTone = useMemo(() => getScheduleStatusTone(theme), [theme])
  const historyStatusTone = useMemo(() => getHistoryStatusTone(theme), [theme])

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
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />}
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
                  const tone = scheduleStatusTone[s.status] ?? scheduleStatusTone.pending
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
                  <ActivityIndicator color={theme.primary} size="small" />
                </View>
              ) : (historyQuery.data ?? []).length === 0 ? (
                <View style={styles.historyEmpty}>
                  <Text style={styles.historyEmptyText}>Nenhuma vistoria enviada ainda.</Text>
                </View>
              ) : (
                <View style={styles.sectionBody}>
                  {(historyQuery.data ?? []).map((insp: Inspection) => {
                    const tone = historyStatusTone[insp.status] ?? historyStatusTone.submitted
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

const createStyles = (theme: ThemeTokens) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderBottomColor: theme.surfaceAlt,
    borderBottomWidth: 1,
  },
  headerTitle: { color: theme.text, fontSize: 22, fontWeight: '700' },
  headerSubtitle: { color: theme.textMute, fontSize: 13, marginTop: 2 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  scrollContent: { padding: 16, paddingBottom: 40, gap: 8 },

  section: { gap: 8, marginTop: 8 },
  sectionTitle: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    paddingHorizontal: 2,
  },
  sectionBody: { gap: 8 },

  scheduleRow: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowPressed: { opacity: 0.8 },
  scheduleRowLeft: { flex: 1, gap: 3 },
  scheduleRowTitle: { color: theme.text, fontSize: 14, fontWeight: '600' },
  scheduleRowMeta: { color: theme.textMute, fontSize: 12 },
  scheduleRowRejection: { color: theme.danger, fontSize: 11, marginTop: 2 },

  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusPillText: { fontSize: 11, fontWeight: '700' },

  historyToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 10,
  },
  historyToggleText: { color: theme.textMute, fontSize: 13, fontWeight: '600' },
  historyToggleChevron: { color: theme.textMute, fontSize: 10 },
  historyLoading: { paddingVertical: 20, alignItems: 'center' },
  historyEmpty: { paddingVertical: 16, alignItems: 'center' },
  historyEmptyText: { color: theme.textMute, fontSize: 13 },

  historyRow: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyRowLeft: { flex: 1, gap: 2 },
  historyRowTitle: { color: theme.textSoft, fontSize: 13, fontWeight: '500' },
  historyRowNote: { color: theme.danger, fontSize: 11 },

  emptyCard: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 14,
    padding: 24,
    alignItems: 'center',
    gap: 8,
    marginTop: 32,
    marginHorizontal: 16,
  },
  emptyTitle: { color: theme.text, fontSize: 16, fontWeight: '700' },
  emptyText: { color: theme.textMute, fontSize: 13, textAlign: 'center', lineHeight: 20 },
})
