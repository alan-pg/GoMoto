# ADR 0027 — Como o app do cliente lê saldo derivado do razão

- **Status:** Proposta — aguardando revisão
- **Data:** 2026-08-31
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]], [[decisions/0016-escrita-cliente-mobile-route-handler|ADR 0016]], [[Specs/0014-redesenho-financeiro]]

## Contexto

O app do cliente exibe valores que **não existem como coluna**: todo saldo é
derivado do razão por view (ADR 0024, Princípio 2). Essas views são
`security_invoker` — leem com a RLS de quem consulta. Isso é o que impede um
tenant de ver o outro, e é a razão pela qual a suíte de isolamento exige
`security_invoker` em toda view do schema.

O efeito colateral: **se uma tabela que a view agrega não for legível pelo
cliente, a view não erra — ela responde um número menor, plausível e falso.**

### O defeito que expôs isso (2026-08-31)

Cobrança de R$ 102,69 com R$ 100,00 abatidos por crédito:

| | cockpit (operador) | app (cliente) |
|---|---|---|
| a pagar | R$ 2,76 | **R$ 105,45** |

`charge_balances` deriva `paid_amount` somando `payment_allocations`, tabela que
tinha apenas a policy de tenant — nenhuma `customer_read_own_*`, ao contrário de
`charges`, `charge_items` e `payments`. Para a sessão do cliente o LATERAL
voltava vazio, `allocated` virava 0, e a view respondia
`open_amount = total_amount`.

O erro então se multiplicou: `calculateAmountDue` recebeu o principal errado e
calculou o encargo **sobre ele** — R$ 2,76 de encargo sobre R$ 102,69, contra
R$ 0,07 sobre R$ 2,69. A conta estava certa; o insumo, não.

Corrigido pela migration `20260901000332`, que dá ao cliente a leitura das
alocações das próprias cobranças.

### Por que nenhum portão pegou

- `typecheck` e `lint` não enxergam RLS.
- Os testes financeiros leem com **service role**, que bypassa exatamente a
  camada onde o defeito mora — passavam com ou sem a policy.
- `tenant-isolation-financeiro` prova que um tenant **não** vê o outro. Ninguém
  provava que o cliente vê o **próprio** dado corretamente.
- A rota que gera o Pix também usa service role e calculava certo, então o valor
  cobrado nunca ficou errado. A divergência era só de exibição — o que a torna
  mais difícil de notar, não menos grave: a tela anunciava R$ 105,45 e o QR
  sairia com R$ 2,76.

O aviso estava escrito e foi lido como detalhe de implementação: o comentário
da rota do QR já dizia ter ido para service role porque *"a RLS bloqueia as
leituras necessárias"*.

### O que ainda não bate

Varredura das 14 tabelas financeiras: `payment_allocations` era a única sem
policy de cliente. Mas a classe não é "tabela sem policy" — é **view que agrega
tabela que o cliente não pode ler**. Com saldo real montado, comparando a mesma
consulta como admin e como cliente:

| view | admin | cliente | app lê hoje? |
|---|---|---|---|
| `charge_balances` | R$ 1.231,26 | R$ 1.231,26 ✅ | sim |
| `customer_credit_balances` | R$ 250,00 | **R$ 0** | não |
| `deposit_balances` | R$ 400,00 | **R$ 0** | não |
| `customer_financial_position` | 1 linha | **0 linhas** | não |

As três derivam de `financial_entries`, que tem apenas policy de tenant. **Hoje
é inofensivo porque o app não as lê** — no dia em que a tela mostrar "seu
crédito disponível" ou "sua caução", mostra zero com cara de número certo.

### Onde o risco NÃO está

Rastreados todos os caminhos de escrita de dinheiro:

| caminho | credencial |
|---|---|
| Emissão (cron e disparo manual) | service role |
| Intent de pagamento (Pix) | service role |
| Webhook do gateway | service role |
| Recebimento, abatimento, retenção, encerramento | Server Action, sessão do **operador** (enxerga o tenant) |

E o app do cliente **não escreve nada financeiro**: suas únicas escritas são
upload de foto de vistoria e o próprio usuário; vistoria e manutenção passam por
Route Handler ([[decisions/0016-escrita-cliente-mobile-route-handler|ADR 0016]]).

**O valor gravado nunca dependeu da visão do cliente.** Este ADR trata de
exibição, não de integridade de escrita.

## Decisão

**Tomada: o portão.** `leitura-do-cliente.spec.ts` passa a ler **sempre com o
token do cliente**, nunca com service role, e exige que toda view consumida pelo
app devolva o mesmo que o admin. Um segundo teste congela o inventário das views
que ainda divergem: se alguma entrar ou sair da lista, ele falha pedindo que
esta decisão seja reaberta.

Verificado nos dois sentidos: removendo a policy de `payment_allocations` o
primeiro teste falha; concedendo policy de cliente em `financial_entries` o
inventário falha.

**Em aberto: como o cliente passa a ler crédito e caução**, quando o app
precisar. Duas saídas, e a escolha tem lado de segurança:

**(a) Policy de cliente em `financial_entries`.** Simples e uniforme com o resto.
Custo: expõe ao cliente conta contábil, valor de custo e a estrutura do plano —
o razão inteiro das linhas dele, incluindo `despesa_manutencao` que originou um
crédito. É mais do que ele precisa ver para saber quanto tem.

**(b) View dedicada com `security_definer` e filtro explícito por cliente.**
Expõe só o saldo. Custo: abre exceção ao invariante "toda view declara
`security_invoker`", que a suíte de isolamento hoje exige de todas — o teste
precisaria de uma lista de exceções, e cada exceção passa a depender do filtro
interno estar certo, não da RLS.

Recomendação: **(b)**, com o filtro por `current_customer_ids()` dentro da view e
um teste dedicado por view isenta. O que se ganha é o princípio de menor
exposição; o que se paga é a exceção documentada, que é menos perigosa que
publicar o razão.

## Consequências

- Todo saldo novo que o app for exibir passa antes pelo portão, que compara com
  a leitura do operador. O modo de falha "número plausível e falso" deixa de
  depender de alguém reparar na tela.
- A suíte financeira continua podendo usar service role para montar cenário —
  mas **asserção sobre o que o cliente vê** só vale lida com token.
- Enquanto (a) ou (b) não for decidido, o app não deve exibir crédito nem
  caução: hoje mostraria zero.

## Quando reavaliar

Quando o app do cliente precisar exibir crédito, caução ou qualquer valor
derivado de `financial_entries` — o que fecha a questão em aberto acima.
