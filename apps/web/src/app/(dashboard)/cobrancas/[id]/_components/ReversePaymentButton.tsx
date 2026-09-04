'use client'

/**
 * Estorno de pagamento — o botão que faltava.
 *
 * `reversePaymentAction` existia exportada e sem nenhum chamador: a regra
 * estava pronta e não havia como acioná-la pela tela. Era também por isso que
 * um defeito nela sobrevivia — estornar abatimento por crédito lançava exceção
 * DEPOIS de marcar o pagamento como estornado, e ninguém batia nesse caminho.
 *
 * O estorno não apaga nada (Princípio 3): o pagamento continua na tabela com
 * data e motivo, e o razão ganha a transação inversa amarrada à original. A
 * cobrança volta a ficar em aberto porque o saldo é derivado.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Undo2 } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { formatCurrency } from '@/lib/utils'
import { reversePaymentAction } from '../../actions'

export function ReversePaymentButton({
  paymentId,
  amount,
}: {
  paymentId: string
  amount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    setErro(null)
    startTransition(async () => {
      const result = await reversePaymentAction(paymentId, motivo)
      if (!result.ok) { setErro(result.error.message); return }
      setOpen(false)
      setMotivo('')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setErro(null); setOpen(true) }}
        title="Estornar pagamento"
        className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border px-3 text-[12px] text-fg-mute transition-colors hover:border-danger hover:text-danger"
      >
        <Undo2 className="h-3.5 w-3.5" /> Estornar
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Estornar pagamento">
        <div className="space-y-4">
          <p className="text-[13px] text-fg-mute">
            O recebimento de {formatCurrency(amount)} é desfeito no razão e a cobrança
            volta a ficar em aberto. O pagamento não é apagado: fica registrado como
            estornado, com data e motivo. Se o valor veio de crédito do cliente, o
            crédito volta para o saldo dele.
          </p>

          <div>
            <label className="mb-1.5 block text-[13px] text-fg-mute">Motivo</label>
            <textarea
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg"
              rows={3}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Chargeback, valor lançado na cobrança errada…"
            />
            <p className="mt-1 text-[12px] text-fg-mute">Mínimo de 3 caracteres.</p>
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
              disabled={isPending || motivo.trim().length < 3}
              className="inline-flex h-9 items-center rounded-full bg-danger px-4 text-[13px] font-semibold text-bg hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? 'Estornando…' : 'Estornar'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
