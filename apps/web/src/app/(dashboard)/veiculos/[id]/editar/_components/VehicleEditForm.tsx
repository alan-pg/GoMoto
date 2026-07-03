'use client'

import { useState, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  VEHICLE_STATUS_LABELS,
  VEHICLE_PHOTO_SLOT_LABELS,
  ACQUISITION_TYPE_LABELS,
  type VehiclePhotoSlot,
  type VehicleStatus,
} from '@gomoto/core'
import { useSupabaseContext, useRequiredTenantId } from '@gomoto/data'
import { updateVehicle, deleteVehiclePhoto } from '../../../actions'

const SLOTS: VehiclePhotoSlot[] = ['principal', 'front', 'left_side', 'right_side', 'rear', 'dashboard']

const MANUAL_STATUSES: { value: VehicleStatus; label: string }[] = [
  { value: 'available',   label: VEHICLE_STATUS_LABELS.available },
  { value: 'reserved',    label: VEHICLE_STATUS_LABELS.reserved },
  { value: 'maintenance', label: VEHICLE_STATUS_LABELS.maintenance },
  { value: 'sinister',    label: VEHICLE_STATUS_LABELS.sinister },
]

const ACQUISITION_OPTIONS = Object.entries(ACQUISITION_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}))

const FUEL_OPTIONS = [
  { value: 'GASOLINA',          label: 'Gasolina' },
  { value: 'ÁLCOOL/GASOLINA',   label: 'Álcool/Gasolina (Flex)' },
  { value: 'ELÉTRICO',          label: 'Elétrico' },
]

const OWNER_TYPE_OPTIONS = [
  { value: 'cpf',  label: 'CPF' },
  { value: 'cnpj', label: 'CNPJ' },
]

interface Props {
  vehicleId: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  moto: Record<string, any>
  initialPhotoUrls: Partial<Record<VehiclePhotoSlot, string>>
  currentStatus: VehicleStatus
}

