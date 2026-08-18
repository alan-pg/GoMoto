# 📊 Estado Atual — [[GoMoto]]

Snapshot em **2026-06-25**.

## ✅ Funcionando end-to-end

- Autenticação (login/logout via Supabase, cookie httpOnly)
- Dashboard com KPIs e gráficos Recharts
- CRUD completo de motos (com mapa Leaflet) — primeira tela migrada para `@gomoto/data`
- CRUD completo de clientes (com filtros, WhatsApp)
- **Locações (Spec 0004 — backend completo)** — tabela `rentals` (ex-`contracts`), 4 migrations (schema base, extensions de `billings`, RPCs atômicos `create_rental_with_charges` / `terminate_rental` / `renew_rental`, coluna `rent_to_own`). Server Actions com 8 operações: criar, encerrar, renovar, baixar pagamento, aplicar desconto, cobrança avulsa, fila, upload de documentos. Regras em `@gomoto/core/rules/rentals.ts`. **Tela `/locacoes` é placeholder** — UI completa pendente.
- CRUD de cobranças (com cálculo de atraso; `original_amount` + `discount_amount` + `calculateFinalAmount`; status `prejudice` substitui `loss`)
- CRUD de entradas, despesas, multas
- Fila de espera integrada ao módulo de locações (inserção via `addToQueue` server action)
- Manutenção (bootstrap a partir do plano atribuído à moto + registro manual + conclusão multi-item via operador no web, com snapshot `effective_executor` / `effective_customer_payer_pct`)
- **Planos de manutenção** — `/planos-manutencao` com CRUD de planos e itens, autocomplete via `SUGGESTED_PLAN_ITEMS`, clone, arquivar, set default. Wizard `/motos` passo 3 atribui plano à moto e materializa `maintenances` previstas por item.
- **Manutenção pelo cliente (mobile + web)** — cliente registra conclusão no Expo Go (KM, oficina, custo, fotos), operador revisa em `/aprovacoes` (aprova preenchendo executor/% pagador ou rejeita com motivo). Badge na sidebar conta pendentes; realtime cross-tab invalida cache automaticamente.
- **Módulo de Vistoria (Spec 0009)** — `/vistorias/perfis` CRUD de Perfil de Vistoria (checklist + itens de imagem); `/vistorias` lista central de pendências (check-in/check-out + análise de periódica); `/vistorias/execute/[id]` execução/análise (mesmo componente reusado na tela da locação, RF-018); vínculos de perfil (check-in/check-out + periódica/frequência) na criação da locação; comparação lado a lado check-in×check-out e histórico agregado na tela do veículo. Vistoria periódica é a primeira escrita do cliente no sistema — app mobile (aba "Vistorias") envia via Route Handler `/api/inspections/schedules/[id]/submit` (Bearer token + service role, ADR 0016), nunca via Server Action. Agendamento upfront via RPC `create_rental_with_charges` estendido; status "atrasada" derivado na leitura (sem cron). Código morto (`checklists`) removido; itens de manutenção "Vistoria..." renomeados para "Revisão..." (colisão de nome resolvida).
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
| App mobile | Login CPF + listagem de manutenções + registro de conclusão + **BillingsScreen** (cobranças do cliente, filtros, modal de detalhe). Outras telas pendentes |
| `packages/data` cobre só leituras | Mutações vivem em `actions.ts` por tela (decisão registrada na ADR 0002) |

## 🐛 Bugs conhecidos

Nenhum bug crítico aberto.

## 🧱 Dívida técnica registrada

**Leitura em escala — [[decisions/0025-leitura-em-escala-paginacao-agregacao-indice|ADR 0025]]** (2026-08-18)

Precisa de revisão: **performance das buscas, paginação, agregação e índices**.

Três defeitos do mesmo tipo apareceram em sequência ao testar o sistema como
operador, todos silenciosos e nenhum pego por portão:

- PostgREST corta em **1.000 linhas** sem erro — KPI que soma linhas no cliente
  passa a mostrar parte da carteira com cara de número certo;
