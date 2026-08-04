# ADR 0018 — Vistoria no pátio pelo celular: responsividade via cockpit web (`/mobile/*`), não novo app

- **Status:** Aceita
- **Data:** 2026-08-03
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação via Server Action, reaproveitado sem alteração), [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] + [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]] + [[decisions/0016-escrita-cliente-mobile-route-handler|ADR 0016]] (por que o `apps/mobile` existente **não** é o lugar certo pra isso), [[PRDs/0009-modulo-vistoria|PRD 0009]], [[Specs/0009-modulo-vistoria|Spec 0009]]

## Contexto

Funcionários precisam registrar vistorias de check-in/check-out **no pátio**, usando o celular, em vez de depender de um computador. A tela que já faz isso — `InspectionExecutionPanel.tsx`, servida em `/vistorias/execute/[inspectionId]` e embutida em `/locacoes/[id]` — já é praticamente mobile-friendly no conteúdo: coluna única, checklist OK/Não-OK, grid de fotos 2 colunas. O bloqueio real não é essa tela, é a **chrome do cockpit**: `LayoutShell` (`apps/web/src/components/layout/LayoutShell.tsx`) renderiza uma `Sidebar` `fixed` de 64–256px + `margin-left` inline em **toda** rota sob `(dashboard)`, sem nenhum breakpoint — isso inviabiliza qualquer tela do cockpit num viewport de celular. Não existe hoje nenhum precedente real de responsividade no `apps/web` (grep no projeto encontra só 2 usos isolados de `sm:`, nenhum de `md:`/`lg:` em layout de página).

O projeto já tem um app mobile nativo — `apps/mobile` (Expo) — mas ele é arquiteturalmente o app do **cliente final**, não do funcionário. A [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]] (estendida pela 0004 e pela 0016) fixa um modelo de identidade próprio pra esse app: CPF como identidade global, control plane de seleção de tenant, e escrita via Route Handler + service role (nunca RLS de INSERT direta). O funcionário, ao contrário, já é `tenant_member` e já autentica normalmente via Supabase Auth com cookie de sessão — o mesmo mecanismo que o cockpit desktop usa hoje, que funciona idêntico num navegador de celular sem nenhuma mudança.

## Decisão

Tornar responsiva **apenas a fatia necessária do `apps/web`**, criando uma nova route-group `(mobile)`, fora do `(dashboard)`, com layout próprio minimalista (sem `Sidebar`/`Topbar`) — reaproveitando 100% de autenticação (sessão Supabase do operador via `getCurrentTenantId`/`getPlatformRole`, mesmos guards de `(dashboard)/layout.tsx`), hooks de `@gomoto/data` e Server Actions já existentes.

Duas rotas novas, nenhuma rota existente alterada:

| Rota | Responsabilidade |
|---|---|
| `/mobile/vistorias` | Lista mobile de pendências — reaproveita `usePendingInspections()` (mesmo hook do `/vistorias` desktop), filtrada a check-in/check-out (vistoria periódica submetida pelo cliente é fluxo de análise de mesa, fora de escopo aqui), renderizada como cards empilhados em vez de tabela |
| `/mobile/vistorias/[inspectionId]` | Wrapper fino que renderiza `<InspectionExecutionPanel>` — o mesmo componente usado no desktop e embutido em `/locacoes/[id]`, sem duplicação de lógica |

Ajustes pontuais no `InspectionExecutionPanel.tsx` (componente compartilhado, então o ganho também beneficia o desktop): botões OK/Não-OK de `h-8` para `h-10`/`h-11` (abaixo do alvo de toque recomendado de 44px) e `capture="environment"` no `<input type="file">` de foto, pra abrir a câmera traseira direto em vez do seletor de arquivo genérico.

Autenticação do funcionário no celular: **conta pessoal de operador, mesmo login de hoje** (`/login`, que já é uma tela centrada/estreita fora do `(dashboard)`, e já funciona em celular sem alteração). Nenhum dispositivo compartilhado ou sessão genérica — decisão confirmada com o usuário durante o planejamento desta ADR.

