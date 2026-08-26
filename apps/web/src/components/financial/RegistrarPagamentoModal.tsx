'use client'

/**
 * Registrar pagamento — implementação ÚNICA, usada pela lista de cobranças e
 * pela tela de detalhe.
 *
 * Eram dois modais separados, com o mesmo propósito e comportamentos
 * diferentes: títulos distintos ("Registrar recebimento" × "Registrar
 * pagamento"), um com campo de observações e outro não, tetos calculados por
 * caminhos diferentes, e o erro exibido dentro do modal num e atrás dele no
 * outro. Cada correção precisava ser feita duas vezes — e por duas vezes eu
 * corrigi só um deles.
 *
 * As três camadas de proteção do valor moram aqui, uma vez só:
 *
 *   1. O campo NUNCA guarda valor acima do devido: digitar ou colar um número
 *      maior prende no teto, com a tarja explicando por quê.
 *   2. O botão segue CLICÁVEL. Desabilitar parecia proteger e não protegia —
 *      clique em botão desabilitado não dispara evento, e o operador ficava
 *      diante de um modal parado, sem explicação nenhuma.
 *   3. `receivePayment` recusa no servidor, porque tela se contorna.
 *
 * Tudo é calculado na DATA DO RECEBIMENTO, não na de hoje: o cliente paga
 * quando pode, e o encargo devido é o daquele dia. Mudar a data refaz os
 * números na hora.
 */

import { useState, useTransition } from 'react'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { formatCurrency, formatDate } from '@/lib/utils'
import { calculateAmountDue, type LateChargePolicy } from '@gomoto/core'
import { receivePaymentAction } from '@/app/(dashboard)/cobrancas/actions'

const FORMAS_DE_PAGAMENTO = [
  { value: 'pix', label: 'Pix' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'bank_transfer', label: 'Transferência' },
  { value: 'credit_card', label: 'Cartão de crédito' },
  { value: 'debit_card', label: 'Cartão de débito' },
  { value: 'other', label: 'Outro' },
]

/** Hoje em `YYYY-MM-DD` local — `toISOString` devolve UTC e vira ontem à noite. */
export function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type CobrancaParaPagamento = {
  chargeId: string
  chargeNumber: number
  customerId: string
  customerName: string
  dueDate: string
  openAmount: number
  status: string
}

