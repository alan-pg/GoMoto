import { describe, it, expect } from 'vitest'
import { isSelfPromotion, wouldLeaveZeroActiveOwners } from './access-control'

const USER_A = 'user-a'
const USER_B = 'user-b'

describe('isSelfPromotion — RF-016/RN-004', () => {
  it('true quando o ator tenta subir o próprio papel (viewer→admin)', () => {
    expect(isSelfPromotion(USER_A, USER_A, 'viewer', 'admin')).toBe(true)
  })

  it('true quando o ator tenta subir o próprio papel (admin→owner)', () => {
    expect(isSelfPromotion(USER_A, USER_A, 'admin', 'owner')).toBe(true)
  })

  it('false quando o novo papel é igual ao atual', () => {
    expect(isSelfPromotion(USER_A, USER_A, 'admin', 'admin')).toBe(false)
  })

  it('false quando é um rebaixamento do próprio papel', () => {
    expect(isSelfPromotion(USER_A, USER_A, 'owner', 'viewer')).toBe(false)
  })

  it('false quando o alvo é outro usuário, mesmo que suba de papel', () => {
    expect(isSelfPromotion(USER_A, USER_B, 'viewer', 'owner')).toBe(false)
  })
})

describe('wouldLeaveZeroActiveOwners — RF-017/020/RN-003', () => {
  it('true ao revogar o único Owner ativo', () => {
    const members = [
      { userId: USER_A, role: 'owner' as const, status: 'active' as const },
      { userId: USER_B, role: 'admin' as const, status: 'active' as const },
    ]
    expect(wouldLeaveZeroActiveOwners(members, USER_A, 'revoke')).toBe(true)
  })

  it('false ao revogar quando há ≥2 Owners ativos', () => {
    const members = [
      { userId: USER_A, role: 'owner' as const, status: 'active' as const },
      { userId: USER_B, role: 'owner' as const, status: 'active' as const },
    ]
    expect(wouldLeaveZeroActiveOwners(members, USER_A, 'revoke')).toBe(false)
  })

  it('true ao trocar o papel do único Owner ativo para algo != owner', () => {
    const members = [{ userId: USER_A, role: 'owner' as const, status: 'active' as const }]
    expect(wouldLeaveZeroActiveOwners(members, USER_A, { changeRoleTo: 'admin' })).toBe(true)
  })

  it('false ao trocar o papel do único Owner ativo para owner (noop)', () => {
    const members = [{ userId: USER_A, role: 'owner' as const, status: 'active' as const }]
    expect(wouldLeaveZeroActiveOwners(members, USER_A, { changeRoleTo: 'owner' })).toBe(false)
  })

  it('false quando o alvo não é Owner', () => {
    const members = [{ userId: USER_A, role: 'admin' as const, status: 'active' as const }]
    expect(wouldLeaveZeroActiveOwners(members, USER_A, 'revoke')).toBe(false)
  })

  it('false quando o alvo já está revoked', () => {
    const members = [{ userId: USER_A, role: 'owner' as const, status: 'revoked' as const }]
    expect(wouldLeaveZeroActiveOwners(members, USER_A, 'revoke')).toBe(false)
  })
})