**Confinamento de sessão mobile ao `/mobile/*`.** Como só a vistoria tem versão adaptada, uma sessão vinda de celular real que caia em qualquer rota do `(dashboard)` (link salvo, digitação direta de URL, voltar do histórico, ou o próprio redirect padrão pós-login) é redirecionada pra `/mobile/vistorias` em vez de renderizar a chrome quebrada de Sidebar/Topbar. Detecção via `User-Agent` (`apps/web/src/lib/device.ts`, `isMobileUserAgent`) — por dispositivo real, não por largura de viewport (não pega emulação de DevTools nem tablets em modo desktop, o que é intencional: o gate é "isso é um celular de funcionário", não "a janela está estreita"). Implementado em dois pontos, ambos usando o mesmo util:

1. `middleware.ts` — redirect pós-login já manda mobile direto pra `/mobile/vistorias` em vez de `/dashboard` (evita um hop extra).
2. `(dashboard)/layout.tsx` — mesmo guard, cobre qualquer entrada que não passe pelo redirect de login (bookmark, digitação de URL, etc.), rodando depois do gate de `platform_admin` (control plane não tem versão mobile, fica de fora deste confinamento).

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **A — Estender `apps/mobile` (app do cliente) com uma tela pro funcionário** | O `apps/mobile` tem um modelo de identidade inteiro construído em torno do cliente final (CPF global, control plane, escrita via Route Handler com service role — ADR 0003/0004/0016). Funcionário usa conta de operador via `tenant_members`/Supabase Auth padrão. Misturar os dois modelos de auth num mesmo app exigiria uma tela de login nova, um fluxo de seleção de papel, e reabrir decisões já fechadas — desproporcional ao pedido ("por enquanto só a tela de vistoria"). |
| **B — Tornar toda a chrome do `(dashboard)` responsiva** (Sidebar vira drawer/hambúrguer abaixo de um breakpoint, Topbar adaptativa) | Resolveria o problema de forma mais genérica — qualquer tela do cockpit ganharia mobile de graça — mas expande o raio de impacto pra cada uma das ~20 rotas existentes quando só uma precisa disso agora. `Sidebar.tsx` já tem lógica não-trivial (fly-outs via portal, badges, accordion) — mexer nela pra adicionar um modo responsivo é risco de regressão desproporcional ao escopo pedido. Fica de pé como caminho natural se o número de telas mobile crescer (ver "Quando reavaliar"). |
| **C — Mover `/vistorias/execute/[id]` pra fora do `(dashboard)`** (mesma URL, layout novo, sem duplicar rota) | Mais DRY que a opção escolhida — zero duplicação de "casca" de rota. Descartada porque muda a experiência do operador **desktop** na mesma tela (ele perde a sidebar ao abrir uma vistoria), um efeito colateral em uso já estabelecido que não foi pedido. |
| **D — Nova rota dedicada `/mobile/*`, sem tocar em nenhuma rota existente** (escolhida) | Maior duplicação de "casca" (dois `page.tsx` finos fazendo praticamente a mesma coisa que `/vistorias` e `/vistorias/execute/[id]` do desktop), mas zero lógica de negócio duplicada (mesmos hooks, mesmas actions, mesmo `InspectionExecutionPanel`) e **zero risco pro que já existe** — reversível apagando uma pasta. |

## Justificativa

**Reaproveita tudo que já existe.** Nenhuma infraestrutura nova, nenhum novo mecanismo de auth, nenhuma duplicação de regra de negócio — só duas rotas finas e um layout sem chrome desktop.

**Escopo do tamanho exato do pedido.** "Por enquanto só a tela de vistoria" vira literalmente duas rotas novas; nada no resto do cockpit muda.

**Baixo raio de impacto e reversível.** Não toca em `Sidebar.tsx`, `LayoutShell.tsx` nem em nenhuma rota `(dashboard)` existente — o único arquivo compartilhado alterado (`InspectionExecutionPanel.tsx`) recebe mudanças puramente aditivas (alvos de toque maiores, atributo de captura de câmera), sem risco pro desktop.