export function RegistrarPagamentoModal({
  open,
  onClose,
  cobranca,
  policy,
  onRegistrado,
}: {
  open: boolean
  onClose: () => void
  cobranca: CobrancaParaPagamento | null
  policy: LateChargePolicy | null
  /** Chamado após gravar — a tela decide se recarrega, navega ou avisa. */
  onRegistrado?: () => void
}) {
  const [isPending, startTransition] = useTransition()
  const [data, setData] = useState(hojeLocal())
  const [valor, setValor] = useState('')
  const [forma, setForma] = useState('pix')
  const [notas, setNotas] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [aberturaAtual, setAberturaAtual] = useState<string | null>(null)

  if (!cobranca) return null

  /** Cálculo completo na data informada: menos dias de atraso, menos juros. */
  function calculoEm(quando: string) {
    return calculateAmountDue(
      { open_amount: cobranca!.openAmount, due_date: cobranca!.dueDate, status: cobranca!.status },
      policy,
      new Date(`${quando}T12:00:00`),
    )
  }

  // Reinicia ao abrir para outra cobrança: data de hoje, valor cheio, sem erro
  // herdado da anterior. Um `useEffect` aqui rodaria depois do primeiro render,
  // e o modal apareceria por um instante com os dados da cobrança errada.
  const chave = `${cobranca.chargeId}:${open}`
  if (open && aberturaAtual !== chave) {
    setAberturaAtual(chave)
    setData(hojeLocal())
    setValor(calculoEm(hojeLocal()).amount_due.toFixed(2))
    setForma('pix')
    setNotas('')
    setErro(null)
  }

  const naData = calculoEm(data)
  const devido = naData.amount_due

  function confirmar() {
    // Arredondar aqui, não confiar no truncamento do banco: NUMERIC(14,2)
    // aceita a fração e a arredonda PARA CIMA, o que transforma um centavo a
    // mais em saldo negativo na cobrança.
    const montante = Math.round(parseFloat(valor) * 100) / 100
    if (isNaN(montante) || montante <= 0) { setErro('Informe um valor maior que zero.'); return }

    if (montante > devido) {
      setErro(
        `Não é possível registrar ${formatCurrency(montante)}: nessa data a cobrança `
        + `devia ${formatCurrency(devido)}. Nada foi gravado.`,
      )
      return
    }

    setErro(null)
    startTransition(async () => {
      const result = await receivePaymentAction({
        customer_id: cobranca!.customerId,
        amount: montante,
        method: forma,
        paid_at: new Date(`${data}T12:00:00`).toISOString(),
        notes: notas.trim() || undefined,
        allocations: [{ charge_id: cobranca!.chargeId, amount: montante }],
      })

      if (!result.ok) { setErro(result.error.message); return }
      onClose()
      onRegistrado?.()
    })
  }

  const parcial = parseFloat(valor) > 0 && parseFloat(valor) < devido

  return (
    <Modal open={open} onClose={onClose} title="Registrar pagamento">
      <div className="space-y-4">

        {/* Identificação e vencimento: quem recebe precisa saber QUAL cobrança
            está quitando e desde quando ela vence — é o que explica o encargo
            logo abaixo. Na tela de detalhe isso já está atrás do modal, mas
            repetir aqui custa uma linha e evita fechar o modal para conferir. */}
        <div className="rounded-lg border border-divider bg-surface-2 px-3 py-2 text-[13px]">
          <div className="flex justify-between">
            <span className="text-fg-mute">Cobrança #{cobranca.chargeNumber}</span>
            <span className="text-fg">{cobranca.customerName}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-fg-mute">Vencimento</span>
            <span className="tabular-nums text-fg">
              {formatDate(cobranca.dueDate)}
              {naData.accrued.days_overdue > 0 && (
                <span className="ml-2 text-warning">
                  · {naData.accrued.days_overdue}{' '}
                  {naData.accrued.days_overdue === 1 ? 'dia' : 'dias'} de atraso
                </span>
              )}
            </span>
          </div>
        </div>

        <Input
          label="Data do recebimento"
          type="date"
          max={hojeLocal()}
          value={data}
          onChange={(e) => {
            const v = e.target.value
            if (v > hojeLocal()) {
              setErro('A data do recebimento não pode ser futura.')
              return
            }
            setData(v)
            setErro(null)
            setValor(calculoEm(v).amount_due.toFixed(2))
          }}
        />

        <Input
          label="Valor recebido (R$)"
          type="number"
          step="0.01"
          min="0.01"
          max={devido.toFixed(2)}
          value={valor}
          onChange={(e) => {
            // Dinheiro tem duas casas. `type="number"` com `step="0.01"` só
            // valida em submit de formulário nativo — aqui não há —, então o
            // campo aceitava "446,83000000000000999999" e frações de centavo
            // como 446,836. O banco guarda NUMERIC(14,2) e arredonda calado:
            // 446,836 vira 446,84 e a cobrança fica devendo −0,01.
            const v = e.target.value.replace(/^(\d*[.,]?\d{0,2}).*$/, '$1')
            const n = parseFloat(v)

            if (!isNaN(n) && n > devido) {
              setValor(devido.toFixed(2))
              setErro(
                `O máximo desta cobrança é ${formatCurrency(devido)}. Para receber a `
                + 'mais, registre o valor devido e conceda o excedente como crédito '
                + 'na ficha do cliente.',
              )
              return
            }
            setValor(v)
            setErro(null)
          }}
        />

        {/* Juros são conta que o cliente vai querer conferir: "R$ 360,47" não se
            discute, "350,00 de principal, 7,00 de multa e 3,47 de juros por 30
            dias" se confere. */}
        <div className="space-y-1 rounded-lg border border-divider bg-surface-2 px-3 py-2 text-[12px]">
          {naData.accrued.total > 0 ? (
            <>
              <div className="flex justify-between">
                <span className="text-fg-mute">Principal</span>
                <span className="tabular-nums text-fg">{formatCurrency(naData.open_amount)}</span>
              </div>
              {naData.accrued.fee > 0 && (
                <div className="flex justify-between text-warning">
                  <span>Multa</span>
                  <span className="tabular-nums">{formatCurrency(naData.accrued.fee)}</span>
                </div>
              )}
              {naData.accrued.interest > 0 && (
                <div className="flex justify-between text-warning">
                  {/* Só "N dias": o atraso já está declarado no cabeçalho, ao
                      lado do vencimento. Aqui o número serve de base do
                      cálculo, não de aviso. */}
                  <span>
                    Juros · {naData.accrued.days_overdue}{' '}
                    {naData.accrued.days_overdue === 1 ? 'dia' : 'dias'}
                  </span>
                  <span className="tabular-nums">{formatCurrency(naData.accrued.interest)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-divider pt-1">
                <span className="text-fg-mute">Total a receber</span>
                <span className="tabular-nums font-semibold text-fg">{formatCurrency(devido)}</span>
              </div>
            </>
          ) : (
            <div className="flex justify-between">
              <span className="text-fg-mute">
                Valor devido
                {naData.accrued.grace_period_active && ' · dentro da carência'}
              </span>
              <span className="tabular-nums font-semibold text-fg">{formatCurrency(devido)}</span>
            </div>
          )}
          {parcial && (
            <p className="pt-1 text-info">
              Recebimento parcial: a cobrança segue em aberto com{' '}
              {formatCurrency(Math.round((devido - parseFloat(valor)) * 100) / 100)}.
            </p>
          )}
        </div>

        <Select
          label="Forma de pagamento"
          value={forma}
          onChange={(e) => setForma(e.target.value)}
          options={FORMAS_DE_PAGAMENTO}
        />

        <Textarea
          label="Observações (opcional)"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={2}
        />

        {/* Dentro do modal, nunca atrás dele: a lista mandava o erro para o topo
            da PÁGINA, e a recusa chegava invisível — modal parado, sem
            mensagem, sem saber se algo tinha sido gravado. */}
        {erro && (
          <div className="rounded-lg border border-danger bg-danger-bg px-3 py-2 text-[13px] text-danger">
            {erro}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-full border border-border px-4 text-[13px] text-fg-mute transition-colors hover:text-fg"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmar}
            disabled={isPending}
            className="inline-flex h-9 items-center rounded-full bg-primary px-4 text-[13px] font-semibold text-primary-contrast transition-colors hover:bg-primary-hover disabled:opacity-50"
          >
            {isPending ? 'Registrando…' : 'Confirmar pagamento'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
