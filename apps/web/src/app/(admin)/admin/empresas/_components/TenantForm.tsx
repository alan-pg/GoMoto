'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircle, Loader2, MapPin } from 'lucide-react'
import { applyCnpjMask, applyPhoneMask, applyZipMask } from '@gomoto/core'
import { useCepLookup } from '@/hooks/useCepLookup'
import { createTenant, updateTenant } from '../actions'

// ─── Tipos ────────────────────────────────────────────────────────────────────

type FieldErrorMap = Record<string, string>

type TenantFields = {
  name: string
  slug: string
  legal_name: string
  cnpj: string
  contact_email: string
  contact_phone: string
  address_zip: string
  address_street: string
  address_number: string
  address_complement: string
  address_district: string
  address_city: string
  address_state: string
}

type OwnerFields = {
  owner_name: string
  owner_email: string
  owner_password: string
}

export type TenantFormInitialData = TenantFields & { id?: string }

// ─── Navegação lateral ────────────────────────────────────────────────────────

const NAV_CREATE = [
  { id: 'sec-identity', label: 'Identidade'   },
  { id: 'sec-contact',  label: 'Contato'      },
  { id: 'sec-address',  label: 'Endereço'     },
  { id: 'sec-owner',    label: 'Responsável'  },
]

const NAV_EDIT = [
  { id: 'sec-identity', label: 'Identidade' },
  { id: 'sec-contact',  label: 'Contato'    },
  { id: 'sec-address',  label: 'Endereço'   },
]

// ─── Valores padrão ───────────────────────────────────────────────────────────

const EMPTY_TENANT: TenantFields = {
  name: '',
  slug: '',
  legal_name: '',
  cnpj: '',
  contact_email: '',
  contact_phone: '',
  address_zip: '',
  address_street: '',
  address_number: '',
  address_complement: '',
  address_district: '',
  address_city: '',
  address_state: '',
}

const EMPTY_OWNER: OwnerFields = {
  owner_name: '',
  owner_email: '',
  owner_password: '',
}

// ─── Auxiliares ───────────────────────────────────────────────────────────────

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

function tenantPayload(f: TenantFields) {
  return {
    name: f.name,
    slug: f.slug,
    legal_name: f.legal_name,
    cnpj: f.cnpj,
    contact_email: f.contact_email,
    contact_phone: f.contact_phone,
    address_zip: f.address_zip,
    address_street: f.address_street,
    address_number: f.address_number,
    address_complement: f.address_complement || null,
    address_district: f.address_district,
    address_city: f.address_city,
    address_state: f.address_state,
  }
}

// ─── Primitivas de estilo ─────────────────────────────────────────────────────

const labelCls = 'block text-[13px] text-[#9e9e9e] mb-1.5'
const inputCls =
  'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all disabled:opacity-50'

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 mb-5">
      <h2 className="text-[15px] font-bold text-[#f5f5f5]">{title}</h2>
      {hint && <span className="text-[12px] text-[#616161]">{hint}</span>}
    </div>
  )
}

function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-[12px] text-[#616161]">{hint}</p>}
      {error && <p className="mt-1 text-[12px] text-[#ff9c9a]">{error}</p>}
    </div>
  )
}

// ─── TenantForm ───────────────────────────────────────────────────────────────

type Props =
  | { mode: 'create'; initialData?: undefined; tenantId?: undefined }
  | { mode: 'edit'; initialData: TenantFormInitialData; tenantId: string }

