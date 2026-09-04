---
status: aprovado
versão: 1.0
modo: lite
autor: Alan (com agente IA)
data: 2026-08-07
related:
  - "[[Telas/Locações]]"
  - "[[PRDs/0004-locacao-e-cobrancas]]"
tags:
  - prd
  - prd-lite
  - entrada-locacao
  - financeiro
---

# PRD 0010 — Entrada não reembolsável na locação

> ✅ **Status: implementado** em 2026-08-07. Novo campo "Entrada" na criação da locação — valor não reembolsável que compõe a receita do veículo, pago na hora ou cobrado em aberto. Ver [[Specs/0010-entrada-locacao]] para o detalhamento técnico e evidência de testes.

> **Por que lite?** Um campo novo, um fluxo isolado (criação de locação), reaproveitando um padrão de UX já existente (Caução). Sem nova persona, sem decisão arquitetural nova.

---

## 1. Visão Geral

### 1.1 Contexto e problema

Hoje, na criação de uma locação, o operador só tem um jeito de registrar um valor recebido do cliente na assinatura: a **Caução** — um valor que é sempre devolvido (total ou parcialmente) ao fim do contrato e que, por isso, nunca é contado como receita da locação. Não existe campo para registrar um valor de **entrada** — comum na prática comercial — que o cliente paga ao assinar o contrato, que **não é devolvido** em nenhuma hipótese e que deveria contar como parte do valor recebido pelo veículo. Quando esse valor de entrada é combinado mas ainda não pago na hora da assinatura, também não existe hoje um jeito de gerar uma cobrança em aberto vinculada à locação para rastrear essa pendência.

### 1.2 Resultado esperado

- Operador registra o valor de Entrada ao criar a locação (campo opcional, como a Caução).
- Se já foi paga, o sistema já registra como recebida. Se não, gera uma cobrança em aberto vinculada à locação.
- O valor da Entrada passa a compor os valores recebidos daquele veículo/locação — diferente da Caução, que nunca entra nesse cálculo.

---

## 2. Personas e User Stories

| Persona | Frequência |
|---|---|
| Operador | Diária (toda criação de locação com entrada combinada) |

- **US-001** — Como Operador, quero registrar o valor de Entrada da locação — já pago ou como cobrança em aberto — para que esse valor componha a receita da locação e o cliente tenha uma cobrança rastreável caso ainda não tenha pago.

---

## 3. Fluxo

### 3.1 Caminho feliz

1. Operador acessa "Nova locação" e preenche os dados normais (veículo, cliente, ciclo, valor, datas).
2. Na seção de garantias e valores adicionais, informa o valor de Entrada (opcional, igual à Caução).
3. Marca se a Entrada já foi paga (informando a data do pagamento) ou ainda está pendente (informando o vencimento).
4. Revisa o preview de cobranças antes de confirmar — a Entrada já aparece listada ali.
5. Confirma a criação da locação.
6. Sistema cria a locação: se a Entrada foi marcada como paga, já nasce registrada como recebida; se pendente, gera uma cobrança em aberto vinculada.
7. Assim que paga, o valor da Entrada passa a compor os valores recebidos daquele veículo.

### 3.2 Erro principal

Operador marca a Entrada como "ainda não paga" mas não preenche a data de vencimento → sistema assume a data de início da locação como vencimento padrão (mesmo comportamento já usado na Caução hoje), evitando cobrança sem vencimento definido.

---

## 4. Requisitos e Critérios de Aceite

### RF-001 — Registrar valor de Entrada (opcional) na criação da locação

- **CA-001 (vincula RF-001):**
  - **Dado** o formulário de nova locação
  - **Quando** o operador deixa o campo Entrada em branco
  - **Então** a locação é criada normalmente, sem nenhuma cobrança de Entrada associada

### RF-002 — Indicar se a Entrada já foi paga ou está pendente

- **CA-002 (vincula RF-002):**
  - **Dado** que o operador informou um valor de Entrada e marcou "já paga" com data de pagamento
  - **Quando** confirma a criação da locação
  - **Então** a locação nasce com a Entrada registrada como recebida naquela data, sem gerar cobrança em aberto
