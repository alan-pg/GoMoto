# 🏠 Tela: Home (landing institucional) — [[GoMoto]]

Rota: `/home` | Tipo: Server Component (sem `'use client'`) | Fora de qualquer route group — layout raiz apenas

## Propósito

Landing page pública de apresentação do produto GoMoto para potenciais clientes
(locadoras de moto). Não faz parte do cockpit autenticado. Decisão do usuário
(2026-08-07): isolar a landing em `/home` e manter `/` intocado — `/` continua
sendo só a rota de roteamento pós-login (não autenticado → `/login`, `platform_admin`
→ `/admin/dashboard`, `tenant_member` → `/dashboard`).

## Roteamento (middleware)

`/home` foi adicionado a `isPublicPath` em `middleware.ts`, no mesmo grupo de
`/auth/*`. É a única rota fora de `/login`/`/auth/*` acessível sem sessão.

## Tema

Sem tenant/sessão → `getThemePreference` resolve `frota-confiavel` + `light`
fixo (mesmo caminho do `/login`, ver `lib/auth/theme.ts`). A landing herda os
tokens do layout raiz normalmente — não tem brand própria.

## Estrutura da página

- **Header** sticky com blur: logo (ícone `Bike` em `bg-primary` + wordmark) +
  nav âncora (`#recursos`, `#como-funciona`, `#contato`) + botão "Entrar" → `/login`.
- **Hero**: headline + subheadline + dois CTAs (`Entrar` primary, `Falar no
  WhatsApp` outline).
- **Recursos** (`#recursos`): grid de `Card` com um item por módulo real do
  sistema (Frota, Locações, Financeiro, Manutenção preventiva, Vistorias,
  Multi-unidade, App do cliente) — sem inventar funcionalidade que não existe.
- **Como funciona** (`#como-funciona`): 3 passos (cadastrar frota → gerenciar
  locação/financeiro → cliente acompanha pelo app).
- **CTA final** (`#contato`): mesmos dois CTAs do hero, texto de fechamento.
- **Footer**: copyright + tagline.

## CTA de contato (WhatsApp) — mock

Não existe cadastro self-service (tenants são provisionados manualmente) nem
envio de e-mail transacional configurado (Resend não implementado ainda — ver
[[Roadmap]]). O CTA de contato reaproveita o padrão de link `wa.me` já usado em
[[Clientes]]/[[Cobranças]], mas **o número é mock** (`5500000000000`,
constante `SALES_WHATSAPP_NUMBER` em `home/page.tsx`) — não há dado comercial
real cadastrado ainda. Substituir antes de publicar em produção.

## Tags
`#projeto/tela` `#gomoto/marketing` `#gomoto/publico`
