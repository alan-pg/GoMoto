# ADR 0028 — Encargo é grandeza corrente, não dívida nova

- **Status:** Aceita
- **Data:** 2026-09-01
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]], [[Specs/0014-redesenho-financeiro]] (R-06, F-05)

## Contexto

O encargo por atraso é projeção até ser realizado (R-06). Quem realiza é o
recebimento: `realizeAccruedBefore` apura multa e juros, grava um `charge_items`
com `source_module = 'late_charge'` e emite `late_charge_realized`. A partir daí
o encargo é dívida documentada, dentro do total da própria cobrança.

O que ninguém tinha percebido: **a cobrança pode voltar a ficar em aberto depois
disso**, e aí o item de encargo passa a ser a base do cálculo seguinte.

### O defeito

Cobrança #2, 22 dias vencida, recebida e depois estornada:

| | valor | composição |
|---|---|---|
| total da cobrança | R$ 102,73 | principal 100,00 + encargo já realizado 2,73 |
| encargo projetado depois do estorno | R$ 2,80 | multa 2,05 + juros 0,75 |

O encargo de 2,73 era multa 2,00 + juros 0,73 por 22 dias sobre 100,00. Os 2,80
são multa e juros sobre **102,73**. Dois erros no mesmo número:

1. **Multa cobrada de novo.** `allocation.ts` comenta *"Multa: uma única vez"*,
   e é verdade — dentro de uma chamada. A segunda realização traz a segunda
   multa. É a maior parte do erro: R$ 2,05 de R$ 2,80.
2. **Juros sobre juros.** A base do cálculo inclui o encargo anterior.

O certo naquele instante era **R$ 0,00 a acrescentar**: nenhum dia novo tinha
passado desde a realização. No dia seguinte, R$ 0,03.

### O estorno não é a única porta

`realizeAccruedBefore` sempre passa `open_amount` como principal. Qualquer
caminho que deixe um item de encargo dentro de uma cobrança que continua `open`
chega ao mesmo estado — **pagamento parcial de cobrança vencida** é o mais
banal, e não precisa de estorno nenhum. O estorno só tornou o defeito visível.

### Por que não estornar o encargo junto com o pagamento

Foi a primeira ideia e está errada em dois níveis.

No mecanismo: `charge_items` recusa UPDATE e DELETE pelo trigger
`trg_charge_items_immutable`, que executa `fn_reject_financial_mutation()` — o
mesmo guardião do razão. Documento emitido não se apaga (Princípio 3).

No mérito: o encargo foi ganho pelo **atraso**, não pelo pagamento. Estornar o
recebimento não desfaz os 22 dias. `fn_reverse_payment` inverte as pernas da
transação do pagamento e devolve a cobrança para `open`; a transação
`late_charge_realized` é outra e deve mesmo continuar de pé, com a receita
reconhecida por competência.

### Por que não basta tirar o encargo da base

Corrige juros sobre juros e não corrige o resto: `accrued(100, 22 dias)` devolve
2,73 outra vez, que somado ao 2,73 já realizado dá 105,46. Troca-se cobrar o
encargo uma vez e pouco por cobrá-lo duas vezes inteiras.

## Decisão

**O encargo de uma cobrança é uma grandeza corrente sobre o principal, e o que
já foi realizado é uma parcela dela já documentada** — não uma dívida nova, nem
uma base nova.

```
encargo_aberto  = max(0, encargo_realizado − paid_amount)
principal       = open_amount − encargo_aberto
corrente        = calculateAccruedCharges(policy, principal, due_date, hoje)
a_acrescentar   = max(0, corrente.total − encargo_realizado)
amount_due      = open_amount + a_acrescentar
```

A subtração é a peça essencial, e resolve a multa sem flag nenhuma: ela está
dentro de `corrente` e dentro de `encargo_realizado`, e se cancela. `min_amount`
também passa a valer para o encargo inteiro, não por realização.

A imputação do pagamento ao encargo antes do principal segue o art. 354 do
Código Civil, e é o que mantém `principal` em 100,00 quando o cliente paga só o
encargo.

`charge_balances` ganha `late_charge_amount`. O insumo vem da view porque os
três consumidores da fonte única — cockpit, Route Handler do mobile e intent do
gateway — já leem essa linha. Fazer cada um buscar os itens por conta própria
reconstruiria o F-05, que é a razão de `calculateAmountDue` existir.

### Onde a regra é deliberadamente conservadora

Se o cliente pagar parte do **principal** depois de um encargo realizado, a
corrente recalcula sobre o principal menor e fica abaixo do já realizado:
`a_acrescentar` trava em zero e volta a crescer devagar. Subcobra, nunca
sobrecobra. Acertar isso exigiria guardar a data da última apuração — estado
novo, para corrigir centavos num caso raro, na direção que não machuca o
cliente. Não vale o preço.

## Consequências

- Encargo já realizado deixa de virar base de encargo novo, por qualquer porta:
  estorno, pagamento parcial ou segunda realização.
- A multa é uma vez por cobrança, e agora é verdade fora de uma única chamada.
- A tela de detalhe passa a separar o que já é item da cobrança do que ainda é
  projeção, porque agora são grandezas diferentes.
- Cobrança sem encargo realizado não muda em nada: `late_charge_amount` vale
  zero e a conta é a de antes.

## Quando reavaliar

Se aparecer necessidade real de juros exatos sobre principal que muda no meio do
atraso — aí a apuração vira incremental e precisa de data da última apuração.
