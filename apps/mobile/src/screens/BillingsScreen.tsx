import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useBillingsForCustomer } from '@gomoto/data'
import { calculateFinalAmount } from '@gomoto/core'
import type { Billing } from '@gomoto/core'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterStatus = 'relevant' | 'all' | 'pending' | 'paid' | 'overdue'

type RentalGroup = {
  leaseId:      string
  licensePlate: string
  model:        string
  make:         string
  billings:     Billing[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pendente',
  paid:      'Pago',
  overdue:   'Vencido',
  cancelled: 'Cancelado',
  prejudice: 'Prejuízo',
}

const STATUS_COLOR: Record<string, string> = {
  pending:   '#e0a500',
  paid:      '#229731',
  overdue:   '#e65e24',
  cancelled: '#9e9e9e',
  prejudice: '#ff9c9a',
}

function formatCurrency(value: number): string {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

function getRelevantBillings(billings: Billing[]): Billing[] {
  const today = new Date().toISOString().slice(0, 10)

  const isOpenCycle = (b: Billing) =>
    b.billing_type === 'cycle' &&
    (b.status === 'overdue' || (b.status === 'pending' && b.due_date < today))

  const isNonCyclePending = (b: Billing) =>
    b.billing_type !== 'cycle' &&
    (b.status === 'pending' || b.status === 'overdue')

  const overdueCycle   = billings.filter(isOpenCycle)
  const nonCyclePending = billings.filter(isNonCyclePending)
  const nextCycle      = billings
    .filter((b) => b.billing_type === 'cycle' && b.status === 'pending' && b.due_date >= today)
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 1)

  const seen = new Set<string>()
  const result: Billing[] = []
  for (const b of [...overdueCycle, ...nonCyclePending, ...nextCycle]) {
    if (!seen.has(b.id)) { seen.add(b.id); result.push(b) }
  }
  return result.sort((a, b) => a.due_date.localeCompare(b.due_date))
}

// ---------------------------------------------------------------------------
// BillingDetailModal
// ---------------------------------------------------------------------------

function BillingDetailModal({ billing, onClose }: { billing: Billing; onClose: () => void }) {
  const original  = billing.original_amount ?? 0
  const discount  = billing.discount_amount ?? 0
  const finalAmt  = calculateFinalAmount(original, discount)

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Detalhe da Cobrança</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.modalClose}>Fechar</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.modalBody}>
          {/* Status */}
          <View style={[styles.statusPill, { backgroundColor: `${STATUS_COLOR[billing.status] ?? '#9e9e9e'}22` }]}>
            <Text style={[styles.statusPillText, { color: STATUS_COLOR[billing.status] ?? '#9e9e9e' }]}>
              {STATUS_LABEL[billing.status] ?? billing.status}
            </Text>
          </View>

          {/* Description */}
          <Text style={styles.detailDescription}>{billing.description}</Text>
          <Text style={styles.detailDue}>Vencimento: {formatDate(billing.due_date)}</Text>

          {/* Amounts */}
          <View style={styles.amountBlock}>
            <Row label="Valor original"  value={formatCurrency(original)}  />
            {discount > 0 && (
              <>
                <Row label="Desconto"        value={`- ${formatCurrency(discount)}`} valueColor="#229731" />
                {billing.discount_reason ? (
                  <Text style={styles.discountReason}>Motivo: {billing.discount_reason}</Text>
                ) : null}
                <View style={styles.divider} />
                <Row label="Valor final"     value={formatCurrency(finalAmt)} bold />
              </>
            )}
            {discount === 0 && (
              <Row label="Valor a pagar"  value={formatCurrency(finalAmt)} bold />
            )}
          </View>

          {/* Payment info */}
          {billing.status === 'paid' && (
            <View style={styles.paidBlock}>
              <Text style={styles.paidTitle}>Pagamento registrado</Text>
              {billing.paid_at ? (
                <Row label="Data de pagamento" value={formatDate(billing.paid_at)} />
              ) : null}
              {billing.payment_method ? (
                <Row label="Forma de pagamento" value={billing.payment_method} />
              ) : null}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  )
}

function Row({
  label,
  value,
  valueColor,
  bold,
}: {
  label: string
  value: string
  valueColor?: string
  bold?: boolean
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, bold && styles.rowValueBold, valueColor ? { color: valueColor } : null]}>
        {value}
      </Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// BillingRow
// ---------------------------------------------------------------------------

