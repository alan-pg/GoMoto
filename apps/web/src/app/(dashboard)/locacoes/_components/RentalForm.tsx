'use client'

import { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'

import { useCustomers, useVehicles } from '@gomoto/data'
import { generateCycleCharges } from '@gomoto/core'
import type { CycleCharge, Rental } from '@gomoto/core'
import { formatCurrency, formatDate } from '@/lib/utils'
import { createRental, updateRental } from '../actions'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface RentalFormProps {
  rentalId?: string
  initialData?: Partial<Rental>
}

type FormState = {
  vehicle_id:       string
  customer_id:      string
  contract_type:    'rental' | 'rent_to_own'
  cycle:            'weekly' | 'monthly'
  due_day:          string
  cycle_amount:     string
  start_date:       string
  end_date:         string
  use_pro_rata:     boolean
  security_deposit: string
  observations:     string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const labelCls    = 'block text-[13px] text-[#9e9e9e] mb-1.5'
const inputCls    = 'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all'
const selectCls   = inputCls
const inputErrCls = 'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#ff9c9a] text-[13px] text-[#f5f5f5] outline-none focus:border-[#ff9c9a] transition-all'

const CONTRACT_TYPE_LABEL = { rental: 'Locação', rent_to_own: 'Compra Programada' }
const CYCLE_LABEL         = { weekly: 'Semanal', monthly: 'Mensal' }

const WEEK_DAY_OPTIONS = [
  { value: '7', label: 'Domingo' },
  { value: '1', label: 'Segunda-feira' },
  { value: '2', label: 'Terça-feira' },
  { value: '3', label: 'Quarta-feira' },
  { value: '4', label: 'Quinta-feira' },
  { value: '5', label: 'Sexta-feira' },
  { value: '6', label: 'Sábado' },
]

function formatDueDay(cycle: 'weekly' | 'monthly', dueDay: string): string {
  if (cycle === 'monthly') return `Dia ${dueDay}`
  return WEEK_DAY_OPTIONS.find(o => o.value === dueDay)?.label ?? dueDay
}

function computeEndDate(startDate: string, qty: number, unit: 'months' | 'weeks'): string {
  if (!startDate || qty <= 0) return ''
  const [y, m, d] = startDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  if (unit === 'months') {
    date.setMonth(date.getMonth() + qty)
  } else {
    date.setDate(date.getDate() + qty * 7)
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function computePeriod(start: string, end: string, cycle: 'monthly' | 'weekly'): string {
  if (!start || !end) return ''
  const s = new Date(start)
  const e = new Date(end)
  if (e <= s) return ''
  if (cycle === 'monthly') {
    const months = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth())
    return String(Math.max(1, months))
  }
  const days = Math.round((e.getTime() - s.getTime()) / 86_400_000)
  return String(Math.max(1, Math.floor(days / 7)))
}

function buildInitialForm(d?: Partial<Rental>): FormState {
  return {
    vehicle_id:       d?.vehicle_id ?? '',
    customer_id:      d?.customer_id ?? '',
    contract_type:    d?.contract_type ?? 'rental',
    cycle:            d?.cycle ?? 'monthly',
    due_day:          String(d?.due_day ?? 10),
    cycle_amount:     d?.cycle_amount != null ? String(d.cycle_amount) : '',
    start_date:       d?.start_date ?? '',
    end_date:         d?.end_date ?? '',
    use_pro_rata:     d?.use_pro_rata ?? true,
    security_deposit: d?.security_deposit != null ? String(d.security_deposit) : '',
    observations:     d?.observations ?? '',
  }
}

// ─── ChargePreview ────────────────────────────────────────────────────────────

function ChargePreview({ charges }: { charges: CycleCharge[] }) {
  if (charges.length === 0) return null
  const total = charges.reduce((s, c) => s + c.amount, 0)
  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold text-[#f5f5f5]">
        {charges.length} cobrança{charges.length !== 1 ? 's' : ''} · {formatCurrency(total)} total
      </p>
      <div className="max-h-52 overflow-y-auto rounded-lg border border-[#323232]">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[#323232] text-left text-[#9e9e9e]">
              <th className="h-8 px-3 font-normal">Vencimento</th>
              <th className="h-8 px-3 font-normal">Tipo</th>
              <th className="h-8 px-3 text-right font-normal">Valor</th>
            </tr>
          </thead>
          <tbody>
            {charges.map((c, i) => (
              <tr key={i} className="h-9 border-b border-[#1e1e1e] last:border-0">
                <td className="px-3 text-[#c7c7c7]">{formatDate(c.due_date)}</td>
                <td className="px-3 text-[#9e9e9e]">
                  {c.billing_type === 'cycle' ? 'Ciclo' : 'Complementar'}
                </td>
                <td className="px-3 text-right font-mono text-[#f5f5f5]">{formatCurrency(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── RentalForm ───────────────────────────────────────────────────────────────

export function RentalForm({ rentalId, initialData }: RentalFormProps) {
  const isEditMode = !!rentalId
  const router     = useRouter()
  const [isPending, startTransition] = useTransition()

  const customersQuery = useCustomers()
  const vehiclesQuery  = useVehicles()

  const customers = useMemo(
    () => (customersQuery.data ?? []).filter(c => c.active).sort((a,b) => a.name.localeCompare(b.name)),
    [customersQuery.data],
  )
  const vehicles = useMemo(
    () => (vehiclesQuery.data ?? []).sort((a,b) => a.license_plate.localeCompare(b.license_plate)),
    [vehiclesQuery.data],
  )

  const [form, setForm] = useState<FormState>(() => buildInitialForm(initialData))
  const [step, setStep] = useState<'form' | 'preview'>('form')
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof FormState, string>>>({})

  const [periodQty, setPeriodQty] = useState('3')

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function handleStartDateChange(value: string) {
    const n = parseInt(periodQty, 10)
    const unit = form.cycle === 'monthly' ? 'months' : 'weeks'
    const computed = n > 0 && value ? computeEndDate(value, n, unit) : ''
    setForm(f => ({
      ...f,
      start_date: value,
      ...(computed ? { end_date: computed } : {}),
    }))
  }

  function handleEndDateChange(value: string) {
    set('end_date', value)
    const period = computePeriod(form.start_date, value, form.cycle)
    if (period) setPeriodQty(period)
  }

  function handlePeriodChange(qty: string) {
    setPeriodQty(qty)
    const n = parseInt(qty, 10)
    if (n > 0 && form.start_date) {
      const unit = form.cycle === 'monthly' ? 'months' : 'weeks'
      const computed = computeEndDate(form.start_date, n, unit)
      if (computed) set('end_date', computed)
    }
  }

  const previewCharges = useMemo<CycleCharge[]>(() => {
    const dueDay = parseInt(form.due_day, 10)
    const amount = parseFloat(form.cycle_amount)
    if (
      !form.start_date || !form.end_date ||
      isNaN(dueDay) || dueDay < 1 || dueDay > 28 ||
      isNaN(amount) || amount <= 0 ||
      form.end_date <= form.start_date
    ) return []
    try {
      return generateCycleCharges({
        start_date:   form.start_date,
        end_date:     form.end_date,
        cycle:        form.cycle,
        due_day:      dueDay,
        cycle_amount: amount,
        use_pro_rata: form.use_pro_rata,
      })
    } catch { return [] }
  }, [form.start_date, form.end_date, form.cycle, form.due_day, form.cycle_amount, form.use_pro_rata])

  const isFormReady = Boolean(
    form.vehicle_id && form.customer_id && form.start_date && form.end_date &&
    form.cycle_amount && form.due_day && form.end_date > form.start_date
  )

  function validateStep() {
    const errors: typeof fieldErrors = {}
    if (!form.vehicle_id)   errors.vehicle_id  = 'Selecione um veículo'
    if (!form.customer_id)  errors.customer_id = 'Selecione um cliente'
    if (!form.start_date)   errors.start_date  = 'Data de início obrigatória'
    if (!form.end_date)     errors.end_date    = 'Data de fim obrigatória'
    if (form.end_date && form.start_date && form.end_date <= form.start_date)
      errors.end_date = 'Data de fim deve ser posterior ao início'
    if (!form.cycle_amount || parseFloat(form.cycle_amount) <= 0)
      errors.cycle_amount = 'Informe o valor do ciclo'
    setFieldErrors(errors)
    return Object.keys(errors).length === 0
  }

  function handleNext() {
    if (validateStep() && previewCharges.length > 0) setStep('preview')
  }

  function handleSubmit() {
    setGlobalError(null)
    startTransition(async () => {
      const payload = {
        vehicle_id:       form.vehicle_id,
        customer_id:      form.customer_id,
        contract_type:    form.contract_type,
        cycle:            form.cycle,
        due_day:          parseInt(form.due_day, 10),
        cycle_amount:     parseFloat(form.cycle_amount),
        start_date:       form.start_date,
        end_date:         form.end_date,
        use_pro_rata:     form.use_pro_rata,
        security_deposit: form.security_deposit ? parseFloat(form.security_deposit) : null,
        observations:     form.observations || null,
      }

      if (isEditMode) {
        const result = await updateRental(rentalId!, payload)
        if (!result.ok) { setGlobalError(result.error.message); return }
        router.push(`/locacoes/${rentalId}`)
      } else {
        const result = await createRental(payload)
        if (!result.ok) { setGlobalError(result.error.message); return }
        router.push(`/locacoes/${result.data.lease_id}`)
      }
    })
  }

  const customerName = customers.find(c => c.id === form.customer_id)?.name ?? '—'
  const vehicleLabel = vehicles.find(v => v.id === form.vehicle_id)
  const vehicleName  = vehicleLabel
    ? `${vehicleLabel.license_plate} — ${vehicleLabel.make} ${vehicleLabel.model}`
    : '—'

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#121212]">

      {/* ── Sticky header ────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-[#2a2a2a] bg-[#121212]/95 px-6 backdrop-blur">
        <Link href="/locacoes" className="whitespace-nowrap text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]">
          ← Locações
        </Link>
        <span className="text-[#3a3a3a]">/</span>
        <h1 className="flex-1 truncate text-[15px] font-bold text-[#f5f5f5]">
          {isEditMode ? 'Editar locação' : 'Nova locação'}
        </h1>
        {step === 'preview' && (
          <button
            type="button"
            onClick={() => setStep('form')}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
          >
            <ChevronLeft className="h-4 w-4" />
            Editar
          </button>
        )}
        <Link
          href="/locacoes"
          className="inline-flex h-8 items-center rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:border-[#616161] hover:text-[#f5f5f5]"
        >
          Cancelar
        </Link>
        {step === 'form' && (
          <button
            type="button"
            onClick={handleNext}
            disabled={!isFormReady || previewCharges.length === 0}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#BAFF1A] px-5 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e616] disabled:opacity-50"
          >
            Preview
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
        {step === 'preview' && (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className="inline-flex h-8 items-center rounded-full bg-[#BAFF1A] px-5 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e616] disabled:opacity-60"
          >
            {isPending ? 'Criando…' : `Confirmar — ${previewCharges.length} cobrança${previewCharges.length !== 1 ? 's' : ''}`}
          </button>
        )}
      </div>

      <div className="mx-auto max-w-3xl px-6 py-8">

        {step === 'form' ? (
          <div className="space-y-8">

            {/* ── Seção: Partes ─────────────────────────────────────────── */}
            <section>
              <h2 className="mb-5 text-[14px] font-bold text-[#BAFF1A]">Partes do contrato</h2>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Cliente *</label>
                  <select
                    className={fieldErrors.customer_id ? inputErrCls : selectCls}
                    value={form.customer_id}
                    onChange={e => set('customer_id', e.target.value)}
                  >
                    <option value="">Selecione um cliente…</option>
                    {customers.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  {fieldErrors.customer_id && (
                    <p className="mt-1 text-[12px] text-[#ff9c9a]">{fieldErrors.customer_id}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Veículo *</label>
                  <select
                    className={fieldErrors.vehicle_id ? inputErrCls : selectCls}
                    value={form.vehicle_id}
                    onChange={e => set('vehicle_id', e.target.value)}
                  >
                    <option value="">Selecione um veículo…</option>
                    {vehicles.map(v => (
                      <option key={v.id} value={v.id}>
                        {v.license_plate} — {v.make} {v.model}
                      </option>
                    ))}
                  </select>
                  {fieldErrors.vehicle_id && (
                    <p className="mt-1 text-[12px] text-[#ff9c9a]">{fieldErrors.vehicle_id}</p>
                  )}
                </div>
              </div>
            </section>

            {/* ── Seção: Condições ──────────────────────────────────────── */}
            <section>
              <h2 className="mb-5 text-[14px] font-bold text-[#BAFF1A]">Condições do contrato</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Tipo de contrato</label>
                    <select
                      className={selectCls}
                      value={form.contract_type}
                      onChange={e => set('contract_type', e.target.value as FormState['contract_type'])}
                    >
                      <option value="rental">Locação</option>
                      <option value="rent_to_own">Compra Programada</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Ciclo de cobrança</label>
                    <select
                      className={selectCls}
                      value={form.cycle}
                      onChange={e => {
                        const newCycle = e.target.value as FormState['cycle']
                        const unit = newCycle === 'monthly' ? 'months' : 'weeks'
                        const n = parseInt(periodQty, 10)
                        const computed = n > 0 && form.start_date
                          ? computeEndDate(form.start_date, n, unit)
                          : ''
                        if (!computed && form.start_date && form.end_date) {
                          const newPeriod = computePeriod(form.start_date, form.end_date, newCycle)
                          if (newPeriod) setPeriodQty(newPeriod)
                        }
                        setForm(f => ({
                          ...f,
                          cycle:   newCycle,
                          due_day: newCycle === 'monthly' ? '10' : '1',
                          ...(computed ? { end_date: computed } : {}),
                        }))
                      }}
                    >
                      <option value="monthly">Mensal</option>
                      <option value="weekly">Semanal</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>
                      {form.cycle === 'monthly' ? 'Dia de vencimento' : 'Dia da semana'}
                    </label>
                    {form.cycle === 'monthly' ? (
                      <select
                        className={selectCls}
                        value={form.due_day}
                        onChange={e => set('due_day', e.target.value)}
                      >
                        {Array.from({ length: 28 }, (_, i) => i + 1).map(d => (
                          <option key={d} value={String(d)}>Dia {d}</option>
                        ))}
                      </select>
                    ) : (
                      <select
                        className={selectCls}
                        value={form.due_day}
                        onChange={e => set('due_day', e.target.value)}
                      >
                        {WEEK_DAY_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Valor do ciclo (R$) *</label>
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      placeholder="0,00"
                      className={fieldErrors.cycle_amount ? inputErrCls : inputCls}
                      value={form.cycle_amount}
                      onChange={e => set('cycle_amount', e.target.value)}
                    />
                    {fieldErrors.cycle_amount && (
                      <p className="mt-1 text-[12px] text-[#ff9c9a]">{fieldErrors.cycle_amount}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Data de início *</label>
                    <input
                      type="date"
                      className={fieldErrors.start_date ? inputErrCls : inputCls}
                      value={form.start_date}
                      onChange={e => handleStartDateChange(e.target.value)}
                    />
                    {fieldErrors.start_date && (
                      <p className="mt-1 text-[12px] text-[#ff9c9a]">{fieldErrors.start_date}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Data de fim *</label>
                    <input
                      type="date"
                      min={form.start_date || undefined}
                      className={fieldErrors.end_date ? inputErrCls : inputCls}
                      value={form.end_date}
                      onChange={e => handleEndDateChange(e.target.value)}
                    />
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <input
                        type="number"
                        min="1"
                        max="120"
                        className="h-7 w-14 rounded-md border border-[#323232] bg-[#282828] px-2 text-[12px] text-[#f5f5f5] outline-none focus:border-[#BAFF1A]"
                        value={periodQty}
                        onChange={e => handlePeriodChange(e.target.value)}
                      />
                      <span className="text-[12px] text-[#9e9e9e]">
                        {form.cycle === 'monthly' ? 'meses' : 'semanas'}
                      </span>
                    </div>
                    {fieldErrors.end_date && (
                      <p className="mt-1 text-[12px] text-[#ff9c9a]">{fieldErrors.end_date}</p>
                    )}
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-[#c7c7c7]">
                  <input
                    type="checkbox"
                    checked={form.use_pro_rata}
                    onChange={e => set('use_pro_rata', e.target.checked)}
                    className="rounded accent-[#BAFF1A]"
                  />
                  Calcular pro rata na primeira e última cobranças
                </label>
              </div>
            </section>

            {/* ── Seção: Financeiro ─────────────────────────────────────── */}
            <section>
              <h2 className="mb-5 text-[14px] font-bold text-[#BAFF1A]">Garantias e observações</h2>
              <div className="space-y-4">
                <div className="max-w-xs">
                  <label className={labelCls}>Caução / depósito de segurança (R$)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0,00 — opcional"
                    className={inputCls}
                    value={form.security_deposit}
                    onChange={e => set('security_deposit', e.target.value)}
                  />
                  <p className="mt-1 text-[12px] text-[#616161]">
                    Valor retido como garantia. Devolvido ao encerrar.
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Observações</label>
                  <textarea
                    className={`${inputCls} h-20 resize-none py-2`}
                    placeholder="Condições especiais, observações do contrato…"
                    value={form.observations}
                    onChange={e => set('observations', e.target.value)}
                    maxLength={2000}
                  />
                </div>
              </div>
            </section>

            {/* Preview de cobranças (inline) */}
            {previewCharges.length > 0 && <ChargePreview charges={previewCharges} />}

            {previewCharges.length === 0 && isFormReady && (
              <p className="text-[13px] text-[#9e9e9e]">
                Preencha as datas e valor para visualizar as cobranças.
              </p>
            )}
          </div>

        ) : (
          /* ── Step 2: Preview ──────────────────────────────────────────── */
          <div className="space-y-6">
            <div className="rounded-xl bg-[#202020] p-5 text-[13px]">
              <h2 className="mb-4 text-[14px] font-bold text-[#BAFF1A]">Resumo do contrato</h2>
              <div className="grid grid-cols-2 gap-x-8 gap-y-2.5">
                {([
                  ['Cliente',     customerName],
                  ['Veículo',     vehicleName],
                  ['Tipo',        CONTRACT_TYPE_LABEL[form.contract_type]],
                  ['Ciclo',       CYCLE_LABEL[form.cycle]],
                  ['Vencimento',  formatDueDay(form.cycle, form.due_day)],
                  ['Valor/ciclo', formatCurrency(parseFloat(form.cycle_amount) || 0)],
                  ['Início', form.start_date ? formatDate(form.start_date) : '—'],
                  ['Fim',    form.end_date   ? formatDate(form.end_date)   : '—'],
                  ['Pro rata',    form.use_pro_rata ? 'Sim' : 'Não'],
                  ...(form.security_deposit
                    ? [['Caução', formatCurrency(parseFloat(form.security_deposit))]]
                    : []),
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex gap-2">
                    <span className="min-w-[90px] text-[#9e9e9e]">{label}:</span>
                    <span className="text-[#f5f5f5]">{value}</span>
                  </div>
                ))}
              </div>
              {form.observations && (
                <div className="mt-4 border-t border-[#323232] pt-4">
                  <span className="text-[#9e9e9e]">Observações: </span>
                  <span className="text-[#c7c7c7]">{form.observations}</span>
                </div>
              )}
            </div>

            <ChargePreview charges={previewCharges} />

            {globalError && (
              <div className="flex items-start gap-3 rounded-xl border border-[#ff9c9a]/30 bg-[#7c1c1c] px-4 py-3">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#ff9c9a]" />
                <p className="text-[13px] text-[#ff9c9a]">{globalError}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
