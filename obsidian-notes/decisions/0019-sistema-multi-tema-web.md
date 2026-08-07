# ADR 0019 — Sistema multi-tema no cockpit web

- **Status:** Implementada, incluindo sweep página-a-página (95% do hex cravado migrado — ver "Estado atual")
- **Data:** 2026-08-05
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Estendida por:** —

## Contexto

O `globals.css` atual do `apps/web` está literalmente rotulado `/* InfinitePay Design System — Dark Theme */` — verde-limão `#BAFF1A` sobre preto `#121212`, herdado de um app de pagamentos, não desenhado pra uma locadora de motos. Um estudo visual (fora do código, dois artifacts de referência) propôs três direções completas de identidade — paleta, tipografia, componentes — cada uma com variante clara e escura:

1. **Frota Confiável** — azul `#2563EB`, neutros frios (slate). Não compete com o vocabulário semântico de status (verde/âmbar/vermelho/azul), funciona igual em claro/escuro.
2. **Estrada** — petróleo `#0D9488`, neutros quentes (zinc). Mais personalidade de marca; exige atenção pro verde de sucesso não colidir com o petróleo.
3. **Sinalização** — laranja-ember `#F2790A`, quase-preto azulado, dark-first. Continuidade com o hábito visual atual do time; modo claro é secundário.

O stakeholder gostou das três e quer as três disponíveis ao mesmo tempo no sistema, com uma default e as outras como opção — escolha por **usuário**, não por empresa/tenant. Tanto a direção de marca (tema) quanto o modo claro/escuro precisam ficar salvos — não é aceitável nenhum dos dois viver só em `localStorage`.

Depois, o stakeholder pediu pra manter o visual atual (verde-limão sobre preto) como uma **quarta opção**, não como default nem como estrutura a preservar — o código/CSS legado não precisa sobreviver, só a aparência, reconstruída em cima da mesma arquitetura de tokens das outras três:

4. **Clássico** — verde-limão `#BAFF1A` sobre quase-preto `#121212`, dark-first (é literalmente o tema em produção hoje). Sem vocabulário semântico problemático adicional além do que já existe: no código atual, `Badge.tsx` já usa um roxo (`#A880FF`) pro status "info" (ex.: moto alugada) — diferente do azul (`#3B82F6`) declarado em `globals.css` sob o mesmo nome, uma inconsistência do próprio legado. A reconstrução resolve a favor do roxo, porque é o valor que o usuário realmente vê hoje nos badges.

Escopo confirmado: isso é sobre `apps/web`. O app mobile (Expo) mantém a identidade própria já desenhada no estudo de tema mobile (mesmo azul de marca, escuro por padrão com claro disponível) — não entra nesse sistema de troca entre as três direções, porque não foi esse o pedido e são sistemas de estilo diferentes (RN StyleSheet vs. CSS custom properties).

Isso é uma decisão arquitetural não documentada (token architecture + onde persistir a escolha), então fica registrada aqui antes de codar, conforme a regra do projeto.

## Decisão

### 1. Arquitetura de tokens

`:root` em `globals.css` define um conjunto único de custom properties (`--bg`, `--surface`, `--primary`, `--success`, `--warning`, `--danger`, `--info`, etc.) consumido por todos os componentes. Dois atributos independentes no `<html>` resolvem os dois eixos:

- `data-brand="frota-confiavel" | "estrada" | "sinalizacao" | "classico"` — qual das quatro direções está ativa. Cada valor redefine o bloco de tokens.
- `data-mode="light" | "dark"` — só é escrito no `<html>` quando o usuário tem uma escolha explícita salva. Quando a preferência é `'system'` (ver §2), o atributo não é escrito e o CSS cai no `@media (prefers-color-scheme: dark)` — o mesmo padrão já usado nos dois estudos visuais, sem precisar de JS pra decidir no primeiro paint.

