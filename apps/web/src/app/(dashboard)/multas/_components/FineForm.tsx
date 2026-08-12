'use client'

import { useState, useEffect, useRef, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Sparkles } from 'lucide-react'

import { useVehicles, useRentals, useSupabaseContext, useRequiredTenantId } from '@gomoto/data'
import { matchVehicleByPlate, ExtractDocumentFileSchema } from '@gomoto/core'
import { formatCurrency, formatDate } from '@/lib/utils'
import { createFine, updateFine, extractFineNoticeFields, addFineAttachment } from '../actions'
import { DocumentImportCard } from '@/components/documents/DocumentImportCard'

// ─── Constantes ───────────────────────────────────────────────────────────────

const RESPONSIBLE_OPTIONS = [
  { value: 'customer', label: 'Cliente' },
  { value: 'company',  label: 'Empresa' },
]

// Campos de FineNoticeFields (extração por IA, PRD 0013) que mapeiam 1:1 pra
// campos de texto do form — usados pra aplicar o resultado da extração e
// marcar quais campos foram preenchidos pela IA (RF-005/CA-006).
const AI_STRING_FIELDS = [
  'description', 'infraction_date', 'ait_number', 'infraction_location',
  'renainf_number', 'notification_date', 'prior_defense_deadline', 'driver_identification_deadline',
  'senatran_infraction_code', 'senatran_infraction_subcode', 'issuing_agency_name', 'issuing_agency_code',
  'competent_agency_code', 'competent_agency_name', 'driver_name', 'driver_cnh', 'driver_cpf', 'driver_document',
  'infraction_time', 'measurement_instrument_id', 'traffic_agent_id', 'original_renainf_number',
  'infraction_municipality_code', 'infraction_municipality_name', 'infraction_state', 'senatran_message',
] as const

// Campos numéricos na extração, guardados como string no form (mesmo padrão de `amount`).
const AI_NUMBER_FIELDS = ['amount', 'measured_speed', 'considered_speed', 'speed_limit'] as const

const NAV_ITEMS = [
  { id: 'sec-document',     label: 'Documento'       },
  { id: 'sec-link',         label: 'Vínculo'         },
  { id: 'sec-infraction',   label: 'Infração'        },
  { id: 'sec-values',       label: 'Datas e Valores' },
  { id: 'sec-deadlines',    label: 'Prazos (NA/NP)'  },
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
  aiFilled,
}: {
  label: string
  error?: string
  children: React.ReactNode
  className?: string
  /** RF-005/CA-006: campo preenchido pela extração por IA, ainda não editado manualmente. */
  aiFilled?: boolean
}) {
  return (
    <div className={className}>
      <label className={`${labelCls} flex items-center gap-1`}>
        {label}
        {aiFilled && <Sparkles className="w-3 h-3 text-primary shrink-0" aria-label="Preenchido pela IA" />}
      </label>
      <div className={aiFilled ? 'rounded-lg ring-1 ring-primary/50' : undefined}>
        {children}
      </div>
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
    // Sem default — operador precisa escolher explicitamente quem paga (decide se gera cobrança).
    responsible:          d?.responsible ?? '',
    observations:         d?.observations ?? '',
    ait_number:           d?.ait_number ?? '',
    infraction_location:  d?.infraction_location ?? '',
    points:               d?.points != null ? String(d.points) : '',
    // PRD 0013 — campos oficiais da NA
    renainf_number:                  d?.renainf_number ?? '',
    notification_date:               d?.notification_date ?? '',
    prior_defense_deadline:          d?.prior_defense_deadline ?? '',
    driver_identification_deadline:  d?.driver_identification_deadline ?? '',
    senatran_infraction_code:        d?.senatran_infraction_code ?? '',
    senatran_infraction_subcode:     d?.senatran_infraction_subcode ?? '',
    issuing_agency_name:             d?.issuing_agency_name ?? '',
    issuing_agency_code:             d?.issuing_agency_code ?? '',
    competent_agency_code:           d?.competent_agency_code ?? '',
    competent_agency_name:           d?.competent_agency_name ?? '',
    driver_name:                     d?.driver_name ?? '',
    driver_cnh:                      d?.driver_cnh ?? '',
    driver_cpf:                      d?.driver_cpf ?? '',
    driver_document:                 d?.driver_document ?? '',
    infraction_time:                 d?.infraction_time ?? '',
    measurement_instrument_id:       d?.measurement_instrument_id ?? '',
    traffic_agent_id:                d?.traffic_agent_id ?? '',
    measured_speed:                  d?.measured_speed != null ? String(d.measured_speed) : '',
    considered_speed:                d?.considered_speed != null ? String(d.considered_speed) : '',
    speed_limit:                     d?.speed_limit != null ? String(d.speed_limit) : '',
    infraction_municipality_code:    d?.infraction_municipality_code ?? '',
    infraction_municipality_name:    d?.infraction_municipality_name ?? '',
    infraction_state:                d?.infraction_state ?? '',
    senatran_message:                d?.senatran_message ?? '',
    // PRD 0013 — campos oficiais da NP (preenchidos manualmente, geralmente depois)
    appeal_deadline:                 d?.appeal_deadline ?? '',
    discounted_payment_deadline:     d?.discounted_payment_deadline ?? '',
    original_renainf_number:         d?.original_renainf_number ?? '',
  }
}

