/**
 * Espelham os guards das RPCs SECURITY DEFINER (set_tenant_member_role,
 * revoke_tenant_member — Spec 0011 §4.2). A RPC continua sendo a fonte de
 * verdade (enforcement real); estas funções puras só servem de hint de UI
 * (desabilitar ações sem round-trip) + cobertura Unit direta de RN-003/004/005.
 */
import type { TenantMemberRole } from '../schemas/access-control'

const ROLE_RANK: Record<TenantMemberRole, number> = { viewer: 1, operator: 2, admin: 3, owner: 4 }

/** RF-016/RN-004 — sem autopromoção: ninguém sobe o próprio papel. */
export function isSelfPromotion(
  actorUserId: string,
  targetUserId: string,
  currentRole: TenantMemberRole,
  newRole: TenantMemberRole,
): boolean {
  return actorUserId === targetUserId && ROLE_RANK[newRole] > ROLE_RANK[currentRole]
}

/** RF-017/020/RN-003 — o tenant precisa manter ao menos 1 Owner ativo. */
export function wouldLeaveZeroActiveOwners(
  members: { userId: string; role: TenantMemberRole; status: 'active' | 'revoked' }[],
  targetUserId: string,
  action: 'revoke' | { changeRoleTo: TenantMemberRole },
): boolean {
  const activeOwners = members.filter((m) => m.role === 'owner' && m.status === 'active')
  const target = members.find((m) => m.userId === targetUserId)
  if (!target || target.role !== 'owner' || target.status !== 'active') return false
  const remaining =
    action === 'revoke'
      ? activeOwners.filter((m) => m.userId !== targetUserId)
      : activeOwners.filter((m) => m.userId !== targetUserId || action.changeRoleTo === 'owner')
  return remaining.length === 0
}