Badge.tsx, Button.tsx e qualquer outro componente com hex cravado (`bg-[#BAFF1A]`, `bg-[#0e2f13]`...) migram para referenciar os tokens (`var(--primary)`, `var(--success-bg)`...) em vez de hex fixo — é o que faz as quatro direções funcionarem sem tocar em cada componente de novo.

### 1.1 Tokens da direção "Clássico"

As outras três já têm seus tokens detalhados no estudo visual. "Clássico" não existia como sistema de tokens — só como hex espalhado — então fica registrado aqui:

| Token | Escuro (= produção atual) | Claro (novo, derivado) |
|---|---|---|
| `--bg` | `#121212` | `#FAFAF8` |
| `--surface` | `#202020` | `#FFFFFF` |
| `--surface-2` | `#323232` | `#F0F0EC` |
| `--border` | `#333333` | `#E4E4DE` |
| `--text` | `#FFFFFF` | `#171717` |
| `--text-soft` | `#A0A0A0` | `#52525B` |
| `--text-mute` | `#666666` | `#9C9C94` |
| `--primary` | `#BAFF1A` | `#6B8F00` |
| `--primary-contrast` | `#121212` | `#FFFFFF` |
| `--primary-tint` | `#243300` | `#F1F8DC` |
| `--success` / `--success-bg` | `#229731` / `#0E2F13` | `#16A34A` / `#DCFCE7` |
| `--warning` / `--warning-bg` | `#E65E24` / `#3A180F` | `#C2410C` / `#FFEDD5` |
| `--danger` / `--danger-bg` | `#FF9C9A` / `#7C1C1C` | `#DC2626` / `#FEE2E2` |
| `--info` / `--info-bg` | `#A880FF` / `#2D0363` | `#7C3AED` / `#EDE9FE` |

O escuro é praticamente igual ao que já roda em produção (fidelidade máxima, é o ponto do pedido). O claro é novo — nunca existiu um modo claro do tema atual — derivado escurecendo cada cor de acento o suficiente pra manter contraste AA em fundo branco (ex.: o lime `#BAFF1A` puro falha como cor de texto/ícone em fundo claro; `#6B8F00` é a mesma família, legível). Como qualquer decisão de design nova, fica sujeita a ajuste depois de ver na tela.

### 2. Persistência: duas colunas em `tenant_members`, não tabela nova

```sql
ALTER TABLE tenant_members
  ADD COLUMN theme_brand VARCHAR(24) NOT NULL DEFAULT 'frota-confiavel'
    CHECK (theme_brand IN ('frota-confiavel', 'estrada', 'sinalizacao', 'classico')),
  ADD COLUMN color_mode  VARCHAR(6)  NOT NULL DEFAULT 'system'
    CHECK (color_mode IN ('system', 'light', 'dark'));
```

- `tenant_members` já é a tabela `(tenant_id, user_id)` com RLS habilitada — reaproveitar evita criar uma tabela nova só pra isso (e evita ter que decidir um `tenant_id` artificial pra ela, já que a regra do projeto exige `tenant_id NOT NULL` em toda tabela nova).
- Efeito colateral aceito: um operador que atua em mais de um tenant pode escolher tema diferente por tenant — não é um problema, é até razoável (ex.: se um dia existir branding por tenant, o campo já existe).
- **As duas escolhas ficam salvas no banco** — tema e modo claro/escuro são preferências de conta, sobrevivem a troca de navegador/dispositivo. Duas colunas em vez de uma só combinada (`"frota-confiavel-dark"`) porque os eixos são independentes e crescem separado — trocar o CHECK de `color_mode` não deve forçar reescrever a lista de combinações de `theme_brand`.
- `color_mode = 'system'` é o default: não é "sem preferência salva", é a preferência explícita de seguir o SO — por isso o dado mesmo assim mora no banco (ver §1 pra como isso vira zero-flash no SSR sem precisar de JS).

### 3. Default

