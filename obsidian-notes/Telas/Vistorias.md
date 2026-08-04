# 🔍 Tela: Vistorias — [[GoMoto]]

Rota base: `/vistorias` | Tipo: mistura de Client Component (`/vistorias`, `/vistorias/perfis`, `/vistorias/execute/[id]`) + seções embutidas em Server Components (`/locacoes/[id]`, `/veiculos/[id]`)

Implementa [[Specs/0009-modulo-vistoria|Spec 0009]] — perfis de vistoria reutilizáveis, check-in/check-out (administrativo) e vistoria periódica (cliente, primeira escrita do mobile no sistema).

## Rotas

| Rota | Arquivo | Responsabilidade |
|---|---|---|
| `/vistorias` | `page.tsx` | Lista central de pendências (RF-017): check-in/check-out pendentes, periódicas aguardando análise, agendamentos ainda não submetidos pelo cliente (informativo) |
| `/vistorias/perfis` | `perfis/page.tsx` + `actions.ts` | CRUD de Perfil de Vistoria (checklist + itens de imagem) |
| `/vistorias/perfis/novo` | `perfis/novo/page.tsx` | Criação — `InspectionProfileForm.tsx` |
| `/vistorias/perfis/[id]/editar` | `perfis/[id]/editar/page.tsx` | Edição — mesmo form, "substitui tudo" nos itens (não é CRUD item-a-item como planos de manutenção) |
| `/vistorias/execute/[inspectionId]` | `execute/[inspectionId]/page.tsx` | Execução (check-in/check-out pendente) ou análise (periódica submetida) — `InspectionExecutionPanel.tsx`, mesmo componente usado embutido em `/locacoes/[id]` (RF-018/CA-018) |

## Padrão canônico (ADR 0002) — com uma exceção documentada

Perfis (`/vistorias/perfis`) e lista de pendências (`/vistorias`) são **Client Components** usando hooks de `@gomoto/data` (`useInspectionProfiles`, `usePendingInspections`) — igual a `/planos-manutencao`, não `/locacoes` (que é Server Component com `select()` inline).

**As seções embutidas em `/locacoes/[id]` e `/veiculos/[id]` (Server Components) NÃO usam `@gomoto/data`** — usam `select()` inline + `deriveInspectionScheduleStatus`/`pickLatestInspectionBySchedule` de `@gomoto/core`. Motivo: `packages/data/src/index.ts` reexporta hooks (`context.tsx` usa `createContext` sem `'use client'` no próprio arquivo) — importar **qualquer** símbolo do pacote, mesmo uma função pura de repositório, quebra o build do Next num Server Component ("You're importing a component that needs createContext"). Erro descoberto durante `pnpm build` desta Spec — repositórios de `@gomoto/data` só são seguros de chamar a partir de hooks (Client Component) ou do Route Handler mobile (que usa client admin direto, não os repositórios).

## Execução (`InspectionExecutionPanel.tsx`)

Componente único para três casos, decidido por `inspection.status`:

- **`pending`** (check-in/check-out): formulário — checklist OK/Não OK + observação por item, upload de foto por item obrigatório/opcional direto pro bucket `inspection-photos` (path `<tenant_id>/<inspection_id>/<item_id>.<ext>` — usa `item_id`, não um slug do rótulo, porque o rótulo é editável e não garante unicidade). Submete via `submitAdminInspection`.
- **`completed`**: read-only — mesmas respostas/fotos gravadas como snapshot em `inspections.answers`/`.photos`, signed URLs geradas no client (`createSignedUrl`, 1h).
- **`submitted`** (periódica, enviada pelo cliente): read-only + painel de análise (aprovar / rejeitar com motivo obrigatório) via `approveInspection`/`rejectInspection`.

## Perfis (`InspectionProfileForm.tsx`)

