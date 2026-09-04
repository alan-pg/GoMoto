# ADR 0029 — Cancelar manutenção desfaz o que ela criou

- **Status:** Aceita
- **Data:** 2026-09-03
- **Autores:** Alan + agente IA
- **Relacionada:** [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]], [[Specs/0014-redesenho-financeiro]]

## Contexto

Manutenção registrada por engano precisa poder ser desfeita, e com ela a
despesa, a cobrança de repasse e o crédito que ela gerou. Hoje isso não existe
para o caso mais comum, e a tela promete um caminho que não leva a lugar nenhum.

### O que o registro cria

`fn_create_payable` tem dois ramos, e eles produzem coisas diferentes:

**Empresa pagou** — `payables` em `open`; transação `payable_created` (débito
`despesa_manutencao`, crédito `contas_a_pagar`); e, havendo parte do cliente,
uma cobrança de repasse com item em `repasse_manutencao`.

**Cliente pagou** — `payables` nasce **`paid`** (a empresa nunca teve o que
pagar); linha em `customer_credits`; e uma transação `credit_granted` com três
pernas: débito `despesa_manutencao`, crédito `repasse_manutencao` pela parte que
o cliente bancou em definitivo, crédito `creditos_de_clientes` pelo que a empresa
passa a dever a ele. **Não há cobrança.**

### Por que o segundo ramo é intransponível hoje

Três fatos se encaixam:

1. o payable nasce `paid`;
2. `cancelPayable` recusa qualquer payable `paid` — *"o estorno correto depende
   do que a criação lançou, e aqui só sabemos inverter o par
   despesa/contas_a_pagar"*;
3. `checkMaintenanceDeletable` só libera quando o payable está `cancelled`.

Não existe estado alcançável em que a exclusão passe. A recusa diz *"Acerte o
valor em Cobranças (estorno do crédito ou cobrança avulsa) **antes de excluir**"*
— e "antes" nunca chega. Pior: **estorno de crédito não existe** como operação.
Só há `fn_apply_customer_credit` (abater) e `fn_settle_customer_credit`
(devolver em dinheiro); `fn_reverse_payment` desfaz uma *aplicação* de crédito,
nunca a concessão.

O contorno que sobra — cobrança avulsa pela tela — credita `receita_locacao`,
cravado no código sem seletor de conta. Essa conta cai em Receita bruta e tem
`default_in_tax_base = true`: **o estorno viraria receita tributável**. A conta
correta seria `repasse_manutencao` (`expense_recovery`, fora da base), que anula
o custo em vez de inventar receita. Ela existe no plano; a tela não a oferece.

## Decisão

**Cancelar a manutenção desfaz, em uma transação, tudo que o registro criou.**

Quatro decisões dentro dessa:

### 1. O dinheiro é estornado; a manutenção é apagada

`financial_entries` é append-only (Princípio 3): nada de dinheiro se apaga, tudo
se estorna, com `reverses_transaction_id` dizendo o que desfaz o quê. Já
`maintenances` é registro operacional — um lançamento feito por engano não tem
valor histórico, e a tela já oferece "Excluir". Mantém-se o verbo que existe; o
que muda é ele passar a funcionar.

O rastro não se perde: o razão guarda a criação e o estorno, o payable fica
`cancelled` e a auditoria registra a exclusão com o estado anterior.

### 2. A operação inteira mora no banco

`cancelPayable` hoje orquestra em passos soltos no TypeScript: lê o payable,
cancela a cobrança, marca o status, estorna a transação. É exatamente o padrão
que já custou caro três vezes neste projeto — *se o guarda e a escrita não estão
na mesma transação, o guarda não existe*.

E aqui a guarda depende de **saldo derivado**: o crédito ainda estar disponível
sai de `customer_credit_balances`, que soma `financial_entries`. Ler-decidir-
escrever solto deixa dois operadores desfazerem o mesmo crédito. `fn_cancel_payable`
faz tudo sob trava do cliente, como `fn_apply_customer_credit` já faz.

`cancelPayable` (TS) vira casca fina sobre ela.

### 3. Duas recusas, ambas quando o dinheiro de terceiro se moveu

Confirmadas na revisão: pagamento do cliente exige estorno **antes**; crédito já
usado impede a exclusão. Crédito ainda intacto é removido pelo próprio
cancelamento, sem pedir nada ao operador.

**Cobrança de repasse já paga.** O cliente pagou por algo que não aconteceu:
ele tem direito de volta. Estornar esse recebimento dentro de uma exclusão o
esconderia — estorno é fato próprio, com motivo próprio e trilha própria. A
recusa aponta o botão que já existe: estorne o pagamento na cobrança, depois
cancele.

**Crédito já gasto ou devolvido.** Se o saldo não cobre mais o que foi
concedido, o cliente já se beneficiou. A recusa aponta o caminho real: o
abatimento aparece como pagamento na cobrança em que foi usado e pode ser
estornado por lá, o que devolve o saldo e libera o cancelamento.

Nos dois casos a guarda compara com o **saldo derivado**, não com colunas.

### 4. Baixa de despesa é estornada junto

Se a empresa já pagou a oficina, o dinheiro saiu — mas saiu por um registro
errado. Cancelar tem de desfazer também a baixa, estornando `payable_paid`. Não
existe reversão de baixa hoje; ela nasce aqui, e passa a valer para despesa
avulsa também.

Isto é diferente das recusas do item 3: ali o dinheiro é de terceiro e a
devolução é decisão dele; aqui é caixa próprio, e o estorno apenas reconhece
que a saída não devia ter sido lançada.

O critério da revisão é o resultado, não o mecanismo: **valor pago pela empresa
ou pelo cliente é cancelado e não aparece em conta nenhuma.** Como cada
transação é estornada perna a perna, isso vale para todas ao mesmo tempo — custo
e recuperação somem do DRE, o caixa volta, o saldo de crédito do cliente
volta a zero e o payable sai de contas a pagar.

### 5. `customer_credits` ganha `cancelled_at`

A ficha do cliente lista as concessões — *"o que foi concedido, não o que
resta"* — ao lado do saldo real derivado. Sem marcar a linha, um crédito
estornado seguiria aparecendo como concessão viva. O saldo já estaria correto,
porque é derivado; a lista é que mentiria.

## Consequências

- A recusa de exclusão passa a ser rara e verdadeira: só aparece quando alguém
  precisa decidir sobre dinheiro de terceiro, e diz qual botão apertar.
- `cancelPayable` deixa de ser orquestração solta — ganha atomicidade que hoje
  não tem, inclusive para despesa avulsa.
- Estorno de baixa de despesa passa a existir como operação de primeira classe.
- O contorno da cobrança avulsa em `receita_locacao` deixa de ser necessário, e
  com ele o risco de estorno virar receita tributável.

## Alternativas descartadas

**Cobrança avulsa como acerto.** Não desfaz: soma um segundo fato que anula o
primeiro no resultado, mas infla Receita bruta e base tributável, e deixa a
manutenção errada de pé para sempre.

**Apagar as linhas financeiras.** Viola o Princípio 3 e destrói a única prova de
que o engano existiu.

**Marcar a manutenção como cancelada em vez de apagar.** Exigiria coluna de
status nova e uma decisão de UI sobre onde ela aparece, para preservar um
registro que o operador declarou inexistente. Reavaliar se surgir necessidade de
auditar tentativas de lançamento.

## Em aberto

Se o seletor de conta deve aparecer na cobrança avulsa. Deixa de ser urgente com
esta decisão, mas `receita_locacao` cravada continua errada para qualquer
cobrança que não seja locação.
