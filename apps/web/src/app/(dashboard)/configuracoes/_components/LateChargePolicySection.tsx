'use client'

/**
 * Política de encargo por atraso — a única forma de configurar multa e juros.
 *
 * Antes desta tela, a política só existia porque o seed a inseriu: mudar multa
 * ou juros exigia SQL direto no banco. O que havia em Configurações era um
 * `saveFinancialSettings` sem chamador, gravando JSON numa chave que nenhum
 * código lia.
 *
 * Salvar cria uma VERSÃO nova. Não há edição da vigente de propósito: a
 * cobrança guarda `late_charge_policy_id`, então o que foi emitido continua
 * valendo o que valia no dia — mexer na linha vigente mudaria retroativamente
 * o que clientes antigos devem.
 */

import { useState, useTransition } from 'react'
import { Percent } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatDate } from '@/lib/utils'
import {
  toPolicyInput,
  DAYS_PER_MONTH,
  type LateChargePolicy,
} from '@gomoto/core'
import { createLateChargePolicyAction } from '../actions'

export type PolicyVersion = LateChargePolicy & {
  id: string
  version: number
  effective_from: string
}

/** Decimal com vírgula, como o resto do sistema — sem zeros à toa. */
function num(n: number, casas = 2): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })
}

function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function LateChargePolicySection({ versions }: { versions: PolicyVersion[] }) {
  const [isPending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState(false)

  // A vigente é a de maior `effective_from` que já começou — a mesma ordem que
  // `resolveLateChargePolicy` usa na emissão.
  const hoje = hojeLocal()
  const vigente = versions.find((v) => v.effective_from <= hoje) ?? versions[0]
  const futuras = versions.filter((v) => v.effective_from > hoje)

  const inicial = vigente
    ? toPolicyInput(vigente)
    : { fee_type: 'percentage' as const, fee_value: 2, monthly_interest_percent: 1, grace_period_days: 0, min_amount: 0 }

  const [feeType, setFeeType]   = useState<'percentage' | 'fixed'>(inicial.fee_type)
  const [fee, setFee]           = useState(String(inicial.fee_value))
  const [juros, setJuros]       = useState(String(inicial.monthly_interest_percent))
  const [carencia, setCarencia] = useState(String(inicial.grace_period_days))
  const [minimo, setMinimo]     = useState(String(inicial.min_amount))
  const [vigencia, setVigencia] = useState(hoje)

  // O operador digita ao mês porque é assim que a cláusula do contrato fala; o
  // banco guarda ao dia. Mostrar a taxa diária derivada evita que a conversão
  // seja um segredo entre o formulário e a tabela.
  const jurosDia = (parseFloat(juros) || 0) / DAYS_PER_MONTH

  function salvar() {
    setErro(null)
    setOk(false)
    startTransition(async () => {
      const r = await createLateChargePolicyAction({
        fee_type: feeType,
        fee_value: parseFloat(fee),
        monthly_interest_percent: parseFloat(juros),
        grace_period_days: parseInt(carencia, 10),
        min_amount: parseFloat(minimo),
        effective_from: vigencia,
      })
      if (!r.ok) { setErro(r.error.message); return }
      setOk(true)
    })
  }

  return (
    <section>
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-full bg-warning-bg p-2.5 border border-warning">
          <Percent className="h-5 w-5 text-warning" />
        </div>
        <div>
          <h2 className="text-[28px] font-semibold text-fg">Encargo por atraso</h2>
          <p className="text-[13px] text-fg-mute">
            Multa e juros cobrados quando a cobrança vence sem pagamento. Vale para
            toda a empresa — cobranças já emitidas mantêm a regra do dia em que saíram.
          </p>
        </div>
      </div>

      <Card>
        <div className="space-y-5">
          {vigente && (
            <div className="rounded-lg border border-divider bg-surface-2 px-4 py-3 text-[13px]">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-fg-mute">
                  Em vigor · versão {vigente.version} · desde {formatDate(vigente.effective_from)}
                </span>
                <span className="tabular-nums text-fg">
                  {vigente.fee_type === 'percentage'
                    ? `${num(toPolicyInput(vigente).fee_value)}% de multa`
                    : `${formatCurrency(vigente.fee_value)} de multa`}
                  {' · '}
                  {num(toPolicyInput(vigente).monthly_interest_percent)}% ao mês
                  {vigente.grace_period_days > 0 && ` · ${vigente.grace_period_days} dia(s) de carência`}
                  {vigente.min_amount > 0 && ` · mínimo ${formatCurrency(vigente.min_amount)}`}
                </span>
              </div>
            </div>
          )}

          {futuras.length > 0 && (
            <div className="rounded-lg border border-info bg-info-bg px-4 py-3 text-[13px] text-info">
              {futuras.length === 1 ? 'Há uma versão agendada' : `Há ${futuras.length} versões agendadas`}
              {' '}para {futuras.map((f) => formatDate(f.effective_from)).join(', ')}.
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[13px] text-fg-mute">Tipo de multa</label>
              <select
                value={feeType}
                onChange={(e) => setFeeType(e.target.value as 'percentage' | 'fixed')}
                className="h-9 w-full rounded-lg border border-divider bg-surface px-3 text-[13px] text-fg focus:border-primary focus:outline-none"
              >
                <option value="percentage">Percentual sobre o saldo</option>
                <option value="fixed">Valor fixo em reais</option>
              </select>
            </div>

            <Input
              label={feeType === 'percentage' ? 'Multa (%)' : 'Multa (R$)'}
              type="number"
              step="0.01"
              min="0"
              value={fee}
              onChange={(e) => setFee(e.target.value)}
            />

            <div>
              <Input
                label="Juros ao mês (%)"
                type="number"
                step="0.01"
                min="0"
                value={juros}
                onChange={(e) => setJuros(e.target.value)}
              />
              <p className="mt-1 text-[12px] text-fg-mute tabular-nums">
                Equivale a {num(jurosDia, 4)}% ao dia, sobre o saldo em aberto.
              </p>
            </div>

            <div>
              <Input
                label="Carência (dias)"
                type="number"
                step="1"
                min="0"
                value={carencia}
                onChange={(e) => setCarencia(e.target.value)}
              />
              <p className="mt-1 text-[12px] text-fg-mute">
                Dias após o vencimento antes de o encargo começar a correr.
              </p>
            </div>

            <Input
              label="Encargo mínimo (R$)"
              type="number"
              step="0.01"
              min="0"
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
            />

            <div>
              <Input
                label="Em vigor a partir de"
                type="date"
                min={hoje}
                value={vigencia}
                onChange={(e) => setVigencia(e.target.value)}
              />
              <p className="mt-1 text-[12px] text-fg-mute">
                Não retroage: o que já foi cobrado mantém a regra antiga.
              </p>
            </div>
          </div>

          {erro && (
            <div className="rounded-lg border border-danger bg-danger-bg px-3 py-2 text-[13px] text-danger">
              {erro}
            </div>
          )}
          {ok && (
            <div className="rounded-lg border border-success bg-success-bg px-3 py-2 text-[13px] text-success">
              Nova versão salva. Cobranças emitidas a partir da vigência usarão esta regra.
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={salvar} disabled={isPending}>
              {isPending ? 'Salvando…' : 'Salvar nova versão'}
            </Button>
          </div>
        </div>
      </Card>
    </section>
  )
}