`'frota-confiavel'` (Direção 01 — azul) continua o default — não muda com a entrada do "Clássico". É a que menos briga com o vocabulário semântico de status já usado pesado no produto (disponível/alugada/manutenção/vencida) e a única com risco "baixo" na comparação do estudo original. "Clássico" entra só como opção disponível pra quem já se acostumou com o visual atual — ninguém migra pra ele sem escolher explicitamente, e ninguém que já estava usando o sistema muda de tema sem querer, porque o default de coluna nova (`theme_brand`) se aplica a partir da migration pra frente, não retroage sobre preferência nenhuma que ainda não existe.

### 4. Onde o usuário troca

Nova seção "Aparência" em `/configuracoes` (`apps/web/src/app/(dashboard)/configuracoes/page.tsx`), com leitura via hook de `@gomoto/data` e mutação via Server Action nova em `apps/web/src/app/(dashboard)/configuracoes/actions.ts` — segue o padrão canônico da ADR 0002: resolve `tenant_id`/`user_id` server-side, valida com Zod, grava, `logAction`, `revalidatePath`.

### 5. Sem flash de tema errado

`apps/web/src/app/layout.tsx` já resolve a sessão no server; passa a ler `theme_brand` e `color_mode` do usuário atual em `tenant_members` e escrever `data-brand` (sempre) e `data-mode` (só quando `color_mode !== 'system'`) diretamente no `<html>` renderizado no servidor. Não há troca client-side depois do primeiro paint.

### 5.1 Login sempre claro (correção — mesmo princípio do app mobile)

Bug: `/login` podia abrir escuro, porque sem sessão `getThemePreference` caía num default com `color_mode: 'system'` — se o SO/navegador de quem está tentando entrar preferir escuro, `@media (prefers-color-scheme: dark)` resolvia escuro. Mesma causa raiz do bug já corrigido no mobile (ADR 0021 §6): antes de autenticar não dá pra saber quem é o operador nem se a preferência do navegador tem algo a ver com ele.

`getThemePreference` (`apps/web/src/lib/auth/theme.ts`) agora distingue dois defaults:
- **Sem sessão** (`!user` — cobre `/login`, a única rota do grupo `(auth)`): `color_mode: 'light'` fixo.
- **Autenticado sem tenant** (`!tenantId` — ex.: `platform_admin` no control plane): continua `color_mode: 'system'`, sem mudança — é um usuário real, só não tem preferência de operador pra ler; não é o mesmo caso do login.

Como todo o resto do app (`(dashboard)`, `(admin)`, `(mobile)`) exige sessão antes de renderizar (redireciona pra `/login` sem uma), na prática esse ajuste só afeta a própria tela de login — sem precisar de lógica por rota, porque `getThemePreference` já é o único ponto que resolve o tema pro `<html>`.

### 6. Escopo

Esta ADR cobre `apps/web` inteiro — inclui a fatia `/mobile/*` (PWA de campo, ADR 0018), porque ela consome o mesmo `globals.css`/tokens e herda a troca automaticamente, sem trabalho extra. **`apps/mobile` (Expo) fica de fora** — é outro sistema de estilo (StyleSheet do React Native, sem CSS custom properties) e pede uma ADR própria se/quando for temizado.

### 7. Correção de contraste (auditoria UX/UI 2026-08-06)

Pedido do stakeholder: avaliar os 4 temas × claro/escuro contra 21 critérios de UX/UI (usabilidade, acessibilidade, hierarquia visual, etc.), entregue como artifact, seguido de "aplique todas as melhorias identificadas". A auditoria rodou um script Python (luminância relativa WCAG 2.1, `(L1+0,05)/(L2+0,05)`, com composição alpha pros tokens `rgba()` do modo escuro) contra as 8 paletas reais de `globals.css` e achou 3 padrões sistêmicos + 2 restritos ao modo claro:

