'use client'

import { useState, useEffect, useRef, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle } from 'lucide-react'

import { useCustomers, useVehicles, useRentals } from '@gomoto/data'
import { formatCurrency } from '@/lib/utils'
import { createFine, updateFine } from '../actions'

// ─── Constantes ───────────────────────────────────────────────────────────────

const COMMON_INFRACTIONS = [
  { description: 'Avançar sinal vermelho ou parada obrigatória',          code: '208-III', amount: 293.47,  points: 7 },
  { description: 'Conduzir sem capacete de proteção',                      code: '244-I',   amount: 195.23,  points: 7 },
  { description: 'Conduzir sem documentos do veículo',                     code: '232',     amount: 130.16,  points: 3 },
  { description: 'Conduzir sem habilitação (CNH)',                         code: '162-III', amount: 880.41,  points: 7 },
  { description: 'Embriaguez ao volante',                                  code: '165',     amount: 2934.70, points: 7 },
  { description: 'Estacionamento irregular',                               code: '181',     amount: 195.23,  points: 3 },
  { description: 'Excesso de velocidade até 20% acima do limite',         code: '218-I',   amount: 88.38,   points: 3 },
  { description: 'Excesso de velocidade entre 20% e 50% acima do limite', code: '218-II',  amount: 195.23,  points: 5 },
  { description: 'Habilitação (CNH) vencida',                              code: '162-I',   amount: 293.47,  points: 5 },
  { description: 'Licenciamento do veículo vencido',                       code: '230-V',   amount: 293.47,  points: 3 },
  { description: 'Não sinalizar mudança de faixa',                         code: '186',     amount: 88.38,   points: 3 },
  { description: 'Uso de celular ao volante',                              code: '252',     amount: 293.47,  points: 5 },
]

const SOURCE_OPTIONS = [
  { value: '',             label: 'Selecione o órgão...' },
  { value: 'detran',       label: 'DETRAN' },
  { value: 'cetran',       label: 'CETRAN' },
  { value: 'municipal',    label: 'Municipal (CET, SMTT, etc.)' },
  { value: 'private_area', label: 'Área privada' },
  { value: 'other',        label: 'Outro' },
]

const RESPONSIBLE_OPTIONS = [
  { value: 'customer', label: 'Cliente' },
  { value: 'company',  label: 'Empresa' },
]

const NAV_ITEMS = [
  { id: 'sec-link',         label: 'Vínculo'         },
  { id: 'sec-infraction',   label: 'Infração'        },
  { id: 'sec-values',       label: 'Datas e Valores' },
  { id: 'sec-observations', label: 'Observações'     },
]

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FineFormProps {
  fineId?: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialData?: Record<string, any>
}

// ─── Estilos base ─────────────────────────────────────────────────────────────

const labelCls   = 'block text-[13px] text-fg-mute mb-1.5'
const inputCls   = 'w-full h-9 px-3 rounded-lg bg-surface-2 border border-border text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-primary transition-all'
const inputErrCls = 'w-full h-9 px-3 rounded-lg bg-surface-2 border border-danger text-[13px] text-fg placeholder:text-fg-mute outline-none focus:border-danger transition-all'

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <h2 className="text-[15px] font-bold text-fg">{title}</h2>
      {hint && <span className="text-[12px] text-fg-mute">{hint}</span>}
    </div>
  )
}

function Field({
  label,
  error,
  children,
  className,
}: {
  label: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
      {error && <p className="text-[12px] text-danger mt-1">{error}</p>}
    </div>
  )
}

// ─── Estado inicial ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInitialForm(d?: Record<string, any>) {
  return {
    customer_id:          d?.customer_id ?? '',
    vehicle_id:           d?.vehicle_id ?? '',
    description:          d?.description ?? '',
    amount:               d?.amount != null ? String(d.amount) : '',
    infraction_date:      d?.infraction_date ?? '',
    due_date:             d?.due_date ?? '',
    responsible:          d?.responsible ?? 'customer',
    observations:         d?.observations ?? '',
    ait_number:           d?.ait_number ?? '',
    infraction_code:      d?.infraction_code ?? '',
    infraction_location:  d?.infraction_location ?? '',
    points:               d?.points != null ? String(d.points) : '',
    source:               d?.source ?? '',
    ticket_url:           d?.ticket_url ?? '',
  }
}

