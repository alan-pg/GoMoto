# ADR 0031 — Integração Cora, modalidade Parceria

- **Status:** Aceita
- **Data:** 2026-09-04
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0030-multiplos-gateways-de-pagamento|ADR 0030]], [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]]

## Contexto

A ADR 0030 deixou a fundação multi-gateway pronta e nomeou a Cora como o próximo provedor. A documentação (`developers.cora.com.br`) contradiz a suposição registrada lá: a Cora tem **duas modalidades**, e a nossa é OAuth puro.

| | Integração Direta | **Parceria Cora** ← nossa |
|---|---|---|
| Base | `matls-clients.api.cora.com.br` | `api.cora.com.br` |
| Auth | mTLS + `client_credentials` | **OAuth2 authorization_code** |
| Para quê | gerenciar a própria conta | ERPs cujos clientes autorizam o app |

O fluxo encaixa no contrato `PaymentProvider.oauth` sem peça nova. Quatro diferenças em relação ao Mercado Pago, porém, não são cosméticas:

| | Mercado Pago | Cora |
|---|---|---|
| `access_token` | ~180 dias | **24 horas** |
| `refresh_token` | existe, sem uso | **obrigatório e rotativo** — novo a cada renovação, o anterior vale 3 usos; sessão morre com 60 dias de inatividade |
| Valores | decimal (`350.00`) | **centavos inteiros** (`35000`) |
| Pix | `qr_code` + `qr_code_base64` | **só `pix.emv`** |
| Webhook | corpo JSON assinado (HMAC `x-signature`) | **sem corpo e sem assinatura** — só os headers `webhook-event-id`, `webhook-event-type`, `webhook-resource-id` |

## Decisões

### 1. A notificação da Cora não é fonte de verdade — é um aviso

A Cora não assina o webhook e não oferece campo de segredo no cadastro do endpoint (`POST /endpoints/` aceita apenas `url`, `resource`, `trigger`). Quem descobrir a URL consegue emitir `invoice.paid`.

Três camadas, todas necessárias — nenhuma delas suficiente sozinha:

1. **Segredo no path da URL.** `.../cora-webhook/<CORA_WEBHOOK_SECRET>`. É o único lugar onde cabe um segredo, já que não há header de autenticação. Comparado em tempo constante.
2. **Reconsultar a invoice na API da Cora** com o token daquele tenant, e acreditar no que a API responde — nunca no que a requisição afirmou. Vale o mesmo que o MP faz, mas ali era prudência e aqui é a defesa principal.
3. **Resolver o tenant pelo NOSSO registro.** `webhook-resource-id` é procurado em `payment_intents.provider_intent_id`; a conta e o tenant saem de lá. Nada que veio de fora escolhe de quem é o dinheiro.

`gateway_events.signature_valid` fica **`false` permanentemente** para a Cora. É honesto e é o ponto: a coluna diz o que aconteceu, e um provedor que não assina não pode produzir um registro que afirme verificação.

### 2. Renovação de credencial com posse declarada no banco

24 horas de validade tornam o refresh obrigatório — sem ele, toda cobrança a partir do segundo dia falha. E o refresh token da Cora é **rotativo**: renovar devolve um novo, o anterior sobrevive a no máximo 3 usos.

Duas requisições concorrentes que encontrem o token vencido renovariam as duas, queimando a janela de rotação. Por isso a renovação é **reivindicada** antes de acontecer: `fn_claim_credential_refresh` marca a posse sob `FOR UPDATE`, com lease de tempo. Quem perde a corrida segue com a credencial atual — que ainda vale, porque a renovação dispara com **margem** (10 minutos antes de vencer), não no vencimento.

O lease existe porque a chamada HTTP pode morrer no meio: posse sem prazo de validade é integração travada até alguém mexer no banco.

Isso corrige o G-08 da ADR 0030 também para o Mercado Pago, onde o `refresh` existia sem chamador.

### 3. Centavos moram dentro do adaptador

O sistema inteiro fala em reais decimais. A Cora fala em centavos inteiros. A conversão acontece **só** em `providers/cora/api.ts`, nas duas direções. Nenhum valor em centavos atravessa a fronteira do adaptador — errar isso é cobrar cem vezes o devido, e o defeito seria invisível em teste com valor redondo.

### 4. O EMV é o campo canônico do Pix

A Cora devolve apenas `pix.emv` (o código copia-e-cola). O app renderizava `qr_code_base64` como imagem, campo que só o Mercado Pago tem.

O app passa a **gerar o QR a partir do EMV**. O Mercado Pago também devolve o EMV (em `qr_code`), então os dois convergem num campo só, `payload.emv`, e a tela do cliente deixa de conhecer o formato de um provedor específico. `qr_code_base64` continua sendo gravado quando o provedor o oferece, mas nada depende dele.

## Consequências

**Aceitamos**

- A URL do webhook da Cora é um segredo. Vazá-la (log, print, ticket de suporte) exige rotação — trocar `CORA_WEBHOOK_SECRET` e recadastrar o endpoint na Cora.
- Renovação é preguiçosa (na hora de cobrar), não agendada. Uma conta parada 60 dias perde a sessão e exige reconexão — comportamento da Cora, não nosso. A tela mostra a conta como conectada até a primeira falha; melhorar isso é trabalho separado.
- Só `pix` no catálogo da Cora por ora. `boleto` é suportado pela API e exige `payment_method_type` novo no banco mais tela — entra quando for pedido.

**Escopo pedido**

Apenas `invoice`. A Cora oferece `account`, `payment` e `transfer`; pedir acesso a extrato, saldo ou iniciação de pagamento da conta do cliente sem precisar seria coletar poder que não usamos.

## A verificar em homologação

**O `state` do OAuth.** A documentação da Cora não menciona `state` no `/oauth/authorize`, e o exemplo de callback mostra `session_state` e `code` sem ele. Toda a nossa defesa de CSRF depende de o `state` voltar — é ele que carrega tenant e provedor.

O emissor do token é `auth.stage.cora.com.br/realms/cora`, ou seja **Keycloak**, que devolve `state` por especificação. Mas "por especificação" não vale como garantia para o parâmetro que impede sequestro de conexão: é o primeiro teste da homologação. Se não voltar, o plano B é um nonce no path do `redirect_uri`.
