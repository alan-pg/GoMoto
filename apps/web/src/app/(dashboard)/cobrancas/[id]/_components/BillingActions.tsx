'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { formatCurrency } from '@/lib/utils'
import { type LateChargePolicy } from '@gomoto/core'
import { RegistrarPagamentoModal, type CobrancaParaPagamento } from '@/components/financial/RegistrarPagamentoModal'
import { cancelChargeAction } from '../../actions'
import { applyCustomerCredits } from '../actions'

interface AvailableCredit {
  id: string
  amount: number
  available_balance: number
  origin: string
  reason: string
}

interface BillingActionsProps {
  billingId: string
  customerId: string
  status: string
  amountDue: number
  /** Tudo que o modal compartilhado precisa para identificar a cobrança e
   *  recalcular o devido na data do recebimento. */
  cobranca: CobrancaParaPagamento
  latePolicy: LateChargePolicy | null
  availableCredits: AvailableCredit[]
  /** Saldo de crédito do cliente — um POOL, vindo do razão.
   *
   *  Cada linha de `availableCredits` carrega este MESMO número em
   *  `available_balance`: somá-las multiplicaria o saldo pela quantidade de
   *  créditos concedidos. Por isso ele vem separado, uma vez só. */
  creditBalance: number
}


// A origem gravada em `customer_credits.origin` é o `source_module` de quem
// gerou o crédito. Faltavam justamente os que o produto cria hoje —
// 'maintenance', 'expense', 'manual' —, então o seletor exibia a chave crua em
// inglês: "maintenance — saldo R$ 300,00".
const CREDIT_ORIGIN_LABELS: Record<string, string> = {
  maintenance:        'Manutenção',
  maintenance_refund: 'Estorno manutenção',
  expense:            'Despesa',
  fine:               'Multa',
  manual:             'Lançamento manual',
  manual_adjustment:  'Ajuste manual',
  reversal:           'Estorno',
  customer_credit:    'Crédito ao cliente',
}

