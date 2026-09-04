'use client'

/**
 * Bloqueio manual do cliente — registro administrativo, não portão.
 *
 * `blockCustomer` e `unblockCustomer` existiam corretas e sem nenhum chamador
 * desde a Spec 0014 (P-8): a regra estava pronta e não havia botão. Era por
 * isso que um defeito nelas sobreviveu meses sem ninguém notar.
 *
 * O bloqueio NÃO impede abrir locação (decisão do Alan, 2026-08-15). Ele marca
 * a decisão da empresa sobre aquele cliente, com autor, data e motivo em
 * `delinquency_blocks` — um log append-only, porque interessa saber por que ele
 * foi bloqueado em março e liberado em abril. O formulário de locação exibe a
 * situação; quem decide é quem está na frente do cliente.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Ban, CheckCircle2 } from 'lucide-react'

import { Modal } from '@/components/ui/Modal'
import { blockCustomer, unblockCustomer } from '../actions'

export function BlockCustomerButton({
  customerId,
  isBlocked,
}: {
  customerId: string
  isBlocked: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [open, setOpen] = useState(false)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)

  function confirmar() {
    setErro(null)
    startTransition(async () => {
      const result = isBlocked
        ? await unblockCustomer({ customer_id: customerId, justification: texto })
        : await blockCustomer({ customer_id: customerId, reason: texto })

      if (!result.ok) { setErro(result.error.message); return }
      setOpen(false)
      setTexto('')
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setErro(null); setOpen(true) }}
        className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-4 text-[13px] transition-colors ${
          isBlocked
            ? 'border-success text-success hover:bg-success-bg'
            : 'border-danger text-danger hover:bg-danger-bg'
        }`}
      >
        {isBlocked
          ? <><CheckCircle2 className="h-3.5 w-3.5" /> Desbloquear</>
          : <><Ban className="h-3.5 w-3.5" /> Bloquear</>}
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isBlocked ? 'Desbloquear cliente' : 'Bloquear cliente'}
      >
        <div className="space-y-4">
          <p className="text-[13px] text-fg-mute">
            {isBlocked
              ? 'O cliente volta a constar como liberado. O histórico de bloqueios é preservado.'
              : 'Marca o cliente como bloqueado para a equipe. Não impede abrir locação nem cobrar — ao criar uma locação o operador vê o aviso e decide.'}
          </p>

          <div>
            <label className="mb-1.5 block text-[13px] text-fg-mute">
              {isBlocked ? 'Justificativa' : 'Motivo'}
            </label>
            <textarea
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-fg"
              rows={3}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={isBlocked
                ? 'Negociou a dívida, pagou o acordo…'
                : 'Inadimplência recorrente, contato perdido…'}
            />
            <p className="mt-1 text-[12px] text-fg-mute">Mínimo de 5 caracteres.</p>
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
              disabled={isPending || texto.trim().length < 5}
              className={`inline-flex h-9 items-center rounded-full px-4 text-[13px] font-semibold text-bg disabled:opacity-50 ${
                isBlocked ? 'bg-success hover:opacity-90' : 'bg-danger hover:opacity-90'
              }`}
            >
              {isPending ? 'Salvando…' : isBlocked ? 'Desbloquear' : 'Bloquear'}
            </button>
          </div>
        </div>
      </Modal>
    </>
  )
}
