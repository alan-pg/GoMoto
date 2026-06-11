'use client'

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Upload, Eye, Search, FileEdit, FileDown,
  CheckCircle, Trash2, User, Bike, FileText,
  Settings2, AlertTriangle, XCircle, ChevronLeft,
  Building2, UserRound, Clock, CalendarDays,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { StatusBadge } from '@/components/ui/Badge'
import { Header } from '@/components/layout/Header'
import { Modal } from '@/components/ui/Modal'
import type { Contract, Customer, Motorcycle } from '@/types'

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface ContractRow extends Omit<Contract, 'customer' | 'motorcycle'> {
  customer: Pick<Customer, 'id' | 'name' | 'phone' | 'cpf' | 'rg' | 'state' | 'drivers_license' | 'drivers_license_category' | 'address' | 'zip_code'> | null
  motorcycle: Pick<Motorcycle, 'id' | 'model' | 'make' | 'license_plate' | 'km_current' | 'year_manufacture' | 'year_model' | 'renavam' | 'chassis' | 'color' | 'fuel'> | null
}

interface ContractTemplate {
  id?: string
  slug: string
  name: string
  description: string
  file_url: string | null
  updated_at: string | null
}

type TerminateStep = 'choice' | 'client' | 'company'

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATES: ContractTemplate[] = [
  { slug: 'rental', name: 'Contrato de Locação', description: 'Padrão semanal sem fidelidade', file_url: null, updated_at: null },
  { slug: 'loyalty', name: 'Com Fidelidade', description: 'Com permanência mínima', file_url: null, updated_at: null },
]

const SUPPORTED_VARIABLES = [
  // — Identificação do cliente (ordem do contrato) —
  { tag: '{{nome_cliente}}',    desc: 'Nome completo' },
  { tag: '{{rg_cliente}}',     desc: 'RG + órgão (ex: 12488178 DETRAN RJ)' },
  { tag: '{{cpf_cliente}}',    desc: 'CPF' },
  { tag: '{{cnh_cliente}}',    desc: 'Número da habilitação' },
  { tag: '{{categoria_cnh}}',  desc: 'Categoria CNH (ex: AB)' },
  { tag: '{{endereco_cliente}}', desc: 'Endereço completo' },
  { tag: '{{cep_cliente}}',    desc: 'CEP' },
  // — Dados da motocicleta —
  { tag: '{{marca_moto}}',          desc: 'Marca (ex: HONDA)' },
  { tag: '{{modelo_moto}}',         desc: 'Marca + Modelo (ex: HONDA CG 160 START)' },
  { tag: '{{ano_fabricacao_moto}}', desc: 'Ano de fabricação (ex: 2024)' },
  { tag: '{{ano_modelo_moto}}',     desc: 'Ano do modelo (ex: 2025)' },
  { tag: '{{ano_fab_mod_moto}}',    desc: 'Fabricação/Modelo combinado (ex: 2024/2025)' },
  { tag: '{{renavam_moto}}',        desc: 'RENAVAM' },
  { tag: '{{placa_moto}}',          desc: 'Placa' },
  { tag: '{{chassi_moto}}',         desc: 'Chassi' },
  { tag: '{{cor_moto}}',            desc: 'Cor' },
  { tag: '{{combustivel_moto}}',    desc: 'Combustível' },
  { tag: '{{km_inicial}}',          desc: 'KM no início do contrato' },
  // — Condições financeiras e datas —
  { tag: '{{valor_semanal}}',  desc: 'Valor semanal (ex: 350,00)' },
  { tag: '{{data_inicio}}',    desc: 'Data início por extenso' },
  { tag: '{{data_hoje}}',      desc: 'Data atual por extenso' },
]

type StatusFilter = 'all' | 'active' | 'closed' | 'cancelled' | 'broken'

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'Todos' },
  { key: 'active', label: 'Ativos' },
  { key: 'closed', label: 'Encerrados' },
  { key: 'cancelled', label: 'Cancelados' },
  { key: 'broken', label: 'Rescindidos' },
]

const FINE_AMOUNT = 1000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR')
}

function fmtLong(dateStr: string | null | undefined) {
  if (!dateStr) return '—'
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long', year: 'numeric',
  })
}

function numberToWords(value: number): string {
  const int = Math.floor(value)
  const UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove']
  const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa']
  const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
    'seiscentos', 'setecentos', 'oitocentos', 'novecentos']

  function below1000(n: number): string {
    if (n === 0) return ''
    if (n < 20) return UNITS[n]
    if (n < 100) {
      const u = n % 10
      return u === 0 ? TENS[Math.floor(n / 10)] : `${TENS[Math.floor(n / 10)]} e ${UNITS[u]}`
    }
    const h = Math.floor(n / 100)
    const rest = n % 100
    const hWord = n === 100 ? 'cem' : HUNDREDS[h]
    return rest === 0 ? hWord : `${hWord} e ${below1000(rest)}`
  }

  if (int === 0) return 'zero reais'
  if (int < 1000) return `${below1000(int)} reais`
  const thousands = Math.floor(int / 1000)
  const rest = int % 1000
  const kWord = thousands === 1 ? 'mil' : `${below1000(thousands)} mil`
  return rest === 0 ? `${kWord} reais` : `${kWord} e ${below1000(rest)} reais`
}

