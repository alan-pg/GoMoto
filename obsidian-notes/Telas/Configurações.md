# ⚙️ Tela: Configurações — [[GoMoto]]

Rota: `/configuracoes` | Tipo: Client Component

## Seções

> Seção "Dados da Empresa" removida (2026-08-07) — os campos `empresa_*` na tabela `settings` não eram consumidos por nenhuma outra tela (contratos, relatórios, etc.).

### 1. Segurança (ícone Lock `#a880ff`)

| Campo | Tipo |
|---|---|
| Nova Senha | password com toggle Eye/EyeOff |
| Confirmar Nova Senha | password |

**Validações:**
- Mínimo 6 caracteres
- Senhas devem corresponder

Salva via `supabase.auth.updateUser({ password: newPassword })`.

### 2. Informações da Conta (ícone User `#e65e24`) — Read-Only

- E-mail de acesso (`supabase.auth.getUser()`)
- Membro desde (data formatada com `Intl.DateTimeFormat('pt-BR', { day, month, year })`)

## Componente FeedbackMessage

```typescript
type: 'success' | 'error'
// success: bg #0e2f13, border #229731, icon CheckCircle2
// error:   bg #7c1c1c, border #ff9c9a, icon AlertCircle
```

## Queries Supabase

```sql
-- Alterar senha
supabase.auth.updateUser({ password: '...' })

-- Buscar usuário logado
supabase.auth.getUser()
```

## Tags
`#projeto/tela` `#gomoto/configuracoes`
