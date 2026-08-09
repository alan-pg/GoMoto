# 🚨 Tela: Multas — [[GoMoto]]

Rotas: `/multas` (listagem) · `/multas/novo` (criação) · `/multas/[id]` (detalhe) · `/multas/[id]/editar` (edição)
Tipo: listagem e formulário são Client Component; detalhe é Server Component com Server Actions próprias.

> ⚠️ Nota atualizada em 2026-08-09 durante o planejamento da Spec 0012 — a versão anterior não documentava o sistema de anexos nem vários campos do formulário que já existem no código.

## Listagem (`/multas`)

- Botão **"+ Registrar Multa"** no `PageTitle`, linka pra `/multas/novo`.
- 5 KPI cards.
- Filtros: abas de status + select de moto + busca.
- Accordion por moto com histórico colapsável.
- Dados via hooks de `@gomoto/data`: `useFines()`, `useVehicles()` — não é mais fetch inline.

## KPI Cards

| Card | Ícone | Cor |
|---|---|---|
| Total (todas) | FileText | neutro |
| Pendentes (contagem + valor) | Clock | info |
| Vencidas (contagem + valor) | AlertTriangle | vermelho |
| A vencer em 7d | Calendar | amarelo |
| Pagas no mês | CheckCircle2 | verde |

## Filtros

| Filtro | Valores |
|---|---|
| Status | all / overdue / due_soon / pending / paid |
| Moto | Select de placas |
| Busca | Em `description` + `customers.name` |

## Status Dinâmico (calculado no cliente)

```javascript
function calcFineStatus(fine):
  if paid → 'paid'
  if due_date < hoje → 'overdue'
  if due_date - hoje <= 7 dias → 'due_soon'
  else → 'pending'
```

## Agrupamento (Accordion por Moto)

Cabeçalho: ponto colorido de urgência + placa bold monospace + marca/modelo + badges "X vencida(s)" / "X a vencer" + total pendente em vermelho.

Dentro: tabela de pendentes + toggle "Ver histórico (X pagas)".

## Colunas da Tabela (Pendentes)

| Coluna | Conteúdo |
|---|---|
| Infração | Descrição bold + observações + cliente em texto menor |
| Data / Vencimento | Data infração + "Venc:" em vermelho se vencida |
| Valor | `formatCurrency()` em vermelho |
| Responsável | Badge "Cliente" (info) ou "Empresa" (neutro) |
| Status | Badge computado via `calcFineStatus()` |
| Ações | Eye (detalhe), Edit2, CheckCircle (marcar paga), Trash2 |

## Formulário de Criação/Edição (`FineForm.tsx`)

Layout com navegação lateral por seção (sticky, com `IntersectionObserver` pra marcar a seção ativa).

| Seção | Campo | Required | Obs |
|---|---|:-:|---|
| Vínculo | Moto | ✓ | Select — auto-vincula cliente via contrato/locação ativa |
| Vínculo | Cliente | — | **Opcional** — "condutor pode ser identificado depois"; auto-vincula moto se selecionado primeiro |
| Infração | Infrações comuns (CTB) | — | Select quickfill — 12 infrações pré-cadastradas com código/valor/pontos |
| Infração | Descrição | ✓ | Editável mesmo após quickfill, max 300 chars |
| Infração | Código do artigo (CTB) | — | Ex.: `218-II` |
| Infração | Órgão autuador | — | Select: DETRAN / CETRAN / Municipal / Área privada / Outro (`source`) |
| Infração | Local da infração | — | max 2000 chars |
| Datas e Valores | Data da infração | ✓ | — |
| Datas e Valores | Data de vencimento | — | — |
| Datas e Valores | Valor (R$) | ✓ | Pré-preenchido pelo quickfill |
| Datas e Valores | Pontos na CNH | — | 0–7 |
| Datas e Valores | Responsável pelo pagamento | — | customer / company |
| Datas e Valores | Nº do AIT | — | max 50 chars |
| Observações | Link do boleto/notificação | — | `ticket_url`, tipo `url` |
| Observações | Observações livres | — | max 2000 chars |