function fmtBRL(value: number | null | undefined) {
  if (value == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

function addYears(date: Date, years: number): Date {
  const d = new Date(date)
  d.setFullYear(d.getFullYear() + years)
  return d
}

function timeRemaining(to: Date): string {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const diff = to.getTime() - now.getTime()
  if (diff <= 0) return 'Prazo encerrado'
  const days = Math.floor(diff / 86400000)
  const months = Math.floor(days / 30)
  const years = Math.floor(months / 12)
  if (years > 0) {
    const rem = months - years * 12
    return rem > 0
      ? `${years} ano${years > 1 ? 's' : ''} e ${rem} mês${rem > 1 ? 'es' : ''}`
      : `${years} ano${years > 1 ? 's' : ''}`
  }
  if (months > 0) return `${months} mês${months > 1 ? 'es' : ''}`
  return `${days} dia${days > 1 ? 's' : ''}`
}

function getVigencia(contract: ContractRow) {
  if (contract.status !== 'active') return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = new Date(contract.start_date + 'T00:00:00')
  const type = contract.contract_type ?? 'rental'
  const minEnd = type === 'loyalty' ? addYears(start, 2) : addMonths(start, 3)
  const contractEnd = contract.end_date ? new Date(contract.end_date + 'T00:00:00') : null

  if (contractEnd && today > contractEnd) {
    return { level: 'red' as const, label: 'Vencido', detail: 'Este contrato passou da data de encerramento prevista.' }
  }
  if (today < minEnd) {
    return {
      level: 'orange' as const,
      label: 'Dentro da vigência mínima',
      detail: `${timeRemaining(minEnd)} restantes. Encerramento antecipado gera multa de ${fmtBRL(FINE_AMOUNT)}.`,
    }
  }
  return {
    level: 'green' as const,
    label: 'Vigência mínima cumprida',
    detail: contractEnd ? `Previsto para encerrar em ${fmt(contract.end_date)}.` : 'Sem data de encerramento definida.',
  }
}

function expectedEndDate(contract: ContractRow): string {
  const type = contract.contract_type ?? 'rental'
  const start = new Date(contract.start_date + 'T00:00:00')
  if (type === 'loyalty') return fmt(addYears(start, 2).toISOString().split('T')[0])
  return contract.end_date ? fmt(contract.end_date) : '—'
}

const supabase = createClient()

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export default function ContratosPage() {
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [templates, setTemplates] = useState<ContractTemplate[]>(DEFAULT_TEMPLATES)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  const [uploadingContract, setUploadingContract] = useState<string | null>(null)
  const [activeContractId, setActiveContractId] = useState<string | null>(null)
  const contractFileRef = useRef<HTMLInputElement>(null)

  const [uploading, setUploading] = useState<string | null>(null)
  const [activeSlug, setActiveSlug] = useState<string | null>(null)
  const templateFileRef = useRef<HTMLInputElement>(null)

  const [downloading, setDownloading] = useState<string | null>(null)
  const [templatesModal, setTemplatesModal] = useState(false)

  // Modal de detalhes
  const [selectedContract, setSelectedContract] = useState<ContractRow | null>(null)
  const [terminateStep, setTerminateStep] = useState<TerminateStep | null>(null)
  const [terminateReason, setTerminateReason] = useState('')
  const [terminating, setTerminating] = useState(false)

  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)

  const showToast = useCallback((type: 'success' | 'error', msg: string) => {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 3500)
  }, [])

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchContracts = useCallback(async () => {
    const { data } = await supabase
      .from('contracts')
      .select('*, customer:customers(id, name, phone, cpf, rg, state, drivers_license, drivers_license_category, address, zip_code), motorcycle:motorcycles(id, model, make, license_plate, km_current, year_manufacture, year_model, renavam, chassis, color, fuel)')
      .order('created_at', { ascending: false })
    if (data) setContracts(data as ContractRow[])
    setLoading(false)
  }, [])

  const fetchTemplates = useCallback(async () => {
    const { data } = await supabase.from('contract_templates').select('*')
    if (data?.length) {
      setTemplates(prev => prev.map(t => {
        const db = data.find((d: { slug: string }) => d.slug === t.slug)
        return db ? { ...t, ...db } : t
      }))
    }
  }, [])

  useEffect(() => {
    fetchContracts()
    fetchTemplates()
  }, [fetchContracts, fetchTemplates])

  const filtered = useMemo(() => {
    let rows = contracts
    if (filter !== 'all') rows = rows.filter(c => c.status === filter)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(c =>
        c.customer?.name?.toLowerCase().includes(q) ||
        c.motorcycle?.license_plate?.toLowerCase().includes(q) ||
        c.motorcycle?.model?.toLowerCase().includes(q)
      )
    }
    return rows
  }, [contracts, filter, search])

  // ---------------------------------------------------------------------------
  // Upload contrato assinado
  // ---------------------------------------------------------------------------

  const handleContractFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeContractId) return
    setUploadingContract(activeContractId)
    try {
      const ext = file.name.split('.').pop() ?? 'pdf'
      const path = `signed/${activeContractId}.${ext}`
      const { error: upErr } = await supabase.storage.from('contract-templates').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('contract-templates').getPublicUrl(path)
      const { error: dbErr } = await supabase.from('contracts').update({ pdf_url: urlData.publicUrl }).eq('id', activeContractId)
      if (dbErr) throw dbErr
      showToast('success', 'Contrato assinado enviado!')
      setSelectedContract(prev => prev?.id === activeContractId ? { ...prev, pdf_url: urlData.publicUrl } : prev)
      fetchContracts()
    } catch { showToast('error', 'Falha no upload do contrato') }
    finally {
      setUploadingContract(null); setActiveContractId(null)
      if (contractFileRef.current) contractFileRef.current.value = ''
    }
  }

  // ---------------------------------------------------------------------------
  // Upload template
  // ---------------------------------------------------------------------------

  const handleTemplateFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !activeSlug) return
    if (!file.name.endsWith('.docx')) { showToast('error', 'Apenas .docx são permitidos'); return }
    setUploading(activeSlug)
    try {
      const path = `models/${activeSlug}_template.docx`
      const { error: upErr } = await supabase.storage.from('contract-templates').upload(path, file, { upsert: true })
      if (upErr) throw upErr
      const { data: urlData } = supabase.storage.from('contract-templates').getPublicUrl(path)
      const tpl = templates.find(t => t.slug === activeSlug)
      const { error: dbErr } = await supabase.from('contract_templates').upsert({
        slug: activeSlug, name: tpl?.name, description: tpl?.description,
        file_url: urlData.publicUrl, updated_at: new Date().toISOString(),
      }, { onConflict: 'slug' })
      if (dbErr) throw dbErr
      showToast('success', 'Modelo atualizado!')
      fetchTemplates()
    } catch { showToast('error', 'Falha no upload do modelo') }
    finally {
      setUploading(null); setActiveSlug(null)
      if (templateFileRef.current) templateFileRef.current.value = ''
    }
  }

  const handleRemoveTemplate = async (slug: string) => {
    if (!confirm('Remover este modelo?')) return
    await supabase.from('contract_templates').update({ file_url: null, updated_at: null }).eq('slug', slug)
    showToast('success', 'Modelo removido')
    fetchTemplates()
  }

  // ---------------------------------------------------------------------------
  // Download contrato preenchido
  // ---------------------------------------------------------------------------

  const handleDownloadFilled = useCallback(async (contract: ContractRow, templateSlug: string) => {
    const template = templates.find(t => t.slug === templateSlug)
    if (!template?.file_url) { showToast('error', 'Configure um modelo .docx primeiro'); return }
    setDownloading(contract.id + templateSlug)
    try {
      const res = await fetch(template.file_url)
      if (!res.ok) throw new Error(`Falha ao buscar template: ${res.status} ${res.statusText}`)
      const arrayBuffer = await res.arrayBuffer()
      const PizZip = (await import('pizzip')).default
      const Docxtemplater = (await import('docxtemplater')).default
      const zip = new PizZip(arrayBuffer)

      // Word splits {{tag}} across multiple XML runs — fix before docxtemplater processes
      const xmlFiles = Object.keys(zip.files).filter(
        n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n)
      )
      for (const fname of xmlFiles) {
        let xml = (zip.files[fname] as { asText: () => string }).asText()
        let prev = ''
        while (prev !== xml) {
          prev = xml
          const boundary = '(<\\/w:t><\\/w:r>(?:<w:bookmarkStart[^>]*\\/>)*(?:<w:bookmarkEnd[^>]*\\/>)*<w:r>(?:<w:rPr>[\\s\\S]*?<\\/w:rPr>)?<w:t(?:[^>]*)>)'
          xml = xml.replace(new RegExp(`\\{${boundary}\\{`, 'g'), '{{$1')
          xml = xml.replace(new RegExp(`\\}${boundary}\\}`, 'g'), '}}$1')
        }
        zip.file(fname, xml)
      }

      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        nullGetter: () => '',
        delimiters: { start: '{{', end: '}}' },
      })
      const c = contract.customer
      const m = contract.motorcycle
      const ano_fabricacao = m?.year_manufacture?.trim() ?? ''
      const ano_modelo = m?.year_model?.trim() ?? ano_fabricacao
      const rg_cliente = [c?.rg, c?.state ? `DETRAN ${c.state}` : ''].filter(Boolean).join(' ')
      doc.render({
        data_hoje: new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }),
        data_inicio: fmtLong(contract.start_date),
        nome_cliente: c?.name ?? '',
        cpf_cliente: c?.cpf ?? '',
        rg_cliente,
        cnh_cliente: c?.drivers_license ?? '',
        categoria_cnh: c?.drivers_license_category ?? '',
        endereco_cliente: c?.address ?? '',
        cep_cliente: c?.zip_code ?? '',
        placa_moto: m?.license_plate ?? '',
        marca_moto: m?.make ?? '',
        modelo_moto: m ? `${m.make} ${m.model}` : '',
        ano_fabricacao_moto: ano_fabricacao,
        ano_modelo_moto: ano_modelo,
        ano_fab_mod_moto: ano_modelo ? `${ano_fabricacao}/${ano_modelo}` : ano_fabricacao,
        renavam_moto: m?.renavam ?? '',
        chassi_moto: m?.chassis ?? '',
        cor_moto: m?.color ?? '',
        combustivel_moto: m?.fuel ?? '',
        km_inicial: String(m?.km_current ?? ''),
        valor_semanal: (() => {
          const v = contract.monthly_amount ?? 0
          const num = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(v)
          return `${num} (${numberToWords(v)})`
        })(),
      })
      const blob = doc.getZip().generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `contrato_${(contract.customer?.name ?? 'cliente').replace(/\s+/g, '_')}_${templateSlug}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('[download contrato]', err)
      const msg = err instanceof Error ? err.message : String(err)
      showToast('error', msg.slice(0, 80) || 'Erro ao gerar contrato preenchido')
    }
    finally { setDownloading(null) }
  }, [templates, showToast])

  // ---------------------------------------------------------------------------
  // Encerrar contrato
  // ---------------------------------------------------------------------------

  const handleTerminateClient = async () => {
    if (!selectedContract) return
    setTerminating(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('contracts').update({ status: 'cancelled', end_date: today }).eq('id', selectedContract.id)
      await supabase.from('fines').insert({
        customer_id: selectedContract.customer_id,
        motorcycle_id: selectedContract.motorcycle_id,
        description: 'Multa por rescisão antecipada de contrato',
        amount: FINE_AMOUNT,
        infraction_date: today,
        due_date: today,
        status: 'pending',
        responsible: 'customer',
      })
      await supabase.from('motorcycles').update({ status: 'available' }).eq('id', selectedContract.motorcycle_id)
      showToast('success', `Contrato encerrado. Multa de ${fmtBRL(FINE_AMOUNT)} gerada.`)
      setSelectedContract(null)
      setTerminateStep(null)
      fetchContracts()
    } catch { showToast('error', 'Erro ao encerrar contrato') }
    finally { setTerminating(false) }
  }

  const handleTerminateCompany = async () => {
    if (!selectedContract || terminateReason.trim().length < 50) return
    setTerminating(true)
    try {
      const today = new Date().toISOString().split('T')[0]
      await supabase.from('contracts').update({
        status: 'cancelled',
        end_date: today,
        observations: terminateReason.trim(),
      }).eq('id', selectedContract.id)
      await supabase.from('motorcycles').update({ status: 'available' }).eq('id', selectedContract.motorcycle_id)
      showToast('success', 'Contrato encerrado pela empresa.')
      setSelectedContract(null)
      setTerminateStep(null)
      setTerminateReason('')
      fetchContracts()
    } catch { showToast('error', 'Erro ao encerrar contrato') }
    finally { setTerminating(false) }
  }

  const closeDetailModal = () => {
    setSelectedContract(null)
    setTerminateStep(null)
    setTerminateReason('')
  }

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const configuredTemplates = templates.filter(t => t.file_url)

  const toastEl = toast ? (
    <div className={`px-4 py-1.5 rounded-full text-[13px] font-medium flex items-center gap-2 animate-in fade-in slide-in-from-right-4 duration-300 ${
      toast.type === 'error' ? 'bg-[#7c1c1c] text-[#ff9c9a]' : 'bg-[#0e2f13] text-[#229731]'
    }`}>
      {toast.type === 'error' ? <XCircle className="w-4 h-4" /> : <CheckCircle className="w-4 h-4" />}
      {toast.msg}
    </div>
  ) : null

  const vigencia = selectedContract ? getVigencia(selectedContract) : null

  // ---------------------------------------------------------------------------
  // JSX
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col min-h-full bg-[#121212]">
      <Header
        title="Contratos"
        actions={
          <div className="flex items-center gap-2">
            {toastEl}
            <Button variant="secondary" size="sm" className="gap-2" onClick={() => setTemplatesModal(true)}>
              <Settings2 className="w-4 h-4" />
              Modelos .docx
            </Button>
          </div>
        }
      />

      <div className="p-6 space-y-5">

        {/* Filtros + Busca */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            {FILTERS.map(f => (
              <button key={f.key} onClick={() => setFilter(f.key)}
                className={`text-[13px] pb-1 transition-colors duration-150 ${
                  filter === f.key ? 'border-b-2 border-[#BAFF1A] text-[#BAFF1A]' : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >{f.label}</button>
            ))}
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#616161]" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cliente ou placa..."
              className="h-9 pl-9 pr-4 bg-[#202020] border border-[#474747] rounded-full text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:ring-1 focus:ring-[#BAFF1A] outline-none w-56"
            />
          </div>
        </div>

        {/* Tabela */}
        <div className="overflow-hidden rounded-xl bg-[#202020]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] text-[#f5f5f5]">
              <thead className="border-b border-[#323232]">
                <tr>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Cliente</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Motocicleta</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Tipo</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Período</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Valor/mês</th>
                  <th className="h-9 px-4 font-medium text-[#9e9e9e]">Status</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={7}><div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" /></div></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={7}>
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <div className="w-12 h-12 bg-[#323232] rounded-full flex items-center justify-center">
                        <FileText className="w-6 h-6 text-[#9e9e9e]" />
                      </div>
                      <p className="text-[13px] text-[#9e9e9e]">Nenhum contrato encontrado.</p>
                      {(filter !== 'all' || search) && (
                        <button onClick={() => { setFilter('all'); setSearch('') }} className="text-[13px] text-[#BAFF1A] hover:underline">Limpar filtros</button>
                      )}
                    </div>
                  </td></tr>
                ) : (
                  filtered.map(contract => {
                    const v = getVigencia(contract)
                    return (
                      <tr key={contract.id}
                        onClick={() => { setSelectedContract(contract); setTerminateStep(null) }}
                        className="h-9 text-[13px] border-b border-[#323232] transition-colors hover:bg-[#323232] cursor-pointer"
                      >
                        <td className="px-4">
                          {contract.customer
                            ? <div className="flex items-center gap-2"><User className="w-4 h-4 text-[#a880ff] flex-shrink-0" /><span className="font-medium text-[#f5f5f5] truncate max-w-[160px]">{contract.customer.name}</span></div>
                            : <span className="text-[#9e9e9e]">—</span>}
                        </td>
                        <td className="px-4">
                          {contract.motorcycle
                            ? <div className="flex items-center gap-2">
                                <Bike className="w-4 h-4 text-[#9e9e9e] flex-shrink-0" />
                                <span className="font-medium text-[#f5f5f5]">{contract.motorcycle.make} {contract.motorcycle.model}</span>
                                <span className="text-[#616161]">•</span>
                                <span className="font-mono font-bold text-[#f5f5f5]">{contract.motorcycle.license_plate}</span>
                              </div>
                            : <span className="text-[#9e9e9e]">—</span>}
                        </td>
                        <td className="px-4">
                          <span className={`text-[12px] font-medium ${contract.contract_type === 'loyalty' ? 'text-[#a880ff]' : 'text-[#9e9e9e]'}`}>
                            {contract.contract_type === 'loyalty' ? 'Fidelidade' : 'Locação'}
                          </span>
                        </td>
                        <td className="px-4">
                          <span className="text-[#c7c7c7]">{fmt(contract.start_date)}</span>
                          <span className="text-[#616161] mx-1">→</span>
                          <span className="text-[#c7c7c7]">{expectedEndDate(contract)}</span>
                        </td>
                        <td className="px-4"><span className="text-[#BAFF1A] font-medium">{fmtBRL(contract.monthly_amount)}</span></td>
                        <td className="px-4">
                          <div className="flex items-center gap-1.5">
                            {v && (
                              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                v.level === 'red' ? 'bg-[#ff9c9a]' : v.level === 'orange' ? 'bg-[#e65e24]' : 'bg-[#229731]'
                              }`} />
                            )}
                            <StatusBadge status={contract.status} />
                          </div>
                        </td>
                        <td className="px-4" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Ver detalhes"
                              onClick={() => { setSelectedContract(contract); setTerminateStep(null) }}>
                              <Eye className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── MODAL: DETALHES DO CONTRATO ─────────────────────────── */}
      <Modal open={!!selectedContract && !terminateStep} onClose={closeDetailModal} size="md">
        {selectedContract && (
          <div className="space-y-5">

            {/* Cabeçalho do contrato */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <User className="w-5 h-5 text-[#a880ff]" />
                <h2 className="text-[18px] font-bold text-[#f5f5f5]">{selectedContract.customer?.name ?? '—'}</h2>
              </div>
              {selectedContract.motorcycle && (
                <div className="flex items-center gap-2 text-[#9e9e9e]">
                  <Bike className="w-4 h-4" />
                  <span className="text-[13px]">{selectedContract.motorcycle.make} {selectedContract.motorcycle.model}</span>
                  <span className="text-[#616161]">•</span>
                  <span className="font-mono font-bold text-[#f5f5f5] text-[13px]">{selectedContract.motorcycle.license_plate}</span>
                </div>
              )}
            </div>

            {/* Tipo */}
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[13px] font-medium ${
              selectedContract.contract_type === 'loyalty'
                ? 'bg-[#2d0363] text-[#a880ff]'
                : 'bg-[#323232] text-[#c7c7c7]'
            }`}>
              <FileText className="w-4 h-4" />
              {selectedContract.contract_type === 'loyalty'
                ? 'Contrato com Fidelidade — Promessa de Compra'
                : 'Contrato de Locação Tradicional'}
            </div>

            {/* Datas + Valor */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarDays className="w-3.5 h-3.5 text-[#9e9e9e]" />
                  <p className="text-[11px] text-[#9e9e9e] font-medium uppercase tracking-wide">Início</p>
                </div>
                <p className="text-[15px] font-bold text-[#f5f5f5]">{fmt(selectedContract.start_date)}</p>
              </div>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <CalendarDays className="w-3.5 h-3.5 text-[#9e9e9e]" />
                  <p className="text-[11px] text-[#9e9e9e] font-medium uppercase tracking-wide">Encerramento</p>
                </div>
                <p className="text-[15px] font-bold text-[#f5f5f5]">{expectedEndDate(selectedContract)}</p>
              </div>
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Clock className="w-3.5 h-3.5 text-[#9e9e9e]" />
                  <p className="text-[11px] text-[#9e9e9e] font-medium uppercase tracking-wide">Valor/mês</p>
                </div>
                <p className="text-[15px] font-bold text-[#BAFF1A]">{fmtBRL(selectedContract.monthly_amount)}</p>
              </div>
            </div>

            {/* Vigência */}
            {vigencia ? (
              <div className={`flex items-start gap-3 rounded-xl p-4 border ${
                vigencia.level === 'red'
                  ? 'bg-[#2a0a0a] border-[#ff9c9a]/30'
                  : vigencia.level === 'orange'
                  ? 'bg-[#2a1500] border-[#e65e24]/30'
                  : 'bg-[#0a1f0a] border-[#229731]/30'
              }`}>
                {vigencia.level === 'red'
                  ? <XCircle className="w-5 h-5 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
                  : vigencia.level === 'orange'
                  ? <AlertTriangle className="w-5 h-5 text-[#e65e24] flex-shrink-0 mt-0.5" />
                  : <CheckCircle className="w-5 h-5 text-[#229731] flex-shrink-0 mt-0.5" />}
                <div>
                  <p className={`text-[14px] font-bold ${
                    vigencia.level === 'red' ? 'text-[#ff9c9a]' : vigencia.level === 'orange' ? 'text-[#e65e24]' : 'text-[#229731]'
                  }`}>{vigencia.label}</p>
                  <p className="text-[13px] text-[#c7c7c7] mt-0.5">{vigencia.detail}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-[#9e9e9e] text-[13px]">
                <StatusBadge status={selectedContract.status} />
                <span>{selectedContract.observations && `— ${selectedContract.observations}`}</span>
              </div>
            )}

            {/* Regras do tipo de contrato */}
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-4 space-y-2">
              <p className="text-[12px] font-medium text-[#9e9e9e] uppercase tracking-wide">Regras deste contrato</p>
              {selectedContract.contract_type === 'loyalty' ? (
                <ul className="space-y-1.5 text-[13px] text-[#c7c7c7]">
                  <li className="flex items-start gap-2"><span className="text-[#a880ff] mt-0.5">•</span>Duração de <strong className="text-[#f5f5f5]">2 anos</strong> a partir da data de início</li>
                  <li className="flex items-start gap-2"><span className="text-[#e65e24] mt-0.5">•</span>Encerramento pelo <strong className="text-[#f5f5f5]">cliente</strong> antes do prazo gera multa de <strong className="text-[#ff9c9a]">{fmtBRL(FINE_AMOUNT)}</strong></li>
                  <li className="flex items-start gap-2"><span className="text-[#229731] mt-0.5">•</span>Encerramento pela <strong className="text-[#f5f5f5]">empresa</strong> não gera multa</li>
                </ul>
              ) : (
                <ul className="space-y-1.5 text-[13px] text-[#c7c7c7]">
                  <li className="flex items-start gap-2"><span className="text-[#9e9e9e] mt-0.5">•</span>Vigência mínima de <strong className="text-[#f5f5f5]">3 meses</strong></li>
                  <li className="flex items-start gap-2"><span className="text-[#e65e24] mt-0.5">•</span>Encerramento pelo <strong className="text-[#f5f5f5]">cliente</strong> gera multa de <strong className="text-[#ff9c9a]">{fmtBRL(FINE_AMOUNT)}</strong></li>
                  <li className="flex items-start gap-2"><span className="text-[#229731] mt-0.5">•</span>Encerramento pela <strong className="text-[#f5f5f5]">empresa</strong> não gera multa</li>
                </ul>
              )}
            </div>

            {/* Documento do contrato */}
            <div className="border-t border-[#2a2a2a] pt-4 space-y-3">
              <p className="text-[12px] font-medium text-[#9e9e9e] uppercase tracking-wide">Documento do Contrato</p>
              {configuredTemplates.length > 0 ? (
                <div className="flex gap-2 flex-wrap">
                  {configuredTemplates.map(tpl => (
                    <Button
                      key={tpl.slug}
                      variant="secondary"
                      size="sm"
                      className="gap-1.5"
                      loading={downloading === selectedContract.id + tpl.slug}
                      onClick={() => handleDownloadFilled(selectedContract, tpl.slug)}
                    >
                      <FileDown className="w-4 h-4" />
                      Gerar {tpl.name}
                    </Button>
                  ))}
                </div>
              ) : (
                <p className="text-[12px] text-[#616161]">Configure um modelo .docx em "Modelos .docx" para gerar contratos.</p>
              )}
              <div className="flex gap-2 flex-wrap">
                <Button
                  variant="secondary"
                  size="sm"
                  className="gap-1.5"
                  loading={uploadingContract === selectedContract.id}
                  onClick={() => { setActiveContractId(selectedContract.id); contractFileRef.current?.click() }}
                >
                  <Upload className="w-4 h-4" />
                  {selectedContract.pdf_url ? 'Substituir Assinado' : 'Enviar Assinado'}
                </Button>
                {selectedContract.pdf_url && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => window.open(`${selectedContract.pdf_url}?t=${Date.now()}`, '_blank')}
                  >
                    <Eye className="w-4 h-4" />
                    Ver Contrato Assinado
                  </Button>
                )}
              </div>
            </div>

            {/* Botão de encerrar — só se ativo */}
            {selectedContract.status === 'active' && (
              <div className="pt-1 border-t border-[#2a2a2a]">
                <Button
                  variant="danger"
                  size="md"
                  className="w-full"
                  onClick={() => setTerminateStep('choice')}
                >
                  <XCircle className="w-4 h-4" />
                  Encerrar Contrato
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ── MODAL: QUEM ESTÁ ENCERRANDO ─────────────────────────── */}
      <Modal
        open={!!selectedContract && terminateStep === 'choice'}
        onClose={closeDetailModal}
        title="Encerrar Contrato"
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-[14px] text-[#c7c7c7]">Quem está solicitando o encerramento?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setTerminateStep('client')}
              className="flex flex-col items-center gap-3 p-5 bg-[#1a1a1a] border border-[#323232] rounded-xl hover:border-[#e65e24] hover:bg-[#2a1500] transition-all duration-150 group"
            >
              <div className="w-12 h-12 rounded-full bg-[#323232] flex items-center justify-center group-hover:bg-[#3a180f]">
                <UserRound className="w-6 h-6 text-[#c7c7c7] group-hover:text-[#e65e24]" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-medium text-[#f5f5f5]">Cliente</p>
                <p className="text-[12px] text-[#e65e24] mt-0.5">Gera multa de {fmtBRL(FINE_AMOUNT)}</p>
              </div>
            </button>
            <button
              onClick={() => setTerminateStep('company')}
              className="flex flex-col items-center gap-3 p-5 bg-[#1a1a1a] border border-[#323232] rounded-xl hover:border-[#229731] hover:bg-[#0a1f0a] transition-all duration-150 group"
            >
              <div className="w-12 h-12 rounded-full bg-[#323232] flex items-center justify-center group-hover:bg-[#0e2f13]">
                <Building2 className="w-6 h-6 text-[#c7c7c7] group-hover:text-[#229731]" />
              </div>
              <div className="text-center">
                <p className="text-[14px] font-medium text-[#f5f5f5]">Empresa</p>
                <p className="text-[12px] text-[#229731] mt-0.5">Sem multa</p>
              </div>
            </button>
          </div>
          <button
            onClick={() => setTerminateStep(null)}
            className="flex items-center gap-1.5 text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Voltar
          </button>
        </div>
      </Modal>

      {/* ── MODAL: ENCERRAR PELO CLIENTE ────────────────────────── */}
      <Modal
        open={!!selectedContract && terminateStep === 'client'}
        onClose={closeDetailModal}
        title="Encerrar pelo Cliente"
        size="sm"
      >
        <div className="space-y-5">
          <div className="flex items-start gap-3 bg-[#2a0a0a] border border-[#ff9c9a]/30 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-[#ff9c9a] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-[14px] font-bold text-[#ff9c9a]">Multa de {fmtBRL(FINE_AMOUNT)}</p>
              <p className="text-[13px] text-[#c7c7c7] mt-1">
                Este encerramento irá gerar uma multa de <strong className="text-[#ff9c9a]">{fmtBRL(FINE_AMOUNT)}</strong> para o cliente{' '}
                <strong className="text-[#f5f5f5]">{selectedContract?.customer?.name}</strong>.
                O valor será registrado como multa pendente.
              </p>
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setTerminateStep('choice')}>
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </Button>
            <Button variant="danger" size="md" className="flex-1" loading={terminating} onClick={handleTerminateClient}>
              Confirmar e Gerar Multa
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: ENCERRAR PELA EMPRESA ────────────────────────── */}
      <Modal
        open={!!selectedContract && terminateStep === 'company'}
        onClose={closeDetailModal}
        title="Encerrar pela Empresa"
        size="sm"
      >
        <div className="space-y-5">
          <div>
            <label className="block text-[13px] font-medium text-[#c7c7c7] mb-2">
              Motivo do encerramento <span className="text-[#9e9e9e] font-normal">(mín. 50 caracteres)</span>
            </label>
            <textarea
              value={terminateReason}
              onChange={e => setTerminateReason(e.target.value)}
              rows={4}
              placeholder="Descreva o motivo pelo qual a empresa está encerrando este contrato..."
              className="w-full bg-[#121212] border border-[#474747] rounded-xl px-4 py-3 text-[13px] text-[#f5f5f5] placeholder:text-[#616161] focus:border-[#BAFF1A] focus:ring-1 focus:ring-[#BAFF1A] outline-none resize-none"
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[12px] text-[#9e9e9e]">Sem multa para o cliente</span>
              <span className={`text-[12px] font-medium ${
                terminateReason.trim().length >= 50 ? 'text-[#229731]' : 'text-[#9e9e9e]'
              }`}>
                {terminateReason.trim().length}/50
              </span>
            </div>
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" size="md" className="flex-1" onClick={() => setTerminateStep('choice')}>
              <ChevronLeft className="w-4 h-4" />
              Voltar
            </Button>
            <Button
              variant="danger"
              size="md"
              className="flex-1"
              loading={terminating}
              disabled={terminateReason.trim().length < 50}
              onClick={handleTerminateCompany}
            >
              Confirmar Encerramento
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── MODAL: MODELOS .DOCX ─────────────────────────────────── */}
      <Modal open={templatesModal} onClose={() => setTemplatesModal(false)} title="Modelos de Contrato" size="md">
        <div className="space-y-4">
          {templates.map(tpl => (
            <div key={tpl.slug} className="bg-[#1a1a1a] border border-[#323232] rounded-xl px-4 py-3 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-[#f5f5f5] font-medium">{tpl.name}</p>
                <p className="text-[12px] text-[#9e9e9e] mt-0.5">{tpl.description}</p>
                {tpl.file_url
                  ? <p className="text-[12px] text-[#229731] flex items-center gap-1 mt-1"><CheckCircle className="w-3 h-3" />Arquivo configurado</p>
                  : <p className="text-[12px] text-[#616161] mt-1">Aguardando arquivo</p>}
              </div>
              <div className="flex items-center gap-1.5 ml-4 shrink-0">
                {tpl.file_url ? (
                  <>
                    <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Visualizar" onClick={() => window.open(tpl.file_url!, '_blank')}><Eye className="h-4 w-4" /></Button>
                    <Button variant="secondary" size="sm" className="h-8 w-8 p-0" title="Substituir" loading={uploading === tpl.slug} onClick={() => { setActiveSlug(tpl.slug); templateFileRef.current?.click() }}><FileEdit className="h-4 w-4" /></Button>
                    <Button variant="danger" size="sm" className="h-8 w-8 p-0" title="Remover" onClick={() => handleRemoveTemplate(tpl.slug)}><Trash2 className="h-4 w-4" /></Button>
                  </>
                ) : (
                  <Button variant="secondary" size="sm" className="gap-1.5" loading={uploading === tpl.slug} onClick={() => { setActiveSlug(tpl.slug); templateFileRef.current?.click() }}>
                    <Upload className="h-4 w-4" />Enviar
                  </Button>
                )}
              </div>
            </div>
          ))}
          <div className="border-t border-[#323232] pt-4">
            <p className="text-[12px] text-[#9e9e9e] mb-3 font-medium">Variáveis disponíveis nos modelos</p>
            <div className="flex flex-wrap gap-1.5">
              {SUPPORTED_VARIABLES.map(v => (
                <code key={v.tag} className="text-[11px] text-[#BAFF1A] font-mono bg-[#121212] border border-[#2a2a2a] rounded px-2 py-1">
                  {v.tag}
                </code>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <input ref={templateFileRef} type="file" accept=".docx" className="hidden" onChange={handleTemplateFileChange} />
      <input ref={contractFileRef} type="file" accept=".pdf,.docx,.doc" className="hidden" onChange={handleContractFileChange} />
    </div>
  )
}
