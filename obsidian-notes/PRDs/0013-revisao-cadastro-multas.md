---
status: aprovado
versão: 1.1
modo: lite
autor: Alan (com agente IA)
data: 2026-08-10
related:
  - "[[Telas/Multas]]"
tags:
  - prd
  - prd-lite
  - revisao-cadastro-multas
  - financeiro
---

# PRD 0013 — Revisão do Cadastro de Multas (NA/NP)

> 🟢 **Status: aprovado v1.1** (modo lite) em 2026-08-11. Revisa o cadastro de multas para refletir os dois documentos oficiais do processo brasileiro (Notificação de Autuação e Notificação de Penalidade), seus prazos legais, o condutor identificado, e quem é o responsável pelo pagamento (com geração automática de cobrança pro cliente). Implementado.
>
> **v1.1 (2026-08-11)** — revisão pós-implementação, feita junto com o operador revendo o resultado ao vivo:
> - **RN-002 revogada**: RENAINF deixou de ser obrigatório mesmo pra órgão oficial — vira sempre opcional (ver §4).
> - **RF-011 novo**: Responsável pelo pagamento (cliente/empresa) passa a ser obrigatório e gera/cancela cobrança automaticamente pro cliente.
> - Campo `infraction_code` (artigo do CTB) e o select `source` (órgão) saíram do escopo — nenhum documento real analisado trazia essas informações de forma utilizável; `senatran_infraction_code` (código SENATRAN) e o texto livre "Órgão autuador" já cobrem a necessidade.

> **Por que lite?** Feature pequena — fica toda dentro da tela/entidade Multa já existente, sem persona nova nem módulo novo. Se durante a implementação surgir complexidade fora desse escopo, considerar migração para o template completo.

---

## 1. Visão Geral

### 1.1 Contexto e problema

O formulário de registro de multa trata a notificação de trânsito como um documento único, mas na prática toda multa brasileira passa por até dois documentos oficiais sequenciais e não-redundantes: a **Notificação de Autuação (NA)**, que sempre existe e abre o prazo de defesa prévia e o prazo de **identificação do condutor**, e a **Notificação de Penalidade (NP)**, que só chega depois (podendo levar semanas) e abre o prazo de recurso e o vencimento com desconto. Hoje o sistema não distingue os dois — não captura os prazos oficiais de nenhum, não identifica o condutor já apontado no documento, e não tem como reconhecer que uma NP recém-anexada pertence a uma multa já cadastrada, arriscando duplicidade. Adicionalmente, o preenchimento rápido "Infrações comuns" tem pelo menos um valor incorreto confirmado contra documento real, e não existe hoje nenhum alerta específico para o prazo mais crítico da operação de uma locadora: identificar o condutor a tempo.

### 1.2 Resultado esperado

- Operador cadastra a multa a partir da NA (extração por IA ampliada) e depois anexa a NP quando ela chegar, sem duplicar o registro.
- Prazos legais de cada estágio (identificação de condutor, defesa prévia, recurso, vencimento com desconto) ficam visíveis e rastreáveis, em vez de um único campo genérico de vencimento.
- Fica claro, com um alerta visual, quando uma multa ainda não tem condutor identificado — e o operador consegue registrar essa indicação a qualquer momento, mesmo depois do cadastro.
- Preenchimento rápido de infrações com dados desatualizados deixa de existir.

---

## 2. Personas e User Stories

| Persona | Frequência |
|---|---|
| Operador | Diária/eventual — registra, anexa documentos e acompanha prazos de multas |

- **US-001** — Como Operador, quero anexar a NA de uma multa e ter os campos pré-preenchidos automaticamente (incluindo prazos oficiais e RENAINF), para cadastrar a multa rapidamente e sem erro de digitação.
- **US-002** — Como Operador, quero anexar a NP a uma multa já cadastrada e ter o sistema reconhecer que é a mesma multa, para não duplicar o registro e manter os prazos de recurso/vencimento atualizados.
- **US-003** — Como Operador, quero ver um alerta claro quando uma multa ainda não tem condutor identificado, e poder registrar essa indicação a qualquer momento (não só na criação), para não perder o prazo legal e não travar o cadastro da multa esperando essa informação.
- **US-004** — Como Operador, quero declarar quem é o responsável pelo pagamento da multa (o cliente que estava com a moto, ou a empresa) e, se for o cliente, ter a cobrança gerada automaticamente com o valor e vencimento certos, para não esquecer de cobrar e ter os gastos da empresa separados dos repasses ao cliente.

---

## 3. Fluxo

### 3.1 Caminho feliz

1. Operador recebe a NA e abre "Registrar multa".
2. Anexa o PDF da NA — sistema extrai via IA (placa, descrição, valor, AIT, RENAINF, prazos de defesa prévia e identificação de condutor, condutor identificado se já houver, local) e pré-preenche o formulário.
3. Operador confere, ajusta, vincula moto/cliente e declara o responsável pelo pagamento (cliente ou empresa — obrigatório, sem valor padrão) e salva. Se escolher "cliente", o vencimento é exigido e o sistema gera a cobrança automaticamente. Se o condutor ainda não estiver identificado no documento, a multa fica com o badge "condutor não identificado".
4. Quando o condutor é identificado (imediatamente ou dias/semanas depois), o operador registra a indicação diretamente na multa — o badge desaparece.
5. Semanas depois a NP chega — operador abre a multa existente e anexa o arquivo, preenchendo manualmente o prazo de recurso e o vencimento com desconto.
6. A tela de detalhe exibe todos os prazos vigentes; a listagem calcula "vencida"/"a vencer" a partir do prazo mais próximo ainda em aberto.

