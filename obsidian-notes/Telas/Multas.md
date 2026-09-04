# 🚨 Tela: Multas — [[GoMoto]]

Rotas: `/multas` (listagem) · `/multas/novo` (criação) · `/multas/[id]` (detalhe) · `/multas/[id]/editar` (edição)
Tipo: listagem e formulário são Client Component; detalhe é Server Component com Server Actions próprias.

> ⚠️ Nota atualizada em 2026-08-11 durante a implementação da Spec 0013 (PRD 0013 — Revisão do Cadastro de Multas NA/NP) — remove o quick-fill de infrações, adiciona todos os campos oficiais da NA presentes nos documentos reais analisados (25 campos novos ao todo, entre a primeira leva e a extensão de 2026-08-11), restringe a extração por IA à NA e adiciona detecção de duplicidade por RENAINF/AIT e badge de condutor não identificado.

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

## Status Dinâmico (`calcFineUrgency`, `@gomoto/core/rules`)

Spec 0013 — extraído de dentro de `page.tsx` (era anti-padrão: lógica de domínio em handler de UI) pra `packages/core/src/rules/fines.ts`, reusado também na tela de detalhe (`[id]/page.tsx`). Usa o prazo em aberto **mais próximo** entre todos os prazos oficiais da multa, não mais só `due_date`:

