'use client'

import { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { Plus, Clock, X, ArrowRight, Users, ChevronUp, ChevronDown } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

import { useQueueEntries, useCustomers } from '@gomoto/data'
import type { QueueEntry } from '@gomoto/core'
import { PageTitle } from '@/components/layout/PageTitle'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { formatDate } from '@/lib/utils'
import { addToQueue, removeFromQueue, moveInQueue } from '../actions'

// ─── FilaPage ─────────────────────────────────────────────────────────────────

export default function FilaPage() {
  const qc = useQueryClient()

  const queueQuery     = useQueueEntries()
  const customersQuery = useCustomers()

  const queue = useMemo(() => queueQuery.data ?? [], [queueQuery.data])

  const inQueueIds = useMemo(() => new Set(queue.map(q => q.customer_id)), [queue])

  const availableCustomers = useMemo(
    () =>
      (customersQuery.data ?? [])
        .filter(c => c.active && !inQueueIds.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [customersQuery.data, inQueueIds],
  )

  const [showAdd,    setShowAdd]   = useState(false)
  const [removing,   setRemoving]  = useState<string | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [error,      setError]     = useState('')
  const [movingId,   setMovingId]  = useState<string | null>(null)

  const [isPendingAdd,    startAdd]    = useTransition()
  const [isPendingRemove, startRemove] = useTransition()
  const [isPendingMove,   startMove]   = useTransition()

  function daysInQueue(createdAt: string) {
    const start = new Date(createdAt)
    const today = new Date()
    return Math.floor((today.getTime() - start.getTime()) / 86_400_000)
  }

  async function handleAdd() {
    if (!customerId) return
    setError('')
    startAdd(async () => {
      const result = await addToQueue({ customer_id: customerId })
      if (!result.ok) { setError(result.error.message); return }
      qc.invalidateQueries({ queryKey: ['queue_entries'] })
      setShowAdd(false)
      setCustomerId('')
    })
  }

  async function handleRemove(id: string) {
    startRemove(async () => {
      const result = await removeFromQueue(id)
      if (!result.ok) { setError(result.error.message); return }
      qc.invalidateQueries({ queryKey: ['queue_entries'] })
      setRemoving(null)
    })
  }

  async function handleMove(id: string, direction: 'up' | 'down') {
    setError('')

    const snapshot = qc.getQueryData<QueueEntry[]>(['queue_entries']) ?? []
    const idx      = snapshot.findIndex(q => q.id === id)
    const swapIdx  = direction === 'up' ? idx - 1 : idx + 1

    if (idx === -1 || swapIdx < 0 || swapIdx >= snapshot.length) return

    // Aplica swap otimista no cache antes de chamar o servidor
    const optimistic = snapshot
      .map((q, i) => {
        if (i === idx)     return { ...q, position: snapshot[swapIdx].position }
        if (i === swapIdx) return { ...q, position: snapshot[idx].position }
        return q
      })
      .sort((a, b) => a.position - b.position)

    setMovingId(id)
    qc.setQueryData(['queue_entries'], optimistic)

    startMove(async () => {
      const result = await moveInQueue(id, direction)
      if (!result.ok) {
        qc.setQueryData(['queue_entries'], snapshot) // reverte
        setError(result.error.message)
        setMovingId(null)
        return
      }
      qc.invalidateQueries({ queryKey: ['queue_entries'] })
      // Mantém highlight por 500 ms após o servidor confirmar
      setTimeout(() => setMovingId(null), 500)
    })
  }

  const selectCls = 'w-full h-9 px-3 rounded-lg bg-[#282828] border border-[#474747] text-[13px] text-[#f5f5f5] outline-none focus:border-[#BAFF1A]'

  return (
    <div className="flex min-h-full flex-col bg-[#121212]">
      <PageTitle
        title="Fila de espera"
        subtitle="Clientes aguardando um veículo disponível"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/locacoes"
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#474747] px-4 text-[13px] text-[#9e9e9e] transition-colors hover:text-[#f5f5f5]"
            >
              ← Locações
            </Link>
            <button
              onClick={() => setShowAdd(true)}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-[#BAFF1A] px-4 text-[13px] font-bold text-[#121212] transition-colors hover:bg-[#a8e818]"
            >
              <Plus className="h-4 w-4" />
              Adicionar à Fila
            </button>
          </div>
        }
      />

      <div className="space-y-5 p-6">

        {/* KPI */}
        <div className="flex items-center gap-4 rounded-xl bg-[#202020] p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#BAFF1A22] text-[#BAFF1A]">
            <Users className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[13px] text-[#9e9e9e]">Na fila agora</p>
            <p className="text-2xl font-bold text-[#f5f5f5]">{queue.length}</p>
          </div>
        </div>

        {/* Lista */}
        {queueQuery.isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#BAFF1A] border-t-transparent" />
          </div>
        ) : queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl bg-[#202020] p-16 text-center">
            <Clock className="mb-4 h-12 w-12 text-[#616161]" />
            <p className="text-lg font-medium text-[#f5f5f5]">Fila vazia.</p>
            <p className="mt-1 text-[13px] text-[#9e9e9e]">Nenhum cliente aguardando um veículo.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#323232] bg-[#1a1a1a]">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#323232]">
                  <th className="h-9 w-16 px-4 text-left font-medium text-[#9e9e9e]">Pos.</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Cliente</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Telefone</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Na fila desde</th>
                  <th className="h-9 px-4 text-left font-medium text-[#9e9e9e]">Tempo</th>
                  <th className="h-9 px-4 text-right font-medium text-[#9e9e9e]">Ações</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((q, idx) => {
                  const days      = daysInQueue(q.created_at)
                  const isFirst   = idx === 0
                  const isLast    = idx === queue.length - 1
                  const isMoving  = movingId === q.id

                  return (
                    <tr
                      key={q.id}
                      style={{ transition: 'background-color 300ms ease' }}
                      className={`h-9 border-b border-[#1e1e1e] last:border-0 ${
                        isMoving ? 'bg-[#BAFF1A18]' : 'hover:bg-[#222222]'
                      }`}
                    >
                      <td className="px-4">
                        <span
                          style={{ transition: 'color 300ms ease, transform 300ms ease', display: 'inline-block' }}
                          className={`font-mono font-bold ${isMoving ? 'text-[#BAFF1A] scale-110' : 'text-[#BAFF1A]'}`}
                        >
                          #{q.position}
                        </span>
                      </td>
                      <td className="px-4 font-medium text-[#f5f5f5]">{q.customers?.name ?? '—'}</td>
                      <td className="px-4 text-[#9e9e9e]">{q.customers?.phone ?? '—'}</td>
                      <td className="px-4 text-[#9e9e9e]">{formatDate(q.created_at)}</td>
                      <td className="px-4">
                        <span className={`text-[12px] font-medium ${days > 30 ? 'text-[#ff9c9a]' : days > 7 ? 'text-[#e65e24]' : 'text-[#9e9e9e]'}`}>
                          {days === 0 ? 'Hoje' : `${days}d`}
                        </span>
                      </td>
                      <td className="px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => handleMove(q.id, 'up')}
                            disabled={isFirst || isPendingMove}
                            title="Subir na fila"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9e9e9e] transition-colors hover:bg-[#323232] hover:text-[#f5f5f5] disabled:pointer-events-none disabled:opacity-30"
                          >
                            <ChevronUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleMove(q.id, 'down')}
                            disabled={isLast || isPendingMove}
                            title="Descer na fila"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[#9e9e9e] transition-colors hover:bg-[#323232] hover:text-[#f5f5f5] disabled:pointer-events-none disabled:opacity-30"
                          >
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>

                          <Link
                            href={`/locacoes/nova?customer_id=${q.customer_id}`}
                            title="Iniciar locação para este cliente"
                            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#BAFF1A22] px-2.5 text-[12px] font-medium text-[#BAFF1A] transition-colors hover:bg-[#BAFF1A33]"
                          >
                            <ArrowRight className="h-3.5 w-3.5" />
                            Nova locação
                          </Link>

                          <button
                            onClick={() => setRemoving(q.id)}
                            title="Remover da fila"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[#9e9e9e] transition-colors hover:bg-[#323232] hover:text-[#ff9c9a]"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}
      </div>

      {/* Modal: Adicionar à Fila */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setCustomerId(''); setError('') }} title="Adicionar à Fila" size="sm">
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-[13px] text-[#9e9e9e]">Cliente</label>
            <select
              className={selectCls}
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
            >
              <option value="">Selecione um cliente…</option>
              {availableCustomers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {availableCustomers.length === 0 && (customersQuery.data ?? []).filter(c => c.active).length > 0 && (
              <p className="mt-1.5 text-[12px] text-[#9e9e9e]">Todos os clientes ativos já estão na fila.</p>
            )}
          </div>
          {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setShowAdd(false); setCustomerId(''); setError('') }} disabled={isPendingAdd}>
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={isPendingAdd || !customerId}>
              {isPendingAdd ? 'Adicionando…' : 'Adicionar à Fila'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Confirmar Remoção */}
      <Modal open={!!removing} onClose={() => { setRemoving(null); setError('') }} title="Remover da Fila" size="sm">
        <div className="space-y-4">
          <p className="text-[13px] text-[#9e9e9e]">
            Tem certeza que deseja remover este cliente da fila de espera?
          </p>
          {error && <p className="text-[13px] text-[#ff9c9a]">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setRemoving(null); setError('') }} disabled={isPendingRemove}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => removing && handleRemove(removing)} disabled={isPendingRemove}>
              {isPendingRemove ? 'Removendo…' : 'Remover'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