### 3.2 Erro principal

Operador tenta cadastrar uma multa (ou anexar um documento) cujo RENAINF — ou AIT, quando a multa for de área privada e não tiver RENAINF — já corresponde a uma multa existente no mesmo tenant. O sistema identifica a coincidência e alerta antes de confirmar, oferecendo anexar o documento à multa existente em vez de criar um novo registro.

---

## 4. Requisitos e Critérios de Aceite

Cada RF traz seu CA inline. RNs aparecem só se houver invariante de domínio.

### RF-001 — Remover o preenchimento rápido "Infrações comuns"

- **CA-001 (vincula RF-001):**
  - **Dado** que o operador abre o formulário de registro de multa
  - **Quando** a seção de Infração é exibida
  - **Então** não há mais lista de preenchimento automático baseada em infrações pré-cadastradas — descrição, valor e demais campos são preenchidos manualmente ou via extração por IA.

### RF-002 — Novos campos oficiais da NA

- **CA-002 (vincula RF-002):**
  - **Dado** um cadastro de multa a partir de uma NA
  - **Quando** o operador salva o formulário
  - **Então** ficam disponíveis (opcionais, preenchidos preferencialmente via IA) o número RENAINF, prazo de identificação do condutor, prazo de defesa prévia, data da notificação, código oficial da infração (SENATRAN) e nome do órgão autuador — nenhum é obrigatório (RN-002 revogada, ver §4).

### RF-003 — Condutor identificado no documento

- **CA-003 (vincula RF-003):**
  - **Dado** que a NA ou NP já traz um condutor identificado (nome/CNH/CPF preenchidos, não "não disponível")
  - **Quando** o operador cadastra ou atualiza a multa
  - **Então** esses dados ficam registrados e visíveis na tela de detalhe, independente do cliente vinculado ao contrato.

### RF-004 — Novos campos oficiais da NP (preenchimento manual)

- **CA-004 (vincula RF-004):**
  - **Dado** que o operador anexa a NP de uma multa já cadastrada
  - **Quando** preenche manualmente os dados dela (sem extração por IA)
  - **Então** o prazo de recurso e a data de vencimento com desconto ficam registrados e visíveis, sem sobrescrever os prazos já vindos da NA.

### RF-005 — Extração por IA direcionada à NA

- **CA-005 (vincula RF-005):**
  - **Dado** que o operador anexa um PDF de NA na seção de preenchimento automático
  - **Quando** a extração é concluída
  - **Então** os campos específicos da NA (RENAINF, prazo de defesa prévia, prazo de identificação de condutor, condutor identificado quando presente) aparecem pré-preenchidos, junto aos já extraídos hoje (placa, descrição, data, valor, AIT, local). A extração por IA não se aplica à NP.

### RF-006 — Anexo dedicado de NA e de NP

- **CA-006 (vincula RF-006):**
  - **Dado** que uma multa já está cadastrada
  - **Quando** o operador acessa a tela de detalhe
  - **Então** há opção clara para anexar o arquivo da NA (se ainda não anexado na criação) e, separadamente, o arquivo da NP — cada um preservando seus próprios prazos.

### RF-007 — Detecção de duplicidade por RENAINF/AIT

- **CA-007 (vincula RF-007):**
  - **Dado** que o operador tenta cadastrar uma multa ou anexar um documento cujo RENAINF (ou AIT, quando a multa não tiver RENAINF) já existe em outra multa do mesmo tenant
  - **Quando** confirma a ação
  - **Então** o sistema alerta sobre a duplicidade e oferece anexar o documento à multa existente em vez de criar um novo registro.

### RF-008 — Indicadores de urgência recalculados

- **CA-008 (vincula RF-008):**
  - **Dado** que uma multa tem múltiplos prazos oficiais registrados
  - **Quando** a listagem de multas calcula os indicadores "vencida" e "a vencer"
  - **Então** o cálculo usa o prazo em aberto mais próximo entre eles (identificação de condutor, defesa prévia, recurso, vencimento com desconto), não mais um único campo genérico.

### RF-009 — Nome do órgão autuador por extenso

- **CA-009 (vincula RF-009):**
  - **Dado** que o operador cadastra ou edita uma multa
  - **Quando** visualiza a seção de Infração
  - **Então** há um campo de texto livre para o nome do órgão autuador (ex.: "PREF. DE RJ RIO DE JANEIRO"), preenchido automaticamente pela extração quando disponível.

### RF-010 — Badge de condutor não identificado e indicação a qualquer momento