```javascript
function calcFineUrgency(fine):
  if paid → 'paid'
  nearest = menor data entre: driver_identification_deadline, prior_defense_deadline,
            appeal_deadline, discounted_payment_deadline, due_date (ignora nulos)
  if não há nenhum prazo → 'pending'
  if nearest < hoje → 'overdue'
  if nearest - hoje <= 7 dias → 'due_soon'
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
| Status | Badge computado via `calcFineUrgency()` (`@gomoto/core/rules`) |
| Ações | Eye (detalhe), Edit2, CheckCircle (marcar paga), Trash2 |

## Formulário de Criação/Edição (`FineForm.tsx`)

Layout com navegação lateral por seção (sticky, com `IntersectionObserver` pra marcar a seção ativa).

| Seção | Campo | Required | Obs |
|---|---|:-:|---|
| Vínculo | Placa | ✓ | Select de veículos (era "Moto") — trocar reseta Locação e Cliente |
| Vínculo | Locação | — | Select das locações (ativas + históricas) da placa selecionada — habilita só depois da Placa. Ver §Placa → Locação → Cliente abaixo |
| Vínculo | Cliente | — | **Somente leitura**, derivado da Locação escolhida — não é mais selecionável direto (2026-08-11) |
| Vínculo | Condutor identificado — Nome/CNH/CPF/Outro documento | — | PRD 0013 — preenchido quando a NA/NP já traz o condutor (não é o cliente vinculado, é o que o documento oficial diz); `driver_document` (campo "DOC") complementa a CNH quando o documento traz um identificador diferente |
| Infração | Descrição | ✓ | max 300 chars. Quick-fill "Infrações comuns" **removido** (Spec 0013/RF-001 — lista hardcoded tinha valor errado confirmado contra documento real) |
| Infração | Código SENATRAN / Desdobramento | — | Código oficial numérico (ex.: `7455`) + sub-código (`senatran_infraction_subcode`, ex.: `0`) — juntos identificam a infração exata na tabela oficial. Substitui `infraction_code` (artigo do CTB) — **removido** por nunca aparecer em documento real, nem ser extraível |
| Infração | Órgão autuador / Código do órgão | — | Texto livre (`issuing_agency_name`) + código numérico (`issuing_agency_code`). Campo antes era select (`source`) — **removido**, ver histórico abaixo |
| Infração | Órgão competente / Código | — | `competent_agency_name`/`competent_agency_code` — costuma ser igual ao órgão autuador, mas é campo distinto no documento |
| Infração | Local da infração | — | max 2000 chars |
| Infração | Código do município / Município / UF | — | `infraction_municipality_code`/`infraction_municipality_name`/`infraction_state` — estruturado à parte do local em texto livre porque a frota opera em cidades diferentes (filtro/relatório por região) |
| Infração | Nº do equipamento/instrumento / Matrícula do agente | — | `measurement_instrument_id`/`traffic_agent_id` — rastreabilidade pra recurso (contestar calibração do radar, identificar o agente) |
| Infração | Medição realizada / Valor considerado / Limite regulamentado (km/h) | — | `measured_speed`/`considered_speed`/`speed_limit` — só se aplica a infração de excesso de velocidade; base de cálculo pra avaliar se vale contestar |
| Datas e Valores | Data da infração / Hora da infração | ✓ (data) | `infraction_time`, formato HH:MM |
| Datas e Valores | Data de vencimento | — | — |
| Datas e Valores | Valor (R$) | ✓ | — |
| Datas e Valores | Pontos na CNH | — | 0–7 |
| Datas e Valores | Responsável pelo pagamento | — | customer / company |
| Datas e Valores | Nº do AIT | — | max 50 chars |
| Prazos (NA/NP) | RENAINF / RENAINF da multa original | — | Opcional (RN-002 revogada em 2026-08-10 — multa de área privada existe mas é rara pra uma locadora de moto; sem trava condicionada a órgão). RENAINF segue sendo a chave de deduplicação quando informado (RN-001). `original_renainf_number` referencia o RENAINF anterior quando a notificação é uma reemissão/correção |
| Prazos (NA/NP) | Data da notificação | — | Data em que a NA/NP foi notificada |
| Prazos (NA/NP) | Prazo — defesa prévia | — | Vem da NA |
| Prazos (NA/NP) | Prazo — identificação de condutor | — | Vem da NA — o mais crítico pra locadora, aciona o badge de condutor não identificado |
| Prazos (NA/NP) | Prazo — recurso | — | Vem da NP, preenchido manualmente quando ela chega |
| Prazos (NA/NP) | Vencimento com desconto | — | Vem da NP, preenchido manualmente |
| Observações | Observações livres | — | max 2000 chars |
| Observações | Mensagem SENATRAN | — | `senatran_message` — texto livre, vazio na maioria dos documentos mas pode carregar aviso legal relevante quando presente |

`ticket_url` (Link do boleto/notificação) **removido** — não persistia arquivo de verdade, só um link digitado. Substituído pelo anexo tipo `payment_slip` (Boleto) no sistema de anexos já existente (§Anexos abaixo), que sobe o PDF de verdade pro Storage.

**Modo edição**: sem upload de anexo neste formulário — anexar documento a uma multa já existente continua só na tela de detalhe (`FineAttachments`, §Anexos abaixo).

**Modo criação** (Spec 0012/0013): primeira seção ("Documento", opcional) tem só o card **"Preencher com IA (NA)"** — anexa a Notificação de Autuação, dispara extração por IA (ver §Extração abaixo), sobe pro bucket `fine-documents` como anexo `ait` depois que `createFine` confirma a criação (`uploadStagedAttachment`; falha no upload manda pro detalhe da multa já salva em vez da listagem, pra reanexar manualmente). **NP não tem slot na criação** — decisão revisada em 2026-08-10: só é anexada na tela de detalhe, junto com os demais documentos (§Anexos abaixo). Um card dedicado pra NP na criação chegou a existir brevemente e foi removido — mantém o formulário de criação focado só no documento que sempre existe (a NA).

### Placa → Locação → Cliente (revisado em 2026-08-11)

**Cliente nunca é selecionado direto** — só é derivado de uma locação escolhida. Fluxo:
1. Operador seleciona a **Placa** (`vehicles`) — obrigatória.
2. **Locação** habilita, listando *todas* as locações dessa moto via `useRentals()` **sem filtro de status** (ativas e históricas, `packages/data/repositories/rentals.ts::listRentals`) — ordenadas por `start_date` desc, rótulo `"<cliente> — <início>[ a <fim> | (ativa)]"`. Necessário porque a NA/NP costuma chegar semanas/meses depois da infração — o locatário de hoje pode não ser quem dirigia na data da infração.
3. Ao escolher uma locação, `customer_id` do form é preenchido a partir de `rental.customer_id` — **Cliente** aparece como texto somente-leitura (não é mais um `<select>`), mostrando `rental.customer?.name`.
4. Trocar a Placa reseta Locação e Cliente (a lista de locações muda).
5. **Modo edição**: como não persiste *qual* locação foi escolhida (só o `customer_id` resultante), um `useEffect` faz reconciliação best-effort — acha a primeira locação da moto com `customer_id` batendo e pré-seleciona no picker, só pra não deixar o campo em branco.

**Extração por IA**: casa a placa extraída com `matchVehicleByPlate` e seleciona a moto — a lista de locações aparece sozinha (reativa a `form.vehicle_id`), mas a IA **não** escolhe a locação nem o cliente automaticamente (não sabe qual delas cobre a data da infração) — fica pro operador escolher manualmente.

### Extração de Notificação via IA (Spec 0012/0013 / ADR 0023)

Só no modo criação, e só pra **NA (Notificação de Autuação)** — o prompt (`buildFineNoticePrompt`) é explícito sobre isso desde a Spec 0013, e a extração não tenta ler NP. Ao anexar o PDF/imagem na seção "Preencher com IA (NA)", o form dispara a Server Action `extractFineNoticeFields` (`multas/actions.ts`) — Gemini via Vercel AI Gateway, mesmo helper `apps/web/src/lib/document-extraction/extract.ts` da extração de CNH, schema `FineNoticeFieldsSchema` (`@gomoto/core`).

Campos extraídos (30 ao todo, ver `AI_STRING_FIELDS`/`AI_NUMBER_FIELDS` em `FineForm.tsx`): Descrição, Data/Hora da infração, Valor, Nº do AIT, Local, Código do município/Município/UF, RENAINF, RENAINF da multa original, data da notificação, prazo de defesa prévia, prazo de identificação de condutor, código/subcódigo SENATRAN, nome/código do órgão autuador, nome/código do órgão competente, condutor identificado (nome/CNH/CPF/outro documento), nº do equipamento/instrumento, matrícula do agente, medição realizada/valor considerado/limite regulamentado (velocidade), mensagem SENATRAN. `due_date` **saiu** do conjunto extraído — a NA não tem esse campo (o mapeamento anterior era ambíguo, provavelmente confundia com o prazo de defesa prévia); `due_date` no form virou campo só manual.

**Campos do documento deliberadamente fora do cadastro** (avaliados e descartados por baixo valor pra esse negócio): nome/CNH/CPF/UF do proprietário (é a própria GoMoto, não muda multa a multa), marca/modelo/versão/espécie do veículo (redundante com o cadastro do veículo, já vinculado pela placa), país (sempre "Brasil"), embarcador/transportador (campo pra veículo de carga, não se aplica a motos).

A **placa extraída** é cruzada com `useVehicles()` via `matchVehicleByPlate` (`@gomoto/core/rules`) — bate → pré-seleciona a Moto (e o Cliente, via contrato ativo); não bate → campo de Moto fica vazio pra seleção manual, sem bloquear o resto do preenchimento. Falha/timeout (**30s**, ver nota abaixo) mostra "Tentar novamente" / "Preencher manualmente".

> ⚠️ **Timeout subiu de 15s pra 30s em 2026-08-11**: o schema de extração da NA praticamente dobrou de tamanho (16→30 campos) e passou a estourar os 15s originais em chamada real ao Gemini (erro do AI SDK: `"Delay was aborted"`). `EXTRACTION_TIMEOUT_MS` em `extract.ts`, RNF-001 atualizado no PRD e na Spec 0012.

**Sinalização de campo preenchido por IA (sparkle)**: cada campo populado pela extração fica marcado com um ícone `Sparkles` ao lado do label + leve destaque (`ring-1 ring-primary/50`) na borda do input. Estado vive em `aiFilledFields` (`Set<string>` com as chaves do form), populado no fim de `runFineNoticeExtraction` — **substituído por inteiro** a cada nova extração (não acumula entre documentos). A função `set()` (usada por todo `onChange` do form) remove a chave desse set assim que o operador edita o campo manualmente — o sparkle some na hora. Só os ~30 campos realmente extraíveis da NA recebem essa prop; `vehicle_id`/`customer_id` (preenchidos via `matchVehicleByPlate` + contrato, não diretamente pela IA) não são sinalizados.

**Detecção de duplicidade (RF-007/RN-001, Spec 0013)**: depois da extração, o Server Action busca uma multa existente do mesmo tenant com o mesmo RENAINF (ou AIT, se a multa não tiver RENAINF — `findDuplicateFine`, função privada em `multas/actions.ts`; **não** vem de `@gomoto/data`, ver nota abaixo). Se achar, mostra um banner de aviso com link "Ver multa existente →" — não bloqueia o preenchimento, mas avisa antes de salvar. `createFine` repete a checagem no servidor (cobre RENAINF editado manualmente) e a tabela tem índice único parcial `(tenant_id, renainf_number) WHERE renainf_number IS NOT NULL` como trava final.

> ⚠️ **Nenhuma Server Action deste arquivo importa de `@gomoto/data`.** O barrel do pacote (`packages/data/src/index.ts`) reexporta `./context` (client-only, `createContext`) junto com os repositórios — importar qualquer coisa de lá num arquivo `'use server'` quebra o boundary Server/Client do Next.js. Todas as queries daqui usam o `supabase` do escopo direto, mesmo padrão de `createFine`/`markFineAsPaid`/`syncFineBilling`.

Fora de produção a extração é SIMULADA por padrão — a suíte E2E (`document-extraction-multa.spec.ts`) roda sem configurar nada, e `DOCUMENT_EXTRACTION_REAL=1` exercita a IA de verdade — o RENAINF do fixture é derivado do nome do arquivo (`mockRenainfNumber`) pra não colidir com a dedup entre os testes da suíte.

### Responsável pelo pagamento → Cobrança automática (revisado em 2026-08-11)

`responsible` (`'customer' | 'company'`) é **obrigatório, sem default** — migration `20260811110000_fines_responsible_required.sql` derrubou o `DEFAULT` e setou `NOT NULL`; o `<select>` inicia em branco (`"Selecione..."`) e o operador é forçado a escolher, tanto na criação quanto na edição.

Escolher **Cliente** exige `due_date` (vencimento) e um `customer_id` resolvido (via Locação, §Placa → Locação → Cliente acima) — o `<select required>`/`<input required>` do navegador cobre o vencimento, e `handleSubmit` em `FineForm.tsx` reforça os dois antes de chamar a Server Action (mensagem específica se faltar só o cliente: "Selecione a locação (em Vínculo) para identificar o cliente..." — evita o caso de a cobrança falhar silenciosamente no servidor sem o operador entender por quê).

**`syncFineBilling`** (`multas/actions.ts`, chamada por `createFine`/`updateFine` antes de gravar a multa) decide o que fazer com a cobrança vinculada (`billings.fine_id`) a partir do `responsible` resolvido:
- `company` → cancela (`status='cancelled'`) a cobrança existente, se houver. Se a cobrança já estiver **paga**, a troca é **bloqueada** — a multa nem chega a ser atualizada (`updateFine` roda o sync *antes* do `UPDATE` na tabela `fines`, pra nunca deixar `responsible='company'` com uma cobrança de cliente paga ainda pendurada). Mensagem: "Não é possível mudar o responsável para empresa: a cobrança do cliente já foi paga."
- `customer` → sem cobrança existente: cria uma nova (`source: 'fine'`, `fine_id` setado, `late_charge_config` com o mesmo default hardcoded de `manutencao/[id]/actions.ts::confirmAutoBilling` — RF-017 não lê `FinancialSettingsSchema.late_charge_defaults` do tenant em nenhum dos dois fluxos hoje). Com cobrança existente **não paga**: atualiza `original_amount`/`due_date`/`customer_id`/`lease_id` em vez de duplicar. Com cobrança **paga**: mantém congelada, não mexe.

Editar o **valor** da multa com `responsible='customer'` propaga pro `original_amount` da cobrança automaticamente (mesmo update-in-place acima) — validado ao vivo trocando R$293,47 → R$350 → R$400 numa multa de teste e conferindo a linha em `billings` a cada passo.

Tela de detalhe (`[id]/page.tsx`) ganhou seção **"Cobrança"** — só aparece quando `fine.responsible === 'customer'` — busca a billing não-cancelada mais recente vinculada (`fine_id`, `neq('status','cancelled')`, `limit(1)`) em paralelo com a query da multa, mostra valor/vencimento/status (badge com as mesmas cores de `/cobrancas`) e link "Ver cobrança →". Sem cobrança ainda (ex.: sync falhou silenciosamente) mostra "Sem cobrança gerada ainda."

**Relatórios financeiros**: `/relatorios` está mockado (não lê `billings`/`fines` de verdade) — decisão explícita de não mexer nisso agora. O modelo de dados (`fines.responsible` + `billings.fine_id`/`source='fine'`) já é suficiente pra uma etapa futura de relatório separar gasto da empresa vs. repasse pro cliente; não há trabalho de agregação pendente deste PR.

> ⚠️ **Bug pré-existente encontrado e removido nesta revisão**: existia um `confirmAutoBilling` manual em `multas/[id]/actions.ts` (RF-017, cópia adaptada do equivalente em `manutencao/[id]/actions.ts`) que nunca era chamado por nenhum componente — e tinha um bug real: o `INSERT` em `billings` não setava `fine_id` (o de `manutencao` seta `maintenance_id` corretamente), então geraria cobrança órfã se algum dia fosse conectado a um botão. Removido por completo (arquivo deletado) — superado pelo `syncFineBilling` automático acima.

## Anexos (tela de detalhe, `/multas/[id]`)

Componente `FineAttachments.tsx` — sistema de múltiplos anexos por tipo.

- Bucket Storage: **`fine-documents`** (privado, 10MB, PDF/JPG/PNG/WebP).
- Path: `${tenantId}/${fineId}/${type}/${timestamp}.${ext}`.
- Tabela `fine_attachments`: `type` ∈ `ait` (rótulo "NA — Notificação de Autuação" desde a Spec 0013), `nip` (rótulo "NP — Notificação de Penalidade"), `payment_slip` (Boleto — novo, substitui o antigo campo solto `ticket_url`), `payment_receipt`, `appeal`, `appeal_decision`, `driver_indication`, `other` — **múltiplos anexos por tipo são permitidos** (sem índice único). Os valores `ait`/`nip` no banco continuam assim por compatibilidade; só o rótulo exibido mudou pra terminologia NA/NP.
- Linha é **imutável após upload** (tabela não tem `updated_at`) — editar significa excluir e reanexar.
- Fluxo: upload direto ao Storage pelo client → `addFineAttachment(fineId, type, path, label?, notes?)` (Server Action recebe só o path) → signed URL gerada no client pra exibir na hora → agrupamento visual por tipo.
- Exclusão: `deleteFineAttachment(id, fineId, fileUrl)` remove do Storage + linha da tabela.
- **Badge "condutor não identificado" (RF-010, Spec 0013)**: exibido acima da lista quando a multa tem `driver_identification_deadline` preenchido e ninguém ainda identificou o condutor — nem o documento (`driver_name`/`driver_cnh`/`driver_cpf`), nem um anexo `driver_indication`. Calculado server-side em `[id]/page.tsx` via `isDriverUnidentified` (`@gomoto/core/rules`) e passado como prop; o vínculo com `customer_id` **não** conta pra resolver o badge (é vínculo interno, não a indicação formal ao órgão). A indicação pode ser registrada a qualquer momento após o cadastro, sem bloquear a criação da multa.

## Modal: Marcar como Paga

- Pré-preenche data com hoje.
- Salva: `status='paid'`, `payment_date={data}` via `markFineAsPaid(id, data)`.

## Server Actions (`actions.ts`)

`createFine` (Spec 0013 — checa duplicidade por RENAINF/AIT antes do insert, retorna `code: 'DUPLICATE_FINE'` + `existingFineId` quando encontra; chama `syncFineBilling` antes de gravar), `updateFine` (usa `FineSchema.partial()`; mesmo `syncFineBilling` antes do `UPDATE`, pode bloquear a troca de responsável), `syncFineBilling` (função privada, não exportada — gera/atualiza/cancela a cobrança vinculada conforme `responsible`, §Responsável pelo pagamento acima), `markFineAsPaid`, `deleteFine`, `addFineAttachment`, `deleteFineAttachment`, `extractFineNoticeFields` (Spec 0012/0013, envelope `ActionResult<T>`, retorna também `duplicateOf`).

Não existe mais `[id]/actions.ts` nesta tela — o `confirmAutoBilling` manual que vivia lá foi removido (código morto com bug, ver nota acima).

## Tags
`#projeto/tela` `#gomoto/financeiro`
