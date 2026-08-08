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
import { useBillingsForCustomer, useHistoryBillingsForCustomer } from '@gomoto/data'
import {
  calculateDaysOverdue,
  calculateFinalAmount,
  isChargeOverdue,
} from '@gomoto/core'
import type { Billing } from '@gomoto/core'
import { supabase } from '../lib/supabase'
import { useTheme, type ThemeTokens } from '../theme'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PaymentMethod = 'pix' | 'boleto' | 'card'

type PixResult = {
  qr_code: string
  qr_code_base64: string
  expires_at: string
  is_reused: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  pending:   'Pendente',
  paid:      'Pago',
  overdue:   'Vencida',
  cancelled: 'Cancelada',
  prejudice: 'Prejuízo',
}

function getStatusTone(theme: ThemeTokens): Record<string, { color: string; bg: string }> {
  return {
    pending:   { color: theme.pending, bg: theme.pendingBg },
    paid:      { color: theme.success, bg: theme.successBg },
    overdue:   { color: theme.warning, bg: theme.warningBg },
    cancelled: { color: theme.textMute, bg: theme.surfaceAlt },
    prejudice: { color: theme.danger, bg: theme.dangerBg },
  }
}

const BILLING_TYPE_LABEL: Record<string, string> = {
  cycle:         'Ciclo',
  one_time:      'Avulsa',
  complementary: 'Complementar',
  fine:          'Multa',
}

function getBillingTypeTone(theme: ThemeTokens): Record<string, { bg: string; fg: string }> {
  return {
    cycle:         { bg: theme.successBg, fg: theme.success },
    one_time:      { bg: theme.indigoBg, fg: theme.indigo },
    complementary: { bg: theme.violetBg, fg: theme.violet },
    fine:          { bg: theme.dangerBg, fg: theme.danger },
  }
}

type StatusTone = ReturnType<typeof getStatusTone>
type TypeTone = ReturnType<typeof getBillingTypeTone>
type Styles = ReturnType<typeof createStyles>

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  pix:           'Pix',
  cash:          'Dinheiro',
  credit_card:   'Cartão de crédito',
  debit_card:    'Cartão de débito',
  bank_transfer: 'Transferência',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function daysUntil(isoDate: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(isoDate + 'T00:00:00')
  return Math.round((due.getTime() - today.getTime()) / 86_400_000)
}