**Não fecha portas.** Se amanhã mais telas precisarem de versão mobile, o padrão já está estabelecido (layout `(mobile)` + rota nova reaproveitando hooks/actions existentes) — e a Alternativa B continua disponível como evolução natural se o número de rotas `/mobile/*` crescer demais.

## Consequências

### Positivas

- Funcionário loga no celular com a própria conta de operador e já funciona — nenhum trabalho de auth novo.
- Zero duplicação de lógica de negócio: mesma query (`usePendingInspections`), mesmas Server Actions (`submitAdminInspection`), mesmo componente de execução.
- Ajustes de alvo de toque no `InspectionExecutionPanel.tsx` beneficiam também o uso desktop (botões maiores nunca são uma regressão de usabilidade).
- Caminho claro e replicável pra estender a outras telas no futuro, sem precisar reabrir esta decisão a cada nova tela mobile.
- Funcionário nunca cai numa tela desktop quebrada no celular — qualquer entrada mobile no `(dashboard)` é redirecionada pra `/mobile/vistorias` automaticamente.

### Negativas / riscos aceitos

- **Duplicação de "casca" de rota:** `/mobile/vistorias` e `/mobile/vistorias/[id]` fazem, em estrutura, o mesmo papel que `/vistorias` e `/vistorias/execute/[id]` do desktop — dois `page.tsx` a mais pra manter em sincronia se o formato de dados mudar (ex.: novo campo em `InspectionWithRentalInfo`). Aceito porque a lógica em si (hooks, actions, painel) é 100% compartilhada — o que duplica é só apresentação.
- **Sem tela mobile pra vistoria periódica (análise/aprovação):** esse fluxo fica de fora do escopo `/mobile/*` por ora — é um fluxo de análise de mesa (aprovar/rejeitar com justificativa), não uma tarefa de pátio. Se isso mudar, é uma extensão natural do mesmo padrão.
- **Se o número de rotas `/mobile/*` crescer muito**, a duplicação de casca deixa de compensar frente a tornar o `(dashboard)` responsivo de verdade (Alternativa B) — ver "Quando reavaliar".

### Neutras

- Nenhuma policy RLS, schema de banco ou Server Action existente é alterada por esta ADR — é uma mudança de apresentação (rotas + layout), não de domínio.

## Quando reavaliar

- **Mais de ~3 telas precisarem de versão mobile dedicada** — nesse ponto, o custo de manter rotas `/mobile/*` paralelas às do `(dashboard)` supera o de tornar `Sidebar`/`LayoutShell` responsivos de verdade (Alternativa B revisitada).
- **Pátio precisar de dispositivo compartilhado** (sessão fixa, conta genérica em vez de login pessoal do operador) — decisão explicitamente fora de escopo aqui (usuário confirmou conta pessoal); se mudar, merece ADR própria, análogo ao que a 0016 fez pro cliente mobile.
- **Vistoria periódica (análise/aprovação) precisar rodar no pátio também** — reavaliar se cabe no mesmo padrão `/mobile/*` ou se muda a natureza do fluxo o suficiente pra justificar telas diferentes.

## Referências

- [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] — padrão de Server Action reaproveitado sem alteração.
- [[decisions/0003-escopo-e-auth-do-mobile-cliente|ADR 0003]], [[decisions/0004-control-plane-e-identidade-do-cliente|ADR 0004]], [[decisions/0016-escrita-cliente-mobile-route-handler|ADR 0016]] — por que `apps/mobile` é o app errado pra essa necessidade.
- [[PRDs/0009-modulo-vistoria]] / [[Specs/0009-modulo-vistoria]] — módulo de vistoria original (check-in/check-out administrativo).
- [[Telas/Vistorias]] — nota de tela atualizada com as novas rotas `/mobile/*`.
- `apps/web/src/components/layout/LayoutShell.tsx`, `Sidebar.tsx` — chrome do `(dashboard)` que motivou esta decisão.
