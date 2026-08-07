'use client'

import { useState, useTransition } from 'react'
import { Plus, ShieldCheck, ShieldOff, Trash2, UserPlus } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import {
  addPlatformAdmin,
  removePlatformAdmin,
  setPlatformAdminRole,
} from './actions'

export type PlatformAdminRow = {
  user_id: string
  email: string
  name: string | null
  role: 'owner' | 'operator'
  created_at: string
  created_by_email: string | null
}

type AddForm = { email: string; role: 'owner' | 'operator' }

const EMPTY_FORM: AddForm = { email: '', role: 'operator' }

type Props = {
  initialRows: PlatformAdminRow[]
  loadError: string | null
  currentUserId: string
  currentRole: 'owner' | 'operator'
}

export function PlatformAdminsClient({
  initialRows,
  loadError,
  currentUserId,
  currentRole,
}: Props) {
  const [rows, setRows] = useState<PlatformAdminRow[]>(initialRows)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [topError, setTopError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const isOwner = currentRole === 'owner'
  // O guard "≥1 owner" também roda no banco; manter o aviso visual ajuda o
  // usuário a entender por que o toggle aparece desabilitado.
  const ownerCount = rows.filter((r) => r.role === 'owner').length

  function openAdd() {
    setForm(EMPTY_FORM)
    setFormError(null)
    setShowAdd(true)
  }

  function handleAdd() {
    setFormError(null)
    setTopError(null)
    startTransition(async () => {
      const result = await addPlatformAdmin(form.email, form.role)
      if ('error' in result && result.error) {
        setFormError(result.error)
        return
      }
      const created = (result as { row: PlatformAdminRow | null }).row
      if (created) {
        setRows((prev) =>
          [...prev.filter((r) => r.user_id !== created.user_id), created].sort((a, b) =>
            a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'owner' ? -1 : 1,
          ),
        )
      }
      setShowAdd(false)
    })
  }

  function handleSetRole(row: PlatformAdminRow, next: 'owner' | 'operator') {
    if (row.role === next) return
    setTopError(null)
    startTransition(async () => {
      const result = await setPlatformAdminRole(row.user_id, next)
      if ('error' in result && result.error) {
        setTopError(result.error)
        return
      }
      setRows((prev) => prev.map((r) => (r.user_id === row.user_id ? { ...r, role: next } : r)))
    })
  }

  function openRemove(row: PlatformAdminRow) {
    setRemovingId(row.user_id)
    setRemoveError(null)
  }

  function handleRemove() {
    if (!removingId) return
    startTransition(async () => {
      const result = await removePlatformAdmin(removingId)
      if ('error' in result && result.error) {
        setRemoveError(result.error)
        return
      }
      setRows((prev) => prev.filter((r) => r.user_id !== removingId))
      setRemovingId(null)
    })
  }

  const target = removingId ? rows.find((r) => r.user_id === removingId) ?? null : null

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[24px] font-semibold text-fg flex items-center gap-2">
            <ShieldCheck className="w-6 h-6" /> Admins da plataforma
          </h1>
          <p className="text-[13px] text-fg-mute mt-1">
            Pessoas com acesso ao control plane. Owners gerenciam outros owners; operators
            executam o operacional do dia-a-dia.
          </p>
        </div>
        {isOwner ? (
          <Button onClick={openAdd}>
            <Plus className="w-4 h-4 mr-1.5" /> Adicionar admin
          </Button>
        ) : null}
      </header>

      {loadError ? (
        <div className="rounded-lg bg-danger-bg text-danger border border-danger px-4 py-3 text-[13px] mb-4">
          Falha ao carregar admins: {loadError}
        </div>
      ) : null}

      {topError ? (
        <div className="rounded-lg bg-danger-bg text-danger border border-danger px-4 py-3 text-[13px] mb-4">
          {topError}
        </div>
      ) : null}

      <div className="rounded-xl border border-divider overflow-hidden bg-[#181818]">
        <table className="w-full text-left">
          <thead className="bg-surface text-[12px] uppercase tracking-wide text-fg-mute">
            <tr>
              <th className="px-4 py-3 font-medium">Pessoa</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Adicionado por</th>
              <th className="px-4 py-3 font-medium text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-fg-mute text-[14px]">
                  Nenhum admin cadastrado.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const isSelf = row.user_id === currentUserId
                const isLastOwner = row.role === 'owner' && ownerCount <= 1
                return (
                  <tr key={row.user_id} className="border-t border-divider">
                    <td className="px-4 py-3 text-[14px] text-fg">
                      <div className="font-medium">{row.name ?? row.email}</div>
                      <div className="text-[12px] text-fg-mute">{row.email}</div>
                    </td>
                    <td className="px-4 py-3">
                      {row.role === 'owner' ? (
                        <Badge variant="brand">Owner</Badge>
                      ) : (
                        <Badge variant="muted">Operator</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[13px] text-fg-mute">
                      {row.created_by_email ?? <span className="italic">bootstrap</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-2">
                        {isOwner ? (
                          row.role === 'owner' ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending || isLastOwner}
                              onClick={() => handleSetRole(row, 'operator')}
                              title={isLastOwner ? 'Precisa de ≥1 owner' : 'Rebaixar para operator'}
                            >
                              <ShieldOff className="w-3.5 h-3.5 mr-1" /> Rebaixar
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={pending}
                              onClick={() => handleSetRole(row, 'owner')}
                            >
                              <ShieldCheck className="w-3.5 h-3.5 mr-1" /> Promover
                            </Button>
                          )
                        ) : null}
                        {isOwner ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={pending || isSelf || isLastOwner}
                            onClick={() => openRemove(row)}
                            title={
                              isSelf
                                ? 'Você não pode se remover'
                                : isLastOwner
                                  ? 'Precisa de ≥1 owner'
                                  : 'Remover admin'
                            }
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" /> Remover
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Adicionar admin">
        <div className="space-y-4">
          <p className="text-[13px] text-fg-soft">
            O usuário precisa já existir em <code>auth.users</code> (cadastre antes via Supabase
            Studio ou signup). Buscamos pelo email exato.
          </p>
          <Input
            label="Email"
            type="email"
            autoFocus
            value={form.email}
            onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
            placeholder="pessoa@gomoto.dev"
            disabled={pending}
          />
          <div>
            <label className="text-[13px] text-fg-soft block mb-1.5">Role</label>
            <div className="flex gap-2">
              {(['operator', 'owner'] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm((prev) => ({ ...prev, role: r }))}
                  disabled={pending}
                  className={
                    'flex-1 h-10 rounded-lg border text-[14px] transition ' +
                    (form.role === r
                      ? 'border-primary text-primary bg-primary-tint'
                      : 'border-divider text-fg-soft hover:border-border')
                  }
                >
                  {r === 'owner' ? (
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4" /> Owner
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5">
                      <UserPlus className="w-4 h-4" /> Operator
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          {formError ? (
            <div className="rounded-lg bg-danger-bg text-danger border border-danger px-3 py-2 text-[13px]">
              {formError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setShowAdd(false)} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={pending || form.email.trim().length === 0}>
              {pending ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!removingId}
        onClose={() => setRemovingId(null)}
        title="Remover admin da plataforma"
      >
        <div className="space-y-4">
          <p className="text-[13px] text-fg-soft">
            A pessoa perde acesso ao control plane imediatamente. O usuário em si permanece
            em <code>auth.users</code> — você só está removendo o vínculo de admin.
          </p>
          {target ? (
            <div className="rounded-lg border border-divider bg-[#181818] px-3 py-2 text-[14px] text-fg">
              <div className="font-medium">{target.name ?? target.email}</div>
              <div className="text-[12px] text-fg-mute">{target.email}</div>
            </div>
          ) : null}
          {removeError ? (
            <div className="rounded-lg bg-danger-bg text-danger border border-danger px-3 py-2 text-[13px]">
              {removeError}
            </div>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setRemovingId(null)} disabled={pending}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={handleRemove} disabled={pending}>
              {pending ? 'Removendo…' : 'Remover'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
