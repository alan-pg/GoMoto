import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import {
  VEHICLE_STATUS_LABELS,
  VEHICLE_PHOTO_SLOT_LABELS,
  ACQUISITION_TYPE_LABELS,
  type VehiclePhotoSlot,
  type VehicleStatus,
} from '@gomoto/core'
import { getSelectableStatuses } from '@gomoto/core'
import { formatCurrency } from '@/lib/utils'
import VehicleStatusActions from './_components/VehicleStatusActions'
import VehiclePhotoGallery from './_components/VehiclePhotoGallery'

const STATUS_COLORS: Record<VehicleStatus, string> = {
  available:   'bg-[#143c18] text-[#4ade80] border-[#4ade80]/30',
  rented:      'bg-[#2d0363] text-[#a880ff] border-[#a880ff]/30',
  reserved:    'bg-[#1a1a3e] text-[#818cf8] border-[#818cf8]/30',
  maintenance: 'bg-[#3a1800] text-[#fb923c] border-[#fb923c]/30',
  sinister:    'bg-[#3a0000] text-[#f87171] border-[#f87171]/30',
  sold:        'bg-[#1a1a1a] text-[#9e9e9e] border-[#9e9e9e]/30',
  inactive:    'bg-[#1a1a1a] text-[#616161] border-[#616161]/30',
}