| Token | Problema | Escopo |
|---|---|---|
| `--border` vs `--surface` | 1,12–1,29:1 (mínimo de componente é 3:1, WCAG 1.4.11) — limite de UI praticamente invisível | 8/8 paletas |
| `--fg-mute` vs `--surface` | 2,52–3,73:1 (mínimo de texto é 4,5:1) | 8/8 paletas |
| `--primary-contrast` vs `--primary` (texto de botão) | 3,59–3,78:1 no claro de Estrada/Sinalização/Clássico (Frota Confiável já passava, 5,17:1) | 3/4 marcas, só claro |
| Badges `success`/`warning`/`danger`/`info`/`pending` vs a própria `-bg` | 2,74–3,95:1 em várias combinações — sistemático no claro das 4 marcas, e também `success`/`danger` no escuro do Clássico | Ver commit — não uniforme, cada marca tinha faixas de falha diferentes |
| `--critical`/`--critical-bg` (token único, ADR 0020) | 3,86–4,47:1 — nunca passava 4,5:1 com folga em nenhuma das 8 paletas | 8/8 (um único ajuste de hex resolve todas de uma vez, por ser token universal) |

**Correção**: cada token com falha foi reescurecido (claro) ou reclareado (escuro) em espaço HSL, preservando matiz/saturação, até bater o limiar + margem de 0,05 (pra sobreviver ao arredondamento de 8-bit). `border`/`fg-mute` de todas as 8 paletas, `primary`+`primary-hover` das 3 marcas afetadas, os pares de badge que falhavam por marca/modo, e `--critical`/`--critical-bg` (que também teve o alpha do modo escuro reduzido de `.16` pra `.12`, porque com `.16` o vermelho precisava clarear demais pra bater 4,5:1 nas 4 marcas ao mesmo tempo). Script + valores antes/depois: `apps/web/src/app/globals.css` (comentário no topo do bloco de tokens). Verificado após a mudança: as 8 paletas re-auditadas não têm mais nenhum FAIL nos pares corrigidos (dois near-misses pré-existentes e não relacionados — `danger` no escuro de Frota Confiável e Sinalização, 4,04:1 e 4,08:1 — foram deixados como estavam, por não terem sido sinalizados como falha na auditoria original).

**Descoberta não coberta pela correção**: o divisor de linha da tabela em `/veiculos` (e o mesmo padrão em outras ~48 telas) usa `border-b border-surface-2`, não `border-b border-border` — ou seja, a correção do token `--border` não resolve visualmente esse divisor específico, porque ele nunca usou esse token. `surface-2` é uma variante de fundo (pensada pra hover/stripe), não um token de borda, e o contraste dela contra `surface` é ainda mais próximo de 1:1. Trocar esse padrão exigiria revisar ~48 arquivos que usam `border-surface-2` como divisor estrutural (headers sticky, tab nav, dividers de página — não só tabelas) — escopo maior que ajuste de token de cor, decisão de UI própria, não aplicado nesta rodada.

