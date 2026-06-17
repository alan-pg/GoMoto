'use client'

import { useState, useTransition } from 'react'
import { Building2, Pause, Play, Plus, Pencil } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  createTenant,
  reactivateTenant,
  suspendTenant,
  updateTenant,
} from './actions'

export type TenantRow = {
  id: string
  name: string
  slug: string
  legal_name: string | null
  cnpj: string | null
  contact_email: string | null
  contact_phone: string | null
  address_zip: string | null
  address_street: string | null
  address_number: string | null
  address_complement: string | null
  address_district: string | null
  address_city: string | null
  address_state: string | null
  suspended_at: string | null
  suspended_reason: string | null
  created_at: string
}

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

type CreateFormState = TenantFields & {
  owner_name: string
  owner_email: string
  owner_password: string
}

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

const EMPTY_CREATE: CreateFormState = {
  ...EMPTY_TENANT,
  owner_name: '',
  owner_email: '',
  owner_password: '',
}

function tenantToFields(t: TenantRow): TenantFields {
  return {
    name: t.name ?? '',
    slug: t.slug ?? '',
    legal_name: t.legal_name ?? '',
    cnpj: t.cnpj ?? '',
    contact_email: t.contact_email ?? '',
    contact_phone: t.contact_phone ?? '',
    address_zip: t.address_zip ?? '',
    address_street: t.address_street ?? '',
    address_number: t.address_number ?? '',
    address_complement: t.address_complement ?? '',
    address_district: t.address_district ?? '',
    address_city: t.address_city ?? '',
    address_state: t.address_state ?? '',
  }
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

function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-[#323232] bg-[#181818] p-5 space-y-4">
      <div>
        <h3 className="text-[14px] font-medium text-[#f5f5f5]">{title}</h3>
        {description ? (
          <p className="text-[12px] text-[#9e9e9e] mt-0.5">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

type FieldErrorMap = Record<string, string>

type TenantFieldsBlockProps = {
  values: TenantFields
  onChange: (next: TenantFields) => void
  disabled?: boolean
  showSlugHint?: boolean
  errors?: FieldErrorMap
}

function TenantFieldsBlock({
  values,
  onChange,
  disabled,
  showSlugHint,
  errors = {},
}: TenantFieldsBlockProps) {
  function set<K extends keyof TenantFields>(key: K, value: TenantFields[K]) {
    onChange({ ...values, [key]: value })
  }

  function handleNameChange(value: string) {
    const prevAutoSlug = slugify(values.name)
    const userCustomized = values.slug && values.slug !== prevAutoSlug
    onChange({
      ...values,
      name: value,
      slug: userCustomized ? values.slug : slugify(value),
    })
  }

  return (
    <div className="space-y-5">
      <FormSection
        title="Identidade"
        description="Nome fantasia, razão social e identificador único da empresa."
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Nome fantasia"
            value={values.name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="GoMoto Bonze"
            disabled={disabled}
            error={errors.name}
          />
          <Input
            label="Slug"
            value={values.slug}
            onChange={(e) => set('slug', e.target.value)}
            placeholder="gomoto-bonze"
            hint={showSlugHint ? 'Letras minúsculas, números e hífens.' : undefined}
            disabled={disabled}
            error={errors.slug}
          />
          <Input
            label="Razão social"
            value={values.legal_name}
            onChange={(e) => set('legal_name', e.target.value)}
            placeholder="GoMoto Bonze Locadora LTDA"
            disabled={disabled}
            error={errors.legal_name}
          />
          <Input
            label="CNPJ"
            value={values.cnpj}
            onChange={(e) => set('cnpj', e.target.value)}
            placeholder="00.000.000/0000-00 (opcional)"
            hint="Único quando preenchido."
            disabled={disabled}
            error={errors.cnpj}
          />
        </div>
      </FormSection>

      <FormSection title="Contato" description="Canais oficiais da empresa para comunicação institucional.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Email"
            type="email"
            value={values.contact_email}
            onChange={(e) => set('contact_email', e.target.value)}
            placeholder="contato@empresa.com.br"
            disabled={disabled}
            error={errors.contact_email}
          />
          <Input
            label="Telefone"
            value={values.contact_phone}
            onChange={(e) => set('contact_phone', e.target.value)}
            placeholder="(11) 90000-0000"
            disabled={disabled}
            error={errors.contact_phone}
          />
        </div>
      </FormSection>

      <FormSection title="Endereço" description="Endereço fiscal usado em contratos e documentos.">
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-3">
            <Input
              label="CEP"
              value={values.address_zip}
              onChange={(e) => set('address_zip', e.target.value)}
              placeholder="00000-000"
              disabled={disabled}
              error={errors.address_zip}
            />
          </div>
          <div className="col-span-12 md:col-span-7">
            <Input
              label="Logradouro"
              value={values.address_street}
              onChange={(e) => set('address_street', e.target.value)}
              placeholder="Av. Paulista"
              disabled={disabled}
              error={errors.address_street}
            />
          </div>
          <div className="col-span-12 md:col-span-2">
            <Input
              label="Número"
              value={values.address_number}
              onChange={(e) => set('address_number', e.target.value)}
              placeholder="1000"
              disabled={disabled}
              error={errors.address_number}
            />
          </div>

          <div className="col-span-12 md:col-span-6">
            <Input
              label="Complemento"
              value={values.address_complement}
              onChange={(e) => set('address_complement', e.target.value)}
              placeholder="Sala 42 (opcional)"
              disabled={disabled}
              error={errors.address_complement}
            />
          </div>
          <div className="col-span-12 md:col-span-6">
            <Input
              label="Bairro"
              value={values.address_district}
              onChange={(e) => set('address_district', e.target.value)}
              placeholder="Bela Vista"
              disabled={disabled}
              error={errors.address_district}
            />
          </div>

          <div className="col-span-12 md:col-span-9">
            <Input
              label="Cidade"
              value={values.address_city}
              onChange={(e) => set('address_city', e.target.value)}
              placeholder="São Paulo"
              disabled={disabled}
              error={errors.address_city}
            />
          </div>
          <div className="col-span-12 md:col-span-3">
            <Input
              label="UF"
              value={values.address_state}
              onChange={(e) => set('address_state', e.target.value.toUpperCase())}
              placeholder="SP"
              maxLength={2}
              disabled={disabled}
              error={errors.address_state}
            />
          </div>
        </div>
      </FormSection>
    </div>
  )
}

export function EmpresasClient({
  initialTenants,
  loadError,
}: {
  initialTenants: TenantRow[]
  loadError: string | null
}) {
  const [tenants, setTenants] = useState<TenantRow[]>(initialTenants)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<TenantRow | null>(null)
  const [createForm, setCreateForm] = useState<CreateFormState>(EMPTY_CREATE)
  const [editForm, setEditForm] = useState<TenantFields>(EMPTY_TENANT)
  const [formError, setFormError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({})
  const [suspendingId, setSuspendingId] = useState<string | null>(null)
  const [suspendReason, setSuspendReason] = useState('')
  const [pending, startTransition] = useTransition()

  function openCreate() {
    setCreateForm(EMPTY_CREATE)
    setFormError(null)
    setFieldErrors({})
    setShowCreate(true)
  }

  function openEdit(tenant: TenantRow) {
    setEditing(tenant)
    setEditForm(tenantToFields(tenant))
    setFormError(null)
    setFieldErrors({})
  }

  // Filtra o mapa de erros por prefixo e remove o prefixo das chaves.
  // Ex.: { 'tenant.slug': '...', 'owner.email': '...' } com prefixo
  // 'tenant.' → { slug: '...' }. Permite reusar TenantFieldsBlock entre
  // create (nested) e edit (flat).
  function stripPrefix(errors: FieldErrorMap, prefix: string): FieldErrorMap {
    const out: FieldErrorMap = {}
    for (const [k, v] of Object.entries(errors)) {
      if (k.startsWith(prefix)) out[k.slice(prefix.length)] = v
      else if (prefix === '' && !k.includes('.')) out[k] = v
    }
    return out
  }

  function applyResult(
    result: { error?: string; fieldErrors?: Array<{ path: string; message: string }> },
  ): boolean {
    if (result.fieldErrors && result.fieldErrors.length > 0) {
      const map: FieldErrorMap = {}
      result.fieldErrors.forEach(({ path, message }) => {
        map[path] = message
      })
      setFieldErrors(map)
    }
    if (result.error) {
      setFormError(result.error)
      return false
    }
    return true
  }

  function setOwnerField<K extends 'owner_name' | 'owner_email' | 'owner_password'>(
    key: K,
    value: CreateFormState[K],
  ) {
    setCreateForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleCreate() {
    setFormError(null)
    setFieldErrors({})
    const payload = {
      tenant: tenantPayload(createForm),
      owner: {
        name: createForm.owner_name,
        email: createForm.owner_email,
        password: createForm.owner_password,
      },
    }
    startTransition(async () => {
      const result = await createTenant(payload)
      const ok = applyResult(result as Parameters<typeof applyResult>[0])
      if (!ok) return
      const saved = (result as { data: TenantRow }).data
      setTenants((prev) => {
        const without = prev.filter((t) => t.id !== saved.id)
        return [...without, saved].sort((a, b) => a.name.localeCompare(b.name))
      })
      setShowCreate(false)
    })
  }

  function handleEditSubmit() {
    if (!editing) return
    setFormError(null)
    setFieldErrors({})
    startTransition(async () => {
      const result = await updateTenant(editing.id, tenantPayload(editForm))
      const ok = applyResult(result as Parameters<typeof applyResult>[0])
      if (!ok) return
      const saved = (result as { data: TenantRow }).data
      setTenants((prev) => {
        const without = prev.filter((t) => t.id !== saved.id)
        return [...without, saved].sort((a, b) => a.name.localeCompare(b.name))
      })
      setEditing(null)
    })
  }

  function openSuspend(tenant: TenantRow) {
    setSuspendingId(tenant.id)
    setSuspendReason('')
  }

  function handleSuspend() {
    if (!suspendingId) return
    startTransition(async () => {
      const result = await suspendTenant(suspendingId, { reason: suspendReason })
      if ('error' in result && result.error) {
        setFormError(result.error)
        return
      }
      setTenants((prev) =>
        prev.map((t) =>
          t.id === suspendingId
            ? {
                ...t,
                suspended_at: new Date().toISOString(),
                suspended_reason: suspendReason,
              }
            : t,
        ),
      )
      setSuspendingId(null)
    })
  }

  function handleReactivate(tenant: TenantRow) {
    startTransition(async () => {
      const result = await reactivateTenant(tenant.id)
      if ('error' in result && result.error) {
        alert(result.error)
        return
      }
      setTenants((prev) =>
        prev.map((t) =>
          t.id === tenant.id
            ? { ...t, suspended_at: null, suspended_reason: null }
            : t,
        ),
      )
    })
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-[#f5f5f5] flex items-center gap-2">
            <Building2 className="w-6 h-6" /> Empresas da plataforma
          </h1>
          <p className="text-[13px] text-[#9e9e9e] mt-1">
            Gerencie as locadoras cadastradas. Suspender bloqueia o acesso a dados; o time
            interno continua enxergando a empresa marcada como suspensa.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="w-4 h-4 mr-1.5" /> Nova empresa
        </Button>
      </header>

      {loadError ? (
        <div className="rounded-lg bg-[#7c1c1c] text-[#ff9c9a] border border-[#ff9c9a] px-4 py-3 text-[13px] mb-4">
          Falha ao carregar empresas: {loadError}
        </div>
      ) : null}

      <div className="rounded-xl border border-[#323232] overflow-hidden bg-[#181818]">
        <table className="w-full text-left">
          <thead className="bg-[#202020] text-[12px] uppercase tracking-wide text-[#9e9e9e]">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">Slug</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {tenants.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-[#9e9e9e] text-[14px]">
                  Nenhuma empresa cadastrada ainda.
                </td>
              </tr>
            ) : (
              tenants.map((tenant) => {
                const suspended = !!tenant.suspended_at
                return (
                  <tr key={tenant.id} className="border-t border-[#323232]">
                    <td className="px-4 py-3 text-[#f5f5f5] text-[14px] font-medium">
                      {tenant.name}
                    </td>
                    <td className="px-4 py-3 text-[#c7c7c7] text-[13px] font-mono">
                      {tenant.slug}
                    </td>
                    <td className="px-4 py-3">
                      {suspended ? (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="danger">Suspensa</Badge>
                          {tenant.suspended_reason ? (
                            <span className="text-[11px] text-[#9e9e9e]">
                              {tenant.suspended_reason}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <Badge variant="success">Ativa</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(tenant)}
                          disabled={pending}
                        >
                          <Pencil className="w-3.5 h-3.5 mr-1" /> Editar
                        </Button>
                        {suspended ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleReactivate(tenant)}
                            disabled={pending}
                          >
                            <Play className="w-3.5 h-3.5 mr-1" /> Reativar
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openSuspend(tenant)}
                            disabled={pending}
                          >
                            <Pause className="w-3.5 h-3.5 mr-1" /> Suspender
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Nova empresa"
        size="xl"
      >
        <div className="space-y-5">
          <TenantFieldsBlock
            values={createForm}
            onChange={(next) =>
              setCreateForm((prev) => ({
                ...prev,
                ...next,
              }))
            }
            disabled={pending}
            showSlugHint
            errors={stripPrefix(fieldErrors, 'tenant.')}
          />

          <FormSection
            title="Acesso do responsável"
            description="Esse usuário recebe role owner no tenant e poderá convidar os demais membros depois."
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Nome do responsável"
                value={createForm.owner_name}
                onChange={(e) => setOwnerField('owner_name', e.target.value)}
                placeholder="Alan Gonçalves"
                disabled={pending}
                error={fieldErrors['owner.name']}
              />
              <Input
                label="Email do responsável"
                type="email"
                value={createForm.owner_email}
                onChange={(e) => setOwnerField('owner_email', e.target.value)}
                placeholder="responsavel@empresa.com.br"
                disabled={pending}
                error={fieldErrors['owner.email']}
              />
              <div className="md:col-span-2">
                <Input
                  label="Senha inicial"
                  type="password"
                  value={createForm.owner_password}
                  onChange={(e) => setOwnerField('owner_password', e.target.value)}
                  placeholder="mín. 8 caracteres"
                  hint="O responsável pode trocar depois pelo fluxo de recuperação."
                  disabled={pending}
                  error={fieldErrors['owner.password']}
                />
              </div>
            </div>
          </FormSection>

          {formError ? (
            <div className="rounded-lg bg-[#7c1c1c] text-[#ff9c9a] border border-[#ff9c9a] px-3 py-2 text-[13px]">
              {formError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setShowCreate(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={handleCreate} disabled={pending}>
              {pending ? 'Criando…' : 'Criar empresa'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? `Editar ${editing.name}` : 'Editar empresa'}
        size="xl"
      >
        <div className="space-y-5">
          <TenantFieldsBlock
            values={editForm}
            onChange={setEditForm}
            disabled={pending}
            showSlugHint
            errors={stripPrefix(fieldErrors, '')}
          />

          {formError ? (
            <div className="rounded-lg bg-[#7c1c1c] text-[#ff9c9a] border border-[#ff9c9a] px-3 py-2 text-[13px]">
              {formError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={handleEditSubmit} disabled={pending}>
              {pending ? 'Salvando…' : 'Salvar alterações'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!suspendingId}
        onClose={() => setSuspendingId(null)}
        title="Suspender empresa"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-[#c7c7c7]">
            A empresa não conseguirá acessar dados enquanto estiver suspensa. O time interno
            continua vendo o login mas com a mensagem de suspensão.
          </p>
          <Input
            label="Motivo"
            value={suspendReason}
            onChange={(e) => setSuspendReason(e.target.value)}
            placeholder="Ex.: inadimplência da mensalidade"
            disabled={pending}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setSuspendingId(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button
              onClick={handleSuspend}
              disabled={pending || suspendReason.trim().length === 0}
            >
              {pending ? 'Suspendendo…' : 'Suspender'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