export default async function VehicleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [motoResult, photosResult, historyResult, documentsResult, obligationsResult, maintenancesResult] =
    await Promise.all([
      supabase.from('motorcycles').select('*').eq('id', id).single(),
      supabase.from('vehicle_photos').select('*').eq('motorcycle_id', id),
      supabase
        .from('vehicle_status_history')
        .select('*')
        .eq('motorcycle_id', id)
        .order('created_at', { ascending: false }),
      supabase
        .from('vehicle_documents')
        .select('*')
        .eq('motorcycle_id', id)
        .eq('is_current', true),
      supabase
        .from('vehicle_obligations')
        .select('*')
        .eq('motorcycle_id', id)
        .order('due_date', { ascending: true }),
      supabase
        .from('maintenances')
        .select('*')
        .eq('motorcycle_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

  if (motoResult.error || !motoResult.data) notFound()

  const moto = motoResult.data
  const photos = photosResult.data ?? []
  const history = historyResult.data ?? []
  const documents = documentsResult.data ?? []
  const obligations = obligationsResult.data ?? []
  const maintenances = maintenancesResult.data ?? []

  // Gerar URLs assinadas para fotos em paralelo
  const photoUrls: Partial<Record<VehiclePhotoSlot, string>> = {}
  await Promise.all(
    photos.map(async (photo) => {
      const { data } = await supabase.storage
        .from('vehicle-photos')
        .createSignedUrl(photo.url, 3600)
      if (data?.signedUrl) {
        photoUrls[photo.slot as VehiclePhotoSlot] = data.signedUrl
      }
    }),
  )

  const currentStatus = moto.status as VehicleStatus
  const selectableStatuses = getSelectableStatuses(currentStatus)

  function formatDate(d: string | null | undefined) {
    if (!d) return '—'
    return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR')
  }

  const OBLIGATION_TYPE_LABELS: Record<string, string> = {
    ipva: 'IPVA',
    licensing: 'Licenciamento',
    dpvat: 'DPVAT',
    insurance: 'Seguro',
    crv_issuance: 'Emissão CRV',
    detran_fee: 'Taxa DETRAN',
    other: 'Outro',
  }

  return (
    <div className="min-h-screen bg-[#121212]">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-[#121212] border-b border-[#323232] px-6 h-16 flex items-center gap-4">
        <Link href="/motos" className="text-[13px] text-[#9e9e9e] hover:text-[#f5f5f5] transition-colors">
          ← Motocicletas
        </Link>
        <span className="text-[#474747]">/</span>
        <h1 className="text-[18px] font-bold text-[#f5f5f5]">
          {moto.make} {moto.model} · {moto.license_plate}
        </h1>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/motos/${id}/editar`}
            className="inline-flex items-center h-9 px-4 rounded-full bg-[#323232] text-[#f5f5f5] text-[13px] font-medium hover:bg-[#474747] transition-colors"
          >
            Editar dados
          </Link>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-5xl mx-auto">
        {/* Status + Ações */}
        <div className="flex items-center gap-4">
          <span
            className={`inline-flex items-center h-7 px-3 rounded-full text-[13px] font-medium border ${STATUS_COLORS[currentStatus]}`}
          >
            {VEHICLE_STATUS_LABELS[currentStatus]}
          </span>
          {selectableStatuses.length > 0 && (
            <VehicleStatusActions
              motorcycleId={id}
              currentStatus={currentStatus}
              selectableStatuses={selectableStatuses}
            />
          )}
        </div>

        {/* Galeria de fotos */}
        <section>
          <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Fotos</h2>
          <VehiclePhotoGallery
            motorcycleId={id}
            photoUrls={photoUrls}
          />
        </section>

        {/* Dados básicos */}
        <section>
          <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Identificação</h2>
          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  ['Placa', moto.license_plate],
                  ['RENAVAM', moto.renavam],
                  ['Chassi', moto.chassis],
                  ['Marca', moto.make],
                  ['Modelo', moto.model],
                  ['Ano fab./modelo', `${moto.year_manufacture ?? '—'} / ${moto.year_model ?? '—'}`],
                  ['Cor', moto.color],
                  ['Combustível', moto.fuel],
                  ['Cilindrada', moto.engine_capacity],
                  ['KM de entrada', moto.km_entry != null ? moto.km_entry.toLocaleString('pt-BR') : '—'],
                  ['KM atual', moto.km_current != null ? moto.km_current.toLocaleString('pt-BR') : '—'],
                  ['Observações', moto.observations],
                ].map(([label, value]) => (
                  <tr key={label as string} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 px-4 text-[#9e9e9e] w-48">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Aquisição */}
        <section>
          <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Aquisição</h2>
          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  ['Tipo', moto.acquisition_type ? ACQUISITION_TYPE_LABELS[moto.acquisition_type as keyof typeof ACQUISITION_TYPE_LABELS] ?? moto.acquisition_type : '—'],
                  ['Data da compra', formatDate(moto.purchase_date)],
                  ['Valor pago', moto.acquisition_amount ? formatCurrency(moto.acquisition_amount) : '—'],
                  ['Valor FIPE', moto.fipe_value ? formatCurrency(moto.fipe_value) : '—'],
                  ['Dono anterior', moto.previous_owner],
                  ['CPF/CNPJ anterior', moto.previous_owner_cpf],
                ].map(([label, value]) => (
                  <tr key={label as string} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 px-4 text-[#9e9e9e] w-48">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Documentação registral */}
        <section>
          <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Documentação Registral</h2>
          <div className="bg-[#202020] rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  ['Proprietário registrado', moto.registered_owner_name],
                  ['Documento', moto.registered_owner_document],
                  ['Tipo', moto.registered_owner_type?.toUpperCase()],
                  ['UF', moto.registration_state],
                  ['Transferência', moto.ownership_transferred ? 'Concluída' : 'Pendente'],
                  ['Data da transferência', formatDate(moto.ownership_transfer_date)],
                ].map(([label, value]) => (
                  <tr key={label as string} className="border-b border-[#323232] last:border-0">
                    <td className="h-9 px-4 text-[#9e9e9e] w-48">{label}</td>
                    <td className="h-9 px-4 text-[#f5f5f5]">{value || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Rastreador */}
        {moto.has_tracker && (
          <section>
            <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Rastreador GPS</h2>
            <div className="bg-[#202020] rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  {[
                    ['Marca', moto.tracker_brand],
                    ['Modelo', moto.tracker_model],
                    ['IMEI', moto.tracker_imei],
                  ].map(([label, value]) => (
                    <tr key={label as string} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 px-4 text-[#9e9e9e] w-48">{label}</td>
                      <td className="h-9 px-4 text-[#f5f5f5] font-mono">{value || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Seguro */}
        {moto.has_insurance && (
          <section>
            <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Seguro</h2>
            <div className="bg-[#202020] rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  {[
                    ['Valor mensal', moto.insurance_monthly_amount ? formatCurrency(moto.insurance_monthly_amount) : '—'],
                    ['Vencimento', formatDate(moto.insurance_expiry_date)],
                  ].map(([label, value]) => (
                    <tr key={label as string} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 px-4 text-[#9e9e9e] w-48">{label}</td>
                      <td className="h-9 px-4 text-[#f5f5f5]">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Histórico de status */}
        <section>
          <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">
            Histórico de Status <span className="text-[12px] font-normal text-[#9e9e9e]">({history.length})</span>
          </h2>
          <div className="bg-[#202020] rounded-xl overflow-hidden">
            {history.length === 0 ? (
              <p className="text-[13px] text-[#9e9e9e] px-4 py-3">Nenhuma transição registrada.</p>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="border-b border-[#323232]">
                  <tr>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">De</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Para</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 px-4 text-[#9e9e9e]">
                        {entry.previous_status
                          ? VEHICLE_STATUS_LABELS[entry.previous_status as VehicleStatus]
                          : <span className="italic text-[#616161]">Cadastro</span>}
                      </td>
                      <td className="h-9 px-4 text-[#f5f5f5]">
                        {VEHICLE_STATUS_LABELS[entry.new_status as VehicleStatus]}
                      </td>
                      <td className="h-9 px-4 text-[#9e9e9e]">
                        {new Date(entry.created_at).toLocaleDateString('pt-BR', {
                          day: '2-digit', month: '2-digit', year: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* Documentos */}
        {documents.length > 0 && (
          <section>
            <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Documentos Atuais</h2>
            <div className="bg-[#202020] rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[#323232]">
                  <tr>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Tipo</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Nº</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Emissão</th>
                  </tr>
                </thead>
                <tbody>
                  {documents.map((doc) => (
                    <tr key={doc.id} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 px-4 text-[#f5f5f5] uppercase">{doc.type}</td>
                      <td className="h-9 px-4 text-[#9e9e9e] font-mono">{doc.document_number || '—'}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{formatDate(doc.issued_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Obrigações */}
        {obligations.length > 0 && (
          <section>
            <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Obrigações Anuais</h2>
            <div className="bg-[#202020] rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[#323232]">
                  <tr>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Tipo</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Valor</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Vencimento</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {obligations.map((obl) => (
                    <tr key={obl.id} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 px-4 text-[#f5f5f5]">{OBLIGATION_TYPE_LABELS[obl.type] ?? obl.type}</td>
                      <td className="h-9 px-4 text-[#BAFF1A]">{formatCurrency(obl.amount)}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{formatDate(obl.due_date)}</td>
                      <td className="h-9 px-4">
                        <span className={`text-[12px] font-medium ${obl.status === 'paid' ? 'text-[#4ade80]' : obl.status === 'overdue' ? 'text-[#f87171]' : 'text-[#fbbf24]'}`}>
                          {obl.status === 'paid' ? 'Pago' : obl.status === 'overdue' ? 'Vencido' : obl.status === 'exempt' ? 'Isento' : 'Pendente'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Manutenções recentes */}
        {maintenances.length > 0 && (
          <section>
            <h2 className="text-[14px] font-bold text-[#BAFF1A] mb-3">Manutenções Recentes</h2>
            <div className="bg-[#202020] rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <thead className="border-b border-[#323232]">
                  <tr>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Descrição</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Data prev.</th>
                    <th className="h-9 px-4 text-left text-[#9e9e9e] font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {maintenances.map((m) => (
                    <tr key={m.id} className="border-b border-[#323232] last:border-0">
                      <td className="h-9 px-4 text-[#f5f5f5]">{m.description}</td>
                      <td className="h-9 px-4 text-[#9e9e9e]">{formatDate(m.scheduled_date)}</td>
                      <td className="h-9 px-4">
                        <span className={`text-[12px] font-medium ${m.completed ? 'text-[#4ade80]' : 'text-[#fbbf24]'}`}>
                          {m.completed ? 'Concluída' : 'Pendente'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