Outras melhorias da mesma auditoria, aplicadas fora do CSS:
- Seção "Aparência" movida pra primeiro lugar em `/configuracoes` (antes ficava abaixo de "Dados da Empresa", exigindo scroll) — achado de descobribilidade.
- Confirmação de que já existe feedback inline pós-salvar ("Aparência atualizada.") — item que a auditoria tinha marcado como "não capturado", checado no código (`configuracoes/page.tsx`, `handleSaveTheme`).
- Responsividade (viewport mobile/tablet) e um novo passe de UI pro divisor `border-surface-2` ficaram fora do escopo desta rodada — ver "Quando reavaliar".

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| Só `localStorage`, sem coluna no banco (tema e/ou modo) | Não sobrevive a troca de navegador/dispositivo — contradiz o pedido explícito de que as duas escolhas fiquem salvas |
| Tabela nova `user_preferences(user_id, theme_brand, color_mode)` sem `tenant_id` | Indireção sem ganho, e fere a regra de `tenant_id NOT NULL` em toda tabela nova sem necessidade — `tenant_members` já modela `(tenant, user)` |
| Tema por tenant (branding da locadora, todo operador vê o mesmo) | Não foi o que o stakeholder pediu ("usuário escolher"); vira extensão futura se aparecer demanda de white-label — o campo em `tenant_members` não impede adicionar depois um default em `tenants` |
| Uma coluna única combinando marca+modo (ex.: `theme = 'frota-confiavel-dark'`) | Funcionaria, mas acopla dois eixos que mudam por razões diferentes (marca é escolha de identidade; modo é conforto visual) — `CHECK` fica mais frágil a cada combinação nova |
| Estender o tema mobile (Expo) pra também virar 3 direções selecionáveis | Fora do pedido — mobile mantém a identidade única já definida no estudo próprio |
| Descontinuar o visual atual (verde-limão/preto) ao trocar de arquitetura | Rejeitado — o stakeholder pediu explicitamente pra manter como opção. A ressalva é só não preservar o *código* legado: a aparência é reconstruída como uma 4ª direção normal dentro do novo sistema de tokens |
| Preservar `globals.css`/`Badge.tsx` atuais como estão, só adicionando os 3 temas novos por cima | Geraria dois sistemas paralelos (hex cravado pro "Clássico" + tokens pros outros três) — mais difícil de manter que migrar tudo, incluindo o Clássico, pro mesmo modelo de tokens |

## Consequências

### Positivas
- As duas escolhas (marca e modo) sobrevivem a troca de dispositivo/navegador, sem tabela nova.
- SSR elimina flash de tema errado no primeiro load, inclusive quando a preferência é `'system'`.
- A camada de tokens necessária pra isso também destrava claro/escuro de verdade — hoje o app é dark-only fixo.

### Negativas
- Não é só CSS novo: `Badge.tsx`, `Button.tsx` e variantes com hex cravado precisam migrar pra `var(--token)` — refactor pontual em componentes existentes, não só em `globals.css`. Isso inclui o próprio "Clássico", que hoje *é* o hex cravado — não sobra atalho de "não mexer nesse".
- O modo claro do "Clássico" é inventado nesta ADR (nunca existiu em produção) — validar com o stakeholder depois de implementado, antes de considerar fechado.
- Operador com múltiplos tenants pode acabar com tema e/ou modo "duplicado" por engano entre eles — cosmético, não crítico.

### Neutras
- Nenhuma pendente nesta rodada — tema e modo ficam os dois persistidos no banco, conforme pedido.

## Quando reavaliar

- **Demanda de branding por tenant** (a locadora escolhe a cor, não o operador): reabrir pra adicionar `tenants.theme_brand` como default, com `tenant_members.theme_brand` como override pessoal por cima.
- **`apps/mobile` (Expo) ganhar suporte a tema**: nova ADR — reaproveitar os mesmos quatro slugs de direção (`frota-confiavel` | `estrada` | `sinalizacao` | `classico`), mas arquitetura de tokens própria pro React Native.
- **Modo claro do "Clássico" não agradar**: como é uma derivação nova sem referência de produção, é o candidato mais provável a pedir ajuste de tom depois do primeiro uso real — revisar os valores da tabela em §1.1 se acontecer.
- **Divisor `border-b border-surface-2` (~48 arquivos)**: se o próximo passe de UI quiser resolver isso, decidir entre trocar pra `border-border` (ganha contraste, mas muda a densidade visual de headers/tabs/tabelas em quase todo o app — merece validação visual antes de aplicar em massa) ou aceitar que é um divisor propositalmente sutil e não um limite de componente WCAG 1.4.11 (dividers puramente decorativos, redundantes com espaçamento, não são obrigados a 3:1). Ver §7.
- **Responsividade (mobile/tablet) das 8 combinações**: a auditoria de 2026-08-06 só cobriu desktop (~1568px) — abrir se aparecer relato de problema visual em viewport menor.

## Estado atual

Implementado e testado manualmente (login → troca de tema em `/configuracoes` → persistência entre navegações, nas 4 direções × claro/escuro):

