# 📊 Estado Atual — [[GoMoto]]

Snapshot em **2026-06-12**.

## ✅ Funcionando end-to-end

- Autenticação (login/logout via Supabase, cookie httpOnly)
- Dashboard com KPIs e gráficos Recharts
- CRUD completo de motos (com mapa Leaflet) — primeira tela migrada para `@gomoto/data`
- CRUD completo de clientes (com filtros, WhatsApp)
- CRUD de contratos (com joins customer+motorcycle; rescisão pelo cliente gera multa; rescisão pela empresa exige justificativa ≥50 chars)
- CRUD de cobranças (com cálculo de atraso)
- CRUD de entradas, despesas, multas
- Fila de espera (cadastro com upload de documentos, swap auditado, fechamento de contrato em 5 mutações compostas)
- Manutenção (bootstrap automático ao criar moto + registro manual + conclusão multi-item)
- Processos (Q&A interno com ordenação)
- Configurações da empresa
- **Audit logs populados em todas as 7 telas de dashboard** (Fase 5 — gap fechado em 2026-06-12)
- **Multi-tenancy:** `tenant_id` injetado server-side em todas as escritas

Ver [[Telas]] para documentação detalhada de cada rota.

## 🏛 Padrão arquitetural atual

Padrão canônico consolidado nas 7 telas em `apps/web/src/app/(dashboard)/*`:

- **Leituras** via hooks de `@gomoto/data` (`useContracts`, `useMaintenances`, etc.) consumidos com `useSupabaseContext()`.
- **Escritas** via Server Actions co-localizadas em `./actions.ts`, com `logAction()` por mutação e `getCurrentTenantId(supabase)` server-side.
- **Storage uploads** seguem no client; a URL gerada é patchada via Server Action.

Detalhes e tradeoffs registrados em [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]].

## ⚠️ Mockado / incompleto

| Item | Situação |
|---|---|
| PDF de contratos | Botão existe, mas não gera arquivo real |
| Geolocalização de motos | Lat/lng simulados no mapa; GPS real comentado como "futuro" |
| Emails transacionais | Settings preparado, mas não envia |
| Webhooks/notificações | Não implementado |
| App mobile | Estrutura `apps/mobile/` ainda não criada (Fase 4-bis) |
| `packages/data` cobre só leituras | Mutações vivem em `actions.ts` por tela (decisão registrada na ADR 0002) |

## 🐛 Bugs conhecidos

Nenhum bug crítico aberto.

## 🧮 Regras de domínio em `@gomoto/core/rules`

Fase 3 concluída para o escopo de **eliminar duplicação**. Cobertura atual (49 testes Vitest):

- `contracts` — vigência mínima, vigência esperada, classificação de validade (red/orange/green), `CONTRACT_TERMINATION_FINE_BRL`.
- `billings` — `isChargeOverdue`, `calculateDaysOverdue`, default rate, punctuality rate, ticket médio.
- `motorcycles` — `isIdleMotorcycle`.
- `customers` — `identifyCustomersWithMultipleOverdueCharges`.
- `queue` — notas auditáveis do swap (`getMoveUpNote`, `getMoveDownNote`, `getMoveDownReasonNote`, `QUEUE_REORDER_UP_NOTE`).

Auditoria em 2026-06-12 confirmou que `contratos`, `cobrancas` e `fila` consomem essas regras sem drift inline.

## 🚀 Roadmap imediato (ordem sugerida)

1. **Geração de PDF** — completar contratos via Edge Function.
2. **Extrair regime de manutenção** para `@gomoto/core/rules/maintenance` — tabela de intervalos por tipo, `KM_POR_DIA`, `diffKm`, cálculo de próxima manutenção. Atualmente inline em `manutencao/page.tsx`. *Não é eliminação de duplicação (não há lugar com cópia), mas é a maior concentração de regra de domínio fora do `core`.* Sessão dedicada, não cirúrgica.
3. **Fase 4-bis — bootstrap `apps/mobile`** (Expo + Expo Router).
4. **Resend** — emails de cobrança vencida, lembretes de manutenção.
5. **Sentry** — monitoramento de erros em produção.
6. **Upstash Redis** — migrar rate-limit de in-memory pra persistente.

## 📈 Métricas de build

- `pnpm build` sem erros (Turbo cobre `web` + `core` + `data`).
- Dev server: `http://localhost:3000`
- Supabase local: `http://127.0.0.1:54321`
- Projeto Supabase cloud: `hcnxbqunescfanqzmsha`

## Últimos commits relevantes (2026-06-12)

| Commit | Mensagem |
|---|---|
| `cb74995` | refactor(core): extrai rules/queue + fila consome calculateMinimumEndDate |
| `cdd7063` | docs: ADR 0002 do padrão canônico de tela + atualiza Estado Atual |
| `9751646` | refactor(fila): migra page.tsx para hooks de leitura + Server Actions |
| `7119d7a` | refactor(manutencao): migra page.tsx para hooks de leitura + Server Actions |
| `1887cc0` | refactor(contratos): migra page.tsx para hooks de leitura + Server Actions |
| `84b2e30` | refactor(despesas): migra page.tsx para hooks de leitura + Server Actions |
| `83c1d88` | refactor(multas): migra page.tsx para hooks de leitura + Server Actions |
| `a1fa0cb` | refactor(entradas): migra page.tsx para hooks de leitura + Server Actions |
| `65b6cc0` | refactor(cobrancas): migra page.tsx para hooks de leitura + Server Actions |

## Tags
`#projeto/estado` `#projeto/ativo`
