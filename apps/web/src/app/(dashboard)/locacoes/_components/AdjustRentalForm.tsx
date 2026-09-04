/**
 * @file AdjustRentalForm.tsx
 * @description Reajuste do valor da locação (Spec 0014 / ADR 0024).
 *
 * Reescrito sobre o cronograma. A versão anterior tinha duas operações
 * distintas — reajustar valor e regerar cronograma — porque plano e documento
 * eram a mesma coisa: mudar o ciclo obrigava a cancelar cobranças emitidas e
 * recriá-las.
 *
 * Agora o reajuste altera apenas linhas `scheduled`. Período já emitido é
 * documento imutável (Princípio 5), e a prévia mostra exatamente quais linhas
 * mudam e quais ficam intactas.
 *
 * Os campos de multa e juros saíram: encargo passou a ser política do tenant,
 * versionada, e não configuração por locação (R-07/R-08).
 */

'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Input'
import { formatCurrency, formatDate } from '@/lib/utils'
import { useRentalSchedule } from '@gomoto/data'
import { selectAdjustableLines } from '@gomoto/core'
import { adjustRentalSchedule } from '../actions'

type Rental = {
  id: string
  cycle_amount?: number | null
  start_date?: string | null
  end_date?: string | null
}

export function AdjustRentalForm({
  rental,
  onDone,
}: {
  rental: Rental
  onDone?: () => void
}) {
  const [newAmount, setNewAmount] = useState(String(rental.cycle_amount ?? ''))
  const [effectiveFrom, setEffectiveFrom] = useState(todayIso())
  const [justification, setJustification] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  /**
   * Resultado do reajuste.
   *
   * A tela aplicava e não dizia nada: `onDone?.()` é a única coisa que
   * acontecia no sucesso, e a página que monta este formulário NÃO passa
   * `onDone` — então não acontecia nada mesmo. Sem mensagem, sem navegação, e
   * a prévia (cache do TanStack) seguia mostrando os valores antigos. O
   * operador clicava, a tela ficava idêntica, e o reajuste tinha sido gravado.
   *
   * `updated_lines` vem da action e é exatamente o que ele precisa conferir:
   * quantas parcelas mudaram de fato.
   */
  const [applied, setApplied] = useState<{ lines: number; amount: number; from: string } | null>(null)

  const router = useRouter()

  const scheduleQuery = useRentalSchedule(rental.id)
  const lines = useMemo(() => scheduleQuery.data?.lines ?? [], [scheduleQuery.data])

  const parsedAmount = parseFloat(newAmount)
  const hasValidAmount = !isNaN(parsedAmount) && parsedAmount > 0

  /** Linhas que o reajuste vai tocar — só as ainda não emitidas. */
  const affected = useMemo(
    () => (effectiveFrom ? selectAdjustableLines(lines, effectiveFrom) : []),
    [lines, effectiveFrom],
  )

  const issuedCount = useMemo(
    () => lines.filter((l) => l.status === 'issued').length,
    [lines],
  )

  /**
   * Existe parcela reajustável em ALGUMA data? Sem isso não dá para distinguir
   * "o cronograma acabou" de "a data escolhida passou das parcelas abertas" —
   * e o conselho certo é oposto em cada caso.
   */
  const hasAdjustableLines = useMemo(
    () => lines.some((l) => l.status === 'scheduled'),
    [lines],
  )

  const preview = useMemo(() => {
    if (!hasValidAmount || affected.length === 0) return null

    const currentTotal = affected.reduce((s, l) => s + l.amount, 0)
    const newTotal = parsedAmount * affected.length

    return {
      lines: affected.length,
      currentTotal,
      newTotal,
      delta: newTotal - currentTotal,
    }
  }, [hasValidAmount, affected, parsedAmount])

  /** Volta para a locação. O botão Cancelar chamava `onDone?.()` — inerte pela
   *  mesma razão do sucesso, então não fazia nada. */
  function voltar() {
    if (onDone) { onDone(); return }
    router.push(`/locacoes/${rental.id}`)
  }

  async function handleSubmit() {
    setSaving(true)
    setError('')
    setApplied(null)

    const result = await adjustRentalSchedule({
      rental_id: rental.id,
      new_amount: parsedAmount,
      effective_from: effectiveFrom,
      justification,
    })

    setSaving(false)

    if (!result.ok) {
      setError(result.error.message)
      return
    }

    setApplied({ lines: result.data.updated_lines, amount: parsedAmount, from: effectiveFrom })

    // A prévia vem de `useRentalSchedule`, um cache do TanStack: o
    // `revalidatePath` da action não o alcança. Sem este refetch a tela
    // anunciaria o sucesso ao lado de uma prévia dizendo que as mesmas parcelas
    // ainda vão mudar.
    void scheduleQuery.refetch()

    onDone?.()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Novo valor do ciclo"
          type="number"
          step="0.01"
          value={newAmount}
          onChange={(e) => setNewAmount(e.target.value)}
        />
        <Input
          label="Vigente a partir de"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
        />
      </div>

      <Textarea
        label="Justificativa"
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
        placeholder="Motivo do reajuste"
      />

      {scheduleQuery.isLoading && (
        <p className="text-[13px] text-[var(--fg-mute)]">Carregando cronograma…</p>
      )}

      {preview && (
        <div className="border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px]">
          <div className="flex justify-between">
            <span className="text-[var(--fg-soft)]">Parcelas afetadas</span>
            <span className="tabular-nums">{preview.lines}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-[var(--fg-soft)]">Total atual</span>
            <span className="tabular-nums">{formatCurrency(preview.currentTotal)}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-[var(--fg-soft)]">Total após reajuste</span>
            <span className="tabular-nums font-medium">{formatCurrency(preview.newTotal)}</span>
          </div>
          <div className="mt-1 flex justify-between">
            <span className="text-[var(--fg-soft)]">Diferença</span>
            <span
              className={`tabular-nums ${
                preview.delta >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'
              }`}
            >
              {preview.delta >= 0 ? '+' : ''}{formatCurrency(preview.delta)}
            </span>
          </div>

          {issuedCount > 0 && (
            <p className="mt-3 border-t border-[var(--divider)] pt-2 text-[12px] text-[var(--fg-mute)]">
              {issuedCount} parcela(s) já emitida(s) permanecem intactas — documento emitido
              não é reescrito.
            </p>
          )}
        </div>
      )}

      {hasValidAmount && affected.length === 0 && !scheduleQuery.isLoading && (
        <p className="text-[13px] text-[var(--pending)]">
          {hasAdjustableLines
            ? 'Nenhuma parcela a partir dessa data. Há parcelas em aberto antes dela — '
              + 'antecipe a vigência para alcançá-las.'
            : 'Não há parcela em aberto: todo o cronograma já foi emitido. '
              + 'Use cobrança complementar ou renegociação.'}
        </p>
      )}

      {error && (
        <p className="text-[13px] text-[var(--danger)]">{error}</p>
      )}

      {applied && (
        <div className="flex items-start gap-3 rounded-xl border border-[var(--success)] bg-[var(--success-bg)] p-4 text-[13px] text-[var(--success)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="leading-relaxed">
            <p>
              <strong>
                {applied.lines} parcela{applied.lines !== 1 ? 's' : ''} reajustada
                {applied.lines !== 1 ? 's' : ''}
              </strong>{' '}
              para {formatCurrency(applied.amount)}, a partir de {formatDate(applied.from)}.
            </p>
            {issuedCount > 0 && (
              <p className="mt-1 opacity-80">
                {issuedCount} parcela{issuedCount !== 1 ? 's' : ''} já emitida
                {issuedCount !== 1 ? 's' : ''} não mud{issuedCount !== 1 ? 'aram' : 'ou'} —
                documento emitido não é reescrito.
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={voltar}>
          {applied ? 'Voltar para a locação' : 'Cancelar'}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={saving || !hasValidAmount || affected.length === 0 || justification.trim().length < 3}
        >
          {saving ? 'Aplicando…' : applied ? 'Aplicar outro reajuste' : 'Aplicar reajuste'}
        </Button>
      </div>
    </div>
  )
}

function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}
