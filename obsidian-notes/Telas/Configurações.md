# ⚙️ Tela: Configurações — [[GoMoto]]

Rota: `/configuracoes` | Tipo: Client Component

## Seções

> Seção "Dados da Empresa" removida (2026-08-07) — os campos `empresa_*` na tabela `settings` não eram consumidos por nenhuma outra tela (contratos, relatórios, etc.).

### Encargo por atraso (Owner apenas) — ADR 0024

A única forma de configurar multa e juros. Antes desta seção, `late_charge_policies` só recebia escrita por migration: mudar a política exigia SQL direto no banco.

| Campo | Unidade na tela | Unidade em `late_charge_policies` |
|---|---|---|
| Tipo de multa | percentual / valor fixo | `fee_type` |
| Multa | **%** (2 = 2%) ou R$ | `fee_value` — **fração** (0.02) quando percentual |
| Juros | **% ao mês** (1 = 1% a.m.) | `daily_interest_rate` — **fração ao dia** (÷ 30) |
| Carência | dias | `grace_period_days` |
| Encargo mínimo | R$ | `min_amount` |
| Em vigor a partir de | data ≥ hoje | `effective_from` |

**Empresa nova nasce sem política, e isso é o estado correto.** `create_tenant_with_owner` não cria nenhuma; o back-fill da migration de políticas só alcançou os tenants que já existiam. Sem política, cobrança vencida não acumula multa nem juros — o cliente deve o valor original, por quanto tempo passar.

Nesse estado a tela mostra um aviso e os campos ficam **vazios**, com a convenção de mercado apenas no placeholder. Antes eles nasciam preenchidos com 2% e 1% ao mês, e quem abria a tela lia configuração onde não havia nenhuma.

A conversão entre as duas colunas vive em `toPolicyRow`/`toPolicyInput` (`@gomoto/core`, `rules/late-charge-policy.ts`), testada. Não é detalhe de formatação: a convenção já divergiu duas vezes nesta base — a função `calculateLateCharges` (removida) tratava `2` como 2%, enquanto a regra viva trata `0.02` como 2%.

**Salvar cria uma VERSÃO nova, nunca edita a vigente.** Cobrança guarda `late_charge_policy_id`, então o que já foi emitido continua valendo o que valia no dia. A numeração e a trava de retroatividade estão em `fn_create_late_charge_policy`, sob `FOR UPDATE` do tenant — `MAX(version)+1` calculado no app daria o mesmo número a duas gravações simultâneas.

Quem escolhe a política de uma cobrança é o banco, por `fn_late_charge_policy_at(tenant, data)`, na **data de emissão**. Fonte única: emissão avulsa (`fn_create_charge`) e cron (`issue_due_charges`) chamam a mesma função.

Havia três respostas para "qual política vale": `fn_create_charge` casava por `due_date`, o cron por `CURRENT_DATE` resolvido uma vez para o lote inteiro, e a lista do cockpit usava a vigente hoje para todas as linhas. Com uma versão só na base ninguém percebia; a segunda fez a mesma cobrança valer R$ 35 de multa fixa na lista e 2% na tela de detalhe.

`due_date` tinha um efeito difícil de defender: cobrança emitida hoje com vencimento em 60 dias podia pegar uma versão **agendada**, ainda não vigente.

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