export default function VehicleEditForm({ vehicleId, moto, initialPhotoUrls, currentStatus }: Props) {
  const router = useRouter()
  const supabase = useSupabaseContext()
  const getTenantId = useRequiredTenantId()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [photoUrls, setPhotoUrls] = useState<Partial<Record<VehiclePhotoSlot, string>>>(initialPhotoUrls)
  const [uploadingSlot, setUploadingSlot] = useState<VehiclePhotoSlot | null>(null)
  const fileInputRefs = useRef<Partial<Record<VehiclePhotoSlot, HTMLInputElement | null>>>({})

  const isRented = currentStatus === 'rented'

  const [form, setForm] = useState({
    license_plate:             moto.license_plate ?? '',
    renavam:                   moto.renavam ?? '',
    make:                      moto.make ?? '',
    model:                     moto.model ?? '',
    year_manufacture:          moto.year_manufacture ?? '',
    year_model:                moto.year_model ?? '',
    color:                     moto.color ?? '',
    fuel:                      moto.fuel ?? 'GASOLINA',
    chassis:                   moto.chassis ?? '',
    engine_capacity:           moto.engine_capacity ?? '',
    observations:              moto.observations ?? '',
    acquisition_type:          moto.acquisition_type ?? '',
    purchase_date:             moto.purchase_date ?? '',
    acquisition_amount:        moto.acquisition_amount ? String(moto.acquisition_amount) : '',
    fipe_value:                moto.fipe_value ? String(moto.fipe_value) : '',
    previous_owner:            moto.previous_owner ?? '',
    previous_owner_cpf:        moto.previous_owner_cpf ?? '',
    registered_owner_name:     moto.registered_owner_name ?? '',
    registered_owner_document: moto.registered_owner_document ?? '',
    registered_owner_type:     moto.registered_owner_type ?? 'cnpj',
    registration_state:        moto.registration_state ?? '',
    ownership_transferred:     moto.ownership_transferred ? 'true' : 'false',
    ownership_transfer_date:   moto.ownership_transfer_date ?? '',
    status:                    isRented ? currentStatus : (moto.status ?? 'available'),
    has_tracker:               moto.has_tracker ? 'true' : 'false',
    tracker_brand:             moto.tracker_brand ?? '',
    tracker_model:             moto.tracker_model ?? '',
    tracker_imei:              moto.tracker_imei ?? '',
    has_insurance:             moto.has_insurance ? 'true' : 'false',
    insurance_monthly_amount:  moto.insurance_monthly_amount ? String(moto.insurance_monthly_amount) : '',
    insurance_expiry_date:     moto.insurance_expiry_date ?? '',
  })

  function set(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handlePhotoUpload(slot: VehiclePhotoSlot, file: File) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      alert('Apenas JPG, PNG e WebP são aceitos.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Tamanho máximo: 5MB.')
      return
    }

    const tenantId = getTenantId()
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${tenantId}/${vehicleId}/${slot}/${Date.now()}.${ext}`

    setUploadingSlot(slot)
    try {
      const { error: uploadErr } = await supabase.storage
        .from('vehicle-photos')
        .upload(path, file, { upsert: true, contentType: file.type })

      if (uploadErr) {
        alert(`Erro no upload: ${uploadErr.message}`)
        return
      }

      setPhotoUrls((prev) => ({ ...prev, [slot]: URL.createObjectURL(file) }))
      // Salvar no banco via action
      const result = await updateVehicle(
        vehicleId,
        { license_plate: moto.license_plate }, // payload mínimo para não triggar validação completa
        { [slot]: path },
      )
      if (!result.ok) {
        alert(`Foto enviada mas não salva: ${result.error.message}`)
      }
    } finally {
      setUploadingSlot(null)
    }
  }

  async function handleDeletePhoto(slot: VehiclePhotoSlot) {
    const result = await deleteVehiclePhoto(vehicleId, slot)
    if (result.ok) {
      setPhotoUrls((prev) => {
        const next = { ...prev }
        delete next[slot]
        return next
      })
    } else {
      alert(`Erro ao remover foto: ${result.error.message}`)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    const payload: Record<string, unknown> = {
      license_plate:             form.license_plate.toUpperCase(),
      renavam:                   form.renavam,
      make:                      form.make.toUpperCase(),
      model:                     form.model,
      year_manufacture:          form.year_manufacture || null,
      year_model:                form.year_model || null,
      color:                     form.color.toUpperCase() || null,
      fuel:                      form.fuel || null,
      chassis:                   form.chassis.toUpperCase() || null,
      engine_capacity:           form.engine_capacity || null,
      observations:              form.observations || null,
      acquisition_type:          form.acquisition_type || null,
      purchase_date:             form.purchase_date || null,
      acquisition_amount:        form.acquisition_amount ? parseFloat(form.acquisition_amount.replace(/\./g, '').replace(',', '.')) : null,
      fipe_value:                form.fipe_value ? parseFloat(form.fipe_value.replace(/\./g, '').replace(',', '.')) : null,
      previous_owner:            form.previous_owner || null,
      previous_owner_cpf:        form.previous_owner_cpf || null,
      registered_owner_name:     form.registered_owner_name || null,
      registered_owner_document: form.registered_owner_document || null,
      registered_owner_type:     form.registered_owner_document ? form.registered_owner_type : null,
      registration_state:        form.registration_state || null,
      ownership_transferred:     form.ownership_transferred === 'true',
      ownership_transfer_date:   form.ownership_transfer_date || null,
      has_tracker:               form.has_tracker === 'true',
      tracker_brand:             form.has_tracker === 'true' ? (form.tracker_brand || null) : null,
      tracker_model:             form.has_tracker === 'true' ? (form.tracker_model || null) : null,
      tracker_imei:              form.has_tracker === 'true' ? (form.tracker_imei || null) : null,
      has_insurance:             form.has_insurance === 'true',
      insurance_monthly_amount:  form.has_insurance === 'true' && form.insurance_monthly_amount
        ? parseFloat(form.insurance_monthly_amount.replace(/\./g, '').replace(',', '.'))
        : null,
      insurance_expiry_date:     form.has_insurance === 'true' ? (form.insurance_expiry_date || null) : null,
    }

    if (!isRented) {
      payload.status = form.status
    }

    startTransition(async () => {
      const result = await updateVehicle(vehicleId, payload)
      if (result.ok) {
        router.push(`/veiculos/${vehicleId}`)
      } else {
        setError(result.error.message)
      }
    })
  }

  const inputClass = 'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] placeholder:text-[#616161] outline-none focus:border-[#BAFF1A] transition-all'
  const labelClass = 'block text-[13px] text-[#9e9e9e] mb-1.5'
  const sectionClass = 'space-y-4 pt-4 border-t border-[#323232]'

  return (
    <div className="min-h-screen bg-[#121212]">
      <div className="sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-16 flex items-center gap-4">
        <Link href={`/veiculos/${vehicleId}`} className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors">
          ← {moto.make} {moto.model}
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="text-[18px] font-bold text-[#f5f5f5]">Editar Veículo</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6 max-w-3xl mx-auto">

        {/* ── Fotos ── */}
        <div className="space-y-4">
          <h2 className="text-[14px] font-bold text-[#BAFF1A]">Fotos <span className="text-[12px] font-normal text-[#9e9e9e]">JPG, PNG ou WebP · máx. 5MB por slot</span></h2>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
            {SLOTS.map((slot) => {
              const url = photoUrls[slot]
              const isUploading = uploadingSlot === slot
              return (
                <div key={slot} className="space-y-1.5">
                  <div className="aspect-square rounded-xl overflow-hidden bg-[#202020] border border-[#323232] relative group">
                    {url ? (
                      <>
                        <Image
                          src={url}
                          alt={VEHICLE_PHOTO_SLOT_LABELS[slot]}
                          width={160}
                          height={160}
                          className="w-full h-full object-cover"
                          unoptimized
                        />
                        <button
                          type="button"
                          onClick={() => handleDeletePhoto(slot)}
                          className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-[11px] hidden group-hover:flex items-center justify-center"
                        >
                          ✕
                        </button>
                      </>
                    ) : (
                      <label className="absolute inset-0 flex flex-col items-center justify-center cursor-pointer text-[#474747] hover:text-[#9e9e9e] transition-colors">
                        {isUploading ? (
                          <div className="w-4 h-4 border-2 border-[#BAFF1A] border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          ref={(el) => { fileInputRefs.current[slot] = el }}
                          disabled={isUploading}
                          onChange={(e) => {
                            const file = e.target.files?.[0]
                            if (file) void handlePhotoUpload(slot, file)
                            e.target.value = ''
                          }}
                        />
                      </label>
                    )}
                  </div>
                  <p className="text-[11px] text-center text-[#9e9e9e]">{VEHICLE_PHOTO_SLOT_LABELS[slot]}</p>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Identificação ── */}
        <div className="space-y-4">
          <h2 className="text-[14px] font-bold text-[#BAFF1A]">Identificação</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Placa *</label>
              <input className={inputClass} value={form.license_plate} onChange={(e) => set('license_plate', e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>RENAVAM *</label>
              <input className={inputClass} value={form.renavam} onChange={(e) => set('renavam', e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Marca *</label>
              <input className={inputClass} value={form.make} onChange={(e) => set('make', e.target.value)} required />
            </div>
            <div>
              <label className={labelClass}>Modelo *</label>
              <input className={inputClass} value={form.model} onChange={(e) => set('model', e.target.value)} required />
            </div>
          </div>
          <div className="grid grid-cols-4 gap-4">
            <div>
              <label className={labelClass}>Ano fab.</label>
              <input className={inputClass} value={form.year_manufacture} onChange={(e) => set('year_manufacture', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Ano mod.</label>
              <input className={inputClass} value={form.year_model} onChange={(e) => set('year_model', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Cor</label>
              <input className={inputClass} value={form.color} onChange={(e) => set('color', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Combustível</label>
              <select className={inputClass} value={form.fuel} onChange={(e) => set('fuel', e.target.value)}>
                {FUEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Chassi</label>
              <input className={inputClass} value={form.chassis} onChange={(e) => set('chassis', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Cilindrada</label>
              <input className={inputClass} value={form.engine_capacity} onChange={(e) => set('engine_capacity', e.target.value)} />
            </div>
          </div>
        </div>

        {/* ── Status ── */}
        <div className={sectionClass}>
          <h2 className="text-[14px] font-bold text-[#BAFF1A]">Status na Frota</h2>
          {isRented ? (
            <div className="flex items-center gap-3">
              <div className="h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#9e9e9e] flex items-center">
                {VEHICLE_STATUS_LABELS[currentStatus]}
              </div>
              <p className="text-[12px] text-[#9e9e9e]">Status Locado só pode ser alterado via encerramento de contrato.</p>
            </div>
          ) : (
            <select
              className={`${inputClass} max-w-xs`}
              value={form.status}
              onChange={(e) => set('status', e.target.value)}
            >
              {MANUAL_STATUSES.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
        </div>

        {/* ── Aquisição ── */}
        <div className={sectionClass}>
          <h2 className="text-[14px] font-bold text-[#BAFF1A]">Aquisição</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Tipo de aquisição</label>
              <select className={inputClass} value={form.acquisition_type} onChange={(e) => set('acquisition_type', e.target.value)}>
                <option value="">Selecione…</option>
                {ACQUISITION_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Data da compra</label>
              <input type="date" className={inputClass} value={form.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Valor pago (R$)</label>
              <input className={inputClass} placeholder="0,00" value={form.acquisition_amount} onChange={(e) => set('acquisition_amount', e.target.value)} />
            </div>
            <div>
              <label className={labelClass}>Valor FIPE (R$)</label>
              <input className={inputClass} placeholder="0,00" value={form.fipe_value} onChange={(e) => set('fipe_value', e.target.value)} />
            </div>
          </div>

          {form.acquisition_type !== 'zero_km' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Dono anterior</label>
                <input className={inputClass} value={form.previous_owner} onChange={(e) => set('previous_owner', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>CPF/CNPJ anterior</label>
                <input className={inputClass} value={form.previous_owner_cpf} onChange={(e) => set('previous_owner_cpf', e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* ── Documentação Registral ── */}
        <div className={sectionClass}>
          <h2 className="text-[14px] font-bold text-[#BAFF1A]">Documentação Registral</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Proprietário registrado</label>
              <input className={inputClass} value={form.registered_owner_name} onChange={(e) => set('registered_owner_name', e.target.value)} />
            </div>
            <div className="grid grid-cols-[100px_1fr] gap-2">
              <div>
                <label className={labelClass}>Tipo</label>
                <select className={inputClass} value={form.registered_owner_type} onChange={(e) => set('registered_owner_type', e.target.value)}>
                  {OWNER_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>CPF/CNPJ</label>
                <input className={inputClass} value={form.registered_owner_document} onChange={(e) => set('registered_owner_document', e.target.value)} />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelClass}>UF</label>
              <input className={inputClass} maxLength={2} value={form.registration_state} onChange={(e) => set('registration_state', e.target.value.toUpperCase())} />
            </div>
            <div>
              <label className={labelClass}>Transferência</label>
              <select className={inputClass} value={form.ownership_transferred} onChange={(e) => set('ownership_transferred', e.target.value)}>
                <option value="false">Pendente</option>
                <option value="true">Concluída</option>
              </select>
            </div>
            {form.ownership_transferred === 'true' && (
              <div>
                <label className={labelClass}>Data da transferência</label>
                <input type="date" className={inputClass} value={form.ownership_transfer_date} onChange={(e) => set('ownership_transfer_date', e.target.value)} />
              </div>
            )}
          </div>
        </div>

        {/* ── Rastreador GPS ── */}
        <div className={sectionClass}>
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-bold text-[#BAFF1A]">Rastreador GPS</h2>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.has_tracker === 'true'}
                onChange={(e) => set('has_tracker', e.target.checked ? 'true' : 'false')}
              />
              <div className="w-9 h-5 bg-[#323232] rounded-full peer peer-checked:bg-[#BAFF1A] transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>
          {form.has_tracker === 'true' && (
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Marca *</label>
                <input className={inputClass} value={form.tracker_brand} onChange={(e) => set('tracker_brand', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Modelo *</label>
                <input className={inputClass} value={form.tracker_model} onChange={(e) => set('tracker_model', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>IMEI (15 dígitos) *</label>
                <input
                  className={inputClass}
                  maxLength={15}
                  pattern="\d{15}"
                  placeholder="123456789012345"
                  value={form.tracker_imei}
                  onChange={(e) => set('tracker_imei', e.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Seguro ── */}
        <div className={sectionClass}>
          <div className="flex items-center gap-3">
            <h2 className="text-[14px] font-bold text-[#BAFF1A]">Seguro</h2>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={form.has_insurance === 'true'}
                onChange={(e) => set('has_insurance', e.target.checked ? 'true' : 'false')}
              />
              <div className="w-9 h-5 bg-[#323232] rounded-full peer peer-checked:bg-[#BAFF1A] transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
            </label>
          </div>
          {form.has_insurance === 'true' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Valor mensal (R$) *</label>
                <input className={inputClass} placeholder="0,00" value={form.insurance_monthly_amount} onChange={(e) => set('insurance_monthly_amount', e.target.value)} />
              </div>
              <div>
                <label className={labelClass}>Vencimento *</label>
                <input type="date" className={inputClass} value={form.insurance_expiry_date} onChange={(e) => set('insurance_expiry_date', e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* ── Observações ── */}
        <div className={sectionClass}>
          <label className={labelClass}>Observações</label>
          <textarea
            className={`${inputClass} h-24 py-2 resize-none`}
            value={form.observations}
            onChange={(e) => set('observations', e.target.value)}
          />
        </div>

        {/* ── Ações ── */}
        {error && (
          <div className="px-4 py-3 bg-[#7c1c1c] border border-[#ff9c9a]/30 rounded-xl">
            <p className="text-[13px] text-[#ff9c9a]">{error}</p>
          </div>
        )}

        <div className="flex gap-4 justify-end pt-4 border-t border-[#323232]">
          <Link
            href={`/veiculos/${vehicleId}`}
            className="inline-flex items-center h-9 px-4 rounded-full bg-[#323232] text-[#f5f5f5] text-[13px] font-medium hover:bg-[#474747] transition-colors"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="h-9 px-6 rounded-full bg-[#BAFF1A] text-[#121212] text-[13px] font-bold hover:bg-[#a8e616] transition-colors disabled:opacity-60"
          >
            {isPending ? 'Salvando...' : 'Salvar alterações'}
          </button>
        </div>
      </form>
    </div>
  )
}
