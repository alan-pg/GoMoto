# 💳 Tela: Cobranças — [[GoMoto]]

Rota: `/cobrancas` | Tipo: Client Component

> [!warning] Nota parcialmente defasada
> As seções de **tabela**, **abas de filtro** e **KPIs** ainda descrevem o mundo
> pré-[[ADR 0024]]: `status='paid'`, `payment_date`, `observations`, status
> `loss`, ações "Editar" e "Excluir". Nada disso existe — documento emitido é
> imutável (Princípio 5) e saldo nunca é coluna (Princípio 2). Só a seção
> **Ações Especiais → Registrar pagamento** está em dia com o código.

## Layout

- 6 KPI cards financeiros
- Abas de filtro (5 status)
- Busca textual
- Tabela com 7 colunas + ações especiais

## Abas de Filtro

`Todas` / `Pendentes` / `Vencidas` / `Pagas` / `Prejuízo` — cada uma com contador.

## Busca Textual

Em `customers.name` e `description` (case-insensitive).

## Colunas da Tabela

| Coluna | Conteúdo |
|---|---|
| Cliente | Nome + ícone WhatsApp (`wa.me/55{phone}`) |
| Descrição | Texto da cobrança |
| Valor | `formatCurrency(amount)` |
| Vencimento | `formatDate(due_date)` |
| Status | `<StatusBadge />` |
| Dt. Pagamento | `formatDate(payment_date)` ou "—" |
| Ações | Editar, Marcar Pago, Prejuízo, Excluir |

## Ações Especiais

**Registrar pagamento** (aparece se a cobrança está aberta ou vencida):

Uma implementação só — `components/financial/RegistrarPagamentoModal.tsx` —
usada tanto pela lista quanto pela tela de detalhe. Eram dois modais separados
que divergiram: um recusava valor acima do saldo, o outro deixava passar, e a
conta do devido estava duplicada (a cópia do detalhe perdeu o `round2` e exibia
250,00000000000003 onde a lista dava 250,00). Quem for mexer, mexe nos dois de
uma vez porque só existe um.

O modal mostra:

| Bloco | Conteúdo |
|---|---|
| Cabeçalho | Nº da cobrança, cliente, **vencimento** e dias de atraso |
| Data do recebimento | Default hoje; futura é recusada. Muda a data → refaz o encargo |
| Valor recebido | Trava no devido: acima disso volta ao máximo e explica dentro do modal |
| Detalhamento | Principal / Multa / Juros · N dias / Total a receber |
| Forma de pagamento | PIX / Dinheiro / Cartão / Transferência / Outro |

O encargo é **projetado** até o recebimento e realizado com a data escolhida
(R-06 / ADR 0024) — não existe "consolidar encargo" à parte. Excedente não vira
pagamento: para receber a mais, registre o devido e conceda o resto como crédito
na ficha do cliente.

**Cobrar pelo gateway** (só na tela de detalhe, cobrança aberta ou vencida):

O rótulo do botão vem do **gateway eleito**, resolvido no servidor e passado
como `gatewayMethod` — não é fixo. O que ele gera depende do provedor:

| Gateway eleito | Botão | Modal |
|---|---|---|
| Mercado Pago, Cora | *Gerar Pix* | QR + copia-e-cola |
| InfinitePay | *Gerar link de pagamento* | URL copiável + abrir checkout |

A InfinitePay não devolve código Pix: devolve uma **URL de checkout hospedado**,
e quem escolhe Pix ou cartão é o cliente, na página deles
([[decisions/0032-integracao-infinitepay-checkout|ADR 0032]]). Por isso o
payload grava `checkout_url` e não `emv` — gravar como `emv` faria a tela
mostrar uma URL como copia-e-cola e o cliente tentaria colá-la no app do banco.

O modal **acompanha a confirmação** (`usePaymentIntentStatus`, 5s): o pagamento
chega por webhook, fora do navegador. Ao confirmar, `router.refresh()` reexecuta
o Server Component e os botões de ação somem junto com o status.

Nenhum chamador nomeia meio de pagamento. `getOrCreateIntent` resolve a conta
eleita primeiro e usa `descriptor.methods[0]` — antes era `'pix'` fixo, o que
quebraria a cobrança assim que um gateway de checkout fosse eleito.

**Contabilizar como Prejuízo** (aparece se `pending` ou `overdue`):
- Modal de confirmação com aviso em vermelho
- Salva: `status='loss'`

## Formulário de Criação/Edição

| Campo | Tipo | Required |
|---|---|---|
| Cliente | select (clientes ativos) | ✓ |
| Contrato | select (contratos do cliente selecionado) | — |
| Descrição | text | ✓ (Ex: "Semanal — 10/03 a 16/03") |
| Valor (R$) | number (step=0.01) | ✓ |
| Vencimento | date | ✓ |
| Observações | textarea (2 linhas) | — |

Status inicia sempre como `pending` na criação.

## 6 KPI Cards (useMemo)

| Card | Cálculo |
|---|---|
| **Total Recebido** | SUM(amount) WHERE paid + ticket médio |
| **A Receber** | SUM(amount) WHERE pending + valor vencendo em 30d |
| **Vencidas** | SUM(amount) WHERE overdue + cobrança mais antiga (cliente + dias) |
| **Inadimplência** | `(overdue+loss) / total × 100` + pontualidade (paid on time %) |
| **Valores Não Pagos** | pending + overdue + tempo médio de recebimento |
| **Prejuízos** | SUM(amount) WHERE loss + maior prejuízo por cliente |

## Queries Supabase

```sql
-- Fetch principal
SELECT *, customers(name, phone), contracts(id)
FROM billings ORDER BY due_date DESC

-- Selects do formulário
SELECT id, name FROM customers WHERE active = true ORDER BY name
SELECT id, customer_id, customers(name) FROM contracts WHERE status = 'active'

-- Criar
INSERT INTO billings (customer_id, contract_id, description, amount, due_date, status, observations)

-- Editar
UPDATE billings SET (...) WHERE id = ?

-- Marcar pago
UPDATE billings SET status='paid', payment_date=?, observations=? WHERE id = ?

-- Prejuízo
UPDATE billings SET status='loss' WHERE id = ?

-- Deletar
DELETE FROM billings WHERE id = ?
```

## Lógica de Negócio

- Cálculo de atraso: `Math.floor((today - new Date(due_date)) / 86400000)` dias
- Observações de método são **cumulativas** (concatena com `\n` ao marcar pago)
- `filtered` e `metrics` em useMemo para performance

## Tags
`#projeto/tela` `#gomoto/cobrancas`
