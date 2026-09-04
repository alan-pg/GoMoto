'use client'

/**
 * Devolver crédito ao cliente em dinheiro.
 *
 * Crédito é dívida da empresa com o cliente. Existiam duas formas de quitar e
 * só uma estava construída: abater em cobrança futura. Enquanto o contrato
 * está vivo isso basta; encerrado, não há cobrança para abater e o cliente ia
 * embora credor, com o passivo pendurado no balanço.
 *
 * A improvisação natural seria "estornar" o crédito — e ela corrompe o dado:
 * inverter `credit_granted` apaga também a despesa do serviço e a recuperação
 * da parte do cliente. A moto passaria a constar com custo zero.
 *
 * Devolver é outra coisa: baixa o passivo contra o CAIXA, exatamente como a
 * devolução de caução. O lançamento de origem permanece intacto.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Banknote } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { formatCurrency } from '@gomoto/core'
import { settleCustomerCredit } from '../actions'

export function SettleCreditButton({
  customerId,
  balance,
}: {
  customerId: string
  balance: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [valor, setValor] = useState('')
  const [notas, setNotas] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  // Sem saldo não há o que devolver — o botão não existe.
  if (balance <= 0) return null

  const pedido = parseFloat(valor.replace(',', '.')) || 0
  const excede = pedido > balance

  function abrir() {
    setErro(null)
    setValor(balance.toFixed(2))
    setOpen(true)
  }

  function confirmar() {
    setErro(null)
    startTransition(async () => {
      const result = await settleCustomerCredit({
        customer_id: customerId,
        amount: pedido,
        notes: notas.trim() || undefined,
      })
      if (!result.ok) { setErro(result.error.message); return }
      setOpen(false)
      setValor('')
      setNotas('')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={abrir}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:text-fg"
      >
        <Banknote className="h-3.5 w-3.5" /> Devolver crédito
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Devolver crédito ao cliente">
        <div className="space-y-4">
          <p className="text-[13px] text-fg-mute">
            Registra que a empresa devolveu o dinheiro por fora do sistema — PIX,
            transferência ou espécie. O saldo de crédito baixa contra o caixa; o
            lançamento que originou o crédito continua intacto.
          </p>

          <div className="rounded-lg border border-divider bg-surface-2 px-3 py-2 text-[13px]">
            <span className="text-fg-mute">Saldo disponível</span>
            <span className="ml-2 font-mono text-fg">{formatCurrency(balance)}</span>
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] text-fg-mute">Valor a devolver (R$)</label>
            <input
              type="number"
              min="0"
              step="0.01"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
            {excede && (
              <p className="mt-1 text-[12px] text-danger">
                Maior que o saldo de {formatCurrency(balance)}.
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-[13px] text-fg-mute">
              Observação <span className="text-[12px]">(opcional)</span>
            </label>
            <input
              type="text"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="PIX em 19/08, comprovante no WhatsApp…"
            />
          </div>

          {erro && <p className="text-[13px] text-danger">{erro}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[13px] text-fg-mute hover:text-fg"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={isPending || pedido <= 0 || excede}
              className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-contrast hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Registrando…' : 'Confirmar devolução'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