export function BillingActions({ billingId, customerId, status, amountDue, cobranca, latePolicy, availableCredits, creditBalance }: BillingActionsProps) {
  const [isPending, startTransition] = useTransition()
  const [flashError, setFlashError] = useState<string | null>(null)

  const [payOpen, setPayOpen]     = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  // Register Payment form

  // O SELETOR de crédito saiu. O saldo é um POOL por cliente, derivado de
  // `creditos_de_clientes` no razão; as linhas de `customer_credits` guardam o
  // que foi concedido, não o que resta. Escolher entre elas era decisão sem
  // efeito — e a action nem recebia a escolha.
  const saldoDeCredito = creditBalance

  /** Nunca mais que o saldo, nunca mais que a dívida. */
  const tetoDoCredito = Math.round(Math.min(saldoDeCredito, amountDue) * 100) / 100

  // Nasce preenchido com o teto: é o abatimento que o operador quer em quase
  // todo caso, e um campo vazio com placeholder cinza já foi confundido com
  // campo preenchido — clicava em Aplicar e recebia "Valor inválido".
  const [creditAmount, setCreditAmount] = useState(() =>
    tetoDoCredito > 0 ? tetoDoCredito.toFixed(2) : '')

  // Vencida é estado DERIVADO de uma cobrança aberta, não um status terminal:
  // a página envia 'overdue' no lugar de 'open' quando há atraso. Comparar com
  // 'open' escondia a barra inteira — pagar, cancelar, dar baixa, consolidar —
  // exatamente na cobrança que mais precisa de ação.
  const isActionable = status === 'open' || status === 'overdue'
  const hasCredits = availableCredits.length > 0 && isActionable

  function handleCredit() {
    const amount = Math.round((parseFloat(creditAmount) || 0) * 100) / 100
    if (amount <= 0) { setFlashError('Informe um valor maior que zero.'); return }
    if (amount > tetoDoCredito) {
      setFlashError(
        `O máximo aqui é ${formatCurrency(tetoDoCredito)} — o menor entre o saldo `
        + 'de crédito do cliente e o que esta cobrança ainda deve.',
      )
      return
    }
    setFlashError(null)
    startTransition(async () => {
      // Dirigido: este valor, NESTA cobrança. A versão anterior mandava só o
      // cliente e a action varria o saldo para as cobranças mais antigas —
      // podia abater numa que o operador nem tinha aberto.
      const result = await applyCustomerCredits({
        customer_id: customerId,
        charge_id: billingId,
        amount,
      })
      if (!result.ok) { setFlashError(result.error.message); return }
      setCreditOpen(false)
      setCreditAmount('')
    })
  }

  function handleCancel() {
    setFlashError(null)
    startTransition(async () => {
      const result = await cancelChargeAction({ charge_id: billingId, reason: 'Cancelada pelo operador' })
      if (!result.ok) { setFlashError(result.error.message); return }
      setCancelOpen(false)
    })
  }

  return (
    <>
      {flashError && (
        <div className="rounded-xl border border-danger bg-danger-bg px-4 py-3">
          <p className="text-[13px] text-danger">{flashError}</p>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {isActionable && (
          <button
            onClick={() => { setFlashError(null); setPayOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            Registrar pagamento
          </button>
        )}
        {hasCredits && (
          <button
            onClick={() => { setFlashError(null); setCreditOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:border-fg-mute hover:text-fg disabled:opacity-50"
          >
            Aplicar crédito
          </button>
        )}
        {isActionable && (
          <button
            onClick={() => { setFlashError(null); setCancelOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-danger bg-danger-bg px-4 text-[13px] text-danger transition-colors hover:bg-danger-bg disabled:opacity-50"
          >
            Cancelar cobrança
          </button>
        )}
      </div>

      {/* Implementação única, a mesma da lista de cobranças. */}
      <RegistrarPagamentoModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        cobranca={cobranca}
        policy={latePolicy}
      />

      {/* ── Aplicar crédito ────────────────────────────────────────────────── */}
      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title="Aplicar crédito">
        <div className="space-y-4">
          {/* De onde vem e para onde vai, antes de confirmar. O modal antigo
              pedia "qual crédito" — escolha sem efeito, porque o saldo é um
              pool — e mandava só o cliente para a action, que abatia nas
              cobranças mais antigas. Podia nem ser esta. */}
          <div className="rounded-lg border border-divider bg-surface-2 px-3 py-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-fg-mute">Saldo de crédito</span>
              <span className="tabular-nums text-fg">{formatCurrency(saldoDeCredito)}</span>
            </div>
            <div className="mt-1 flex justify-between">
              <span className="text-fg-mute">Esta cobrança deve</span>
              <span className="tabular-nums text-fg">{formatCurrency(amountDue)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-divider pt-1">
              <span className="text-fg-mute">Pode abater até</span>
              <span className="tabular-nums font-semibold text-fg">{formatCurrency(tetoDoCredito)}</span>
            </div>
            {availableCredits.length > 0 && (
              <p className="mt-2 text-[12px] text-fg-mute">
                Origem: {[...new Set(availableCredits.map(c => CREDIT_ORIGIN_LABELS[c.origin] ?? c.origin))].join(', ')}.
              </p>
            )}
          </div>

          <Input
            label="Valor a aplicar (R$)"
            type="number"
            step="0.01"
            min="0.01"
            max={tetoDoCredito.toFixed(2)}
            value={creditAmount}
            onChange={e => {
              // Duas casas e teto na digitação, como no modal de recebimento:
              // o campo aceitava qualquer valor e o excesso só era descoberto
              // depois — quando era descoberto.
              const v = e.target.value.replace(/^(\d*[.,]?\d{0,2}).*$/, '$1')
              const n = parseFloat(v)
              if (!isNaN(n) && n > tetoDoCredito) {
                setCreditAmount(tetoDoCredito.toFixed(2))
                setFlashError(`O máximo aqui é ${formatCurrency(tetoDoCredito)}.`)
                return
              }
              setCreditAmount(v)
              setFlashError(null)
            }}
          />
          {flashError && <p className="text-[13px] text-danger">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCreditOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-border text-[13px] text-fg-mute hover:text-fg"
            >
              Cancelar
            </button>
            <button
              onClick={handleCredit}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-primary text-[13px] font-semibold text-bg hover:bg-primary-hover disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Aplicar crédito'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Cancelar cobrança ──────────────────────────────────────────────── */}
      <Modal open={cancelOpen} onClose={() => setCancelOpen(false)} title="Cancelar cobrança">
        <div className="space-y-4">
          <p className="text-[13px] text-fg-mute">
            Esta cobrança será cancelada e não poderá mais ser reativada. Confirma?
          </p>
          {flashError && <p className="text-[13px] text-danger">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCancelOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-border text-[13px] text-fg-mute hover:text-fg"
            >
              Voltar
            </button>
            <button
              onClick={handleCancel}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full border border-danger bg-danger-bg text-[13px] text-danger transition-opacity hover:opacity-80 disabled:opacity-50"
            >
              {isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
