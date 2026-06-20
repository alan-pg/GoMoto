# 📊 Estado Atual — [[GoMoto]]

Snapshot em **2026-06-20**.

## ✅ Funcionando end-to-end

- Autenticação (login/logout via Supabase, cookie httpOnly)
- Dashboard com KPIs e gráficos Recharts
- CRUD completo de motos (com mapa Leaflet) — primeira tela migrada para `@gomoto/data`
- CRUD completo de clientes (com filtros, WhatsApp)
- CRUD de contratos (com joins customer+motorcycle; rescisão pelo cliente gera multa; rescisão pela empresa exige justificativa ≥50 chars)
- CRUD de cobranças (com cálculo de atraso)
- CRUD de entradas, despesas, multas
- Fila de espera (cadastro com upload de documentos, swap auditado, fechamento de contrato em 5 mutações compostas)
- Manutenção (bootstrap a partir do plano atribuído à moto + registro manual + conclusão multi-item via operador no web, com snapshot `effective_executor` / `effective_customer_payer_pct`)
- **Planos de manutenção** — `/planos-manutencao` com CRUD de planos e itens, autocomplete via `SUGGESTED_PLAN_ITEMS`, clone, arquivar, set default. Wizard `/motos` passo 3 atribui plano à moto e materializa `maintenances` previstas por item.
- **Manutenção pelo cliente (mobile + web)** — cliente registra conclusão no Expo Go (KM, oficina, custo, fotos), operador revisa em `/aprovacoes` (aprova preenchendo executor/% pagador ou rejeita com motivo). Badge na sidebar conta pendentes; realtime cross-tab invalida cache automaticamente.
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
| PDF de contratos | Botão "PDF" gera via docx-preview + print dialog (commit `683a233`) |
| Geolocalização de motos | Lat/lng simulados no mapa; GPS real comentado como "futuro" |
| Emails transacionais | Settings preparado, mas não envia |
| Webhooks/notificações | Não implementado |
| App mobile | Login CPF + listagem de manutenções + registro de conclusão. Outras telas de produto pendentes |
| `packages/data` cobre só leituras | Mutações vivem em `actions.ts` por tela (decisão registrada na ADR 0002) |

## 🐛 Bugs conhecidos

Nenhum bug crítico aberto.

## 🧮 Regras de domínio em `@gomoto/core/rules`

Fase 3 concluída. Cobertura atual (70 testes Vitest):

- `contracts` — vigência mínima, vigência esperada, classificação de validade (red/orange/green), `CONTRACT_TERMINATION_FINE_BRL`.
- `billings` — `isChargeOverdue`, `calculateDaysOverdue`, default rate, punctuality rate, ticket médio.
- `motorcycles` — `isIdleMotorcycle`.
- `customers` — `identifyCustomersWithMultipleOverdueCharges`.
- `queue` — notas auditáveis do swap (`getMoveUpNote`, `getMoveDownNote`, `getMoveDownReasonNote`, `QUEUE_REORDER_UP_NOTE`).
- `maintenance` — `STANDARD_INTERVALS`, `KM_POR_DIA`, `getInterval`, `calculateMaintenanceStatus`, `calculateNextMaintenance`.

Auditoria em 2026-06-12 confirmou que `contratos`, `cobrancas`, `fila` e `manutencao` consomem essas regras sem drift inline.

## 🚀 Roadmap imediato (ordem sugerida)

1. **Deploy no Vercel** — primeiro deploy em produção; conectar repo + env vars no painel.
2. **GitHub Actions CI/CD** — `pnpm build` + lint + Playwright em cada PR.
3. **Resend** — emails de cobrança vencida, lembretes de manutenção.
4. **Upstash Redis** — migrar rate-limit de in-memory pra persistente.
5. **Sentry** — monitoramento de erros em produção (fechar junto com deploy real).

PRD 0003 V1 (manutenção preventiva) — ✅ fechada em 2026-06-20.

## ✅ Recentemente entregue

