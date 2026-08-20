'use client'

import { useState, useTransition } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { formatCurrency } from '@/lib/utils'
import { receivePaymentAction, cancelChargeAction } from '../../actions'
import { applyCustomerCredits, consolidateLateCharge } from '../actions'

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
  /** Encargo acumulado ainda não realizado — projetado até ser consolidado (R-06). */
  accruedCharges: number
  isOverdue: boolean
  availableCredits: AvailableCredit[]
}

const PAYMENT_METHOD_OPTIONS = [
  { label: 'PIX', value: 'pix' },
  { label: 'Dinheiro', value: 'cash' },
  { label: 'Cartão de crédito', value: 'credit_card' },
  { label: 'Cartão de débito', value: 'debit_card' },
  { label: 'Transferência bancária', value: 'bank_transfer' },
  { label: 'Outro', value: 'other' },
]

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

export function BillingActions({ billingId, customerId, status, amountDue, accruedCharges, isOverdue, availableCredits }: BillingActionsProps) {
  const [isPending, startTransition] = useTransition()
  const [flashError, setFlashError] = useState<string | null>(null)

  const [payOpen, setPayOpen]     = useState(false)
  const [realizeOpen, setRealizeOpen] = useState(false)
  const [creditOpen, setCreditOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  // Register Payment form
  const [payAmount, setPayAmount]   = useState(amountDue > 0 ? amountDue.toFixed(2) : '')
  const excedeSaldo = (parseFloat(payAmount) || 0) > amountDue
  const [payMethod, setPayMethod]   = useState('pix')
  const [payNotes, setPayNotes]     = useState('')

  // Waive Charges form
  const [realizeReason, setRealizeReason] = useState('')

  // Apply Credit form
  const [selectedCredit, setSelectedCredit] = useState(availableCredits[0]?.id ?? '')

  /** Quanto faz sentido abater: o menor entre o crédito e o que se deve. */
  function suggestedCredit(creditId: string): string {
    const saldo = availableCredits.find(c => c.id === creditId)?.available_balance ?? 0
    const valor = Math.min(saldo, amountDue)
    return valor > 0 ? valor.toFixed(2) : ''
  }

  // O campo nascia VAZIO com o saldo disponível como placeholder. Em cinza,
  // "R$ 300,00" é indistinguível de um valor preenchido: o operador via o campo
  // pronto, clicava em Aplicar e recebia "Valor inválido" — como se o sistema
  // tivesse recusado um valor perfeitamente válido. O modal de pagamento ao
  // lado já nascia preenchido com o valor devido; este é que destoava.
  const [creditAmount, setCreditAmount] = useState(() =>
    suggestedCredit(availableCredits[0]?.id ?? ''))

  // Vencida é estado DERIVADO de uma cobrança aberta, não um status terminal:
  // a página envia 'overdue' no lugar de 'open' quando há atraso. Comparar com
  // 'open' escondia a barra inteira — pagar, cancelar, dar baixa, consolidar —
  // exatamente na cobrança que mais precisa de ação.
  const isActionable = status === 'open' || status === 'overdue'
  const hasCredits = availableCredits.length > 0 && isActionable

  function handlePay() {
    const amount = parseFloat(payAmount)
    if (isNaN(amount) || amount <= 0) { setFlashError('Valor inválido'); return }
    if (amount > amountDue) {
      setFlashError(`Acima do saldo de ${formatCurrency(amountDue)}.`)
      return
    }
    setFlashError(null)
    startTransition(async () => {
      // Recebimento é do cliente, alocado a esta cobrança. Valor menor que o
      // devido é aceito: a cobrança segue em aberto com o saldo restante.
      //
      // A alocação era `Math.min(amount, amountDue)` — limitava a alocação e
      // deixava o pagamento com o valor cheio, criando a sobra que sumia. Com o
      // valor já barrado acima, alocar o valor inteiro é o correto: o que entra
      // no caixa é exatamente o que quita a dívida.
      const result = await receivePaymentAction({
        customer_id: customerId,
        amount,
        method:      payMethod,
        paid_at:     new Date().toISOString(),
        notes:       payNotes || undefined,
        allocations: [{ charge_id: billingId, amount }],
      })
      if (!result.ok) { setFlashError(result.error.message); return }
      setPayOpen(false)
      setPayNotes('')
    })
  }

  function handleRealize() {
    // Consolidar não exige justificativa: só realiza o encargo que a política
    // já determina. A exigência de motivo vinha de "dispensar", ação que deixou
    // de existir — e travava a confirmação num campo sem sentido.
    setFlashError(null)
    startTransition(async () => {
      // O encargo projetado só vira receita quando consolidado (R-06); não
      // existe mais "dispensar", porque nada foi lançado ainda.
      const result = await consolidateLateCharge(billingId)
      if (!result.ok) { setFlashError(result.error.message); return }
      setRealizeOpen(false)
      setRealizeReason('')
    })
  }

  function handleCredit() {
    const amount = parseFloat(creditAmount)
    if (!selectedCredit) { setFlashError('Selecione um crédito'); return }
    if (isNaN(amount) || amount <= 0) { setFlashError('Valor inválido'); return }
    setFlashError(null)
    startTransition(async () => {
      // A aplicação percorre todos os créditos do cliente e abate a cobrança
      // de vencimento mais antigo — regra de applyCredits em @gomoto/core.
      const result = await applyCustomerCredits(customerId)
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
            onClick={() => { setFlashError(null); setPayAmount(amountDue > 0 ? amountDue.toFixed(2) : ''); setPayOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-[13px] font-semibold text-bg transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            Registrar pagamento
          </button>
        )}
        {isActionable && isOverdue && accruedCharges > 0 && (
          <button
            onClick={() => { setFlashError(null); setRealizeOpen(true) }}
            disabled={isPending}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:border-fg-mute hover:text-fg disabled:opacity-50"
          >
            Consolidar encargo
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

      {/* ── Registrar pagamento ────────────────────────────────────────────── */}
      <Modal open={payOpen} onClose={() => setPayOpen(false)} title="Registrar pagamento">
        <div className="space-y-4">
          {/* O campo cedia qualquer valor: R$ 50.000.000,00 numa cobrança de
              R$ 500,00 passavam sem aviso. A alocação era limitada ao saldo e o
              excedente sumia — ficava em `payments` e nunca no razão. O teto
              aqui é conveniência; quem recusa de verdade é `receivePayment`,
              porque tela se contorna. */}
          <Input
            label="Valor pago (R$)"
            type="number"
            step="0.01"
            min="0.01"
            max={amountDue.toFixed(2)}
            value={payAmount}
            onChange={e => setPayAmount(e.target.value)}
          />
          <p className="-mt-2 text-[12px] text-fg-mute">
            Saldo desta cobrança: {formatCurrency(amountDue)}. Valor menor é
            aceito — ela segue em aberto pelo restante.
          </p>
          {excedeSaldo && (
            <p className="text-[13px] text-danger">
              Acima do saldo de {formatCurrency(amountDue)}. Para receber a mais,
              registre o valor devido e conceda o excedente como crédito ao cliente.
            </p>
          )}
          <Select
            label="Forma de pagamento"
            value={payMethod}
            onChange={e => setPayMethod(e.target.value)}
            options={PAYMENT_METHOD_OPTIONS}
          />
          <Textarea
            label="Observações (opcional)"
            value={payNotes}
            onChange={e => setPayNotes(e.target.value)}
            rows={2}
          />
          {flashError && <p className="text-[13px] text-danger">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setPayOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-border text-[13px] text-fg-mute hover:text-fg"
            >
              Cancelar
            </button>
            <button
              onClick={handlePay}
              disabled={isPending || excedeSaldo}
              className="inline-flex h-9 items-center px-4 rounded-full bg-primary text-[13px] font-semibold text-bg hover:bg-primary-hover disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Confirmar pagamento'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Consolidar encargo ─────────────────────────────────────────────── */}
      {/*
        O texto dizia "os encargos serão ZERADOS" — herança do antigo "Dispensar
        encargos". Consolidar faz o oposto: transforma o encargo calculado pelo
        relógio em recebível de verdade (`late_charge_realized`). Quem lesse o
        aviso clicaria esperando perdoar a dívida e acabaria cobrando o cliente.
      */}
      <Modal open={realizeOpen} onClose={() => setRealizeOpen(false)} title="Consolidar encargo">
        <div className="space-y-4">
          <p className="text-[13px] text-fg-mute">
            A multa e os juros acumulados até hoje passam a ser cobrados do cliente:
            saem do cálculo por tempo e viram valor devido, com lançamento no razão.
            A partir daí seguem acumulando sobre o novo saldo.
          </p>
          <Textarea
            label="Motivo"
            value={realizeReason}
            onChange={e => setRealizeReason(e.target.value)}
            rows={3}
            placeholder="Observação (opcional)…"
          />
          {flashError && <p className="text-[13px] text-danger">{flashError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setRealizeOpen(false)}
              className="inline-flex h-9 items-center px-4 rounded-full border border-border text-[13px] text-fg-mute hover:text-fg"
            >
              Cancelar
            </button>
            <button
              onClick={handleRealize}
              disabled={isPending}
              className="inline-flex h-9 items-center px-4 rounded-full bg-primary text-[13px] font-semibold text-bg hover:bg-primary-hover disabled:opacity-50"
            >
              {isPending ? 'Salvando…' : 'Consolidar'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Aplicar crédito ────────────────────────────────────────────────── */}
      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title="Aplicar crédito">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-[13px] text-fg-mute">Crédito disponível</label>
            <select
              value={selectedCredit}
              onChange={e => {
                setSelectedCredit(e.target.value)
                setCreditAmount(suggestedCredit(e.target.value))
              }}
              className="w-full rounded-lg border border-divider bg-surface px-3 py-2 text-[13px] text-fg focus:border-primary focus:outline-none"
            >
              {availableCredits.map(c => (
                <option key={c.id} value={c.id}>
                  {CREDIT_ORIGIN_LABELS[c.origin] ?? c.origin} — saldo {formatCurrency(c.available_balance)}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Valor a aplicar (R$)"
            type="number"
            step="0.01"
            min="0.01"
            value={creditAmount}
            onChange={e => setCreditAmount(e.target.value)}
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
