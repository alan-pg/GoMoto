# ADR 0023 — Arquitetura de extração de dados de documentos via IA (CNH e Multa)

- **Status:** Aceita
- **Data:** 2026-08-09
- **Autores:** Alan (com agente IA)
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação via Server Action), [[decisions/0010-galeria-de-fotos-vehicle-photos|ADR 0010]] (padrão de anexo de documento com bucket Storage privado + path por convenção)
- **PRD de origem:** [[PRDs/0012-extracao-documentos-ia]]
- **Spec:** [[Specs/0012-extracao-documentos-ia]]

## Contexto

O GoMoto não tem hoje nenhuma integração com provedor de IA/LLM — nenhuma dependência, nenhuma env var, nenhuma Edge Function relacionada. A única "importação assistida" de documento existente é o parser de CRLV (`packages/core/src/parsers/crlv.ts`), que é 100% determinístico: extrai texto de um PDF nativo via `pdfjs-dist` e aplica regex — não lê imagem, não usa IA, falha em qualquer documento escaneado/foto.

O PRD 0012 pede extração de dados de CNH (PDF ou foto) e de notificação de multa (PDF) via IA, preenchendo os formulários de Cliente e Multa, com arquitetura pensada para suportar novos tipos de documento no futuro (RN-005) sem retrabalho. Isso força quatro decisões sem precedente direto no código:

1. **Onde a chamada ao provedor de IA roda** — não existe hoje nenhum lugar no projeto que faça uma chamada de negócio saindo do backend para um serviço de IA externo (a única Edge Function existente, `mercadopago-webhook`, é passiva — recebe webhook, não inicia chamada).
2. **Como integrar com o provedor escolhido** (Gemini, por decisão do stakeholder) — direto via SDK do Google, ou através de uma camada de abstração.
3. **Se e como persistir as tentativas de extração** — o PRD cita métricas de adoção/acerto (§3.3) como objetivo de observação, o que sugeriria um histórico, mas sem meta bloqueante no V1.
4. **Como modelar a extensibilidade a novos tipos de documento** (RN-005) sem tabela de configuração nem reescrita da capacidade já entregue.

## Decisão

### 1. A chamada de IA roda em Server Action Next.js (Node.js, Vercel), não em Edge Function Supabase

`apps/web/src/app/(dashboard)/clientes/actions.ts` e `.../multas/actions.ts` ganham `extractCnhFields`/`extractFineNoticeFields` — Server Actions finas que delegam para um helper compartilhado (`apps/web/src/lib/document-extraction/extract.ts`). Reaproveita o padrão canônico de mutação já estabelecido (ADR 0002) e o runtime Node.js já usado por toda a aplicação, sem introduzir um segundo runtime/linguagem (Deno) só para esta feature. O timeout de função da Vercel (300s) dá folga ampla sobre os 15s de RNF-001.

**Alternativa rejeitada:** Supabase Edge Function. Seria consistente com o único outro caso de "lógica fora do client" hoje, mas sem motivo técnico — não precisa de `service_role` bypass nem é um webhook passivo, só adicionaria uma segunda stack de deploy/observability para uma chamada request/response comum.

### 2. Integração via Vercel AI SDK + AI Gateway, modelo Gemini por string `"google/gemini-..."`

`generateObject()` da Vercel AI SDK, roteado pelo AI Gateway (sem instalar `@ai-sdk/google`). Zero markup sobre o preço do provedor, disponível no plano free da Vercel (crédito mensal por time, sem exigir Pro), com painel de observability/custo e budget alerts nativos — mitigação direta para o risco de custo descontrolado que o próprio PRD (§11.2) já sinalizava e delegava para a Spec.

Toda chamada passa `providerOptions: { gateway: { disallowPromptTraining: true } }` — controle do AI Gateway disponível em qualquer plano (inclusive free), sem custo extra, com Google/Gemini coberto pelo acordo de não-reuso de dados pra treino que a Vercel já negociou com os provedores. Isso resolve RNF-005 inteiramente em código: se o modelo pedido não estiver coberto por esse acordo no momento da chamada, o Gateway recusa a requisição explicitamente em vez de rotear silenciosamente por um provedor sem a garantia — cai no mesmo `EXTRACTION_FAILED` já desenhado para qualquer outra falha do provedor. **Só funciona com credenciais gerenciadas do Gateway, não com BYOK** (chave própria do Gemini) — outro motivo pra não migrar pra BYOK sem reavaliar essa decisão.