**Modo edição**: sem upload de anexo neste formulário — anexar documento a uma multa já existente continua só na tela de detalhe (`FineAttachments`, §Anexos abaixo).

**Modo criação** (Spec 0012): primeira seção ("Documento", opcional) permite anexar a notificação de autuação — dispara extração por IA (ver §Extração abaixo) e, ao salvar, sobe automaticamente pro bucket `fine-documents` como anexo tipo `ait`, sem precisar ir na tela de detalhe depois.

### Auto-vinculação Moto ↔ Cliente

Ao selecionar moto → busca contrato/locação ativa → preenche cliente (se houver). Ao selecionar cliente → preenche moto. Fonte: `useRentals()` filtrado por `status === 'active'`. Mesma lógica de contrato é reaproveitada quando a moto é pré-selecionada pela extração de placa (abaixo).

### Extração de Notificação via IA (Spec 0012 / ADR 0023)

Só no modo criação. Ao anexar o PDF/imagem na seção "Documento", o form dispara a Server Action `extractFineNoticeFields` (`multas/actions.ts`) — Gemini via Vercel AI Gateway, mesmo helper `apps/web/src/lib/document-extraction/extract.ts` da extração de CNH, schema `FineNoticeFieldsSchema` (`@gomoto/core`). Campos extraídos (Descrição, Datas, Valor, Nº do AIT, Local) pré-preenchem o form; a **placa extraída** é cruzada com `useVehicles()` via `matchVehicleByPlate` (`@gomoto/core/rules`) — bate → pré-seleciona a Moto (e o Cliente, via contrato ativo); não bate → campo de Moto fica vazio pra seleção manual, sem bloquear o resto do preenchimento. Falha/timeout (15s) mostra "Tentar novamente" / "Preencher manualmente".

`DOCUMENT_EXTRACTION_MOCK=1` no servidor troca a chamada real por um resultado fixo, usado pela suíte E2E (`document-extraction-multa.spec.ts`).

## Anexos (tela de detalhe, `/multas/[id]`)

Componente `FineAttachments.tsx` — sistema de múltiplos anexos por tipo, **não documentado na versão anterior desta nota**.

- Bucket Storage: **`fine-documents`** (privado, 10MB, PDF/JPG/PNG/WebP).
- Path: `${tenantId}/${fineId}/${type}/${timestamp}.${ext}`.
- Tabela `fine_attachments`: `type` ∈ `ait` (Auto de Infração), `nip` (Notificação de Penalidade), `payment_receipt`, `appeal`, `appeal_decision`, `driver_indication`, `other` — **múltiplos anexos por tipo são permitidos** (sem índice único).
- Linha é **imutável após upload** (tabela não tem `updated_at`) — editar significa excluir e reanexar.
- Fluxo: upload direto ao Storage pelo client → `addFineAttachment(fineId, type, path, label?, notes?)` (Server Action recebe só o path) → signed URL gerada no client pra exibir na hora → agrupamento visual por tipo.
- Exclusão: `deleteFineAttachment(id, fineId, fileUrl)` remove do Storage + linha da tabela.

## Modal: Marcar como Paga

- Pré-preenche data com hoje.
- Salva: `status='paid'`, `payment_date={data}` via `markFineAsPaid(id, data)`.

## Server Actions (`actions.ts` e `[id]/actions.ts`)

`createFine`, `updateFine`, `markFineAsPaid`, `deleteFine`, `addFineAttachment`, `deleteFineAttachment`, `extractFineNoticeFields` (Spec 0012, envelope `ActionResult<T>`), `confirmAutoBilling` (geração de cobrança a partir da multa, na tela de detalhe — usa envelope `ActionResult<T>`).

## Tags
`#projeto/tela` `#gomoto/financeiro`