// ─── FineForm ─────────────────────────────────────────────────────────────────

export function FineForm({ fineId, initialData }: FineFormProps) {
  const isEditMode = !!fineId
  const router     = useRouter()
  const [isPending, startTransition] = useTransition()

  // ── Dados
  const customersQuery = useCustomers()
  const vehiclesQuery  = useVehicles()
  const rentalsQuery   = useRentals()

  const customers = useMemo(
    () => (customersQuery.data ?? [])
      .filter((c) => c.active)
      .sort((a, b) => a.name.localeCompare(b.name)),
    [customersQuery.data],
  )
  const vehicles = useMemo(
    () => (vehiclesQuery.data ?? [])
      .sort((a, b) => a.license_plate.localeCompare(b.license_plate)),
    [vehiclesQuery.data],
  )
  const contracts = useMemo(
    () => (rentalsQuery.data ?? [])
      .filter((r) => r.status === 'active')
      .map((r) => ({ customer_id: r.customer_id, vehicle_id: r.vehicle_id })),
    [rentalsQuery.data],
  )

  // ── Estado do formulário
  const [form, setForm] = useState(() => buildInitialForm(initialData))
  function set(key: keyof ReturnType<typeof buildInitialForm>, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const [globalError,  setGlobalError]  = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<Partial<Record<string, string>>>({})

  // ── Sidebar: IntersectionObserver para seção ativa
  const sectionRefs  = useRef<Record<string, HTMLElement | null>>({})
  const [activeSection, setActiveSection] = useState('sec-link')

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
        if (visible.length > 0) setActiveSection(visible[0].target.id)
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    Object.values(sectionRefs.current).forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [])

  function scrollTo(id: string) {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  // ── Quick fill: opções do select de infrações comuns
  const quickFillOptions = useMemo(() => [
    { value: '', label: 'Selecione uma infração comum (CTB)...' },
    ...COMMON_INFRACTIONS.map((i) => ({
      value: i.description,
      label: `Art. ${i.code} — ${i.description} — ${formatCurrency(i.amount)}`,
    })),
  ], [])

  // ── Submit
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)
    setFieldErrors({})

    startTransition(async () => {
      const payload = {
        customer_id:          form.customer_id || null,
        vehicle_id:           form.vehicle_id,
        description:          form.description,
        amount:               parseFloat(form.amount),
        infraction_date:      form.infraction_date,
        due_date:             form.due_date || null,
        responsible:          form.responsible as 'customer' | 'company',
        observations:         form.observations || null,
        ait_number:           form.ait_number || null,
        infraction_code:      form.infraction_code || null,
        infraction_location:  form.infraction_location || null,
        points:               form.points ? parseInt(form.points, 10) : null,
        source:               (form.source || null) as 'detran' | 'cetran' | 'municipal' | 'private_area' | 'other' | null,
        ticket_url:           form.ticket_url || null,
      }

      const result = isEditMode
        ? await updateFine(fineId!, payload)
        : await createFine(payload)

      if ('error' in result) {
        setGlobalError('Erro ao salvar. Verifique os dados e tente novamente.')
        return
      }

      router.push('/multas')
    })
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Sticky header ──────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-bg backdrop-blur border-b border-border px-6 h-14 flex items-center gap-3">
        <Link href="/multas" className="text-[13px] text-fg-mute hover:text-fg transition-colors whitespace-nowrap">
          ← Multas
        </Link>
        <span className="text-fg-mute">/</span>
        <h1 className="text-[15px] font-bold text-fg flex-1 truncate">
          {isEditMode ? 'Editar multa' : 'Registrar multa'}
        </h1>
        <Link
          href="/multas"
          className="h-8 px-4 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors inline-flex items-center"
        >
          Cancelar
        </Link>
        <button
          type="submit"
          form="fine-form"
          disabled={isPending}
          className="h-8 px-5 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
        >
          {isPending ? 'Salvando…' : isEditMode ? 'Salvar' : 'Registrar'}
        </button>
      </div>

      {/* ── Corpo: sidebar + formulário ────────────────────────────────────── */}
      <div className="flex gap-0 max-w-4xl mx-auto">

        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="w-44 flex-shrink-0 hidden md:block">
          <nav className="sticky top-14 pt-8 pb-8 pr-4 space-y-0.5">
            {NAV_ITEMS.map((item) => {
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollTo(item.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-mute hover:text-fg-mute hover:bg-border'
                  }`}
                >
                  <span className={`inline-block w-1.5 h-1.5 rounded-full mr-2.5 mb-0.5 transition-colors ${isActive ? 'bg-primary' : 'bg-fg-mute'}`} />
                  {item.label}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* ── Formulário ──────────────────────────────────────────────────── */}
        <form
          id="fine-form"
          onSubmit={handleSubmit}
          className="flex-1 min-w-0 px-6 py-8 space-y-14"
        >

          {/* ══ Vínculo ═══════════════════════════════════════════════════════ */}
          <section
            id="sec-link"
            ref={(el) => { sectionRefs.current['sec-link'] = el }}
          >
            <SectionHeader title="Vínculo" hint="veículo e cliente envolvidos" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">

                {/* Moto — obrigatória */}
                <Field label="Moto *" error={fieldErrors.vehicle_id}>
                  <select
                    className={fieldErrors.vehicle_id ? inputErrCls : inputCls}
                    value={form.vehicle_id}
                    required
                    onChange={(e) => {
                      const vid = e.target.value
                      const contract = contracts.find((c) => c.vehicle_id === vid)
                      setForm((prev) => ({
                        ...prev,
                        vehicle_id:  vid,
                        customer_id: contract?.customer_id ?? prev.customer_id,
                      }))
                    }}
                  >
                    <option value="">Selecione a moto</option>
                    {vehicles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.license_plate} — {m.make} {m.model}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Cliente — opcional (condutor pode ser identificado depois) */}
                <Field label="Cliente">
                  <select
                    className={inputCls}
                    value={form.customer_id}
                    onChange={(e) => {
                      const cid = e.target.value
                      const contract = contracts.find((c) => c.customer_id === cid)
                      setForm((prev) => ({
                        ...prev,
                        customer_id: cid,
                        vehicle_id:  contract?.vehicle_id ?? prev.vehicle_id,
                      }))
                    }}
                  >
                    <option value="">Sem cliente vinculado</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {form.vehicle_id && !form.customer_id && (
                <p className="text-[12px] text-fg-mute">
                  Cliente pode ser vinculado após identificação do condutor. A moto já é suficiente para registrar a multa.
                </p>
              )}
            </div>
          </section>

          {/* ══ Infração ══════════════════════════════════════════════════════ */}
          <section
            id="sec-infraction"
            ref={(el) => { sectionRefs.current['sec-infraction'] = el }}
          >
            <SectionHeader title="Infração" />
            <div className="space-y-4">

              {/* Quick fill CTB */}
              <Field label="Infrações comuns (CTB) — preenchimento rápido">
                <select
                  className={inputCls}
                  value={COMMON_INFRACTIONS.find((i) => i.description === form.description)?.description ?? ''}
                  onChange={(e) => {
                    const match = COMMON_INFRACTIONS.find((i) => i.description === e.target.value)
                    if (match) {
                      setForm((prev) => ({
                        ...prev,
                        description:     match.description,
                        amount:          String(match.amount),
                        infraction_code: match.code,
                        points:          String(match.points),
                      }))
                    }
                  }}
                >
                  {quickFillOptions.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </Field>

              {/* Descrição livre — editável mesmo após quick fill */}
              <Field label="Descrição da infração *" error={fieldErrors.description}>
                <input
                  className={fieldErrors.description ? inputErrCls : inputCls}
                  placeholder="Ex.: Excesso de velocidade — Av. Paulista"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  maxLength={300}
                  required
                />
              </Field>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Código do artigo (CTB)">
                  <input
                    className={inputCls}
                    placeholder="Ex.: 218-II"
                    value={form.infraction_code}
                    onChange={(e) => set('infraction_code', e.target.value)}
                    maxLength={20}
                  />
                </Field>
                <Field label="Órgão autuador">
                  <select
                    className={inputCls}
                    value={form.source}
                    onChange={(e) => set('source', e.target.value)}
                  >
                    {SOURCE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Local da infração">
                <input
                  className={inputCls}
                  placeholder="Ex.: Av. Paulista, 1234 — São Paulo / SP"
                  value={form.infraction_location}
                  onChange={(e) => set('infraction_location', e.target.value)}
                  maxLength={2000}
                />
              </Field>
            </div>
          </section>

          {/* ══ Datas e Valores ═══════════════════════════════════════════════ */}
          <section
            id="sec-values"
            ref={(el) => { sectionRefs.current['sec-values'] = el }}
          >
            <SectionHeader title="Datas e Valores" />
            <div className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <Field label="Data da infração *" error={fieldErrors.infraction_date}>
                  <input
                    type="date"
                    className={fieldErrors.infraction_date ? inputErrCls : inputCls}
                    value={form.infraction_date}
                    onChange={(e) => set('infraction_date', e.target.value)}
                    required
                  />
                </Field>
                <Field label="Data de vencimento">
                  <input
                    type="date"
                    className={inputCls}
                    value={form.due_date}
                    onChange={(e) => set('due_date', e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Valor (R$) *" error={fieldErrors.amount}>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="293.47"
                    className={fieldErrors.amount ? inputErrCls : inputCls}
                    value={form.amount}
                    onChange={(e) => set('amount', e.target.value)}
                    required
                  />
                </Field>
                <Field label="Pontos na CNH">
                  <input
                    type="number"
                    min="0"
                    max="7"
                    placeholder="0–7"
                    className={inputCls}
                    value={form.points}
                    onChange={(e) => set('points', e.target.value)}
                  />
                </Field>
                <Field label="Responsável pelo pagamento">
                  <select
                    className={inputCls}
                    value={form.responsible}
                    onChange={(e) => set('responsible', e.target.value)}
                  >
                    {RESPONSIBLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field label="Nº do AIT" className="max-w-xs">
                <input
                  className={inputCls}
                  placeholder="Ex.: A 123456789"
                  value={form.ait_number}
                  onChange={(e) => set('ait_number', e.target.value)}
                  maxLength={50}
                />
              </Field>
            </div>
          </section>

          {/* ══ Observações ═══════════════════════════════════════════════════ */}
          <section
            id="sec-observations"
            ref={(el) => { sectionRefs.current['sec-observations'] = el }}
          >
            <SectionHeader title="Observações" hint="opcional" />
            <div className="space-y-4">

              <Field label="Link do boleto / notificação">
                <input
                  type="url"
                  className={inputCls}
                  placeholder="https://..."
                  value={form.ticket_url}
                  onChange={(e) => set('ticket_url', e.target.value)}
                />
              </Field>

              <Field label="Observações livres">
                <textarea
                  className={`${inputCls} h-24 py-2 resize-none`}
                  placeholder="Recurso em andamento, detalhes adicionais, número do processo..."
                  value={form.observations}
                  onChange={(e) => set('observations', e.target.value)}
                  maxLength={2000}
                />
              </Field>
            </div>
          </section>

          {/* ── Erro global ─────────────────────────────────────────────────── */}
          {globalError && (
            <div className="flex items-start gap-3 px-4 py-3 bg-danger-bg border border-danger rounded-xl">
              <AlertCircle className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-[13px] text-danger">{globalError}</p>
            </div>
          )}

          {/* ── Footer ──────────────────────────────────────────────────────── */}
          <div className="flex gap-3 justify-end pt-4 pb-16 border-t border-border">
            <Link
              href="/multas"
              className="inline-flex items-center h-9 px-5 rounded-full border border-border text-fg-mute text-[13px] font-medium hover:text-fg hover:border-fg-mute transition-colors"
            >
              Cancelar
            </Link>
            <button
              type="submit"
              disabled={isPending}
              className="h-9 px-6 rounded-full bg-primary text-bg text-[13px] font-bold hover:bg-primary-hover transition-colors disabled:opacity-60"
            >
              {isPending ? 'Salvando…' : isEditMode ? 'Salvar alterações' : 'Registrar multa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