Diferente de Planos de Manutenção (`PlanForm.tsx`): não há Server Action por item (`createMaintenancePlanItem` etc.) — `CreateInspectionProfileSchema`/`UpdateInspectionProfileSchema` (`@gomoto/core`) levam `checklist_items`/`photo_items` como arrays completos, e `updateInspectionProfile` faz `DELETE` + `INSERT` de todos os itens a cada salvamento ("substitui tudo"). Seguro porque `inspections.answers`/`.photos` gravam snapshot (nome/rótulo/status) no momento da execução — não há FK viva do histórico para os itens do perfil (ADR 0015 §Neutras), então os novos IDs gerados no replace não invalidam vistorias já registradas.

## Vistoria periódica pelo cliente (mobile)

Ver `apps/mobile/src/screens/Inspections/` — aba "Vistorias" no app do cliente. Único ponto de escrita do cliente no sistema; passa pelo Route Handler `/api/inspections/schedules/[scheduleId]/submit` (ADR 0016), nunca por Server Action. Upload de foto acontece direto do app pro bucket `inspection-photos` (policy de storage aceita qualquer `authenticated`, path é o que isola por tenant) — o Route Handler só recebe os `storage_path` já prontos, mesmo padrão do `pix/route.ts`.

## Check-in/check-out pelo funcionário no pátio (mobile web)

Implementa [[decisions/0018-vistoria-mobile-responsividade-cockpit-web|ADR 0018]] — não é o app `apps/mobile` (esse é do cliente final, com modelo de identidade próprio); é uma fatia responsiva do próprio `apps/web`, fora da chrome do `(dashboard)` (sem Sidebar/Topbar), pro funcionário acessar do celular no navegador, logado com a própria conta de operador (mesmo login de hoje).

| Rota | Arquivo | Responsabilidade |
|---|---|---|
| `/mobile/*` | `(mobile)/layout.tsx` | Layout sem chrome desktop — mesmos guards de auth/tenant do `(dashboard)/layout.tsx`, header fino com logout. Prefixo genérico (não `/vistorias/*`) porque outras telas podem ganhar versão mobile aqui no futuro |
| `/mobile/vistorias` | `(mobile)/mobile/vistorias/page.tsx` | Lista mobile de pendências — mesmo hook `usePendingInspections` do `/vistorias` desktop, filtrado a check-in/check-out (vistoria periódica é análise de mesa, fora de escopo), cards em vez de tabela |
| `/mobile/vistorias/[inspectionId]` | `(mobile)/mobile/vistorias/[inspectionId]/page.tsx` | Wrapper fino do mesmo `InspectionExecutionPanel.tsx` usado no desktop — nenhuma lógica duplicada |

Sessão mobile (detectada por `User-Agent`, `apps/web/src/lib/device.ts`) é confinada a `/mobile/*` — qualquer entrada num celular real em rota do `(dashboard)` (inclusive o redirect pós-login) é redirecionada pra `/mobile/vistorias` (ADR 0018).

`InspectionExecutionPanel.tsx` (compartilhado entre `/vistorias/execute/[id]`, `/locacoes/[id]` e `/mobile/vistorias/[id]`) recebeu ajustes de alvo de toque (botões OK/Não-OK e "Salvar vistoria" de `h-8`/`h-9` para `h-11`) e `capture="environment"` no input de foto — mudanças aditivas, sem efeito no desktop.

### PWA instalável

`(mobile)/layout.tsx` declara `manifest`/`appleWebApp`/`viewport.themeColor` — só nesse layout, então só `/mobile/*` vira "app" na tela inicial do celular; `(dashboard)` não tem nenhum `<link rel="manifest">`. Manifest estático em `public/mobile-manifest.webmanifest` (`start_url`/`scope` restritos a `/mobile/`, `display: standalone`). Ícones em `public/mobile/` (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`) são placeholder gerado (círculo `#BAFF1A` sobre `#121212`, sem dependência externa) — trocar pelos definitivos quando existirem, mesmos nomes de arquivo e dimensões (192², 512², 512² maskable, 180²). Sem service worker / cache offline por decisão explícita (só instalável por ora).

## Tags
`#projeto/tela` `#gomoto/vistorias` `#gomoto/locacoes`