- **CA-010 (vincula RF-010):**
  - **Dado** que uma multa tem prazo de identificação de condutor registrado e nenhuma indicação de condutor foi feita ainda (nem via extração do documento, nem via registro manual)
  - **Quando** o operador visualiza a listagem ou o detalhe da multa
  - **Então** um badge de alerta "condutor não identificado" é exibido; e o operador consegue registrar a indicação de condutor a qualquer momento após o cadastro da multa — o cadastro nunca fica bloqueado esperando essa informação.

### RF-011 — Responsável pelo pagamento gera cobrança automaticamente

- **CA-011a (vincula RF-011):**
  - **Dado** que o operador está criando ou editando uma multa
  - **Quando** chega na seção de valores
  - **Então** é obrigado a escolher o responsável pelo pagamento (Cliente ou Empresa) — o campo não tem valor padrão e o formulário não salva sem essa escolha.
- **CA-011b (vincula RF-011):**
  - **Dado** que o operador escolhe "Cliente" como responsável
  - **Quando** salva a multa
  - **Então** o vencimento passa a ser obrigatório e o sistema gera automaticamente uma cobrança para o cliente identificado (via locação vinculada), com o valor e vencimento da multa.
  - Se a multa ainda não tiver um cliente identificado (nenhuma locação selecionada), o salvamento é bloqueado com uma mensagem orientando a resolver o vínculo primeiro — nunca gera cobrança "no vazio".
- **CA-011c (vincula RF-011):**
  - **Dado** que uma multa tem cobrança de cliente gerada
  - **Quando** o operador edita a multa e troca o responsável de Cliente para Empresa
  - **Então** a cobrança existente é cancelada — **exceto** se ela já estiver marcada como paga, caso em que a troca é bloqueada (o sistema avisa que não é possível mudar o responsável porque a cobrança do cliente já foi paga).
- **CA-011d (vincula RF-011):**
  - **Dado** que uma multa com responsável "Cliente" tem seu valor alterado
  - **Quando** o operador salva a edição
  - **Então** a cobrança vinculada é atualizada com o novo valor, sem duplicar o registro de cobrança.
- **CA-011e (vincula RF-011):**
  - **Dado** que uma multa tem responsável "Cliente" e cobrança gerada
  - **Quando** o operador abre a tela de detalhe da multa
  - **Então** vê o valor, vencimento e status de pagamento da cobrança, com link direto pra ela.

### Regras de Negócio

- **RN-001** — Duas multas do mesmo tenant não podem ter o mesmo número RENAINF; um documento cujo RENAINF já está registrado pertence à multa existente, não a uma nova.
- ~~**RN-002** — RENAINF é obrigatório para multas de órgão oficial de trânsito...~~ **Revogada em 2026-08-11.** Na prática o RENAINF é sempre opcional — o sistema não distingue categoria de órgão (o select que sustentava essa regra foi removido, ver v1.1 no topo). Se surgir um caso real de multa de área privada com necessidades próprias, a regra volta a ser discutida com dado concreto em mãos.
- **RN-003** — Uma cobrança vinculada a uma multa (`billings.fine_id`) que já está paga não pode ser cancelada trocando o responsável da multa de volta pra "Empresa" — a troca é bloqueada até a cobrança ser resolvida por outro caminho (ex.: estorno).

### Requisitos Não Funcionais

- Nenhum RNF novo — a latência da extração por IA já está coberta pelo PRD 0012.

---

## 5. Dependências e Riscos

### 5.1 Dependências

- PRD 0012 (Extração de Documentos via IA) — mecanismo já implementado; esta feature estende o conjunto de campos-alvo específico da NA, sem criar mecanismo novo.
- Tabela `billings` (módulo financeiro já existente, PRD 0005/Spec 0010) — RF-011 reaproveita `fine_id`/`source='fine'`, já suportados no schema; nenhuma tabela nova.
- Nenhuma dependência externa nova.

### 5.2 Riscos

- RENAINF pode estar presente mas ilegível em digitalizações de baixa qualidade → mitigação: AIT como identificador de deduplicação alternativo (RF-007).
- Operador pode ter só a NP em mãos (perdeu ou nunca recebeu a NA) → mitigação: cadastro continua aceitando qualquer documento anexado manualmente, sem bloquear a criação.
- Campos novos podem aumentar a percepção de complexidade do formulário → mitigação: nenhum dos campos da NA/NP é obrigatório (RENAINF incluso, RN-002 revogada); ficam opcionais e preenchidos preferencialmente via IA. O único campo novo obrigatório é o responsável pelo pagamento (RF-011) — decisão deliberada, é justamente o campo que evita esquecer de cobrar o cliente.

---

## 6. Aprovação

### 6.1 Questões abertas

- [ ] Nenhuma questão aberta.

### 6.2 Checklist mínimo

- [x] Sem `<!-- preencher -->` remanescente
- [x] Cada RF tem ≥1 CA
- [x] Personas com ≥1 US cada
- [x] Fluxo principal + erro principal documentados
- [x] PRD descreve produto (sem detalhes técnicos de implementação)

**Aprovado por:** Alan em 2026-08-10 · **v1.1 aprovada por:** Alan em 2026-08-11
