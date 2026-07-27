'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, AlertTriangle, Info } from 'lucide-react'

import { useBillings } from '@gomoto/data'
import { previewRentalAdjustment, previewScheduleRegeneration, computeScheduleRegenerationCutoff, generateCycleCharges, WEEK_DAY_OPTIONS } from '@gomoto/core'
import type { Rental, LateChargeConfig } from '@gomoto/core'
import { formatCurrency } from '@/lib/utils'
import { effectiveBillingStatus } from '@/lib/billing-status'
import { adjustRental, regenerateRentalSchedule } from '../actions'

interface AdjustRentalFormProps {
  rental: Rental
}

const labelCls = 'block text-[13px] text-[#9e9e9e] mb-1.5'
const inputCls = 'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all'

export function AdjustRentalForm({ rental }: AdjustRentalFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [newCycleAmount, setNewCycleAmount] = useState(String(rental.cycle_amount ?? ''))
  const [cycle, setCycle] = useState<'weekly' | 'monthly'>(rental.cycle ?? 'monthly')
  const [dueDay, setDueDay] = useState(String(rental.due_day ?? 10))
  const [useProRata, setUseProRata] = useState(rental.use_pro_rata)
  const [justification, setJustification] = useState('')
  const [customizeCharges, setCustomizeCharges] = useState(false)
  const [lateFeeType, setLateFeeType] = useState<LateChargeConfig['late_fee_type']>(
    rental.late_charge_config?.late_fee_type ?? 'fixed',
  )
  const [lateFeeValue, setLateFeeValue] = useState(String(rental.late_charge_config?.late_fee_value ?? ''))
  const [dailyInterestPct, setDailyInterestPct] = useState(
    rental.late_charge_config ? String(rental.late_charge_config.daily_interest_rate * 100) : '',
  )
  const [graceDays, setGraceDays] = useState(String(rental.late_charge_config?.grace_period_days ?? '0'))
  const [error, setError] = useState('')

  const billingsQuery = useBillings({ lease_id: rental.id })
  const cycleBillings = useMemo(
    () => (billingsQuery.data ?? []).filter(b => b.billing_type === 'cycle'),
    [billingsQuery.data],
  )
  const pendingCycleBillings = useMemo(
    () => cycleBillings
      .filter(b => effectiveBillingStatus(b) === 'pending')
      .map(b => ({ original_amount: b.original_amount ?? 0 })),
    [cycleBillings],
  )

  const parsedNewAmount = parseFloat(newCycleAmount)
  const hasValidAmount = !isNaN(parsedNewAmount) && parsedNewAmount > 0

  // Mudar ciclo/dia/pro-rata muda a forma do cronograma — não dá pra só
  // atualizar o valor nas cobranças existentes, tem que cancelar as
  // pendentes futuras e regerar (diferente de reajuste puro de valor).
  const hasScheduleChange = Boolean(
    cycle !== (rental.cycle ?? 'monthly') ||
    parseInt(dueDay, 10) !== (rental.due_day ?? 10) ||
    useProRata !== rental.use_pro_rata,
  )

  const valuePreview = useMemo(() => {
    if (!hasValidAmount || hasScheduleChange) return null
    return previewRentalAdjustment(pendingCycleBillings, rental.cycle_amount ?? 0, parsedNewAmount)
  }, [hasValidAmount, hasScheduleChange, pendingCycleBillings, rental.cycle_amount, parsedNewAmount])

  const schedulePreview = useMemo(() => {
    if (!hasValidAmount || !hasScheduleChange || !rental.start_date || !rental.end_date) return null
    const today = new Date()
    const cutoff = computeScheduleRegenerationCutoff(cycleBillings, today)
    const regenerateFrom = cutoff ?? rental.start_date
    const toCancel = cycleBillings.filter(b => effectiveBillingStatus(b) === 'pending')
    const newCharges = generateCycleCharges({
      start_date:   regenerateFrom,
      end_date:     rental.end_date,
      cycle,
      due_day:      parseInt(dueDay, 10),
      cycle_amount: parsedNewAmount,
      use_pro_rata: useProRata,
    }).filter(c => c.due_date > regenerateFrom)
    return previewScheduleRegeneration(toCancel, newCharges)
  }, [hasValidAmount, hasScheduleChange, cycleBillings, rental.start_date, rental.end_date, cycle, dueDay, parsedNewAmount, useProRata])

  const isReady = Boolean(hasValidAmount && justification.trim().length >= 5)

  function handleCycleChange(value: 'weekly' | 'monthly') {
    setCycle(value)
    setDueDay(value === 'monthly' ? '10' : '1')
  }

  function handleConfirm() {
    if (!isReady) return
    setError('')
    startTransition(async () => {
      const new_late_charge_config: LateChargeConfig | undefined = customizeCharges
        ? {
            late_fee_type:       lateFeeType,
            late_fee_value:      parseFloat(lateFeeValue) || 0,
            daily_interest_rate: (parseFloat(dailyInterestPct) || 0) / 100,
            grace_period_days:   parseInt(graceDays, 10) || 0,
          }
        : undefined

      const result = hasScheduleChange
        ? await regenerateRentalSchedule({
            rental_id:        rental.id,
            new_cycle:        cycle,
            new_due_day:      parseInt(dueDay, 10),
            new_cycle_amount: parsedNewAmount,
            new_use_pro_rata: useProRata,
            new_late_charge_config,
            justification:    justification.trim(),
          })
        : await adjustRental({
            rental_id:        rental.id,
            new_cycle_amount: parsedNewAmount,
            new_late_charge_config,
            justification:    justification.trim(),
          })

      if (!result.ok) { setError(result.error.message); return }
      router.push(`/locacoes/${rental.id}`)
    })
  }

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* Header */}
      <div className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-[#2a2a2a] bg-[#121212]/95 px-6 backdrop-blur">
        <Link href={`/locacoes/${rental.id}`} className="text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← {rental.vehicle?.license_plate ?? 'Locação'}
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="flex-1 text-[15px] font-bold text-[#f5f5f5]">Reajustar locação</h1>
        <Link
          href={`/locacoes/${rental.id}`}
          className="inline-flex h-8 items-center rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
        >
          Cancelar
        </Link>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isPending || !isReady}
          className="inline-flex h-8 items-center rounded-full bg-[#BAFF1A] px-5 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e616] disabled:opacity-60"
        >
          {isPending ? 'Reajustando…' : 'Confirmar Reajuste'}
        </button>
      </div>

      <div className="mx-auto max-w-xl space-y-6 px-6 py-8">

        {/* Resumo */}
        <div className="rounded-xl bg-[#202020] p-4 text-[13px]">
          <p className="font-semibold text-[#f5f5f5]">
            {rental.vehicle?.license_plate} — {rental.vehicle?.make} {rental.vehicle?.model}
          </p>
          <p className="mt-0.5 text-[#9e9e9e]">{rental.customer?.name}</p>
          <p className="mt-1.5 text-[#9e9e9e]">
            Valor atual: <span className="font-medium text-[#f5f5f5]">
              {rental.cycle_amount != null ? formatCurrency(rental.cycle_amount) : '—'}
            </span>
          </p>
        </div>

        {/* Novo valor do ciclo */}
        <div>
          <label className={labelCls}>Novo valor do ciclo (R$) *</label>
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={inputCls}
            value={newCycleAmount}
            onChange={e => setNewCycleAmount(e.target.value)}
          />
        </div>

        {/* Ciclo, dia de vencimento e pro rata */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Ciclo de cobrança</label>
            <select className={inputCls} value={cycle} onChange={e => handleCycleChange(e.target.value as 'weekly' | 'monthly')}>
              <option value="monthly">Mensal</option>
              <option value="weekly">Semanal</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>{cycle === 'monthly' ? 'Dia de vencimento' : 'Dia da semana'}</label>
            {cycle === 'monthly' ? (
              <select className={inputCls} value={dueDay} onChange={e => setDueDay(e.target.value)}>
                {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                  <option key={d} value={String(d)}>Dia {d}</option>
                ))}
              </select>
            ) : (
              <select className={inputCls} value={dueDay} onChange={e => setDueDay(e.target.value)}>
                {WEEK_DAY_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            )}
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#c7c7c7]">
          <input
            type="checkbox"
            checked={useProRata}
            onChange={e => setUseProRata(e.target.checked)}
            className="rounded accent-[#BAFF1A]"
          />
          Calcular pro rata na primeira e última cobranças
        </label>

        {/* Prévia de impacto */}
        {valuePreview && (
          valuePreview.affected_count > 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-[#474747] bg-[#202020] px-3 py-2.5 text-[13px] text-[#c7c7c7]">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#9e9e9e]" />
              <span>
                <strong>{valuePreview.affected_count}</strong> cobrança{valuePreview.affected_count !== 1 ? 's' : ''} pendente
                {valuePreview.affected_count !== 1 ? 's' : ''} ser{valuePreview.affected_count !== 1 ? 'ão' : 'á'} atualizada
                {valuePreview.affected_count !== 1 ? 's' : ''} de {formatCurrency(valuePreview.total_previous)} para {formatCurrency(valuePreview.total_new)}.
                {' '}Cobranças pagas e vencidas não serão alteradas.
              </span>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-[#474747] bg-[#202020] px-3 py-2.5 text-[13px] text-[#9e9e9e]">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Não há cobranças pendentes. O novo valor e encargos valem a partir da próxima renovação.</span>
            </div>
          )
        )}

        {schedulePreview && (
          <div className="space-y-2">
            <div className="flex items-start gap-2 rounded-lg border border-[#474747] bg-[#202020] px-3 py-2.5 text-[13px] text-[#c7c7c7]">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#9e9e9e]" />
              <span>
                {schedulePreview.cancelled_count > 0 ? (
                  <>
                    <strong>{schedulePreview.cancelled_count}</strong> cobrança{schedulePreview.cancelled_count !== 1 ? 's' : ''} pendente
                    {schedulePreview.cancelled_count !== 1 ? 's' : ''} ser{schedulePreview.cancelled_count !== 1 ? 'ão' : 'á'} cancelada
                    {schedulePreview.cancelled_count !== 1 ? 's' : ''} e <strong>{schedulePreview.new_charges_count}</strong> nova
                    {schedulePreview.new_charges_count !== 1 ? 's' : ''} ser{schedulePreview.new_charges_count !== 1 ? 'ão' : 'á'} gerada
                    {schedulePreview.new_charges_count !== 1 ? 's' : ''}, totalizando {formatCurrency(schedulePreview.new_charges_total)}.
                  </>
                ) : (
                  <>{schedulePreview.new_charges_count} nova{schedulePreview.new_charges_count !== 1 ? 's' : ''} cobrança{schedulePreview.new_charges_count !== 1 ? 's' : ''} ser{schedulePreview.new_charges_count !== 1 ? 'ão' : 'á'} gerada{schedulePreview.new_charges_count !== 1 ? 's' : ''}, totalizando {formatCurrency(schedulePreview.new_charges_total)}.</>
                )}
                {' '}Cobranças pagas e vencidas não serão alteradas.
              </span>
            </div>
            {schedulePreview.discount_lost_total > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#e65e24] bg-[#3a1200] px-3 py-2.5 text-[13px] text-[#ffa040]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formatCurrency(schedulePreview.discount_lost_total)} em desconto aplicado será perdido (cobrança cancelada).</span>
              </div>
            )}
            {schedulePreview.credit_to_restore_total > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-[#eab308] bg-[#2a2000] px-3 py-2.5 text-[13px] text-[#fde047]">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{formatCurrency(schedulePreview.credit_to_restore_total)} em crédito aplicado voltará a ficar disponível para o cliente.</span>
              </div>
            )}
          </div>
        )}

        {/* Encargos por atraso */}
        <div className="space-y-3 rounded-xl border border-[#323232] p-4">
          <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#c7c7c7]">
            <input
              type="checkbox"
              checked={customizeCharges}
              onChange={e => setCustomizeCharges(e.target.checked)}
              className="rounded accent-[#BAFF1A]"
            />
            Personalizar encargos por atraso desta locação
          </label>
          {!customizeCharges && (
            <p className="text-[12px] text-[#616161]">
              {rental.late_charge_config
                ? 'Esta locação já tem encargos personalizados.'
                : 'Esta locação usa os encargos padrão do tenant.'}
            </p>
          )}
          {customizeCharges && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Tipo de multa</label>
                <select
                  className={inputCls}
                  value={lateFeeType}
                  onChange={e => setLateFeeType(e.target.value as LateChargeConfig['late_fee_type'])}
                >
                  <option value="fixed">Fixa (R$)</option>
                  <option value="percentage">Percentual (%)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Valor da multa</label>
                <input
                  type="number" min="0" step="0.01" className={inputCls}
                  value={lateFeeValue} onChange={e => setLateFeeValue(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Juros diário (%)</label>
                <input
                  type="number" min="0" max="100" step="0.01" className={inputCls}
                  value={dailyInterestPct} onChange={e => setDailyInterestPct(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls}>Carência (dias)</label>
                <input
                  type="number" min="0" step="1" className={inputCls}
                  value={graceDays} onChange={e => setGraceDays(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* Justificativa */}
        <div>
          <label className={labelCls}>Justificativa *</label>
          <textarea
            className={`${inputCls} h-20 resize-none py-2`}
            placeholder="Motivo do reajuste (mín. 5 caracteres)…"
            value={justification}
            onChange={e => setJustification(e.target.value)}
            maxLength={500}
          />
        </div>

        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-[#ff9c9a]/30 bg-[#7c1c1c] px-4 py-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9c9a]" />
            <p className="text-[13px] text-[#ff9c9a]">{error}</p>
          </div>
        )}
      </div>
    </div>
  )
}
