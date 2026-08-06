# ADR 0020 — Tokens de urgência: `pending` e `critical`

- **Status:** Implementada
- **Data:** 2026-08-05
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Estendida por:** —
- **Estende:** [[decisions/0019-sistema-multi-tema-web|ADR 0019]] — mesmo modelo de tokens, dois nomes novos no vocabulário.

## Contexto

No sweep da ADR 0019, dos ~196 hex que sobraram sem migrar, a maior parte é **duplicata inconsistente** dos 4 tokens já existentes — o mesmo verde escrito como `#28b438` em vez de `--success`, o mesmo vermelho como `#ff3e3c` em vez de `--danger`, etc. Essas seguem mapeadas mecanicamente pros tokens existentes, sem token novo.

Duas exceções são semânticas de verdade — cores usadas de propósito pra dizer algo que `success`/`warning`/`danger`/`info` não dizem:

### 1. "Pendente / aguardando análise" (dourado, hoje `#ffba49`/`#ffd166` + fundo `#5e3a00`/`#3a2f00`/`#2d2300`)

Usado em pelo menos 6 arquivos pra a mesma ideia: **algo está esperando uma pessoa agir, mas não é um erro nem uma operação em andamento**:

- `aprovacoes/page.tsx:233` — badge "Pendente" de aprovação de manutenção
- `veiculos/[id]/page.tsx:30` — badge "Aguardando análise" de vistoria enviada pelo cliente
- `veiculos/page.tsx:146` — alerta "N veículos sem plano de manutenção atribuído"
- `dashboard/page.tsx:79` — cor de cobrança vencida há 1-6 dias (tier mais leve, antes de virar `danger`)

É semanticamente diferente de `warning` (que já significa "manutenção em andamento", laranja) — é mais parecido com "isso está na sua fila, olhe quando puder" do que "aja agora".

### 2. "Crítico" (vermelho profundo, hoje `#c41e1e`, um único call site)

`dashboard/page.tsx:76-80`, função `overdueAgeColor`: cobrança vencida há **30+ dias** ganha um vermelho mais escuro/intenso que o `danger` normal (usado pra 7-29 dias). É uma escalada dentro do que hoje é só "vencido = vermelho" — o sistema já tinha essa ideia de gradiente de gravidade, só não tinha token pra ela.

Ambos batem com um padrão real do domínio: GoMoto tem várias filas de "dias em atraso" (manutenção, cobrança, vistoria, multa) que se beneficiam de uma escala visual, não de um binário liga/desliga.

## Decisão

### 1. Dois tokens novos, mesma arquitetura da ADR 0019

`--pending` / `--pending-bg` e `--critical` / `--critical-bg`, definidos nos mesmos 4 blocos por marca (base claro, `@media dark`, `[data-mode="light"]`, `[data-mode="dark"]`) que os 4 tokens existentes.

### 2. `pending` é ajustado por marca; `critical` é universal

`pending` aparece o tempo todo em UI comum (badges de status) — precisa combinar com a paleta de cada marca, como `warning`/`danger` já fazem.

`critical` é usado uma vez, pra um alarme raro e severo (30+ dias de atraso). Em vez de tingir por marca, ele fica **igual nas 4 direções** — é o único tom que propositalmente quebra a identidade visual, do mesmo jeito que navegadores usam um vermelho fixo pra aviso de segurança independente do site. Isso também simplifica: 2 valores em vez de 8.

| Marca | `pending` (claro / escuro) | `pending-bg` (claro / escuro) |
|---|---|---|
| Frota Confiável | `#CA8A04` / `#EAB308` | `#FEF9C3` / `rgba(234,179,8,.16)` |
| Estrada | `#A16207` / `#FACC15` | `#FEF9C3` / `rgba(250,204,21,.16)` |
| Sinalização | `#854D0E` / `#FDE047` | `#FEF3C7` / `rgba(253,224,71,.16)` |
| Clássico | `#A16207` / `#FFBA49` (mantém o hex já usado hoje) | `#FEF3C7` / `#3A2F00` (idem) |

| Token universal | Claro | Escuro |
|---|---|---|
| `critical` | `#B91C1C` | `#FF3B30` |
| `critical-bg` | `#FECACA` | `rgba(255,59,48,.16)` |

