import { describe, it, expect } from 'vitest'
import { CreatePlatformAdminSchema, InviteTenantMemberSchema, ResetPasswordSchema } from './access-control'

describe('CreatePlatformAdminSchema', () => {
  it('aceita payload válido', () => {
    const result = CreatePlatformAdminSchema.safeParse({
      name: 'Ana Souza',
      email: 'Ana@GoMoto.dev',
      role: 'operator',
      password: 'senha1234',
    })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.email).toBe('ana@gomoto.dev')
  })

  it('rejeita email inválido', () => {
    const result = CreatePlatformAdminSchema.safeParse({ name: 'Ana Souza', email: 'not-an-email', role: 'owner', password: 'senha1234' })
    expect(result.success).toBe(false)
  })

  it('rejeita nome com menos de 2 caracteres', () => {
    const result = CreatePlatformAdminSchema.safeParse({ name: 'A', email: 'ana@gomoto.dev', role: 'owner', password: 'senha1234' })
    expect(result.success).toBe(false)
  })

  it('rejeita role fora do enum (admin não é papel de plataforma)', () => {
    const result = CreatePlatformAdminSchema.safeParse({ name: 'Ana Souza', email: 'ana@gomoto.dev', role: 'admin', password: 'senha1234' })
    expect(result.success).toBe(false)
  })

  it('rejeita senha com menos de 8 caracteres', () => {
    const result = CreatePlatformAdminSchema.safeParse({ name: 'Ana Souza', email: 'ana@gomoto.dev', role: 'owner', password: '1234567' })
    expect(result.success).toBe(false)
  })
})

describe('InviteTenantMemberSchema', () => {
  it('aceita payload válido', () => {
    const result = InviteTenantMemberSchema.safeParse({
      name: 'Bruno Lima',
      email: 'bruno@gomoto.dev',
      role: 'viewer',
      password: 'senha1234',
    })
    expect(result.success).toBe(true)
  })

  it('rejeita email inválido', () => {
    const result = InviteTenantMemberSchema.safeParse({ name: 'Bruno Lima', email: 'bruno@', role: 'viewer', password: 'senha1234' })
    expect(result.success).toBe(false)
  })

  it('rejeita nome < 2 chars', () => {
    const result = InviteTenantMemberSchema.safeParse({ name: 'B', email: 'bruno@gomoto.dev', role: 'viewer', password: 'senha1234' })
    expect(result.success).toBe(false)
  })

  it('rejeita role fora do enum', () => {
    const result = InviteTenantMemberSchema.safeParse({ name: 'Bruno Lima', email: 'bruno@gomoto.dev', role: 'superadmin', password: 'senha1234' })
    expect(result.success).toBe(false)
  })

  it('rejeita senha com menos de 8 caracteres', () => {
    const result = InviteTenantMemberSchema.safeParse({ name: 'Bruno Lima', email: 'bruno@gomoto.dev', role: 'viewer', password: '1234567' })
    expect(result.success).toBe(false)
  })
})

describe('ResetPasswordSchema', () => {
  it('aceita senha válida', () => {
    expect(ResetPasswordSchema.safeParse({ password: 'novaSenha123' }).success).toBe(true)
  })

  it('rejeita senha curta', () => {
    expect(ResetPasswordSchema.safeParse({ password: '1234567' }).success).toBe(false)
  })

  it('rejeita senha maior que 72 caracteres', () => {
    expect(ResetPasswordSchema.safeParse({ password: 'a'.repeat(73) }).success).toBe(false)
  })
})