// ─── FineForm ─────────────────────────────────────────────────────────────────

export function FineForm({ fineId, initialData }: FineFormProps) {
  const isEditMode = !!fineId
  const router     = useRouter()
  const [isPending, startTransition] = useTransition()
  const supabase    = useSupabaseContext()
  const getTenantId = useRequiredTenantId()

  // ── Dados
  const vehiclesQuery = useVehicles()
  const rentalsQuery  = useRentals() // sem filtro — precisa de ativas E históricas (locação por placa)

  const vehicles = useMemo(
    () => (vehiclesQuery.data ?? [])
      .sort((a, b) => a.license_plate.localeCompare(b.license_plate)),
    [vehiclesQuery.data],
  )

  // runFineNoticeExtraction roda de forma assíncrona (Server Action) — sem ref,
  // ela capturaria `vehicles` da closure de quando foi chamada, que pode estar
  // desatualizada se a query ainda não tinha resolvido nesse instante.
  const vehiclesRef = useRef(vehicles)
  useEffect(() => { vehiclesRef.current = vehicles }, [vehicles])

  // ── Estado do formulário
  const [form, setForm] = useState(() => buildInitialForm(initialData))

  // ── Cliente nunca é selecionado direto — só via locação escolhida (ativa ou
  // histórica) da moto selecionada. `customer_id` no form fica sempre derivado.
  const [selectedRentalId, setSelectedRentalId] = useState('')

  const vehicleRentals = useMemo(
    () => (rentalsQuery.data ?? [])
      .filter((r) => r.vehicle_id === form.vehicle_id)
      .sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? '')),
    [rentalsQuery.data, form.vehicle_id],
  )

  // Modo edição (ou multa já com cliente vinculado): tenta achar a locação
  // correspondente pra pré-selecionar no picker — não persistimos qual locação
  // foi escolhida, só o customer_id resultante, então essa é uma reconciliação
  // best-effort (primeira locação da lista com esse cliente).
  useEffect(() => {
    if (selectedRentalId || !form.customer_id || vehicleRentals.length === 0) return
    const match = vehicleRentals.find((r) => r.customer_id === form.customer_id)
    if (match) setSelectedRentalId(match.id)
  }, [vehicleRentals, form.customer_id, selectedRentalId])

  // ── Campos preenchidos pela extração por IA, ainda não editados manualmente
  // (RF-005/CA-006) — sinalizados com sparkle; some assim que o operador edita.
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set())

  function set(key: keyof ReturnType<typeof buildInitialForm>, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setAiFilledFields((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
  }

  const [globalError,  setGlobalError]  = useState<string | null>(null)
  const [fieldErrors,  setFieldErrors]  = useState<Partial<Record<string, string>>>({})

  // ── Extração de notificação de multa via IA (PRD/Spec 0012) — só na criação;
  // edição de multa existente já anexa documento via FineAttachments (tela de detalhe).
  const [pendingFineNoticeFile, setPendingFineNoticeFile] = useState<File | null>(null)
  const [fineExtraction, setFineExtraction] = useState<
    | { status: 'idle' }
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | {
        status: 'success'
        fieldsFound: number
        fieldsTotal: number
        plateMatched: boolean
        duplicateOf: { id: string; description: string; amount: number } | null
      }
  >({ status: 'idle' })

  async function runFineNoticeExtraction(file: File) {
    // Validação imediata no client (mesmo schema do Server Action, RNF-003) —
    // feedback rápido sem gastar round-trip antes da checagem definitiva.
    const validFile = ExtractDocumentFileSchema.safeParse(file)
    if (!validFile.success) {
      setPendingFineNoticeFile(file)
      setFineExtraction({ status: 'error', message: validFile.error.issues[0]?.message ?? 'Arquivo inválido' })
      return
    }

    setPendingFineNoticeFile(file)
    setFineExtraction({ status: 'loading' })
    const formData = new FormData()
    formData.append('file', file)
    const result = await extractFineNoticeFields(formData)

    if (!result.ok) {
      setFineExtraction({ status: 'error', message: result.error.message })
      return
    }

    const { fields, fieldsFound, fieldsTotal, duplicateOf } = result.data
    const match = matchVehicleByPlate(fields.license_plate.value, vehiclesRef.current)

    // RF-005/CA-006 — rastreia quais campos a IA de fato preencheu (não-nulos),
    // pra sinalizar com sparkle no form. Substitui o set anterior por inteiro:
    // uma nova extração reflete só o que o documento atual trouxe.
    const touched = new Set<string>()
    for (const key of AI_STRING_FIELDS) if (fields[key].value !== null) touched.add(key)
    for (const key of AI_NUMBER_FIELDS) if (fields[key].value !== null) touched.add(key)

    setForm((prev) => {
      const next = { ...prev }
      for (const key of AI_STRING_FIELDS) {
        const v = fields[key].value
        if (v !== null) next[key] = v
      }
      for (const key of AI_NUMBER_FIELDS) {
        const v = fields[key].value
        if (v !== null) next[key] = String(v)
      }
      // Seleciona a moto pela placa extraída — a locação (e o cliente) fica pra
      // o operador escolher entre as disponíveis pra essa moto (ativas e
      // históricas), já que a IA não sabe qual delas cobre a data da infração.
      if (match) next.vehicle_id = match.id
      return next
    })
    if (match) { setSelectedRentalId(''); }
    setAiFilledFields(touched)

    setFineExtraction({ status: 'success', fieldsFound, fieldsTotal, plateMatched: !!match, duplicateOf })
  }

  // ── Sidebar: IntersectionObserver para seção ativa
  const sectionRefs  = useRef<Record<string, HTMLElement | null>>({})
  const [activeSection, setActiveSection] = useState(isEditMode ? 'sec-link' : 'sec-document')

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

  // ── Submit
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setGlobalError(null)
    setFieldErrors({})

    // Responsável=cliente gera cobrança automaticamente — precisa de vencimento
    // e de cliente identificado (via locação). O <select required>/<input required>
    // já barra o vencimento no navegador; checagem aqui é reforço + cobre o cliente,
    // que não tem como virar "required" nativo (é derivado da locação escolhida).
    if (form.responsible === 'customer') {
      if (!form.due_date) {
        setGlobalError('Data de vencimento é obrigatória quando o responsável é o cliente.')
        return
      }
      if (!form.customer_id) {
        setGlobalError('Selecione a locação (em Vínculo) para identificar o cliente antes de continuar — sem isso a cobrança não pode ser gerada.')
        return
      }
    }

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
        infraction_location:  form.infraction_location || null,
        points:               form.points ? parseInt(form.points, 10) : null,
        // PRD 0013 — campos oficiais da NA
        renainf_number:                 form.renainf_number || null,
        notification_date:              form.notification_date || null,
        prior_defense_deadline:         form.prior_defense_deadline || null,
        driver_identification_deadline: form.driver_identification_deadline || null,
        senatran_infraction_code:       form.senatran_infraction_code || null,
        senatran_infraction_subcode:    form.senatran_infraction_subcode || null,
        issuing_agency_name:            form.issuing_agency_name || null,
        issuing_agency_code:            form.issuing_agency_code || null,
        competent_agency_code:          form.competent_agency_code || null,
        competent_agency_name:          form.competent_agency_name || null,
        driver_name:                    form.driver_name || null,
        driver_cnh:                     form.driver_cnh || null,
        driver_cpf:                     form.driver_cpf || null,
        driver_document:                form.driver_document || null,
        infraction_time:                form.infraction_time || null,
        measurement_instrument_id:      form.measurement_instrument_id || null,
        traffic_agent_id:               form.traffic_agent_id || null,
        measured_speed:                 form.measured_speed ? parseFloat(form.measured_speed) : null,
        considered_speed:               form.considered_speed ? parseFloat(form.considered_speed) : null,
        speed_limit:                    form.speed_limit ? parseFloat(form.speed_limit) : null,
        infraction_municipality_code:   form.infraction_municipality_code || null,
        infraction_municipality_name:   form.infraction_municipality_name || null,
        infraction_state:               form.infraction_state || null,
        senatran_message:               form.senatran_message || null,
        // PRD 0013 — campos oficiais da NP
        appeal_deadline:                form.appeal_deadline || null,
        discounted_payment_deadline:    form.discounted_payment_deadline || null,
        original_renainf_number:        form.original_renainf_number || null,
      }

      const result = isEditMode
        ? await updateFine(fineId!, payload, selectedRentalId || null)
        : await createFine(payload, selectedRentalId || null)

      if ('error' in result) {
        setGlobalError(
          'code' in result && result.code === 'DUPLICATE_FINE'
            ? `Já existe uma multa cadastrada com este RENAINF/AIT. Acesse /multas/${result.existingFineId} para anexar o documento lá.`
            : result.error || 'Erro ao salvar. Verifique os dados e tente novamente.',
        )
        return
      }

      // RF-010/CA-011 — reaproveita o arquivo já obtido na extração, sem pedir de novo.
      // NP não tem slot na criação — é anexada na tela de detalhe (§Anexos).
      if (!isEditMode && pendingFineNoticeFile && result.data) {
        const naOk = await uploadStagedAttachment(result.data.id, pendingFineNoticeFile, 'ait')
        if (!naOk) {
          // Multa já foi salva (sem risco de duplicar) — manda pro detalhe, onde
          // FineAttachments permite reenviar o anexo manualmente.
          router.push(`/multas/${result.data.id}`)
          return
        }
      }

      router.push('/multas')
    })
  }

  async function uploadStagedAttachment(fineId: string, file: File, type: 'ait' | 'nip'): Promise<boolean> {
    const tenantId = getTenantId()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
    const path = `${tenantId}/${fineId}/${type}/${Date.now()}.${ext}`
    const { error: uploadErr } = await supabase.storage
      .from('fine-documents')
      .upload(path, file, { contentType: file.type })

    if (uploadErr) return false
    await addFineAttachment(fineId, type, path)
    return true
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
            {NAV_ITEMS.filter((item) => isEditMode ? item.id !== 'sec-document' : true).map((item) => {
              const isActive = activeSection === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollTo(item.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
                    isActive
                      ? 'bg-surface-2 text-fg'
                      : 'text-fg-mute hover:text-fg-mute hover:bg-divider'
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

          {/* ══ Preencher com IA (extração da notificação) ═══════════════════ */}
          {!isEditMode && (
            <div
              id="sec-document"
              ref={(el) => { sectionRefs.current['sec-document'] = el }}
            >
              <DocumentImportCard
                icon={Sparkles}
                badge="IA"
                title="Preencher com IA (NA)"
                description="Anexe a Notificação de Autuação (NA) para preencher automaticamente. Opcional — dá pra preencher tudo manualmente também."
                accept="application/pdf,image/jpeg,image/png,image/webp"
                processingMessages={['Lendo o documento…', 'Identificando os campos…', 'Conferindo os dados…']}
                status={fineExtraction.status}
                message={
                  fineExtraction.status === 'error'
                    ? fineExtraction.message
                    : fineExtraction.status === 'success'
                      ? `${fineExtraction.fieldsFound} de ${fineExtraction.fieldsTotal} campos identificados.` +
                        (fineExtraction.plateMatched
                          ? ' Veículo pré-selecionado — escolha a locação em Vínculo.'
                          : ' Placa não encontrada.')
                      : undefined
                }
                fileName={pendingFineNoticeFile?.name}
                onSelect={(f) => void runFineNoticeExtraction(f)}
                onRetry={() => { if (pendingFineNoticeFile) void runFineNoticeExtraction(pendingFineNoticeFile) }}
                onDismissError={() => setFineExtraction({ status: 'idle' })}
                onClear={() => { setPendingFineNoticeFile(null); setFineExtraction({ status: 'idle' }) }}
              />

              {/* RF-007 — aviso antecipado de duplicidade, antes mesmo de salvar */}
              {fineExtraction.status === 'success' && fineExtraction.duplicateOf && (
                <div className="mt-3 flex items-start gap-3 px-4 py-3 bg-warning-bg border border-warning rounded-xl">
                  <AlertCircle className="w-4 h-4 text-warning flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] text-warning">
                    Já existe uma multa cadastrada com este RENAINF/AIT ({fineExtraction.duplicateOf.description}
                    {' — '}{formatCurrency(fineExtraction.duplicateOf.amount)}).{' '}
                    <Link href={`/multas/${fineExtraction.duplicateOf.id}`} className="underline font-medium">
                      Ver multa existente →
                    </Link>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ══ Vínculo ═══════════════════════════════════════════════════════ */}
          <section
            id="sec-link"
            ref={(el) => { sectionRefs.current['sec-link'] = el }}
          >
            <SectionHeader title="Vínculo" hint="veículo e cliente envolvidos" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">

                {/* Placa — obrigatória */}
                <Field label="Placa *" error={fieldErrors.vehicle_id}>
                  <select
                    className={fieldErrors.vehicle_id ? inputErrCls : inputCls}
                    value={form.vehicle_id}
                    required
                    onChange={(e) => {
                      const vid = e.target.value
                      setSelectedRentalId('')
                      setForm((prev) => ({ ...prev, vehicle_id: vid, customer_id: '' }))
                    }}
                  >
                    <option value="">Selecione a placa</option>
                    {vehicles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.license_plate} — {m.make} {m.model}
                      </option>
                    ))}
                  </select>
                </Field>

                {/* Locação — habilita depois da placa; lista ativas e históricas dessa moto */}
                <Field label="Locação">
                  <select
                    className={inputCls}
                    value={selectedRentalId}
                    disabled={!form.vehicle_id}
                    onChange={(e) => {
                      const rid = e.target.value
                      setSelectedRentalId(rid)
                      const rental = vehicleRentals.find((r) => r.id === rid)
                      setForm((prev) => ({ ...prev, customer_id: rental?.customer_id ?? '' }))
                    }}
                  >
                    <option value="">
                      {!form.vehicle_id
                        ? 'Selecione a placa primeiro'
                        : vehicleRentals.length === 0
                          ? 'Nenhuma locação para esta moto'
                          : 'Sem cliente vinculado'}
                    </option>
                    {vehicleRentals.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.customer?.name ?? 'Cliente'} — {r.start_date ? formatDate(r.start_date) : '—'}
                        {r.status === 'active' ? ' (ativa)' : r.end_date ? ` a ${formatDate(r.end_date)}` : ''}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Cliente — nunca selecionado direto, só derivado da locação escolhida acima */}
              <Field label="Cliente">
                <div className="h-9 px-3 rounded-lg bg-surface-2 border border-border flex items-center text-[13px] text-fg-mute">
                  {vehicleRentals.find((r) => r.id === selectedRentalId)?.customer?.name ?? 'Selecione uma locação'}
                </div>
              </Field>

              {form.vehicle_id && !form.customer_id && (
                <p className="text-[12px] text-fg-mute">
                  Cliente pode ser vinculado após identificação do condutor. A moto já é suficiente para registrar a multa.
                </p>
              )}

              {/* Condutor já identificado no documento (NA/NP) — RF-003 */}
              <div className="pt-2 border-t border-border">
                <p className="text-[12px] text-fg-mute mb-3">
                  Condutor identificado no documento <span className="text-fg-mute">(opcional — preenchido quando a NA/NP já traz nome/CNH/CPF)</span>
                </p>
                <div className="grid grid-cols-4 gap-4">
                  <Field label="Nome do condutor" aiFilled={aiFilledFields.has('driver_name')}>
                    <input
                      className={inputCls}
                      value={form.driver_name}
                      onChange={(e) => set('driver_name', e.target.value)}
                      maxLength={200}
                    />
                  </Field>
                  <Field label="CNH" aiFilled={aiFilledFields.has('driver_cnh')}>
                    <input
                      className={inputCls}
                      value={form.driver_cnh}
                      onChange={(e) => set('driver_cnh', e.target.value)}
                      maxLength={20}
                    />
                  </Field>
                  <Field label="CPF" aiFilled={aiFilledFields.has('driver_cpf')}>
                    <input
                      className={inputCls}
                      value={form.driver_cpf}
                      onChange={(e) => set('driver_cpf', e.target.value)}
                      maxLength={20}
                    />
                  </Field>
                  <Field label="Outro documento" aiFilled={aiFilledFields.has('driver_document')}>
                    <input
                      className={inputCls}
                      value={form.driver_document}
                      onChange={(e) => set('driver_document', e.target.value)}
                      maxLength={30}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </section>

          {/* ══ Infração ══════════════════════════════════════════════════════ */}
          <section
            id="sec-infraction"
            ref={(el) => { sectionRefs.current['sec-infraction'] = el }}
          >
            <SectionHeader title="Infração" />
            <div className="space-y-4">

              <Field label="Descrição da infração *" error={fieldErrors.description} aiFilled={aiFilledFields.has('description')}>
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
                <Field label="Código SENATRAN" aiFilled={aiFilledFields.has('senatran_infraction_code')}>
                  <input
                    className={inputCls}
                    placeholder="Ex.: 7455"
                    value={form.senatran_infraction_code}
                    onChange={(e) => set('senatran_infraction_code', e.target.value)}
                    maxLength={20}
                  />
                </Field>
                <Field label="Desdobramento" aiFilled={aiFilledFields.has('senatran_infraction_subcode')}>
                  <input
                    className={inputCls}
                    placeholder="Ex.: 0"
                    value={form.senatran_infraction_subcode}
                    onChange={(e) => set('senatran_infraction_subcode', e.target.value)}
                    maxLength={10}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Órgão autuador" aiFilled={aiFilledFields.has('issuing_agency_name')}>
                  <input
                    className={inputCls}
                    placeholder="Ex.: PREF. DE RJ RIO DE JANEIRO"
                    value={form.issuing_agency_name}
                    onChange={(e) => set('issuing_agency_name', e.target.value)}
                    maxLength={200}
                  />
                </Field>
                <Field label="Código do órgão" aiFilled={aiFilledFields.has('issuing_agency_code')}>
                  <input
                    className={inputCls}
                    placeholder="Ex.: 260010"
                    value={form.issuing_agency_code}
                    onChange={(e) => set('issuing_agency_code', e.target.value)}
                    maxLength={20}
                  />
                </Field>
              </div>

              <div className="pt-2 border-t border-border">
                <p className="text-[12px] text-fg-mute mb-3">
                  Órgão competente <span className="text-fg-mute">(opcional — costuma ser igual ao órgão autuador)</span>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nome do órgão competente" aiFilled={aiFilledFields.has('competent_agency_name')}>
                    <input
                      className={inputCls}
                      value={form.competent_agency_name}
                      onChange={(e) => set('competent_agency_name', e.target.value)}
                      maxLength={200}
                    />
                  </Field>
                  <Field label="Código do órgão competente" aiFilled={aiFilledFields.has('competent_agency_code')}>
                    <input
                      className={inputCls}
                      value={form.competent_agency_code}
                      onChange={(e) => set('competent_agency_code', e.target.value)}
                      maxLength={20}
                    />
                  </Field>
                </div>
              </div>

              <Field label="Local da infração" aiFilled={aiFilledFields.has('infraction_location')}>
                <input
                  className={inputCls}
                  placeholder="Ex.: Av. Paulista, 1234 — São Paulo / SP"
                  value={form.infraction_location}
                  onChange={(e) => set('infraction_location', e.target.value)}
                  maxLength={2000}
                />
              </Field>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Código do município" aiFilled={aiFilledFields.has('infraction_municipality_code')}>
                  <input
                    className={inputCls}
                    value={form.infraction_municipality_code}
                    onChange={(e) => set('infraction_municipality_code', e.target.value)}
                    maxLength={10}
                  />
                </Field>
                <Field label="Município" aiFilled={aiFilledFields.has('infraction_municipality_name')}>
                  <input
                    className={inputCls}
                    value={form.infraction_municipality_name}
                    onChange={(e) => set('infraction_municipality_name', e.target.value)}
                    maxLength={100}
                  />
                </Field>
                <Field label="UF" aiFilled={aiFilledFields.has('infraction_state')}>
                  <input
                    className={inputCls}
                    placeholder="Ex.: RJ"
                    value={form.infraction_state}
                    onChange={(e) => set('infraction_state', e.target.value.toUpperCase())}
                    maxLength={2}
                  />
                </Field>
              </div>

              <div className="pt-2 border-t border-border">
                <p className="text-[12px] text-fg-mute mb-3">
                  Equipamento e agente <span className="text-fg-mute">(opcional — rastreabilidade pra recurso)</span>
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Nº do equipamento/instrumento" aiFilled={aiFilledFields.has('measurement_instrument_id')}>
                    <input
                      className={inputCls}
                      value={form.measurement_instrument_id}
                      onChange={(e) => set('measurement_instrument_id', e.target.value)}
                      maxLength={50}
                    />
                  </Field>
                  <Field label="Matrícula do agente" aiFilled={aiFilledFields.has('traffic_agent_id')}>
                    <input
                      className={inputCls}
                      value={form.traffic_agent_id}
                      onChange={(e) => set('traffic_agent_id', e.target.value)}
                      maxLength={50}
                    />
                  </Field>
                </div>
              </div>

              <div className="pt-2 border-t border-border">
                <p className="text-[12px] text-fg-mute mb-3">
                  Velocidade <span className="text-fg-mute">(opcional — só se aplica a infrações de excesso de velocidade)</span>
                </p>
                <div className="grid grid-cols-3 gap-4">
                  <Field label="Medição realizada (km/h)" aiFilled={aiFilledFields.has('measured_speed')}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={inputCls}
                      value={form.measured_speed}
                      onChange={(e) => set('measured_speed', e.target.value)}
                    />
                  </Field>
                  <Field label="Valor considerado (km/h)" aiFilled={aiFilledFields.has('considered_speed')}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={inputCls}
                      value={form.considered_speed}
                      onChange={(e) => set('considered_speed', e.target.value)}
                    />
                  </Field>
                  <Field label="Limite regulamentado (km/h)" aiFilled={aiFilledFields.has('speed_limit')}>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className={inputCls}
                      value={form.speed_limit}
                      onChange={(e) => set('speed_limit', e.target.value)}
                    />
                  </Field>
                </div>
              </div>
            </div>
          </section>

          {/* ══ Datas e Valores ═══════════════════════════════════════════════ */}
          <section
            id="sec-values"
            ref={(el) => { sectionRefs.current['sec-values'] = el }}
          >
            <SectionHeader title="Datas e Valores" />
            <div className="space-y-4">

              <div className="grid grid-cols-3 gap-4">
                <Field label="Data da infração *" error={fieldErrors.infraction_date} aiFilled={aiFilledFields.has('infraction_date')}>
                  <input
                    type="date"
                    className={fieldErrors.infraction_date ? inputErrCls : inputCls}
                    value={form.infraction_date}
                    onChange={(e) => set('infraction_date', e.target.value)}
                    required
                  />
                </Field>
                <Field label="Hora da infração" aiFilled={aiFilledFields.has('infraction_time')}>
                  <input
                    type="time"
                    className={inputCls}
                    value={form.infraction_time}
                    onChange={(e) => set('infraction_time', e.target.value)}
                  />
                </Field>
                <Field
                  label={form.responsible === 'customer' ? 'Data de vencimento *' : 'Data de vencimento'}
                  error={fieldErrors.due_date}
                >
                  <input
                    type="date"
                    className={fieldErrors.due_date ? inputErrCls : inputCls}
                    value={form.due_date}
                    required={form.responsible === 'customer'}
                    onChange={(e) => set('due_date', e.target.value)}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Valor (R$) *" error={fieldErrors.amount} aiFilled={aiFilledFields.has('amount')}>
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
                <Field label="Responsável pelo pagamento *" error={fieldErrors.responsible}>
                  <select
                    className={fieldErrors.responsible ? inputErrCls : inputCls}
                    value={form.responsible}
                    required
                    onChange={(e) => set('responsible', e.target.value)}
                  >
                    <option value="">Selecione...</option>
                    {RESPONSIBLE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </Field>
              </div>

              {form.responsible === 'customer' && (
                <p className="text-[12px] text-fg-mute">
                  Ao salvar, o sistema gera automaticamente uma cobrança pro cliente com o valor e o vencimento acima — acompanhe em Cobranças.
                </p>
              )}

              <Field label="Nº do AIT" className="max-w-xs" aiFilled={aiFilledFields.has('ait_number')}>
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

          {/* ══ Prazos (NA/NP) ═══════════════════════════════════════════════ */}
          <section
            id="sec-deadlines"
            ref={(el) => { sectionRefs.current['sec-deadlines'] = el }}
          >
            <SectionHeader title="Prazos (NA/NP)" hint="RENAINF e prazos legais dos dois documentos oficiais" />
            <div className="space-y-4">

              <div className="grid grid-cols-2 gap-4">
                <Field label="Número RENAINF" aiFilled={aiFilledFields.has('renainf_number')}>
                  <input
                    className={inputCls}
                    placeholder="Ex.: 10581781538"
                    value={form.renainf_number}
                    onChange={(e) => set('renainf_number', e.target.value)}
                    maxLength={30}
                  />
                </Field>
                <Field label="RENAINF da multa original" aiFilled={aiFilledFields.has('original_renainf_number')}>
                  <input
                    className={inputCls}
                    placeholder="Se esta notificação for uma reemissão"
                    value={form.original_renainf_number}
                    onChange={(e) => set('original_renainf_number', e.target.value)}
                    maxLength={30}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <Field label="Data da notificação" aiFilled={aiFilledFields.has('notification_date')}>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.notification_date}
                    onChange={(e) => set('notification_date', e.target.value)}
                  />
                </Field>
                <Field label="Prazo — defesa prévia" aiFilled={aiFilledFields.has('prior_defense_deadline')}>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.prior_defense_deadline}
                    onChange={(e) => set('prior_defense_deadline', e.target.value)}
                  />
                </Field>
                <Field label="Prazo — identificação de condutor" aiFilled={aiFilledFields.has('driver_identification_deadline')}>
                  <input
                    type="date"
                    className={inputCls}
                    value={form.driver_identification_deadline}
                    onChange={(e) => set('driver_identification_deadline', e.target.value)}
                  />
                </Field>
              </div>

              <p className="text-[12px] text-fg-mute pt-2 border-t border-border">
                Os dois campos abaixo vêm da Notificação de Penalidade (NP), que costuma chegar semanas depois — preencha quando ela for anexada.
              </p>

              <div className="grid grid-cols-2 gap-4">
                <Field label="Prazo — recurso">
                  <input
                    type="date"
                    className={inputCls}
                    value={form.appeal_deadline}
                    onChange={(e) => set('appeal_deadline', e.target.value)}
                  />
                </Field>
                <Field label="Vencimento com desconto">
                  <input
                    type="date"
                    className={inputCls}
                    value={form.discounted_payment_deadline}
                    onChange={(e) => set('discounted_payment_deadline', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </section>

          {/* ══ Observações ═══════════════════════════════════════════════════ */}
          <section
            id="sec-observations"
            ref={(el) => { sectionRefs.current['sec-observations'] = el }}
          >
            <SectionHeader title="Observações" hint="opcional" />
            <div className="space-y-4">

              <p className="text-[12px] text-fg-mute">
                Boleto, comprovante e demais documentos são anexados na seção de Documentos da tela de detalhe da multa{isEditMode ? '' : ', depois de salvar'}.
              </p>

              <Field label="Observações livres">
                <textarea
                  className={`${inputCls} h-24 py-2 resize-none`}
                  placeholder="Recurso em andamento, detalhes adicionais, número do processo..."
                  value={form.observations}
                  onChange={(e) => set('observations', e.target.value)}
                  maxLength={2000}
                />
              </Field>

              <Field label="Mensagem SENATRAN" className="pt-2 border-t border-border" aiFilled={aiFilledFields.has('senatran_message')}>
                <textarea
                  className={`${inputCls} h-20 py-2 resize-none`}
                  placeholder="Aviso especial do órgão, quando presente na notificação"
                  value={form.senatran_message}
                  onChange={(e) => set('senatran_message', e.target.value)}
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
