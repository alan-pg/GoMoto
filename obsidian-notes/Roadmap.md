# 🚀 Roadmap — [[GoMoto]]

## Manutenção Preventiva V1 — fases [[PRDs/0003-manutencao-preventiva|PRD 0003]]

Bloco prioritário em andamento. Decisões fechadas em [[decisions/0006-manutencao-preventiva-plano-responsabilidade-registro|ADR 0006]] (revisada em 2026-06-19 — D3/D4 parcialmente adiadas, ver §"Revisão" do ADR).

| Fase | Escopo | Esforço | Bloqueia |
|---|---|---|---|
| ✅ **F1** | Plano + core refatorado | 2-3 dias | F2 |
| 🚧 **F2** | Telas de plano + atribuição à moto (`/planos-manutencao` + wizard passo 3) | 2 dias | F3 |
| ✅ **F3** | Snapshot + modal de conclusão (`effective_executor` / `effective_customer_payer_pct` preenchidos pelo operador; remove `INSERT INTO expenses`) | 1-2 dias | F5 (e libera F4 em paralelo) |
| ✅ **F4** | Mobile lista de preventivas (hooks `@gomoto/data` adaptados pro RN) | 2-3 dias | F5 |
| ✅ **F5** | Mobile registro pelo cliente + aprovação web (`maintenance_records` + bucket + form + `/aprovacoes` + badge realtime) | 3-4 dias | — |
| ⏸ ~~F3 original~~ | ~~Responsabilidade contratual (`contract_maintenance_rules`, `resolveResponsibility`)~~ | — | **Adiada (2026-06-19)** para PRD futuro de "regras de responsabilidade" — ver ADR 0006 §"Revisão". |

**Total: ~10-13 dias focados.** Ordem natural: F1 → F2 → F3 desbloqueia o web; F4 → F5 fecha o ciclo mobile. F4 pode rodar em paralelo a F3.

**Status (2026-06-20):** F3, F4 e F5 entregues. F5 saiu em 4 commits: `87c84ac` (F5.1 tabela + RLS), `899e42a` (F5.2 mobile), `1764f85` (F5.3 /aprovacoes), `36b4dd0` (F5.4 badge + realtime). Resta apenas F2 (planos no web) pra fechar o PRD 0003 V1.

**Pré-check antes do deploy de F1 (não da implementação):**
- ✅ **Local** (2026-06-18): `count(*) FROM maintenances WHERE standard_item_id IS NOT NULL` = **0** (13 linhas órfãs em `maintenance_items`, nenhuma referenciada).
- ⏳ **Cloud** (`hcnxbqunescfanqzmsha`): rodar a mesma query antes do `supabase db push` da F1. Hoje o CLI local não está linkado no projeto — humano roda via Studio cloud.

**Fora do V1 (PRDs futuros consumindo este modelo):** rateio financeiro (`billings` a partir de `effective_*`), regras avançadas (bloqueio por preventiva crítica vencida, oficinas homologadas), Ordem de Serviço, automações (push/WhatsApp, cron de overdue).

## Próximos passos de infra

| # | Item | Descrição | Dependências |
|---|---|---|---|
| 1 | **Deploy no Vercel** | Primeiro deploy em produção. Conectar repo GitHub → Vercel. Adicionar env vars no painel. | — |
| 2 | **GitHub Actions CI/CD** | Pipeline: `pnpm build` + lint + Playwright em cada PR | Deploy no Vercel |
| 3 | **Resend — emails** | Enviar email quando cobrança vencer. Template de lembrete de manutenção. | Variável `RESEND_API_KEY` |
| 4 | **Sentry** | Capturar erros em produção. Dashboard de incidentes. | Deploy |
| 5 | **Upstash Redis** | Migrar rate-limit de in-memory para Redis persistente (atual perde em restart) | Conta Upstash |

## Backlog (médio prazo)

- **Assinatura digital de contratos** — DocuSign ou similar
- **Notificações push / SMS** — alertas de vencimento para operador e cliente (sustenta automações de manutenção do PRD 0003 também)
- **Integração bancária** — reconciliação automática de PIX/boleto
- **Exportação de relatórios** — CSV / Excel de cobranças, despesas, receitas
- **Geolocalização real de motos** — integrar GPS tracker via API
- **Rateio financeiro de manutenção** — PRD próprio consumindo `maintenances.effective_*` para gerar `billings`
- **Ordem de Serviço** — PRD próprio com `service_orders` + peças + mecânico

## Longo prazo / Experimental

- **IA para análise de inadimplência** — score de risco por cliente
- **Cálculo automático de seguro** — taxa de gerenciamento sobre FIPE
- **Self-service signup de tenant** — onboarding sem CLI (ver ADR 0004 §9)
- **Branding por tenant** — logo/cores do app por locadora

## O que está mockado hoje

| Feature | Status | O que falta |
|---|---|---|
| Geolocalização de motos | Lat/lng simulados no mapa | GPS tracker real |
| Emails transacionais | Settings preparado | Integrar Resend |
| Assinatura digital | — | Nenhuma integração ainda |

## Tags
`#projeto/roadmap` `#ideia/futuro`