export function TenantForm({ mode, initialData, tenantId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [tenant, setTenant] = useState<TenantFields>(
    initialData
      ? {
          name: initialData.name,
          slug: initialData.slug,
          legal_name: initialData.legal_name ?? '',
          cnpj: initialData.cnpj ? applyCnpjMask(initialData.cnpj) : '',
          contact_email: initialData.contact_email ?? '',
          contact_phone: initialData.contact_phone ? applyPhoneMask(initialData.contact_phone) : '',
          address_zip: initialData.address_zip ? applyZipMask(initialData.address_zip) : '',
          address_street: initialData.address_street ?? '',
          address_number: initialData.address_number ?? '',
          address_complement: initialData.address_complement ?? '',
          address_district: initialData.address_district ?? '',
          address_city: initialData.address_city ?? '',
          address_state: initialData.address_state ?? '',
        }
      : EMPTY_TENANT,
  )
  const [owner, setOwner]           = useState<OwnerFields>(EMPTY_OWNER)
  const cepLookup                   = useCepLookup()
  const [formError, setFormError]   = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({})

  // ── Handlers ──────────────────────────────────────────────────────────────

  function set<K extends keyof TenantFields>(key: K, value: TenantFields[K]) {
    setTenant((prev) => ({ ...prev, [key]: value }))
  }

  function handleNameChange(value: string) {
    const prevAutoSlug = slugify(tenant.name)
    const userCustomized = tenant.slug && tenant.slug !== prevAutoSlug
    setTenant((prev) => ({
      ...prev,
      name: value,
      slug: userCustomized ? prev.slug : slugify(value),
    }))
  }

  function setOwnerField<K extends keyof OwnerFields>(key: K, value: OwnerFields[K]) {
    setOwner((prev) => ({ ...prev, [key]: value }))
  }

  function applyServerErrors(result: {
    error?: string
    fieldErrors?: Array<{ path: string; message: string }>
  }): boolean {
    if (result.fieldErrors?.length) {
      const map: FieldErrorMap = {}
      result.fieldErrors.forEach(({ path, message }) => { map[path] = message })
      setFieldErrors(map)
    }
    if (result.error) { setFormError(result.error); return false }
    return true
  }

  // Campo com prefixo: create usa "tenant.slug", edit usa "slug"
  function fe(key: string): string | undefined {
    return mode === 'create' ? fieldErrors[`tenant.${key}`] : fieldErrors[key]
  }

  function handleSubmit() {
    setFormError(null)
    setFieldErrors({})
    startTransition(async () => {
      if (mode === 'create') {
        const payload = {
          tenant: tenantPayload(tenant),
          owner: {
            name: owner.owner_name,
            email: owner.owner_email,
            password: owner.owner_password,
          },
        }
        const result = await createTenant(payload)
        const ok = applyServerErrors(result as Parameters<typeof applyServerErrors>[0])
        if (!ok) return
        const created = (result as { data: { id: string } }).data
        router.push(`/admin/empresas/${created.id}`)
      } else {
        const result = await updateTenant(tenantId, tenantPayload(tenant))
        const ok = applyServerErrors(result as Parameters<typeof applyServerErrors>[0])
        if (!ok) return
        router.push(`/admin/empresas/${tenantId}`)
      }
    })
  }

  const navItems = mode === 'create' ? NAV_CREATE : NAV_EDIT
  const backHref = mode === 'edit' ? `/admin/empresas/${tenantId}` : '/admin/empresas'
  const title    = mode === 'create' ? 'Nova empresa' : `Editar ${tenant.name || 'empresa'}`

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-[#121212]">

      {/* Header fixo */}
      <div className="sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-16 flex items-center gap-4">
        <Link
          href={backHref}
          className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors"
        >
          {mode === 'edit' ? `← ${tenant.name || 'Empresa'}` : '← Empresas'}
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="text-[18px] font-bold text-[#f5f5f5]">{title}</h1>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex items-center h-9 px-4 rounded-full bg-[#323232] text-[#f5f5f5] text-[13px] font-medium hover:bg-[#474747] transition-colors"
          >
            Cancelar
          </Link>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="inline-flex items-center h-9 px-4 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e818] transition-colors disabled:opacity-50"
          >
            {isPending
              ? mode === 'create' ? 'Criando…' : 'Salvando…'
              : mode === 'create' ? 'Criar empresa' : 'Salvar alterações'}
          </button>
        </div>
      </div>

      <div className="flex max-w-5xl mx-auto">

        {/* Nav lateral */}
        <nav className="w-48 shrink-0 py-6 pl-6 pr-4 sticky top-16 self-start h-[calc(100vh-4rem)] overflow-y-auto">
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="block px-3 py-1.5 rounded-lg text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] hover:bg-[#323232] transition-colors"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Conteúdo */}
        <div className="flex-1 py-6 pr-6 space-y-8 min-w-0">

          {/* Erro global */}
          {formError && (
            <div className="flex items-center gap-3 px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a] rounded-xl">
              <AlertCircle className="w-4 h-4 text-[#ff9c9a] shrink-0" />
              <p className="text-[13px] text-[#ff9c9a]">{formError}</p>
            </div>
          )}

          {/* ── Identidade ──────────────────────────────────────────────────── */}
          <section id="sec-identity" className="bg-[#1a1a1a] rounded-2xl p-6">
            <SectionHeader
              title="Identidade"
              hint="Nome fantasia, razão social e identificador único."
            />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Nome fantasia" error={fe('name')} className="col-span-2">
                <input
                  className={inputCls}
                  placeholder="GoMoto Norte"
                  value={tenant.name}
                  onChange={(e) => handleNameChange(e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field
                label="Slug"
                hint="Letras minúsculas, números e hífens."
                error={fe('slug')}
              >
                <input
                  className={inputCls}
                  placeholder="gomoto-norte"
                  value={tenant.slug}
                  onChange={(e) => set('slug', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Razão social" error={fe('legal_name')}>
                <input
                  className={inputCls}
                  placeholder="GoMoto Norte Locadora LTDA"
                  value={tenant.legal_name}
                  onChange={(e) => set('legal_name', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field
                label="CNPJ"
                hint="Único quando preenchido. Opcional."
                error={fe('cnpj')}
              >
                <input
                  className={inputCls}
                  placeholder="00.000.000/0000-00"
                  value={tenant.cnpj}
                  onChange={(e) => set('cnpj', applyCnpjMask(e.target.value))}
                  disabled={isPending}
                />
              </Field>
            </div>
          </section>

          {/* ── Contato ─────────────────────────────────────────────────────── */}
          <section id="sec-contact" className="bg-[#1a1a1a] rounded-2xl p-6">
            <SectionHeader
              title="Contato"
              hint="Canais oficiais para comunicação institucional."
            />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" error={fe('contact_email')}>
                <input
                  type="email"
                  className={inputCls}
                  placeholder="contato@empresa.com.br"
                  value={tenant.contact_email}
                  onChange={(e) => set('contact_email', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Telefone" error={fe('contact_phone')}>
                <input
                  className={inputCls}
                  placeholder="(11) 90000-0000"
                  value={tenant.contact_phone}
                  onChange={(e) => set('contact_phone', applyPhoneMask(e.target.value))}
                  disabled={isPending}
                />
              </Field>
            </div>
          </section>

          {/* ── Endereço ────────────────────────────────────────────────────── */}
          <section id="sec-address" className="bg-[#1a1a1a] rounded-2xl p-6">
            <SectionHeader
              title="Endereço"
              hint="Endereço fiscal usado em contratos e documentos."
            />
            <div className="grid grid-cols-6 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>CEP</label>
                <div className="relative">
                  <input
                    className={inputCls}
                    placeholder="00000-000"
                    value={tenant.address_zip}
                    onChange={async (e) => {
                      const masked = applyZipMask(e.target.value)
                      set('address_zip', masked)
                      if (masked.replace(/\D/g, '').length === 8) {
                        const addr = await cepLookup.lookup(masked)
                        if (addr) {
                          setTenant((prev) => ({
                            ...prev,
                            address_street:   addr.street       || prev.address_street,
                            address_district: addr.neighborhood || prev.address_district,
                            address_city:     addr.city         || prev.address_city,
                            address_state:    addr.state        || prev.address_state,
                          }))
                        }
                      } else {
                        cepLookup.clearError()
                      }
                    }}
                    disabled={isPending}
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
                    {cepLookup.loading
                      ? <Loader2 className="w-4 h-4 text-[#BAFF1A] animate-spin" />
                      : <MapPin className="w-4 h-4 text-[#616161]" />
                    }
                  </div>
                </div>
                {cepLookup.error && (
                  <p className="mt-1 text-[12px] text-[#ff9c9a]">{cepLookup.error}</p>
                )}
                {fe('address_zip') && (
                  <p className="mt-1 text-[12px] text-[#ff9c9a]">{fe('address_zip')}</p>
                )}
              </div>
              <Field label="Logradouro" error={fe('address_street')} className="col-span-4">
                <input
                  className={inputCls}
                  placeholder="Av. Paulista"
                  value={tenant.address_street}
                  onChange={(e) => set('address_street', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Número" error={fe('address_number')} className="col-span-2">
                <input
                  className={inputCls}
                  placeholder="1000"
                  value={tenant.address_number}
                  onChange={(e) => set('address_number', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Complemento" error={fe('address_complement')} className="col-span-4">
                <input
                  className={inputCls}
                  placeholder="Sala 42 (opcional)"
                  value={tenant.address_complement}
                  onChange={(e) => set('address_complement', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Bairro" error={fe('address_district')} className="col-span-3">
                <input
                  className={inputCls}
                  placeholder="Bela Vista"
                  value={tenant.address_district}
                  onChange={(e) => set('address_district', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="Cidade" error={fe('address_city')} className="col-span-3">
                <input
                  className={inputCls}
                  placeholder="São Paulo"
                  value={tenant.address_city}
                  onChange={(e) => set('address_city', e.target.value)}
                  disabled={isPending}
                />
              </Field>
              <Field label="UF" error={fe('address_state')} className="col-span-2">
                <input
                  className={inputCls}
                  placeholder="SP"
                  maxLength={2}
                  value={tenant.address_state}
                  onChange={(e) => set('address_state', e.target.value.toUpperCase())}
                  disabled={isPending}
                />
              </Field>
            </div>
          </section>

          {/* ── Responsável (somente criação) ────────────────────────────────── */}
          {mode === 'create' && (
            <section id="sec-owner" className="bg-[#1a1a1a] rounded-2xl p-6">
              <SectionHeader
                title="Responsável"
                hint="Recebe role owner e convida os demais membros."
              />
              <div className="grid grid-cols-2 gap-4">
                <Field
                  label="Nome completo"
                  error={fieldErrors['owner.name']}
                >
                  <input
                    className={inputCls}
                    placeholder="João da Silva"
                    value={owner.owner_name}
                    onChange={(e) => setOwnerField('owner_name', e.target.value)}
                    disabled={isPending}
                  />
                </Field>
                <Field
                  label="Email"
                  error={fieldErrors['owner.email']}
                >
                  <input
                    type="email"
                    className={inputCls}
                    placeholder="responsavel@empresa.com.br"
                    value={owner.owner_email}
                    onChange={(e) => setOwnerField('owner_email', e.target.value)}
                    disabled={isPending}
                  />
                </Field>
                <Field
                  label="Senha inicial"
                  hint="O responsável pode trocar depois pelo fluxo de recuperação."
                  error={fieldErrors['owner.password']}
                  className="col-span-2"
                >
                  <input
                    type="password"
                    className={inputCls}
                    placeholder="mín. 8 caracteres"
                    value={owner.owner_password}
                    onChange={(e) => setOwnerField('owner_password', e.target.value)}
                    disabled={isPending}
                  />
                </Field>
              </div>
            </section>
          )}

          {/* Espaço inferior */}
          <div className="pb-10" />
        </div>
      </div>
    </div>
  )
}