- **CA-003 (vincula RF-002):**
  - **Dado** que o operador informou um valor de Entrada e marcou "ainda não paga" com data de vencimento
  - **Quando** confirma a criação da locação
  - **Então** o sistema gera uma cobrança em aberto vinculada à locação, com o valor e vencimento informados
- **CA-004 (vincula RF-002):**
  - **Dado** que o operador marcou a Entrada como pendente sem preencher a data de vencimento
  - **Quando** confirma a criação
  - **Então** o sistema assume a data de início da locação como vencimento padrão

### RF-003 — Exibir a Entrada no preview de cobranças e no extrato financeiro da locação

- **CA-005 (vincula RF-003):**
  - **Dado** que o operador preencheu um valor de Entrada no formulário
  - **Quando** visualiza o preview de cobranças antes de confirmar
  - **Então** a Entrada aparece listada junto das demais cobranças que serão geradas
- **CA-006 (vincula RF-003):**
  - **Dado** que uma locação tem Entrada registrada
  - **Quando** o operador acessa o extrato financeiro dessa locação
  - **Então** a Entrada aparece no histórico com seu status (paga/pendente)

### RF-004 — Contabilizar a Entrada como receita recebida do veículo

- **CA-007 (vincula RF-004):**
  - **Dado** que uma Entrada foi paga
  - **Quando** o operador consulta os valores recebidos daquele veículo/locação
  - **Então** o valor da Entrada está incluído no total — ao contrário da Caução, que nunca é contabilizada como receita

### RF-005 — Permitir corrigir a Entrada enquanto pendente

- **CA-008 (vincula RF-005):**
  - **Dado** que uma locação tem Entrada pendente
  - **Quando** o operador altera o valor ou o vencimento na tela de edição da locação
  - **Então** a alteração é salva e refletida na cobrança em aberto
- **CA-009 (vincula RF-005):**
  - **Dado** que a Entrada já foi paga
  - **Quando** o operador acessa a tela de edição da locação
  - **Então** o valor da Entrada é exibido somente leitura (não pode ser alterado)

### Regras de Negócio

- **RN-001** — O valor de Entrada não é reembolsável: encerrar a locação não gera nenhuma obrigação de devolução ao cliente (diferente da Caução).
- **RN-002** — Uma locação tem no máximo uma Entrada, definida no momento da criação.
- **RN-003** — Uma Entrada pendente não é cancelada automaticamente pelo encerramento antecipado da locação — permanece como cobrança em aberto até ser paga ou tratada manualmente, diferente das cobranças de ciclo futuras (que são canceladas ao encerrar).

### Requisitos Não Funcionais

*(nenhum requisito não funcional novo — reaproveita as garantias já cobertas pelo PRD 0004: isolamento por tenant, atomicidade da criação de locação)*

---

## 5. Dependências e Riscos

### 5.1 Dependências

- Depende do modelo de cobrança e do padrão de UX já estabelecido pela Caução (PRD 0004 — Locação e Cobranças Automáticas; Spec 0008 — Módulo Financeiro). Este PRD estende esse modelo para reconhecer uma nova modalidade de cobrança, não reembolsável. Nenhuma ADR nova esperada — é extensão de um padrão já decidido, não uma decisão arquitetural nova.

### 5.2 Riscos

- **Confusão de nomenclatura** com a tela legada `/entradas` (registro de receitas avulsas por veículo, de uma arquitetura anterior ao modelo multi-tenant atual). Mitigação: são conceitos e dados independentes, sem colisão técnica; se a tela legada for revisitada no futuro, reconciliar nomenclatura nesse momento.
- **Confusão operacional** entre Entrada e Caução no formulário, já que os campos ficam lado a lado e ambos aceitam "já foi paga?". Mitigação: rótulos e textos de ajuda devem deixar clara a diferença (reembolsável vs. não reembolsável) — detalhe de UX a resolver na Spec.

---

## 6. Aprovação

### 6.1 Questões abertas

- [x] Nenhuma questão aberta.

### 6.2 Checklist mínimo

- [x] Sem `<!-- preencher -->` remanescente
- [x] Cada RF tem ≥1 CA
- [x] Personas com ≥1 US cada
- [x] Fluxo principal + erro principal documentados
- [x] PRD descreve produto (sem detalhes técnicos de implementação)

**Aprovado por:** Alan em 2026-08-07
