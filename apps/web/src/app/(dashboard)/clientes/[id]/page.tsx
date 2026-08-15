import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getCurrentTenantId } from '@/lib/auth/tenant'
import { applyCpfMask, applyCnpjMask, applyPhoneMask, applyZipMask } from '@gomoto/core'
import { formatCurrency } from '@/lib/utils'
import { MessageCircle } from 'lucide-react'
import { CustomerAppAccess } from '../_components/CustomerAppAccess'
import type { Customer, Rental } from '@gomoto/core'

const BUCKET = 'customer-documents'

function fmt(d: string | null | undefined) {
  if (!d) return '—'
  const date = d.includes('T') ? new Date(d) : new Date(d + 'T12:00:00')
  return date.toLocaleDateString('pt-BR')
}

function Row({ label, value, mono = false }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <tr className="border-b border-divider last:border-0">
      <td className="h-9 px-4 text-fg-mute w-48 shrink-0 text-[13px]">{label}</td>
      <td className={`h-9 px-4 text-[13px] ${mono ? 'font-mono' : ''} ${value ? 'text-fg' : 'text-fg-mute italic'}`}>
        {value ?? '—'}
      </td>
    </tr>
  )
}

async function getSignedUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null | undefined): Promise<string | null> {
  if (!path) return null
  // Já é URL completa (legado — gerada antes do bucket privado)
  if (path.startsWith('http')) return path
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const tenantId = await getCurrentTenantId(supabase)
  if (!tenantId) notFound()

  const [customerResult, rentalResult, creditsResult, delinquencyBlocksResult] = await Promise.all([
    supabase.from('customers').select('*').eq('id', id).single(),
    supabase
      .from('rentals')
      .select('*, vehicle:vehicles(license_plate, make, model)')
      .eq('customer_id', id)
      .eq('status', 'active')
      .maybeSingle(),
    supabase
      .from('customer_credits')
      // Saldo disponível é derivado em `customer_credit_balances`, não coluna.
      .select('id, amount, origin, reason, created_at')
      .eq('customer_id', id)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false }),
    supabase
      .from('delinquency_blocks')
      .select('action, reason, actor_id, acted_at')
      .eq('customer_id', id)
      .eq('tenant_id', tenantId)
      .order('acted_at', { ascending: false })
      .limit(5),
  ])

  if (customerResult.error || !customerResult.data) notFound()

  const customer = customerResult.data as Customer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rental = rentalResult.data as (Rental & { vehicle?: { license_plate: string; make: string; model: string } | null }) | null
  const credits = (creditsResult.data ?? []) as { id: string; amount: number;  origin: string; reason: string; created_at: string }[]
  const delinquencyBlocks = (delinquencyBlocksResult.data ?? []) as { action: string; reason: string; actor_id: string; acted_at: string }[]

  const CREDIT_ORIGIN_LABELS: Record<string, string> = {
    maintenance_refund: 'Estorno manutenção',
    reversal:          'Estorno',
    manual_adjustment: 'Ajuste manual',
  }
  const DELINQUENCY_ACTION_LABELS: Record<string, string> = {
    block:   'Bloqueado',
    unblock: 'Desbloqueado',
  }
  // Bloqueado = última ação do log é 'block'. `customers.delinquency_status`
  // saiu na ADR 0024 — era mantida por trigger inerte (F-04).
  const isBlocked = delinquencyBlocks[0]?.action === 'block'

  const [cnhSignedUrl, residencySignedUrl] = await Promise.all([
    getSignedUrl(supabase, customer.drivers_license_photo_url),
    getSignedUrl(supabase, customer.residency_proof_url ?? customer.document_photo_url),
  ])

  const isActive    = customer.active !== false
  const isCompany   = customer.person_type === 'company'
  const whatsappHref = customer.phone
    ? `https://wa.me/55${customer.phone.replace(/\D/g, '')}`
    : null

  const cnhExpiryDate = customer.drivers_license_validity
    ? new Date(customer.drivers_license_validity + 'T12:00:00')
    : null
  const cnhExpired = cnhExpiryDate ? cnhExpiryDate < new Date() : false

  const fullAddress = [
    customer.street && customer.street_number
      ? `${customer.street}, ${customer.street_number}`
      : customer.street,
    customer.complement,
    customer.neighborhood,
    customer.city && customer.state
      ? `${customer.city} — ${customer.state}`
      : customer.city ?? customer.state,
    customer.zip_code ? applyZipMask(customer.zip_code) : null,
  ].filter(Boolean).join(', ')

  return (
    <div className="min-h-screen bg-bg">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 bg-bg border-b border-divider px-6 h-16 flex items-center gap-4">
        <Link href="/clientes" className="text-[13px] text-fg-mute hover:text-fg transition-colors">
          ← Clientes
        </Link>
        <span className="text-border">/</span>
        <h1 className="text-[18px] font-bold text-fg flex-1 truncate">
          {isCompany ? (customer.company_name ?? customer.name) : customer.name}
        </h1>
        <div className="ml-auto flex items-center gap-3">
          {whatsappHref && (
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full bg-success-bg text-success text-[13px] font-medium hover:opacity-80 transition-opacity"
            >
              <MessageCircle className="w-4 h-4" />
              WhatsApp
            </a>
          )}
          <Link
            href={`/clientes/${id}/editar`}
            className="inline-flex items-center h-9 px-4 rounded-full bg-surface-2 text-fg text-[13px] font-medium hover:bg-divider transition-colors"
          >
            Editar
          </Link>
        </div>
      </div>

      <div className="px-6 py-6 space-y-6 max-w-4xl mx-auto">

        {/* ── Status ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className={`inline-flex items-center h-7 px-3 rounded-full text-[13px] font-medium border ${
            isActive
              ? 'bg-success-bg text-success border-success'
              : 'bg-danger-bg text-danger border-danger'
          }`}>
            {isActive ? 'Ativo' : 'Ex-Cliente'}
          </span>
          <span className={`inline-flex items-center h-7 px-3 rounded-full text-[13px] font-medium border ${
            isCompany
              ? 'bg-info-bg text-info border-info'
              : 'bg-primary-tint text-primary border-primary'
          }`}>
            {isCompany ? 'Pessoa Jurídica' : 'Pessoa Física'}
          </span>
          {customer.payment_status && (
            <span className="text-[13px] text-fg-mute">{customer.payment_status}</span>
          )}
        </div>

        {/* ── Contrato Ativo ───────────────────────────────────────────────── */}
        {rental && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Contrato Ativo</h2>
            <div className="bg-surface rounded-xl p-4 flex items-center gap-6 flex-wrap">
              <div>
                <p className="text-[12px] text-fg-mute uppercase tracking-wide font-medium mb-1">Veículo</p>
                <p className="text-[18px] font-bold font-mono text-primary">{rental.vehicle?.license_plate}</p>
                <p className="text-[13px] text-fg">{rental.vehicle?.make} {rental.vehicle?.model}</p>
              </div>
              {rental.cycle_amount != null && (
                <div className="border-l border-divider pl-6">
                  <p className="text-[12px] text-fg-mute uppercase tracking-wide font-medium mb-1">
                    Valor {rental.cycle === 'weekly' ? 'Semanal' : 'Mensal'}
                  </p>
                  <p className="text-[18px] font-bold text-fg">{formatCurrency(rental.cycle_amount)}</p>
                </div>
              )}
              <div className="ml-auto">
                {rental.vehicle_id && (
                  <Link
                    href={`/veiculos/${rental.vehicle_id}`}
                    className="h-8 px-3 rounded-lg bg-surface-2 text-fg text-[12px] font-medium hover:bg-divider transition-colors flex items-center"
                  >
                    Ver veículo →
                  </Link>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── Dados da Empresa (PJ) ────────────────────────────────────────── */}
        {isCompany && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Dados da Empresa</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  <Row label="Razão Social" value={customer.company_name} />
                  <Row label="Nome Fantasia" value={customer.trade_name} />
                  <Row label="CNPJ" value={customer.cnpj ? applyCnpjMask(customer.cnpj) : null} mono />
                  <Row label="Responsável" value={customer.name} />
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Dados Pessoais (PF) ──────────────────────────────────────────── */}
        {!isCompany && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Dados Pessoais</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  <Row label="CPF" value={customer.cpf ? applyCpfMask(customer.cpf) : null} mono />
                  <Row label="RG" value={customer.rg} />
                  <Row label="Data de Nascimento" value={fmt(customer.birth_date)} />
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Contato ──────────────────────────────────────────────────────── */}
        <section>
          <h2 className="text-[14px] font-bold text-primary mb-3">Contato</h2>
          <div className="bg-surface rounded-xl overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                <tr className="border-b border-divider">
                  <td className="h-9 px-4 text-fg-mute w-48 text-[13px]">Telefone 1</td>
                  <td className="h-9 px-4 text-[13px]">
                    {customer.phone ? (
                      <a href={whatsappHref!} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-fg hover:text-primary transition-colors w-fit">
                        <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                        {applyPhoneMask(customer.phone)}
                      </a>
                    ) : <span className="text-fg-mute italic">—</span>}
                  </td>
                </tr>
                {customer.phone2 && (
                  <tr className="border-b border-divider">
                    <td className="h-9 px-4 text-fg-mute w-48 text-[13px]">Telefone 2</td>
                    <td className="h-9 px-4 text-[13px]">
                      <a href={`https://wa.me/55${customer.phone2.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1.5 text-fg hover:text-primary transition-colors w-fit">
                        <MessageCircle className="w-3.5 h-3.5 shrink-0" />
                        {applyPhoneMask(customer.phone2)}
                      </a>
                    </td>
                  </tr>
                )}
                <Row label="Email" value={customer.email} />
                {!isCompany && customer.emergency_contact_name && (
                  <Row label="Contato de Emergência" value={
                    [customer.emergency_contact_name, customer.emergency_contact_phone ? applyPhoneMask(customer.emergency_contact_phone) : null]
                      .filter(Boolean).join(' — ')
                  } />
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Endereço ─────────────────────────────────────────────────────── */}
        {(customer.street || customer.city || customer.address) && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Endereço</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  {customer.street ? (
                    <>
                      <Row label="Logradouro" value={`${customer.street}${customer.street_number ? `, ${customer.street_number}` : ''}`} />
                      {customer.complement && <Row label="Complemento" value={customer.complement} />}
                      <Row label="Bairro" value={customer.neighborhood} />
                      <Row label="Cidade / UF" value={[customer.city, customer.state].filter(Boolean).join(' — ') || null} />
                      <Row label="CEP" value={customer.zip_code ? applyZipMask(customer.zip_code) : null} mono />
                    </>
                  ) : (
                    <Row label="Endereço" value={fullAddress || customer.address} />
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Habilitação (PF) ─────────────────────────────────────────────── */}
        {!isCompany && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Habilitação (CNH)</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  <Row label="Número" value={customer.drivers_license} mono />
                  <Row label="Categoria" value={customer.drivers_license_category} />
                  <tr className="border-b border-divider last:border-0">
                    <td className="h-9 px-4 text-fg-mute w-48 text-[13px]">Validade</td>
                    <td className={`h-9 px-4 text-[13px] ${cnhExpired ? 'text-danger' : 'text-fg'}`}>
                      {customer.drivers_license_validity ? (
                        <>
                          {fmt(customer.drivers_license_validity)}
                          {cnhExpired && <span className="ml-2 text-[11px] font-medium text-danger">(Vencida)</span>}
                        </>
                      ) : <span className="text-fg-mute italic">—</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Acesso ao App (somente PF com email) ─────────────────────────── */}
        {!isCompany && (
          <section>
            <div className="bg-surface rounded-xl p-4">
              <CustomerAppAccess
                customerId={id}
                customerEmail={customer.email}
                hasAppAccess={!!customer.user_id}
              />
            </div>
          </section>
        )}

        {/* ── Documentos ───────────────────────────────────────────────────── */}
        {(cnhSignedUrl || residencySignedUrl) && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Documentos</h2>
            <div className="grid grid-cols-2 gap-4">
              {cnhSignedUrl && (
                <DocumentThumb url={cnhSignedUrl} label="Foto da CNH" alt="CNH do cliente" />
              )}
              {residencySignedUrl && (
                <DocumentThumb
                  url={residencySignedUrl}
                  label={isCompany ? 'Documento da Empresa' : 'Comprovante de Residência'}
                  alt="Documento"
                />
              )}
            </div>
          </section>
        )}

        {/* ── Encerramento (ex-clientes) ───────────────────────────────────── */}
        {!isActive && (customer.departure_date || customer.departure_reason) && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Encerramento</h2>
            <div className="bg-surface rounded-xl overflow-hidden">
              <table className="w-full text-[13px]">
                <tbody>
                  <Row label="Data de Saída" value={fmt(customer.departure_date)} />
                  <Row label="Motivo" value={customer.departure_reason} />
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Inadimplência ────────────────────────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-bold text-primary">
              Situação financeira
              {isBlocked && (
                <span className="ml-2 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-semibold text-danger">Bloqueado</span>
              )}
            </h2>
          </div>
          <div className="rounded-xl bg-surface overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                <tr className="border-b border-divider last:border-0">
                  <td className="h-9 w-48 px-4 text-fg-mute">Status</td>
                  <td className="h-9 px-4 text-fg">
                    {isBlocked
                      ? <span className="text-danger font-medium">Bloqueado para novas locações</span>
                      : <span className="text-success">Regular</span>}
                  </td>
                </tr>
                <tr className="border-b border-divider last:border-0">
                  <td className="h-9 w-48 px-4 text-fg-mute">Créditos disponíveis</td>
                  <td className="h-9 px-4 font-mono text-fg">
                    {formatCurrency(credits.reduce((s, c) => s + c.amount, 0))}
                    <span className="ml-2 text-[12px] text-fg-mute">({credits.filter(c => c.amount > 0).length} ativos)</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {delinquencyBlocks.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Ação</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Data</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Motivo</th>
                  </tr>
                </thead>
                <tbody>
                  {delinquencyBlocks.map((b, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className={`h-9 px-4 font-medium ${b.action === 'block' ? 'text-danger' : 'text-success'}`}>
                        {DELINQUENCY_ACTION_LABELS[b.action] ?? b.action}
                      </td>
                      <td className="h-9 px-4 text-fg-mute">
                        {new Date(b.acted_at).toLocaleDateString('pt-BR')}
                      </td>
                      <td className="h-9 max-w-[240px] truncate px-4 text-fg-mute">{b.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Créditos do cliente ───────────────────────────────────────────── */}
        {credits.length > 0 && (
          <section>
            <h2 className="mb-3 text-[14px] font-bold text-primary">
              Créditos
              <span className="ml-2 text-[12px] font-normal text-fg-mute">({credits.length})</span>
            </h2>
            <div className="overflow-hidden rounded-xl border border-divider">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-divider bg-surface">
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Origem</th>
                    <th className="h-9 px-4 text-left font-medium text-fg-mute">Data</th>
                    <th className="h-9 px-4 text-right font-medium text-fg-mute">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {credits.map(c => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                      <td className="h-9 px-4 text-fg-soft">{CREDIT_ORIGIN_LABELS[c.origin] ?? c.origin}</td>
                      <td className="h-9 px-4 text-fg-mute">{new Date(c.created_at).toLocaleDateString('pt-BR')}</td>
                      <td className="h-9 px-4 text-right font-mono text-fg">{formatCurrency(c.amount)}</td>
                      {/* A coluna de saldo disponível saiu: ele é derivado em
                          `customer_credit_balances`, a partir do quanto do
                          crédito já foi aplicado. Exibir o valor lançado é
                          honesto; exibir uma coluna inexistente não era. */}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* ── Observações ──────────────────────────────────────────────────── */}
        {customer.observations && (
          <section>
            <h2 className="text-[14px] font-bold text-primary mb-3">Observações</h2>
            <div className="bg-surface rounded-xl px-4 py-3">
              <p className="text-[13px] text-fg-mute whitespace-pre-wrap">{customer.observations}</p>
            </div>
          </section>
        )}

      </div>
    </div>
  )
}

function DocumentThumb({ url, label, alt }: { url: string; label: string; alt: string }) {
  const isPdf = url.includes('.pdf') || url.includes('application%2Fpdf')
  return (
    <div className="space-y-2">
      <p className="text-[12px] font-medium text-fg-mute">{label}</p>
      <a href={url} target="_blank" rel="noopener noreferrer"
        className="block relative group rounded-xl overflow-hidden border border-divider bg-surface">
        {isPdf ? (
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="w-12 h-12 rounded-xl bg-surface-2 flex items-center justify-center text-fg-mute text-[12px] font-bold">PDF</div>
            <span className="text-[12px] text-fg-mute group-hover:text-primary transition-colors">Abrir PDF →</span>
          </div>
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={alt} className="w-full h-40 object-cover opacity-80 group-hover:opacity-100 transition-opacity" />
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="text-white font-medium bg-black/60 px-3 py-1.5 rounded-full text-[13px]">Ver original</span>
            </div>
          </>
        )}
      </a>
    </div>
  )
}
