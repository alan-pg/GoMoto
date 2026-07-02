import { z } from 'zod'

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato de data inválido (AAAA-MM-DD)')

export const VehicleStatusEnum = z.enum([
  'available',
  'rented',
  'reserved',
  'maintenance',
  'sinister',
  'sold',
  'inactive',
])
export type VehicleStatus = z.infer<typeof VehicleStatusEnum>

export const VehiclePhotoSlotEnum = z.enum([
  'principal', 'front', 'left_side', 'right_side', 'rear', 'dashboard',
])
export type VehiclePhotoSlot = z.infer<typeof VehiclePhotoSlotEnum>

export const AcquisitionTypeEnum = z.enum([
  'zero_km', 'used', 'settled', 'financed', 'consignment', 'donation', 'other',
])
export type AcquisitionType = z.infer<typeof AcquisitionTypeEnum>

const imeiSchema = z
  .string()
  .regex(/^\d{15}$/, 'IMEI deve ter exatamente 15 dígitos numéricos')
  .optional()
  .nullable()

export const MotorcycleSchema = z.object({
  license_plate:             z.string().trim().min(1, 'Placa é obrigatória').max(10),
  renavam:                   z.string().trim().min(1, 'RENAVAM é obrigatório').max(20),
  make:                      z.string().trim().min(1, 'Marca é obrigatória').max(100),
  model:                     z.string().trim().min(1, 'Modelo é obrigatório').max(100),
  year_manufacture:          z.string().trim().max(10).optional().nullable(),
  year_model:                z.string().trim().max(10).optional().nullable(),
  color:                     z.string().trim().max(50).optional().nullable(),
  fuel:                      z.string().trim().max(50).optional().nullable(),
  chassis:                   z.string().trim().max(20).optional().nullable(),
  engine_capacity:           z.string().trim().max(20).optional().nullable(),
  km_entry:                  z.number().int().min(0).optional().nullable(),
  observations:              z.string().trim().max(2000).optional().nullable(),
  acquisition_type:          AcquisitionTypeEnum.optional().nullable(),
  purchase_date:             dateString.optional().nullable(),
  acquisition_amount:        z.number().positive().max(9_999_999).optional().nullable(),
  fipe_value:                z.number().positive().max(9_999_999).optional().nullable(),
  previous_owner:            z.string().trim().max(200).optional().nullable(),
  previous_owner_cpf:        z.string().trim().max(14).optional().nullable(),
  registered_owner_name:     z.string().trim().max(200).optional().nullable(),
  registered_owner_document: z.string().trim().max(20).optional().nullable(),
  registered_owner_type:     z.enum(['cpf', 'cnpj']).optional().nullable(),
  registration_state:        z.string().trim().max(2).optional().nullable(),
  ownership_transferred:     z.boolean().optional(),
  ownership_transfer_date:   dateString.optional().nullable(),
  // status restrito a 4 valores selecionáveis manualmente (RF-016)
  // rented, sold, inactive só são atribuídos por ações dedicadas
  status: z.enum(['available', 'reserved', 'maintenance', 'sinister']).optional(),
  has_tracker:               z.boolean().optional(),
  tracker_brand:             z.string().trim().max(100).optional().nullable(),
  tracker_model:             z.string().trim().max(100).optional().nullable(),
  tracker_imei:              imeiSchema,
  has_insurance:             z.boolean().optional(),
  insurance_monthly_amount:  z.number().positive().max(9_999_999).optional().nullable(),
  insurance_expiry_date:     dateString.optional().nullable(),
}).refine(
  (d) => !d.has_tracker || (d.tracker_brand && d.tracker_model && d.tracker_imei),
  { message: 'Preencha marca, modelo e IMEI do rastreador', path: ['tracker_brand'] },
).refine(
  (d) => !d.has_insurance || (d.insurance_monthly_amount && d.insurance_expiry_date),
  { message: 'Preencha valor mensal e vencimento do seguro', path: ['insurance_monthly_amount'] },
)

export const VehicleStatusTransitionSchema = z.object({
  motorcycle_id: z.string().uuid(),
  new_status:    VehicleStatusEnum,
})

export const VehiclePhotoUpsertSchema = z.object({
  motorcycle_id: z.string().uuid(),
  slot:          VehiclePhotoSlotEnum,
  url:           z.string().url(),
})

export interface VehicleStatusHistoryEntry {
  id:              string
  tenant_id:       string
  motorcycle_id:   string
  previous_status: VehicleStatus | null
  new_status:      VehicleStatus
  changed_by:      string | null
  created_at:      string
}

export interface VehiclePhoto {
  id:            string
  tenant_id:     string
  motorcycle_id: string
  slot:          VehiclePhotoSlot
  url:           string
  created_at:    string
  updated_at:    string
}

export const VEHICLE_STATUS_LABELS: Record<VehicleStatus, string> = {
  available:   'Disponível',
  rented:      'Locado',
  reserved:    'Reservado',
  maintenance: 'Em manutenção',
  sinister:    'Sinistrado',
  sold:        'Vendido',
  inactive:    'Desativado',
}

export const VEHICLE_PHOTO_SLOT_LABELS: Record<VehiclePhotoSlot, string> = {
  principal:  'Principal',
  front:      'Frontal',
  left_side:  'Lateral esquerda',
  right_side: 'Lateral direita',
  rear:       'Traseira',
  dashboard:  'Painel',
}

export const ACQUISITION_TYPE_LABELS: Record<AcquisitionType, string> = {
  zero_km:     'Zero KM',
  used:        'Compra (usada)',
  settled:     'Quitada',
  financed:    'Financiada',
  consignment: 'Consignação',
  donation:    'Doação',
  other:       'Outro',
}