**Ressalva sobre Sinalização:** é a marca mais apertada — o laranja já é `primary` e o `warning` já precisou virar mostarda (`#EAB308`/`#B45309`) pra não colidir com o laranja. `pending` fica com uma folga de matiz pequena em relação a `warning` ali; a distinção depende mais de luminosidade/saturação do que de matiz. Se na prática ficar difícil de diferenciar num badge pequeno, o ajuste é usar tratamento de forma (contorno vs. preenchido) pra reforçar a diferença, não só cor — mas isso é refinamento de implementação, não muda a decisão de ter os dois tokens.

### 3. Migração dos hex existentes

Depois que os tokens existirem, os ~30 usos atuais de `#ffba49`/`#ffd166`/`#5e3a00`/`#3a2f00`/`#2d2300` viram `pending`/`pending-bg`, e o único uso de `#c41e1e` vira `critical`. O resto dos ~196 hex remanescentes (duplicatas de `success`/`warning`/`danger`/`info`/`primary-hover`) é mapeamento mecânico direto nos tokens que já existem — não faz parte desta ADR, é só o resto do sweep.

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| Forçar os hex restantes nos 4 tokens existentes | Perderia a distinção real entre "aguardando" e "vencido/crítico" que o produto já expressa hoje — regressão de informação, não simplificação |
| `critical` também ajustado por marca | Overhead de design (4× mais valores) pra um alarme usado uma vez; a força do "vermelho universal" é justamente destacar sem depender da marca ativa |
| Um único token `urgent` cobrindo pending+critical | Colapsaria "aguardando análise" (neutro, sem culpa de ninguém) com "30 dias vencido" (alarme) — são leituras emocionais opostas pro operador |

## Consequências

### Positivas
- Sistema de status ganha uma escala coerente: `pending` → `warning` → `danger` → `critical`, junto com `success`/`info` fora da escala de urgência.
- `critical` fica pronto pra ser reaproveitado em outras filas de atraso (multas, manutenção, vistoria) que hoje não têm esse tier, sem trabalho extra de design.

### Negativas
- Mais dois tokens pra manter por marca (10 no total, contando `critical` universal como 1 par).
- Sinalização precisa de atenção redobrada se `pending` e `warning` ficarem parecidos demais lado a lado — só se confirma vendo na tela.

## Quando reavaliar

- Se `critical` ganhar um segundo call site com uma marca preferindo tom próprio, reabrir §2 pra decidir se continua universal.
- Se a ressalva da Sinalização (§2) virar problema real de legibilidade, revisar com tratamento de forma (outline) além de cor.

## Estado atual

Implementado e verificado: os 8 tokens (`pending`/`pending-bg` × 4 marcas × claro/escuro, mais `critical`/`critical-bg` universal × claro/escuro) resolvem os valores corretos em `globals.css` — confirmado via `getComputedStyle` no navegador pras 8 combinações de marca×modo. `tailwind.config.ts` ganhou as 4 classes (`bg-pending`, `text-pending`, `bg-pending-bg`, `bg-critical`, etc.). Os ~33 usos que motivaram a ADR (`#ffba49`/`#ffd166`/`#5e3a00`/`#3a2f00`/`#2d2300` → `pending`/`pending-bg`; `#c41e1e` → `critical`) foram migrados em 7 arquivos. `pnpm build` limpo.

Nota à parte, sem relação com esta ADR: `packages/core/src/rules/charges.spec.ts` tem 4 testes que falham por dependerem de `new Date()` real em vez de um relógio fixo — confirmado com `git stash` que a falha já existe no `main`, antes de qualquer mudança desta sessão. Fica registrado aqui só porque apareceu durante a verificação, não é escopo desta ADR.

## Referências

- ADR 0019 — arquitetura de tokens e as 4 direções de marca.
- `apps/web/src/app/(dashboard)/dashboard/page.tsx:76-80` — `overdueAgeColor`, origem do `critical`.
- `apps/web/src/app/(dashboard)/veiculos/[id]/page.tsx:27-31`, `apps/web/src/app/(dashboard)/aprovacoes/page.tsx:233` — origem do `pending`.