- Kong recusa URI acima de **~8 KB** com 414 — `.in()` estoura a partir de ~200
  ids, e o erro era engolido por `?? []`;
- nenhuma listagem tem paginação de UI, e a busca por texto é feita em memória
  depois de trazer as linhas.

`financial_entries` já passou de 1.000 linhas no banco de desenvolvimento. As
views derivadas agregam sobre ela a cada consulta, sem plano medido.

Contenção já aplicada (não substitui a revisão): enriquecimento da lista de
cobranças em lotes, varreduras de reconciliação paginadas, e KPIs do dashboard
vindos de `receivables_summary` / `receivables_by_month`.

## 🧮 Regras de domínio em `@gomoto/core/rules`

Cobertura atual (**163 testes Vitest**, 12 arquivos):

- `rentals` (**novo Spec 0004**) — `calculateProRataValue`, `generateCycleCharges` (mensal e semanal), `isRentalTerminationWithinMinimum`, `calculateMinimumEndDateForRental`, `getEarlyTerminationImpact`. `RentalSchema` (Zod v4). 28 testes.
- `billings` — `isChargeOverdue`, `calculateDaysOverdue`, default rate, punctuality rate, ticket médio, `canRegisterPayment`, `canApplyDiscount`, `calculateFinalAmount`. Status `prejudice` (substituiu `loss`).
- `contracts` — vigência mínima, vigência esperada, classificação de validade (red/orange/green), `CONTRACT_TERMINATION_FINE_BRL`. (tipo histórico; tabela renomeada para `rentals`)
- `motorcycles` — `isIdleMotorcycle`.
- `customers` — `identifyCustomersWithMultipleOverdueCharges`.
- `queue` — notas auditáveis do swap (`getMoveUpNote`, `getMoveDownNote`, `getMoveDownReasonNote`, `QUEUE_REORDER_UP_NOTE`).
- `maintenance` — `STANDARD_INTERVALS`, `KM_POR_DIA`, `getInterval`, `calculateMaintenanceStatus`, `calculateNextMaintenance`.

## 🚀 Roadmap imediato (ordem sugerida)

1. **Deploy no Vercel** — primeiro deploy em produção; conectar repo + env vars no painel.
2. **GitHub Actions CI/CD** — `pnpm build` + lint + Playwright em cada PR.
3. **Resend** — emails de cobrança vencida, lembretes de manutenção.
4. **Upstash Redis** — migrar rate-limit de in-memory pra persistente.
5. **Sentry** — monitoramento de erros em produção (fechar junto com deploy real).

PRD 0003 V1 (manutenção preventiva) — ✅ fechada em 2026-06-20.
Spec 0004 (locação e cobranças) — ✅ backend + core + mobile fechados em 2026-06-25. UI `/locacoes` pendente.

## ✅ Recentemente entregue

- **Spec 0004 — locação e cobranças (backend + core + mobile)** (2026-06-25) — Rename completo `contracts` → `rentals` em toda a codebase. 4 migrations: schema `rentals` com `cycle`/`cycle_amount`/`due_day`/`rental_type`/`minimum_months`; extensões em `billings` (`original_amount`, `discount_amount`, `billing_type`, status `prejudice`); 3 RPCs atômicos com `SELECT FOR UPDATE NOWAIT` (sem dupla locação para mesma moto); tabela `queue_entries`. `@gomoto/core` atualizado: `RentalSchema`, `generateCycleCharges` (pro-rata, mensal, semanal), `canRegisterPayment`, `canApplyDiscount`, `calculateFinalAmount` — 163 testes passando. `@gomoto/data`: hooks `useRentals`, `useRentalById`, `useBillingsForCustomer`. 8 Server Actions em `locacoes/actions.ts`. Mobile `BillingsScreen` com grupos por locação, filtros, modal de detalhe, pull-to-refresh, banner offline. E2E stubs em `locacoes.spec.ts` e `billings-rentals.spec.ts`. Tela web `/locacoes` é placeholder — UI completa é próximo passo.
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
