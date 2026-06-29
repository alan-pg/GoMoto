import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Clipboard from 'expo-clipboard'
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect } from 'expo-router'
import { useBillingsForCustomer } from '@gomoto/data'
import { calculateFinalAmount } from '@gomoto/core'
import type { Billing } from '@gomoto/core'
import { supabase } from '../lib/supabase'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterStatus = 'relevant' | 'all' | 'pending' | 'paid' | 'overdue'

type PixResult = {
  qr_code: string
  qr_code_base64: string
  expires_at: string
  is_reused: boolean
}

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

function BillingDetailModal({
  billing,
  onClose,
  onPixGenerated,
  pixPaid,
}: {
  billing: Billing
  onClose: () => void
  onPixGenerated?: (billingId: string) => void
  pixPaid?: boolean
}) {
  const original  = billing.original_amount ?? 0
  const discount  = billing.discount_amount ?? 0
  const finalAmt  = calculateFinalAmount(original, discount)
  const [generatingPix, setGeneratingPix] = useState(false)
  const [pixResult, setPixResult]         = useState<PixResult | null>(null)
  const canPix = billing.status === 'pending' || billing.status === 'overdue'

  async function handlePix() {
    setGeneratingPix(true)
    try {
      const result = await generatePix(billing.id)
      setPixResult(result)
      onPixGenerated?.(billing.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Falha ao gerar Pix'
      Alert.alert('Erro', msg)
    } finally {
      setGeneratingPix(false)
    }
  }

  return (
    <>
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

            {/* Pix CTA */}
            {canPix && (
              <TouchableOpacity
                style={[styles.pixBtn, generatingPix && styles.pixBtnDisabled]}
                onPress={handlePix}
                disabled={generatingPix}
              >
                <Text style={styles.pixBtnText}>
                  {generatingPix ? 'Gerando Pix...' : 'Gerar Pix'}
                </Text>
              </TouchableOpacity>
            )}

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

      {pixResult && (
        <PixModal billing={billing} result={pixResult} onClose={() => setPixResult(null)} pixPaid={pixPaid} />
      )}
    </>
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

async function generatePix(billingId: string): Promise<PixResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Não autenticado')

  const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? ''
  if (!webUrl) throw new Error('EXPO_PUBLIC_WEB_URL não configurado')

  const res = await fetch(`${webUrl}/api/billings/${billingId}/pix`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}` },
  })
  const json = await res.json()
  if (!json.ok) throw new Error(json.error?.message ?? 'Falha ao gerar Pix')
  return json.data as PixResult
}

// ---------------------------------------------------------------------------
// PixModal
// ---------------------------------------------------------------------------

function PixModal({
  billing,
  result,
  onClose,
  pixPaid,
}: {
  billing: Billing
  result: PixResult
  onClose: () => void
  pixPaid?: boolean
}) {
  const original = billing.original_amount ?? 0
  const discount = billing.discount_amount ?? 0
  const finalAmt = calculateFinalAmount(original, discount)

  function copyCode() {
    void Clipboard.setStringAsync(result.qr_code)
    Alert.alert('Copiado!', 'Código Pix copiado para a área de transferência.')
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Pix de Cobrança</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.modalClose}>Fechar</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.modalBody}>
          {pixPaid && (
            <View style={styles.pixPaidConfirm}>
              <Text style={styles.pixPaidConfirmText}>Pagamento confirmado!</Text>
            </View>
          )}
          {result.is_reused && (
            <View style={styles.reuseNote}>
              <Text style={styles.reuseNoteText}>Pix ativo reutilizado — mesmo código gerado anteriormente.</Text>
            </View>
          )}
          <View style={styles.pixQrContainer}>
            <Image
              source={{ uri: `data:image/png;base64,${result.qr_code_base64}` }}
              style={styles.pixQrImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.pixInfo}>
            <Text style={styles.pixAmount}>{formatCurrency(finalAmt)}</Text>
            <Text style={styles.pixExpiry}>
              Vence em {formatDate(result.expires_at.slice(0, 10))}
            </Text>
          </View>
          <View style={styles.pixCodeBlock}>
            <Text style={styles.pixCodeLabel}>Copia e Cola</Text>
            <Text style={styles.pixCode} selectable>{result.qr_code}</Text>
          </View>
          <TouchableOpacity style={styles.copyBtn} onPress={copyCode}>
            <Text style={styles.copyBtnText}>Copiar Código Pix</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </Modal>
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
  const [pixBillingId, setPixBillingId] = useState<string | null>(null)
  const [pixPaid, setPixPaid]           = useState(false)

  const serverFilter = filter === 'all' || filter === 'relevant' ? undefined : { status: filter }
  const query = useBillingsForCustomer(serverFilter)

  useFocusEffect(
    useCallback(() => {
      void query.refetch()
    }, [query.refetch]),
  )

  // Polling a cada 5s enquanto o modal Pix estiver aberto (mesmo padrão da web)
  useEffect(() => {
    if (!pixBillingId) return
    const id = setInterval(() => { void query.refetch() }, 5000)
    return () => clearInterval(id)
  }, [pixBillingId, query])

  // Detecta confirmação via webhook: billing muda para 'paid' durante o polling
  useEffect(() => {
    if (!pixBillingId || pixPaid) return
    const latest = (query.data ?? []).find((b) => b.id === pixBillingId)
    if (latest?.status === 'paid') {
      setPixPaid(true)
      setTimeout(() => {
        setSelected(null)
        setPixBillingId(null)
        setPixPaid(false)
      }, 2500)
    }
  }, [query.data, pixBillingId, pixPaid])

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
        <ScrollView
          contentContainerStyle={styles.center}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#BAFF1A" />
          }
        >
          <Text style={styles.emptyText}>Nenhuma cobrança encontrada.</Text>
        </ScrollView>
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
          onClose={() => { setSelected(null); setPixBillingId(null); setPixPaid(false) }}
          onPixGenerated={setPixBillingId}
          pixPaid={pixBillingId === selected.id && pixPaid}
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
  pixBtn: {
    backgroundColor: '#BAFF1A',
    borderRadius:    12,
    paddingVertical: 14,
    alignItems:      'center',
  },
  pixBtnDisabled: {
    opacity: 0.6,
  },
  pixBtnText: {
    color:      '#121212',
    fontSize:   15,
    fontWeight: '700',
  },
  pixPaidConfirm: {
    backgroundColor: '#0e2f13',
    borderColor:     '#229731',
    borderWidth:     1,
    borderRadius:    12,
    padding:         16,
    alignItems:      'center',
  },
  pixPaidConfirmText: {
    color:      '#229731',
    fontSize:   17,
    fontWeight: '700',
  },
  reuseNote: {
    backgroundColor: '#1a1a2e',
    borderRadius:    8,
    padding:         10,
  },
  reuseNoteText: {
    color:    '#9e9e9e',
    fontSize: 12,
    textAlign: 'center',
  },
  pixQrContainer: {
    alignItems:      'center',
    backgroundColor: '#ffffff',
    borderRadius:    16,
    padding:         16,
  },
  pixQrImage: {
    width:  200,
    height: 200,
  },
  pixInfo: {
    alignItems: 'center',
    gap:        4,
  },
  pixAmount: {
    color:      '#f5f5f5',
    fontSize:   22,
    fontWeight: '700',
  },
  pixExpiry: {
    color:    '#9e9e9e',
    fontSize: 13,
  },
  pixCodeBlock: {
    backgroundColor: '#1a1a1a',
    borderColor:     '#323232',
    borderWidth:     1,
    borderRadius:    12,
    padding:         14,
    gap:             6,
  },
  pixCodeLabel: {
    color:    '#9e9e9e',
    fontSize: 12,
  },
  pixCode: {
    color:      '#f5f5f5',
    fontSize:   11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  copyBtn: {
    backgroundColor: '#202020',
    borderColor:     '#474747',
    borderWidth:     1,
    borderRadius:    12,
    paddingVertical: 13,
    alignItems:      'center',
  },
  copyBtnText: {
    color:      '#f5f5f5',
    fontSize:   14,
    fontWeight: '600',
  },
})