function BillingRow({ billing, onPress }: { billing: Billing; onPress: () => void }) {
  const original  = billing.original_amount ?? 0
  const discount  = billing.discount_amount ?? 0
  const finalAmt  = calculateFinalAmount(original, discount)
  const hasDiscount = discount > 0

  return (
    <Pressable style={styles.billingRow} onPress={onPress}>
      <View style={styles.billingRowLeft}>
        <Text style={styles.billingDesc} numberOfLines={1}>{billing.description}</Text>
        <Text style={styles.billingDue}>{formatDate(billing.due_date)}</Text>
      </View>
      <View style={styles.billingRowRight}>
        <Text style={[styles.billingAmount, hasDiscount && styles.billingAmountStrike]}>
          {formatCurrency(original)}
        </Text>
        {hasDiscount && (
          <Text style={styles.billingAmountFinal}>{formatCurrency(finalAmt)}</Text>
        )}
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[billing.status] ?? '#9e9e9e' }]} />
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// BillingsScreen
// ---------------------------------------------------------------------------

export function BillingsScreen() {
  const [filter, setFilter]         = useState<FilterStatus>('relevant')
  const [selected, setSelected]     = useState<Billing | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const serverFilter = filter === 'all' || filter === 'relevant' ? undefined : { status: filter }
  const query = useBillingsForCustomer(serverFilter)

  const groups = useMemo<RentalGroup[]>(() => {
    const billings = query.data ?? []
    const map = new Map<string, RentalGroup>()

    for (const b of billings) {
      const rentalObj = b.rentals as { id: string; motorcycle?: { license_plate?: string; model?: string; make?: string } } | null
      const leaseId     = rentalObj?.id ?? 'unknown'
      const motorcycle  = rentalObj?.motorcycle
      const plate       = motorcycle?.license_plate ?? '—'
      const model       = motorcycle?.model ?? '—'
      const make        = motorcycle?.make ?? ''

      if (!map.has(leaseId)) {
        map.set(leaseId, { leaseId, licensePlate: plate, model, make, billings: [] })
      }
      map.get(leaseId)!.billings.push(b)
    }

    const result = Array.from(map.values())
    if (filter !== 'relevant') return result

    return result
      .map((g) => ({ ...g, billings: getRelevantBillings(g.billings) }))
      .filter((g) => g.billings.length > 0)
  }, [query.data, filter])

  async function handleRefresh() {
    setRefreshing(true)
    await query.refetch()
    setRefreshing(false)
  }

  const FILTERS: { label: string; value: FilterStatus }[] = [
    { label: 'Em aberto', value: 'relevant' },
    { label: 'Todas',     value: 'all' },
    { label: 'Pendentes', value: 'pending' },
    { label: 'Pagas',     value: 'paid' },
    { label: 'Vencidas',  value: 'overdue' },
  ]

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cobranças</Text>
        <Text style={styles.headerSubtitle}>Minhas cobranças</Text>
      </View>

      {/* Offline banner — shown when last fetch failed (likely network issue) */}
      {query.isError && !query.isFetching && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>
            Sem conexão — exibindo dados salvos localmente
          </Text>
        </View>
      )}

      {/* Filter tabs */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => (
          <Pressable
            key={f.value}
            style={[styles.filterTab, filter === f.value && styles.filterTabActive]}
            onPress={() => setFilter(f.value)}
          >
            <Text style={[styles.filterTabText, filter === f.value && styles.filterTabTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      {query.isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#BAFF1A" size="large" />
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Nenhuma cobrança encontrada.</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#BAFF1A"
            />
          }
        >
          {groups.map((group) => (
            <View key={group.leaseId} style={styles.rentalGroup}>
              {/* Group header: placa + modelo */}
              <View style={styles.rentalGroupHeader}>
                <Text style={styles.rentalPlate}>{group.licensePlate}</Text>
                <Text style={styles.rentalModel}>
                  {group.make ? `${group.make} ` : ''}{group.model}
                </Text>
              </View>

              {/* Billing rows */}
              {group.billings.map((b) => (
                <BillingRow
                  key={b.id}
                  billing={b}
                  onPress={() => setSelected(b)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {/* Detail modal */}
      {selected && (
        <BillingDetailModal
          billing={selected}
          onClose={() => setSelected(null)}
        />
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
    paddingBottom: 12,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  headerTitle: {
    color: '#f5f5f5',
    fontSize: 22,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: '#9e9e9e',
    fontSize: 13,
    marginTop: 2,
  },
  offlineBanner: {
    backgroundColor: '#3a2200',
    borderBottomColor: '#cc7722',
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    color: '#ffa040',
    fontSize: 13,
    textAlign: 'center',
  },
  filterBar: {
    flexDirection:    'row',
    paddingHorizontal: 16,
    paddingVertical:  10,
    gap: 8,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      999,
    backgroundColor:  '#202020',
  },
  filterTabActive: {
    backgroundColor: '#BAFF1A',
  },
  filterTabText: {
    color:    '#9e9e9e',
    fontSize: 13,
    fontWeight: '500',
  },
  filterTabTextActive: {
    color:    '#121212',
    fontWeight: '700',
  },
  center: {
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
  },
  emptyText: {
    color:    '#9e9e9e',
    fontSize: 14,
  },
  scrollContent: {
    padding: 16,
    gap:     16,
    paddingBottom: 32,
  },
  rentalGroup: {
    backgroundColor: '#202020',
    borderRadius:    12,
    overflow:        'hidden',
    borderColor:     '#323232',
    borderWidth:     1,
  },
  rentalGroupHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    gap:            10,
    padding:        12,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    backgroundColor:   '#2a2a2a',
  },
  rentalPlate: {
    color:      '#BAFF1A',
    fontSize:   14,
    fontWeight: '700',
  },
  rentalModel: {
    color:    '#9e9e9e',
    fontSize: 13,
    flex:     1,
  },
  billingRow: {
    flexDirection:    'row',
    alignItems:       'center',
    paddingVertical:  12,
    paddingHorizontal: 12,
    borderBottomColor: '#2e2e2e',
    borderBottomWidth: 1,
  },
  billingRowLeft: {
    flex: 1,
    gap:  2,
  },
  billingDesc: {
    color:    '#f5f5f5',
    fontSize: 13,
    fontWeight: '500',
  },
  billingDue: {
    color:    '#9e9e9e',
    fontSize: 12,
  },
  billingRowRight: {
    alignItems: 'flex-end',
    gap:        2,
  },
  billingAmount: {
    color:    '#f5f5f5',
    fontSize: 13,
    fontWeight: '600',
  },
  billingAmountStrike: {
    color:              '#9e9e9e',
    fontSize:           12,
    textDecorationLine: 'line-through',
  },
  billingAmountFinal: {
    color:      '#BAFF1A',
    fontSize:   13,
    fontWeight: '700',
  },
  statusDot: {
    width:        6,
    height:       6,
    borderRadius: 999,
    marginTop:    4,
    alignSelf:    'flex-end',
  },
  // Modal styles
  modalSafe: {
    flex:            1,
    backgroundColor: '#121212',
  },
  modalHeader: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        16,
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
  },
  modalTitle: {
    color:      '#f5f5f5',
    fontSize:   18,
    fontWeight: '700',
  },
  modalClose: {
    color:    '#BAFF1A',
    fontSize: 15,
  },
  modalBody: {
    padding: 20,
    gap:     16,
  },
  statusPill: {
    alignSelf:       'flex-start',
    paddingHorizontal: 12,
    paddingVertical:   6,
    borderRadius:      999,
  },
  statusPillText: {
    fontSize:   13,
    fontWeight: '600',
  },
  detailDescription: {
    color:      '#f5f5f5',
    fontSize:   17,
    fontWeight: '600',
  },
  detailDue: {
    color:    '#9e9e9e',
    fontSize: 14,
  },
  amountBlock: {
    backgroundColor: '#202020',
    borderRadius:    12,
    padding:         16,
    gap:             10,
  },
  discountReason: {
    color:    '#9e9e9e',
    fontSize: 12,
    marginTop: -4,
  },
  divider: {
    height:          1,
    backgroundColor: '#323232',
    marginVertical:  4,
  },
  row: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
  },
  rowLabel: {
    color:    '#9e9e9e',
    fontSize: 14,
  },
  rowValue: {
    color:    '#f5f5f5',
    fontSize: 14,
  },
  rowValueBold: {
    fontWeight: '700',
    fontSize:   16,
  },
  paidBlock: {
    backgroundColor: '#0e2f13',
    borderColor:     '#229731',
    borderWidth:     1,
    borderRadius:    12,
    padding:         16,
    gap:             10,
  },
  paidTitle: {
    color:      '#229731',
    fontSize:   14,
    fontWeight: '600',
    marginBottom: 4,
  },
})
