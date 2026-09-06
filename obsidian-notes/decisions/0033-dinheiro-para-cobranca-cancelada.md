# ADR 0033 — Dinheiro que chega para uma cobrança cancelada

- **Status:** 🟡 **Proposta — aguardando decisão do humano.** Nada implementado.
- **Data:** 2026-09-06
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0030-multiplos-gateways-de-pagamento|ADR 0030]], [[decisions/0032-integracao-infinitepay-checkout|ADR 0032]], [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]], [[decisions/0029-cancelar-manutencao-desfaz-o-que-ela-criou|ADR 0029]]

## Contexto

Descoberto em 2026-09-06, ao fechar o ciclo da InfinitePay em produção. **Não é defeito da InfinitePay** — vale para os três gateways e é anterior a ela. O checkout hospedado só tornou visível, porque um link de pagamento é uma URL que alguém pode ter salvo no WhatsApp, enquanto um QR Pix tende a ser usado ou descartado na hora.

### O que acontece hoje

`cancelCharge` (`apps/web/src/lib/financial/charges.ts`) faz três coisas:

1. Recusa se já houver pagamento alocado;
2. Marca `charges.status = 'cancelled'`;
3. **Reverte a emissão no razão** — desfaz o débito em `contas_a_receber` e o crédito em receita.

E **não toca em `payment_intents`**. Verificado: nenhuma migration e nenhum caminho de aplicação expira o intent no cancelamento. O intent segue `pending` e — o que importa — **o código de pagamento continua vivo no provedor**. O link abre. O QR escaneia.

Se alguém pagar, `fn_confirm_gateway_payment` (migration `20260904222939_multi_gateway.sql`) **não pergunta o status da cobrança**. Ela lê `charges` só para pegar `customer_id`, `rental_id` e `charge_number`, cria o pagamento, insere a alocação e lança:

```
débito   caixa_e_bancos      ✅ o dinheiro entrou mesmo
crédito  contas_a_receber    ❌ mas a emissão já tinha sido revertida
```

**Consequência:** `contas_a_receber` daquele cliente fica **negativo**. O razão continua batendo em zero — o dinheiro é real, a partida dobrada está correta —, mas a conta de recebíveis passa a afirmar que a locadora deve ao cliente, em vez de afirmar que recebeu um adiantamento.

## Por que cancelar no provedor não resolve sozinho

O Mercado Pago e a Cora oferecem cancelamento. Verificado em 2026-09-06:

| Gateway | Endpoint | Restrição |
|---|---|---|
| Mercado Pago | `PUT /v1/payments/{id}` → `{"status":"cancelled"}` | só em `pending`, `in_process`, `authorized` |
| Cora | `DELETE /v2/invoices/{id}` → `204` | recusa se já pago (`REC-0006`) |
| InfinitePay | **não existe** | a API tem só `/links` e `/payment_check` |

⚠️ A página da Cora fala em "boleto". Na API v2 deles boleto e Pix são a mesma entidade `invoice` — é o mesmo `POST /v2/invoices` de onde lemos o `pix.emv` —, então o `DELETE` **deve** servir para os dois. **Isso é inferência e precisa ser conferido na homologação.** Nesta família de integrações, toda inferência não verificada ao vivo já saiu errada ao menos uma vez (ver ADR 0031 e 0032).

Cancelar no provedor **reduz a probabilidade** de dinheiro chegar para uma cobrança cancelada. Não elimina o caso, por quatro motivos:

1. **A InfinitePay não tem como.** Um terço dos gateways fica descoberto por definição.
2. **A chamada pode falhar** — rede, credencial expirada, provedor instável.
3. **Existe corrida.** O cliente pode estar com o código aberto e pagar no mesmo segundo do cancelamento.
4. **O Mercado Pago só cancela dentro de uma janela de status.** Fora dela, a resposta é erro.

Ou seja: a pergunta "o que o razão faz quando esse dinheiro chega mesmo assim" continua precisando de resposta, independentemente do cancelamento remoto.

## Questão 1 — o conserto local (duas metades)

### Metade mecânica: cancelar expira os intents pendentes

Sem decisão a tomar. É o mesmo movimento que `fn_disconnect_provider_account` já faz ao desconectar uma conta, e que `fn_set_default_provider_account` faz ao trocar o gateway eleito — os dois marcam `payment_intents.status = 'expired'`. Falta o terceiro chamador.

Fecha a porta da nossa tela. Não fecha a do provedor.

### Metade que exige decisão: o que a confirmação faz com esse dinheiro

**Recusar viola a ADR 0024** — dinheiro que entrou tem que ser reconhecido. Então as opções reais são:

| Opção | Lançamento | Consequência |
|---|---|---|
| **A. Crédito do cliente** *(recomendada)* | débito `caixa_e_bancos` / crédito `creditos_de_clientes` | Contabilmente correto: é adiantamento, não quitação. O saldo fica disponível para abater outra cobrança pelo fluxo que já existe. |
| B. Manter recebível | como hoje | `contas_a_receber` negativo, sem significado contábil. |
| C. Recusar e alertar | nenhum | Dinheiro real sem registro. Viola a ADR 0024. |

A **A** é a recomendação, mas muda a política financeira do produto — o dinheiro deixa de quitar aquela cobrança e vira saldo do cliente. **É chamada do humano, não do agente.**

## Questão 2 — nada drena a fila de replay

`gateway_events` com `processed_at IS NULL` é a fila de reprocessamento, e `idx_gateway_events_unprocessed` existe para ela. **Nada a consome automaticamente.**

Isso ficou mais relevante depois da correção da ADR 0032: falha de verificação agora *deve* parar nessa fila em vez de sumir. É a escolha certa — mas hoje ela depende de alguém olhar.

Agravante: o padrão é **responder antes de processar**, então quando o processamento falha o provedor já recebeu `200` e não vai reenviar. A retentativa do provedor não cobre esse caso.

Opções: job agendado (pg_cron / Edge Function), alerta quando a fila passa de N, ou botão de reprocessar no cockpit. Nenhuma decidida.

## Ordem sugerida

1. **Metade mecânica da Questão 1** — barata, sem decisão pendente.
2. **Decisão sobre o destino do dinheiro** — é o buraco contábil real.
3. **Questão 2**, que é o que faz qualquer um dos dois casos ser notado.
4. **`cancelIntent?()` no contrato de provedor** — camada de redução de ruído, depois que o buraco estiver fechado.

Sobre o passo 4: o método entra **opcional** no `PaymentProvider`, com `?`, pela mesma razão que `oauth?` é opcional. A InfinitePay não tem como implementar, e o contrato precisa dizer isso em voz alta em vez de deixar um método obrigatório estourando "não implementado" em runtime. Chamadores: cancelar cobrança, desconectar conta e trocar o gateway eleito.

Invertida a ordem, a parte cara fica pronta e o buraco contábil continua aberto.