- **PRD 0003 V1 — fechada** (2026-06-20) — F1 a F5 entregues. Smoke test end-to-end no DB local confirma o bootstrap: plano default com 5 itens → moto criada → 5 maintenances `preventive`/`inspection` materializadas. F2 (planos + wizard passo 3) já estava em código quando reabrimos a auditoria — só faltava marcar como concluída nas notas.
- **PRD 0003 F5 — manutenção mobile + aprovação web** (4 commits, 2026-06-20) — `87c84ac` cria `maintenance_records` com RLS (operador via `tenant_isolation`, cliente via `customer_self_select/insert`). `899e42a` adiciona modal de registro no mobile (KM, oficina, custo, foto de hodômetro obrigatória, foto de nota opcional) — upload via `arrayBuffer()` (`fetch().blob()` no RN gera arquivo vazio na Storage). `1764f85` adiciona rota `/aprovacoes` no web com aprovação inline preenchendo `effective_executor`/`effective_customer_payer_pct` no `maintenances` e marcando o record. `bd3b5bb` corrige warn de `MediaTypeOptions` deprecado (substituído por `mediaTypes: ['images']`). `36b4dd0` adiciona badge de pendentes na sidebar + realtime cross-tab via publication `supabase_realtime`. **F3, F4 e F5 do PRD 0003 concluídas.**
- **PRD 0003 F3/F4 — snapshot + mobile listagem** (commits anteriores) — `effective_executor`/`effective_customer_payer_pct` preenchidos na conclusão do operador (sem `INSERT INTO expenses` automático). Mobile lista preventivas com status calculado via `@gomoto/core/rules/maintenance`.
- **Bootstrap `apps/mobile`** (commit `5e036ad`, 2026-06-12) — Expo SDK 52 + Expo Router + metro.config para monorepo PNPM. Bumpado para **SDK 56** (Expo `~56.0.11`, RN `0.85.3`, React `19.2.3`, expo-router `~56.2.10`) para casar com o Expo Go publicado nas lojas — SDK 54 deu `ClassCastException` no runtime do Expo Go atual. Override `@types/react: ^18` no `pnpm-workspace.yaml` evita que tipos React 19 do mobile vazem para o web (que ainda roda React 18 via lucide-react/radix). `metro.config.js` ajustado para PNPM (sem `disableHierarchicalLookup`, com `unstable_enableSymlinks`). Validação pendente: rodar `pnpm --filter @gomoto/mobile dev` e abrir no Expo Go.
- **Geração de PDF de contratos** (commit `683a233`, 2026-06-12) — botão "PDF" lado a lado com "Gerar [template]" usa `docx-preview` + print dialog nativo. Validação visual pendente.
- **Fase 3 — extrair regime de manutenção** (commit `521b9ca`, 2026-06-12) — última concentração grande de regra inline migrada para `@gomoto/core`.

## 📈 Métricas de build

- `pnpm build` sem erros (Turbo cobre `web` + `core` + `data`).
- Dev server: `http://localhost:3000`
- Supabase local: `http://127.0.0.1:54321`
- Projeto Supabase cloud: `hcnxbqunescfanqzmsha`

## Últimos commits relevantes (2026-06-20)

| Commit | Mensagem |
|---|---|
| `36b4dd0` | feat(maintenance): F5.4 — badge de pendentes + realtime cross-tab |
| `bd3b5bb` | fix(mobile): troca MediaTypeOptions.Images por ['images'] |
| `1764f85` | feat(aprovacoes): F5.3 — rota web pra revisão de manutenção do mobile |
| `899e42a` | feat(mobile): F5.2 — registrar conclusão de manutenção |
| `87c84ac` | feat(maintenance): F5.1 — tabela maintenance_records + RLS de aprovação |
| `521b9ca` | refactor(core): extrai rules/maintenance + manutencao consome do @gomoto/core |
| `683a233` | feat(contratos): botão "PDF" gera contrato via docx-preview + print dialog |
| `4950798` | docs: fecha Fase 3 e separa "extrair manutenção" como item próprio |
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