**Alternativa rejeitada:** `@ai-sdk/google` direto com chave própria do Gemini. Mesmo custo de token, mas sem o painel de observability/budget alert consolidado, e amarra a troca de provedor futura a uma mudança de import em vez de uma string de config.

### 3. Nenhuma persistência dedicada à extração — o resultado final é o anexo já existente do cadastro

Sem tabela de histórico (`document_extractions` ou similar) e sem upload intermediário ao Storage antes da confirmação do operador. O arquivo fica em memória no client até o formulário ser salvo; nesse momento é enviado ao bucket que já existe para cada tela (`customer-documents` via `customers.drivers_license_photo_url`; `fine-documents` via `fine_attachments`, `type='ait'`) — reaproveitando 100% do modelo de dados e dos fluxos de anexo já entregues em features anteriores.

Isso é decisão explícita do stakeholder: persistência é regra do **cadastro** (Cliente/Multa), não da **extração** — a extração é só um atalho de preenchimento efêmero. Consequência aceita: as métricas de adoção/taxa-de-acerto citadas no PRD §3.3 não têm hoje uma fonte de dados; ficam adiadas para quando houver decisão de meta.

**Alternativa rejeitada:** tabela `document_extractions` com histórico de tentativas, campos extraídos e confiança por campo, para alimentar §3.3 e dar trilha de auditoria de dado sensível passando por IA de terceiro. Descartada por decisão de escopo — sem uso definido para o histórico além da métrica não-bloqueante.

### 4. Extensibilidade via registry em código (`packages/core`), não via tabela de configuração

`packages/core/src/document-extraction/registry.ts` mapeia `documentType → { fieldsSchema (Zod), promptBuilder, targetEntity }`. Um Server Action genérico despacha por `documentType`; adicionar um tipo de documento novo (comprovante de residência, contrato) é uma entrada nova no registry, nunca uma mudança nos tipos já entregues (RN-005).

**Alternativa rejeitada:** tabela SQL de configuração de tipos de documento/campos esperados, editável por UI administrativa. Nenhum RF do PRD pede administração desse tipo hoje — YAGNI; o registry em código é extensível o suficiente para o volume atual (2 tipos, crescendo aos poucos) e mais simples de revisar em PR do que dado dinâmico em produção.

## Consequências

**Positivas:**
- Primeira integração de IA do projeto fica isolada em dois pontos (`registry.ts` + `extract.ts`), fácil de auditar e de trocar de provedor/modelo depois.
- Zero migration, zero tabela nova — a feature entra sem dívida de schema.
- Custo e observability de IA ficam visíveis desde o dia 1 via painel da Vercel, sem instrumentação própria.
- Runtime único (Node.js/Vercel) para toda a aplicação — sem uma segunda stack de deploy para manter.

**Negativas:**
- Sem histórico de extração, não há como investigar depois "por que esse campo saiu errado" além do log operacional (contagens/latência, sem valores) — se um problema sistemático de qualidade aparecer, o diagnóstico depende de reproduzir manualmente, não de consultar dado histórico.
- As métricas de adoção/acerto do PRD §3.3 não são calculáveis com o desenho atual — precisarão de uma tabela nova se/quando uma meta for definida (retrabalho futuro aceito conscientemente).
- RNF-005 (garantia contratual de não-reuso para treino) fica amarrado à disponibilidade contínua do acordo `disallowPromptTraining` da Vercel com o Google — se esse acordo mudar ou for descontinuado, a chamada passa a falhar (fail-safe, não fail-open), e a feature precisaria de reavaliação, não é um risco silencioso.

**Padrão estabelecido para o projeto:**
Integrações futuras com provedores de IA/LLM devem seguir este padrão: Server Action em Node.js/Vercel (nunca Edge Function, salvo necessidade técnica concreta), Vercel AI SDK + AI Gateway por padrão (SDK direto do provedor só com justificativa explícita), e extensibilidade por registry em `packages/core` quando o domínio tiver "tipos" que crescem ao longo do tempo, reservando tabela de configuração para quando houver necessidade real de administração via UI.
