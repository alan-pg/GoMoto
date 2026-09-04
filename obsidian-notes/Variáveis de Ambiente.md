# 🔐 Variáveis de Ambiente — [[GoMoto]]

## Produção / Desenvolvimento

Arquivo: `.env.local` (nunca commitado)

| Variável | Exemplo | Uso |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://hcnxbqunescfanqzmsha.supabase.co` | URL do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGc...` | Chave pública (anon) do Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGc...` | Escrita server-side que contorna RLS: Route Handler do mobile, webhook e job de emissão |
| `CRON_SECRET` | string aleatória | Autentica o Vercel Cron em `/api/cron/issue-charges`. **Sem ele o job recusa executar** — melhor não emitir do que deixar aberto um endpoint que cria documentos financeiros (Spec 0014) |
| `MERCADOPAGO_WEBHOOK_SECRET` | string do painel MP | Valida a assinatura HMAC do webhook |

> ⚠️ `NEXT_PUBLIC_` expõe a variável no navegador. Seguro apenas para a `anon key` — nunca usar a `service_role key` com esse prefixo.

## Testes

Arquivo: `.env.test`

| Variável | Uso |
|---|---|
| `TEST_USER_EMAIL` | Email do usuário de teste para Playwright |
| `TEST_USER_PASSWORD` | Senha do usuário de teste |

## Supabase — IDs do Projeto

| Info | Valor |
|---|---|
| Project ID | `hcnxbqunescfanqzmsha` |
| URL | `https://hcnxbqunescfanqzmsha.supabase.co` |

## Como configurar ambiente novo

1. Criar projeto no Supabase (supabase.com)
2. Copiar URL e anon key em Project Settings → API
3. Criar `.env.local` com as duas variáveis
4. Executar `supabase-schema.sql` no SQL Editor do Supabase
5. Criar usuário em Authentication → Users
6. Rodar `npm run dev`

## Futuras variáveis (Roadmap)

| Variável | Serviço | Para que |
|---|---|---|
| `RESEND_API_KEY` | Resend | Emails transacionais |
| `SENTRY_DSN` | Sentry | Monitoramento de erros |
| `UPSTASH_REDIS_URL` | Upstash | Rate-limit persistente |
| `UPSTASH_REDIS_TOKEN` | Upstash | Auth do Redis |

## Tags
`#projeto/config` `#projeto/segurança`