- Migration `20260805231339_add_theme_preferences_to_tenant_members.sql` aplicada.
- Tokens completos das 4 direções em `globals.css` + mapeamento em `tailwind.config.ts`.
- `ThemeBrandSchema`/`ColorModeSchema`/`ThemePreferenceSchema` em `@gomoto/core`; hook `useThemePreference` em `@gomoto/data`.
- `apps/web/src/app/layout.tsx` lê a preferência server-side e escreve `data-brand`/`data-mode` no `<html>` — sem flash confirmado visualmente.
- `updateThemePreferenceAction` + seção "Aparência" em `/configuracoes`, com `router.refresh()` pós-save pra refletir o tema imediatamente sem reload manual.
- Componentes migrados pra tokens: `Badge`, `Button`, `Card`, `Input`/`Select`/`Textarea`, `Modal`, `Sidebar`, `Topbar`, `PageTitle`, `LayoutShell`, e as duas `TenantSuspendedPage` (dashboard + mobile PWA).

**Sweep página-a-página concluído numa segunda passada:** os ~79 arquivos restantes (`page.tsx`/`_components` de cada rota — Dashboard, Manutenção, Veículos, Clientes, Cobranças, Multas, etc., ~3.930 ocorrências de hex fora de `ui/`) foram migrados por mapeamento mecânico hex→token (script Python, `\[#hex\]` → nome do token, preservando o prefixo Tailwind — `bg-`, `hover:bg-`, `border-`, etc. — porque os tokens estão em `theme.extend.colors`, então qualquer variante funciona). `DashboardCharts.tsx` (Recharts) e `VehicleMap.tsx` (cor do pin por status) também migrados, trocando hex por `var(--token)` direto nas props — funciona porque SVG/inline style resolvem CSS custom properties normalmente. Confirmado visualmente no navegador nas 4 direções × claro/escuro em `/dashboard`, `/manutencao` e `/veiculos`.

Resultado: de ~3.930 ocorrências, sobraram **196**, concentradas em: (1) o array de swatches literais em `/configuracoes` (intencional — são as cores de referência do seletor, não devem seguir o tema ativo); (2) uma paleta de status de veículo/urgência de manutenção com 5–6 tons (`VehicleForm.tsx`, `manutencao/page.tsx`, `dashboard/page.tsx` — verde/laranja/roxo/vermelho/dourado além dos 4 tokens semânticos básicos) que não foi forçada nos 4 tokens porque perderia distinção visual — precisa de uma decisão de design (tokens extras tipo `--critical`/`--urgent`), não substituição mecânica; (3) o popup do Leaflet em `VehicleMap.tsx`, que é um cartão claro autocontido (fundo branco fixo do Leaflet) e não precisa seguir o tema do app. `themeColor` do manifest da PWA de campo (`apps/web/src/app/(mobile)/layout.tsx`) continua estático — é metadata do Next, resolvida em build/request time, não CSS.

**Correção de contraste aplicada em 2026-08-06** (§7): valores de `border`, `fg-mute`, `primary`/`primary-hover` (3 marcas), badges semânticos por marca/modo e `critical`/`critical-bg` ajustados nas 8 paletas — reauditado, zero FAIL nos pares corrigidos. Seção "Aparência" movida pra primeiro lugar em `/configuracoes`. `pnpm --filter web typecheck` limpo depois da mudança.

## Referências

- ADR 0002 — padrão canônico de tela (Server Actions em `actions.ts`).
- ADR 0018 — vistoria mobile / responsividade do cockpit web (a fatia `/mobile/*` que herda o tema automaticamente).
- `apps/web/src/app/globals.css`, `apps/web/src/components/ui/Badge.tsx`, `Button.tsx` — hex cravado a migrar.
- `supabase/migrations/20260611232140_tenants_and_tenant_members.sql` — tabela `tenant_members` que ganha as colunas `theme_brand` e `color_mode`.
