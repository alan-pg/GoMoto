import { z } from 'zod'

/**
 * Papéis de tenant_members (Spec 0011). Hierarquia de rank fica em
 * rules/access-control.ts — este schema só valida a forma.
 */
export const TenantMemberRoleSchema = z.enum(['owner', 'admin', 'operator', 'viewer'])
export type TenantMemberRole = z.infer<typeof TenantMemberRoleSchema>

export const PlatformAdminRoleSchema = z.enum(['owner', 'operator'])
export type PlatformAdminRole = z.infer<typeof PlatformAdminRoleSchema>

/**
 * Mesmo mínimo/máximo já usado em CreateTenantWithOwnerSchema.owner.password
 * (packages/core/src/schemas/index.ts) — 72 é o limite de bytes do bcrypt.
 */
const newPasswordString = z.string().min(8, 'Senha precisa de no mínimo 8 caracteres').max(72)

export const CreatePlatformAdminSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: PlatformAdminRoleSchema,
  password: newPasswordString,
})
export type CreatePlatformAdmin = z.infer<typeof CreatePlatformAdminSchema>

export const InviteTenantMemberSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  role: TenantMemberRoleSchema,
  password: newPasswordString,
})
export type InviteTenantMember = z.infer<typeof InviteTenantMemberSchema>

/** Reset de senha por Owner/Admin — createPlatformAdmin/inviteTenantMember acima. */
export const ResetPasswordSchema = z.object({
  password: newPasswordString,
})
export type ResetPassword = z.infer<typeof ResetPasswordSchema>

/**
 * Usado em (auth)/definir-senha (Spec 0011 §3.5) — dormant por enquanto:
 * a criação de usuário passa a pedir a senha direto no cadastro (ver
 * CreatePlatformAdminSchema/InviteTenantMemberSchema acima); este schema
 * volta a ser usado quando o convite por email for implementado.
 */
export const SetInitialPasswordSchema = z.object({
  password: z.string().min(8),
})
export type SetInitialPassword = z.infer<typeof SetInitialPasswordSchema>