function vehicleLabel(billing: Billing): string | null {
  const rental = billing.rentals as { vehicles?: { license_plate?: string; model?: string; make?: string } } | null
  const v = rental?.vehicles
  if (!v?.license_plate) return null
  return `${v.license_plate}${v.make ? ` · ${v.make} ${v.model ?? ''}` : ''}`
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
// SectionHeader
// ---------------------------------------------------------------------------

function SectionHeader({ title, count, danger, styles }: { title: string; count: number; danger?: boolean; styles: Styles }) {
  return (
    <View style={styles.sectionHeader}>
      {danger && <View style={styles.sectionDangerDot} />}
      <Text style={[styles.sectionTitle, danger && styles.sectionTitleDanger]}>
        {title}
      </Text>
      <View style={[styles.sectionCount, danger && styles.sectionCountDanger]}>
        <Text style={[styles.sectionCountText, danger && styles.sectionCountTextDanger]}>
          {count}
        </Text>
      </View>
    </View>
  )
}

// ---------------------------------------------------------------------------
// TypeBadge
// ---------------------------------------------------------------------------

function TypeBadge({ type, styles, typeTone }: { type: string | null | undefined; styles: Styles; typeTone: TypeTone }) {
  if (type === 'one_time') return null
  const label = BILLING_TYPE_LABEL[type ?? ''] ?? null
  if (!label) return null
  // fallback inalcançável na prática: os 4 tipos em BILLING_TYPE_LABEL são os
  // mesmos 4 de getBillingTypeTone — mantido só por segurança de tipos.
  const tone = typeTone[type ?? ''] ?? typeTone.one_time
  return (
    <View style={[styles.typeBadge, { backgroundColor: tone.bg }]}>
      <Text style={[styles.typeBadgeText, { color: tone.fg }]}>{label}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// BillingRow — used in overdue + upcoming sections
// ---------------------------------------------------------------------------

function BillingRow({
  billing,
  onPress,
  styles,
  typeTone,
}: {
  billing: Billing
  onPress: () => void
  styles: Styles
  typeTone: TypeTone
}) {
  const today = new Date()
  const overdue = isChargeOverdue(billing, today)
  const days = overdue
    ? calculateDaysOverdue(billing, today)
    : daysUntil(billing.due_date)

  const finalAmount = calculateFinalAmount(billing.original_amount ?? 0, billing.discount_amount ?? 0)
  const plate = vehicleLabel(billing)

  let dueMeta: string
  if (overdue) {
    dueMeta = days === 0
      ? `Venceu hoje · ${formatDate(billing.due_date)}`
      : `${days} dia${days !== 1 ? 's' : ''} de atraso · venceu ${formatDate(billing.due_date)}`
  } else {
    dueMeta = days === 0
      ? `Vence hoje`
      : days === 1
        ? `Vence amanhã · ${formatDate(billing.due_date)}`
        : `Vence em ${days} dias · ${formatDate(billing.due_date)}`
  }

  return (
    <Pressable
      style={({ pressed }) => [styles.billingRow, overdue && styles.billingRowOverdue, pressed && styles.billingRowPressed]}
      onPress={onPress}
    >
      <View style={styles.billingRowTop}>
        <TypeBadge type={billing.billing_type} styles={styles} typeTone={typeTone} />
        <Text style={[styles.billingRowMeta, overdue ? styles.billingRowMetaDanger : styles.billingRowMetaMuted]}>
          {dueMeta}
        </Text>
      </View>
      <View style={styles.billingRowMain}>
        <View style={styles.billingRowLeft}>
          <Text style={styles.billingRowDesc} numberOfLines={2}>{billing.description ?? '—'}</Text>
          {plate && <Text style={styles.billingRowPlate}>{plate}</Text>}
        </View>
        <View style={styles.billingRowRight}>
          {(billing.discount_amount ?? 0) > 0 ? (
            <>
              <Text style={styles.billingRowAmountStrike}>{formatCurrency(billing.original_amount)}</Text>
              <Text style={[styles.billingRowAmount, overdue && styles.billingRowAmountDanger]}>
                {formatCurrency(finalAmount)}
              </Text>
            </>
          ) : (
            <Text style={[styles.billingRowAmount, overdue && styles.billingRowAmountDanger]}>
              {formatCurrency(finalAmount)}
            </Text>
          )}
          <Text style={styles.billingRowChevron}>›</Text>
        </View>
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// HistoryRow — compact row for paid billings
// ---------------------------------------------------------------------------

function HistoryRow({ billing, onPress, styles }: { billing: Billing; onPress: () => void; styles: Styles }) {
  const finalAmount = calculateFinalAmount(billing.original_amount ?? 0, billing.discount_amount ?? 0)
  const paidDate = billing.paid_at ?? billing.payment_date
  const method = billing.payment_method ? PAYMENT_METHOD_LABEL[billing.payment_method] ?? billing.payment_method : null

  return (
    <Pressable
      style={({ pressed }) => [styles.historyRow, pressed && styles.billingRowPressed]}
      onPress={onPress}
    >
      <View style={styles.historyRowLeft}>
        <View style={styles.historyCheckCircle}>
          <Text style={styles.historyCheckText}>✓</Text>
        </View>
        <View style={styles.historyRowInfo}>
          <Text style={styles.historyRowDesc} numberOfLines={1}>{billing.description ?? '—'}</Text>
          <Text style={styles.historyRowMeta}>
            {paidDate ? `Pago em ${formatDate(paidDate)}` : formatDate(billing.due_date)}
            {method ? ` · ${method}` : ''}
          </Text>
        </View>
      </View>
      <View style={styles.historyRowRight}>
        <Text style={styles.historyRowAmount}>{formatCurrency(finalAmount)}</Text>
        <Text style={styles.billingRowChevron}>›</Text>
      </View>
    </Pressable>
  )
}

// ---------------------------------------------------------------------------
// PaymentMethodSelector
// ---------------------------------------------------------------------------

function PaymentMethodSelector({
  selected,
  onChange,
  styles,
}: {
  selected: PaymentMethod
  onChange: (m: PaymentMethod) => void
  styles: Styles
}) {
  const methods: { id: PaymentMethod; label: string; available: boolean }[] = [
    { id: 'pix',    label: 'Pix',    available: true },
    { id: 'boleto', label: 'Boleto', available: false },
    { id: 'card',   label: 'Cartão', available: false },
  ]

  return (
    <View style={styles.methodSelector}>
      {methods.map((m) => (
        <Pressable
          key={m.id}
          style={[
            styles.methodBtn,
            selected === m.id && styles.methodBtnActive,
            !m.available && styles.methodBtnDisabled,
          ]}
          onPress={() => m.available && onChange(m.id)}
          disabled={!m.available}
        >
          <Text style={[
            styles.methodBtnText,
            selected === m.id && styles.methodBtnTextActive,
            !m.available && styles.methodBtnTextDisabled,
          ]}>
            {m.label}
          </Text>
          {!m.available && (
            <Text style={styles.methodBtnSoon}>em breve</Text>
          )}
        </Pressable>
      ))}
    </View>
  )
}

// ---------------------------------------------------------------------------
// PixModal
// ---------------------------------------------------------------------------

function PixModal({
  billing,
  result,
  pixPaid,
  onClose,
  styles,
}: {
  billing: Billing
  result: PixResult
  pixPaid: boolean
  onClose: () => void
  styles: Styles
}) {
  const finalAmount = calculateFinalAmount(billing.original_amount ?? 0, billing.discount_amount ?? 0)

  function copyCode() {
    void Clipboard.setStringAsync(result.qr_code)
    Alert.alert('Copiado!', 'Código Pix copiado para a área de transferência.')
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.modalSafe}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Pagar com Pix</Text>
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
            <Text style={styles.pixAmount}>{formatCurrency(finalAmount)}</Text>
            <Text style={styles.pixExpiry}>Vence em {formatDate(result.expires_at.slice(0, 10))}</Text>
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
// BillingDetailModal
// ---------------------------------------------------------------------------

function BillingDetailModal({
  billing,
  onClose,
  onPixGenerated,
  pixPaid,
  styles,
  typeTone,
  statusTone,
}: {
  billing: Billing
  onClose: () => void
  onPixGenerated?: (billingId: string) => void
  pixPaid?: boolean
  styles: Styles
  typeTone: TypeTone
  statusTone: StatusTone
}) {
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>('pix')
  const [generatingPix, setGeneratingPix]   = useState(false)
  const [pixResult, setPixResult]           = useState<PixResult | null>(null)

  const original  = billing.original_amount ?? 0
  const discount  = billing.discount_amount ?? 0
  const finalAmt  = calculateFinalAmount(original, discount)
  const canPay    = billing.status === 'pending' || billing.status === 'overdue'
  const today     = new Date()
  const overdue   = isChargeOverdue(billing, today)
  const daysOver  = overdue ? calculateDaysOverdue(billing, today) : 0
  const plate     = vehicleLabel(billing)

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

  const statusColor = statusTone[billing.status]?.color ?? statusTone.cancelled.color
  const statusBg    = statusTone[billing.status]?.bg ?? statusTone.cancelled.bg

  return (
    <>
      <Modal
        visible
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onClose}
      >
        <SafeAreaView style={styles.modalSafe}>
          {/* Header */}
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Cobrança</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <Text style={styles.modalClose}>Fechar</Text>
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.modalBody}>
            {/* Identity block */}
            <View style={styles.detailIdentity}>
              <View style={styles.detailIdentityBadges}>
                <TypeBadge type={billing.billing_type} styles={styles} typeTone={typeTone} />
                <View style={[styles.statusPill, { backgroundColor: statusBg }]}>
                  <Text style={[styles.statusPillText, { color: statusColor }]}>
                    {STATUS_LABEL[billing.status] ?? billing.status}
                  </Text>
                </View>
              </View>
              <Text style={styles.detailDesc}>{billing.description ?? '—'}</Text>
              {plate && <Text style={styles.detailPlate}>{plate}</Text>}
              {overdue && daysOver > 0 ? (
                <Text style={styles.detailOverdueMeta}>
                  {daysOver} dia{daysOver !== 1 ? 's' : ''} de atraso · venceu {formatDate(billing.due_date)}
                </Text>
              ) : (
                <Text style={styles.detailDueMeta}>
                  Vencimento: {formatDate(billing.due_date)}
                </Text>
              )}
            </View>

            {/* Composição */}
            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Composição</Text>
              <View style={styles.compositionBlock}>
                <View style={styles.compositionRow}>
                  <Text style={styles.compositionLabel}>
                    {billing.billing_type === 'cycle' ? 'Aluguel base' : 'Valor'}
                  </Text>
                  <Text style={styles.compositionValue}>{formatCurrency(original)}</Text>
                </View>
                {discount > 0 && (
                  <>
                    <View style={styles.compositionRow}>
                      <View style={styles.compositionLabelGroup}>
                        <Text style={styles.compositionLabel}>Desconto</Text>
                        {billing.discount_reason ? (
                          <Text style={styles.compositionSub}>{billing.discount_reason}</Text>
                        ) : null}
                      </View>
                      <Text style={[styles.compositionValue, { color: statusTone.paid.color }]}>
                        − {formatCurrency(discount)}
                      </Text>
                    </View>
                    <View style={styles.compositionDivider} />
                  </>
                )}
                <View style={styles.compositionRow}>
                  <Text style={[styles.compositionLabel, styles.compositionLabelTotal]}>Total</Text>
                  <Text style={[styles.compositionValue, styles.compositionValueTotal]}>
                    {formatCurrency(finalAmt)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Pagamento */}
            {canPay && (
              <View style={styles.detailSection}>
                <Text style={styles.detailSectionTitle}>Pagar com</Text>
                <PaymentMethodSelector selected={selectedMethod} onChange={setSelectedMethod} styles={styles} />
                {selectedMethod === 'pix' && (
                  <TouchableOpacity
                    style={[styles.payBtn, generatingPix && styles.payBtnDisabled]}
                    onPress={handlePix}
                    disabled={generatingPix}
                  >
                    <Text style={styles.payBtnText}>
                      {generatingPix ? 'Gerando Pix…' : 'Gerar Pix'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* Informação de pagamento (já pago) */}
            {billing.status === 'paid' && (
              <View style={styles.paidBlock}>
                <Text style={styles.paidTitle}>Pagamento registrado</Text>
                {billing.paid_at ?? billing.payment_date ? (
                  <CompositionRow label="Data" value={formatDate(billing.paid_at ?? billing.payment_date)} styles={styles} />
                ) : null}
                {billing.payment_method ? (
                  <CompositionRow
                    label="Forma"
                    value={PAYMENT_METHOD_LABEL[billing.payment_method] ?? billing.payment_method}
                    styles={styles}
                  />
                ) : null}
                {billing.confirmed_source === 'mp_webhook' && (
                  <Text style={styles.paidConfirmedTag}>Confirmado automaticamente via Pix</Text>
                )}
              </View>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {pixResult && (
        <PixModal
          billing={billing}
          result={pixResult}
          pixPaid={pixPaid ?? false}
          onClose={() => setPixResult(null)}
          styles={styles}
        />
      )}
    </>
  )
}

function CompositionRow({ label, value, styles }: { label: string; value: string; styles: Styles }) {
  return (
    <View style={styles.compositionRow}>
      <Text style={styles.compositionLabel}>{label}</Text>
      <Text style={styles.compositionValue}>{value}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// BillingsScreen
// ---------------------------------------------------------------------------

export function BillingsScreen() {
  const [selected, setSelected]         = useState<Billing | null>(null)
  const [refreshing, setRefreshing]     = useState(false)
  const [historyOpen, setHistoryOpen]   = useState(false)
  const [pixBillingId, setPixBillingId] = useState<string | null>(null)
  const [pixPaid, setPixPaid]           = useState(false)
  const theme = useTheme()
  const styles = useMemo(() => createStyles(theme), [theme])
  const typeTone = useMemo(() => getBillingTypeTone(theme), [theme])
  const statusTone = useMemo(() => getStatusTone(theme), [theme])

  const query        = useBillingsForCustomer()
  const historyQuery = useHistoryBillingsForCustomer({ enabled: historyOpen })

  useFocusEffect(
    useCallback(() => {
      void query.refetch()
    }, [query.refetch]),
  )

  // Poll a cada 5 s enquanto o Pix está aberto — detecta confirmação via webhook
  useEffect(() => {
    if (!pixBillingId) return
    const id = setInterval(() => { void query.refetch() }, 5000)
    return () => clearInterval(id)
  }, [pixBillingId, query])

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

  async function handleRefresh() {
    setRefreshing(true)
    await Promise.all([
      query.refetch(),
      historyOpen ? historyQuery.refetch() : Promise.resolve(),
    ])
    setRefreshing(false)
  }

  const today = new Date()
  const todayIso = today.toISOString().slice(0, 10)

  // O backend gera todas as cobranças de ciclo antecipadamente (pode ser anos).
  // Regras de exibição:
  //   • Em atraso  — todas vencidas, qualquer tipo
  //   • Próxima    — única próxima cobrança de ciclo (due_date >= hoje)
  //   • Outras     — multas, avulsas e complementares pendentes não vencidas
  //   • Histórico  — buscado sob demanda via useHistoryBillingsForCustomer
  const { overdue, nextCycle, others } = useMemo(() => {
    const all = query.data ?? []

    const overdue = all
      .filter((b) =>
        b.status === 'overdue' ||
        (b.status === 'pending' && b.due_date < todayIso),
      )
      .sort((a, b) => a.due_date.localeCompare(b.due_date))

    const overdueIds = new Set(overdue.map((b) => b.id))

    const nextCycle = all
      .filter(
        (b) =>
          b.billing_type === 'cycle' &&
          b.status === 'pending' &&
          b.due_date >= todayIso &&
          !overdueIds.has(b.id),
      )
      .sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null

    const others = all
      .filter(
        (b) =>
          b.billing_type !== 'cycle' &&
          b.status === 'pending' &&
          b.due_date >= todayIso &&
          !overdueIds.has(b.id),
      )
      .sort((a, b) => a.due_date.localeCompare(b.due_date))

    return { overdue, nextCycle, others }
  }, [query.data, todayIso])

  const hasContent = overdue.length > 0 || nextCycle !== null || others.length > 0

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Cobranças</Text>
        <Text style={styles.headerSubtitle}>Sua situação financeira</Text>
      </View>

      {/* Offline banner */}
      {query.isError && !query.isFetching && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineBannerText}>Sem conexão — exibindo dados salvos localmente</Text>
        </View>
      )}

      {query.isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={theme.primary} size="large" />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />
          }
        >
          {!hasContent ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Nenhuma cobrança</Text>
              <Text style={styles.emptyText}>Suas cobranças aparecerão aqui quando forem geradas.</Text>
            </View>
          ) : (
            <>
              {/* Em atraso */}
              {overdue.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader title="Em atraso" count={overdue.length} danger styles={styles} />
                  <View style={styles.sectionBody}>
                    {overdue.map((b) => (
                      <BillingRow key={b.id} billing={b} onPress={() => setSelected(b)} styles={styles} typeTone={typeTone} />
                    ))}
                  </View>
                </View>
              )}

              {/* Próxima cobrança de ciclo */}
              {nextCycle && (
                <View style={styles.section}>
                  <SectionHeader title="Próxima cobrança" count={1} styles={styles} />
                  <View style={styles.sectionBody}>
                    <BillingRow billing={nextCycle} onPress={() => setSelected(nextCycle)} styles={styles} typeTone={typeTone} />
                  </View>
                </View>
              )}

              {/* Outras cobranças pendentes (multas, avulsas, complementares) */}
              {others.length > 0 && (
                <View style={styles.section}>
                  <SectionHeader title="Outras" count={others.length} styles={styles} />
                  <View style={styles.sectionBody}>
                    {others.map((b) => (
                      <BillingRow key={b.id} billing={b} onPress={() => setSelected(b)} styles={styles} typeTone={typeTone} />
                    ))}
                  </View>
                </View>
              )}

              {/* Histórico de pagamentos — lazy, só busca ao abrir */}
              <View style={styles.section}>
                <Pressable
                  style={styles.historyToggle}
                  onPress={() => setHistoryOpen((v) => !v)}
                >
                  <Text style={styles.historyToggleText}>
                    {historyOpen ? 'Ocultar histórico' : 'Ver histórico de pagamentos'}
                  </Text>
                  <Text style={styles.historyToggleChevron}>{historyOpen ? '▲' : '▼'}</Text>
                </Pressable>
                {historyOpen && (
                  historyQuery.isLoading ? (
                    <View style={styles.historyLoading}>
                      <ActivityIndicator color={theme.primary} size="small" />
                    </View>
                  ) : (historyQuery.data ?? []).length === 0 ? (
                    <View style={styles.historyEmpty}>
                      <Text style={styles.historyEmptyText}>Nenhum pagamento registrado.</Text>
                    </View>
                  ) : (
                    <View style={styles.sectionBody}>
                      {(historyQuery.data ?? []).map((b) => (
                        <HistoryRow key={b.id} billing={b} onPress={() => setSelected(b)} styles={styles} />
                      ))}
                    </View>
                  )
                )}
              </View>
            </>
          )}
        </ScrollView>
      )}

      {selected && (
        <BillingDetailModal
          billing={selected}
          onClose={() => { setSelected(null); setPixBillingId(null); setPixPaid(false) }}
          onPixGenerated={setPixBillingId}
          pixPaid={pixBillingId === selected.id && pixPaid}
          styles={styles}
          typeTone={typeTone}
          statusTone={statusTone}
        />
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
    paddingBottom: 12,
    borderBottomColor: theme.surfaceAlt,
    borderBottomWidth: 1,
  },
  headerTitle: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: theme.textMute,
    fontSize: 13,
    marginTop: 2,
  },
  offlineBanner: {
    backgroundColor: theme.warningBg,
    borderBottomColor: theme.warning,
    borderBottomWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  offlineBannerText: {
    color: theme.warning,
    fontSize: 13,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 60,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 8,
  },

  // Section
  section: {
    gap: 6,
    marginTop: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 2,
  },
  sectionDangerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.warning,
  },
  sectionTitle: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    flex: 1,
  },
  sectionTitleDanger: {
    color: theme.warning,
  },
  sectionCount: {
    backgroundColor: theme.border,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sectionCountDanger: {
    backgroundColor: theme.warningBg,
  },
  sectionCountText: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
  },
  sectionCountTextDanger: {
    color: theme.warning,
  },
  sectionBody: {
    gap: 6,
  },

  // Type badge
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },

  // Billing row
  billingRow: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  billingRowOverdue: {
    borderColor: theme.warning,
    backgroundColor: theme.warningBg,
  },
  billingRowPressed: {
    opacity: 0.8,
  },
  billingRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  billingRowMeta: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  billingRowMetaDanger: {
    color: theme.warning,
  },
  billingRowMetaMuted: {
    color: theme.textMute,
  },
  billingRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  billingRowLeft: {
    flex: 1,
    gap: 3,
  },
  billingRowDesc: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  billingRowPlate: {
    color: theme.textMute,
    fontSize: 12,
  },
  billingRowRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  billingRowAmount: {
    color: theme.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  billingRowAmountDanger: {
    color: theme.danger,
  },
  billingRowAmountStrike: {
    color: theme.textMute,
    fontSize: 12,
    textDecorationLine: 'line-through',
  },
  billingRowChevron: {
    color: theme.border,
    fontSize: 18,
    lineHeight: 20,
  },

  // History row
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
  historyRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyCheckCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: theme.successBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCheckText: {
    color: theme.success,
    fontSize: 12,
    fontWeight: '700',
  },
  historyRowInfo: {
    flex: 1,
    gap: 2,
  },
  historyRowDesc: {
    color: theme.textSoft,
    fontSize: 13,
    fontWeight: '500',
  },
  historyRowMeta: {
    color: theme.textMute,
    fontSize: 11,
  },
  historyRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  historyRowAmount: {
    color: theme.textMute,
    fontSize: 13,
    fontWeight: '600',
  },

  // History loading / empty
  historyLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  historyEmpty: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  historyEmptyText: {
    color: theme.textMute,
    fontSize: 13,
  },

  // History toggle button
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
  historyToggleText: {
    color: theme.textMute,
    fontSize: 13,
    fontWeight: '600',
  },
  historyToggleChevron: {
    color: theme.textMute,
    fontSize: 10,
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

  // Payment method selector
  methodSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  methodBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    gap: 2,
  },
  methodBtnActive: {
    backgroundColor: theme.successBg,
    borderColor: theme.primary,
  },
  methodBtnDisabled: {
    opacity: 0.5,
  },
  methodBtnText: {
    color: theme.textMute,
    fontSize: 13,
    fontWeight: '600',
  },
  methodBtnTextActive: {
    color: theme.primary,
  },
  methodBtnTextDisabled: {
    color: theme.border,
  },
  methodBtnSoon: {
    color: theme.border,
    fontSize: 9,
    fontWeight: '500',
  },

  // Pay button
  payBtn: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  payBtnDisabled: {
    opacity: 0.6,
  },
  payBtnText: {
    color: theme.primaryContrast,
    fontSize: 15,
    fontWeight: '700',
  },

  // Modal base
  modalSafe: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomColor: theme.surfaceAlt,
    borderBottomWidth: 1,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  modalClose: {
    color: theme.primary,
    fontSize: 15,
  },
  modalBody: {
    padding: 20,
    gap: 20,
  },

  // Detail modal — identity block
  detailIdentity: {
    gap: 6,
  },
  detailIdentityBadges: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    marginBottom: 4,
  },
  detailDesc: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 24,
  },
  detailPlate: {
    color: theme.textMute,
    fontSize: 13,
  },
  detailOverdueMeta: {
    color: theme.warning,
    fontSize: 13,
    fontWeight: '500',
  },
  detailDueMeta: {
    color: theme.textMute,
    fontSize: 13,
  },

  // Detail modal — sections
  detailSection: {
    gap: 10,
  },
  detailSectionTitle: {
    color: theme.textMute,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Composition block
  compositionBlock: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  compositionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  compositionLabelGroup: {
    flex: 1,
    gap: 2,
  },
  compositionLabel: {
    color: theme.textMute,
    fontSize: 14,
  },
  compositionLabelTotal: {
    color: theme.text,
    fontWeight: '600',
  },
  compositionSub: {
    color: theme.border,
    fontSize: 12,
  },
  compositionValue: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
  },
  compositionValueTotal: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.primary,
  },
  compositionDivider: {
    height: 1,
    backgroundColor: theme.surfaceAlt,
  },

  // Status pill
  statusPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 999,
  },
  statusPillText: {
    fontSize: 12,
    fontWeight: '600',
  },

  // Paid block
  paidBlock: {
    backgroundColor: theme.successBg,
    borderColor: theme.success,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 10,
  },
  paidTitle: {
    color: theme.success,
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 2,
  },
  paidConfirmedTag: {
    color: theme.success,
    fontSize: 12,
    opacity: 0.8,
  },

  // Pix modal
  pixPaidConfirm: {
    backgroundColor: theme.successBg,
    borderColor: theme.success,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  pixPaidConfirmText: {
    color: theme.success,
    fontSize: 17,
    fontWeight: '700',
  },
  reuseNote: {
    backgroundColor: theme.indigoBg,
    borderRadius: 8,
    padding: 10,
  },
  reuseNoteText: {
    color: theme.textMute,
    fontSize: 12,
    textAlign: 'center',
  },
  pixQrContainer: {
    // QR code precisa de fundo branco sólido pra ler bem — não segue o tema.
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 16,
    padding: 16,
  },
  pixQrImage: {
    width: 200,
    height: 200,
  },
  pixInfo: {
    alignItems: 'center',
    gap: 4,
  },
  pixAmount: {
    color: theme.text,
    fontSize: 22,
    fontWeight: '700',
  },
  pixExpiry: {
    color: theme.textMute,
    fontSize: 13,
  },
  pixCodeBlock: {
    backgroundColor: theme.surface,
    borderColor: theme.surfaceAlt,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    gap: 6,
  },
  pixCodeLabel: {
    color: theme.textMute,
    fontSize: 12,
  },
  pixCode: {
    color: theme.text,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  copyBtn: {
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  copyBtnText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
})
