---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-06-25
adr:
  - "[[decisions/000X-estrategia-webhook-gateway]]"
  - "[[decisions/000X-abstracao-gateway-pagamento]]"
related:
  - "[[Telas/Configurações]]"
  - "[[Telas/Cobranças]]"
  - "[[PRDs/0004-locacao-e-cobrancas]]"
tags:
  - prd
  - integracao-mercado-pago
  - pagamentos
  - mobile
---

# PRD 0005 — Integração Mercado Pago

> 🟢 **Status: aprovado** em 2026-06-25. Integração de pagamento via Pix com Mercado Pago: tenant conecta conta via OAuth, sistema gera Pix de cobranças, cliente paga pelo app e baixa é automática. Próximo passo: `/spec-generator obsidian-notes/PRDs/0005-integracao-mercado-pago.md`.

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto gerencia cobranças de locação de motos (mensais, semanais, avulsas). Hoje, o recebimento de pagamento é totalmente manual: o operador entra em contato com o cliente por WhatsApp ou ligação, combina o valor, recebe em espécie ou Pix avulso, e registra a baixa manualmente no sistema.

Esse modelo cria dois gargalos críticos: o operador precisa agir ativamente em cada cobrança, o que se torna insustentável à medida que a frota cresce; e o cliente não tem autonomia para saber o que deve e como pagar sem depender do operador.

### 1.2 Resumo executivo

- Cada tenant conecta sua própria conta Mercado Pago ao GoMoto via fluxo OAuth.
- Após a conexão, o sistema passa a gerar cobranças Pix vinculadas à conta do tenant.
- O cliente acessa o app, gera o QR Code Pix sob demanda e efetua o pagamento.
- A baixa da cobrança ocorre automaticamente após confirmação do gateway — sem ação do operador.
- O operador também pode gerar o Pix de uma cobrança pelo web para enviar ao cliente via WhatsApp.
- O Mercado Pago foi escolhido pela facilidade de implementação e alta taxa de adoção. A arquitetura deve permitir substituição futura de gateway sem impacto nas regras de domínio.

### 1.3 Problema

> "O cliente paga as cobranças diretamente pelo app, sem que o operador precise cobrar manualmente via WhatsApp ou ligação."

O modelo atual cria dois gargalos críticos:

1. **Operacional:** cada cobrança exige ação ativa do operador (mensagem, ligação, confirmação). Em frotas maiores, o volume de cobranças torna o processo insustentável.
2. **Experiência do cliente:** o cliente depende do operador para saber o que deve e como pagar. Não há autonomia — e atrasos na cobrança levam a atrasos no pagamento.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Conta de pagamento conectada** | Credencial de uma conta Mercado Pago vinculada a um tenant. Cada tenant possui no máximo uma conta conectada por vez. Sem ela, o sistema não pode gerar cobranças via gateway. |
| **Gateway de pagamento** | Serviço externo responsável por processar pagamentos. Em V1, o Mercado Pago. A camada de produto trata o gateway como abstração — independente do fornecedor. |
| **Pix de cobrança** | Código Pix (QR Code + copia-e-cola) gerado pelo sistema, vinculado a uma cobrança específica do cliente, com valor e vencimento definidos. Distinto de um Pix avulso criado fora do sistema. |
| **Confirmação automática de pagamento** | Registro da baixa de uma cobrança disparado pelo gateway ao sistema, sem ação manual do operador. O operador é notificado, mas não precisa intervir. |
| **Tenant desconectado** | Tenant que ainda não vinculou uma conta de pagamento. Nesse estado, o sistema não oferece geração de Pix de cobrança — o fluxo manual permanece como único caminho. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

1. Eliminar a cobrança manual (WhatsApp, ligação) como etapa obrigatória do recebimento.
2. Dar ao cliente autonomia para pagar cobranças a qualquer hora, diretamente pelo app.
3. Dar ao operador uma alternativa digital para compartilhar o Pix de cobrança sem sair do sistema.

### 3.2 Objetivos do usuário

- **Operador:** conectar a conta Mercado Pago do tenant pelo próprio sistema, sem configuração manual externa.
- **Operador:** gerar o Pix de uma cobrança no web e copiar o código para enviar ao cliente via WhatsApp ou outro canal.
- **Cliente:** abrir o app, visualizar cobranças pendentes, gerar o QR Code Pix sob demanda e efetuar o pagamento.
- **Sistema:** registrar a baixa da cobrança automaticamente após confirmação de pagamento recebida do gateway.

### 3.3 Métricas de sucesso / KPIs

| Critério | Como medir |
|---|---|
| Tenant conecta conta Mercado Pago com sucesso | Fluxo de conexão OAuth concluído sem erro no web |
| Cliente gera Pix, paga e cobrança é baixada automaticamente | Cobrança passa de "pendente" para "pago" após confirmação do gateway, sem ação manual do operador |
| Cobrança paga não pode ser paga novamente | Sistema recusa geração de Pix para cobrança já confirmada como paga |

### 3.4 Incluído em V1

1. Tela de integração de pagamento (nova, no web) — conectar/desconectar conta Mercado Pago por tenant.
2. Geração de Pix de cobrança pelo cliente no app móvel (sob demanda).
3. Geração de Pix de cobrança pelo operador no web (para envio manual ao cliente).
4. Confirmação automática de pagamento — cobrança marcada como paga após retorno positivo do Mercado Pago.
5. Proteção contra duplo pagamento: uma cobrança com Pix ativo reutiliza o código existente em vez de gerar um novo; uma cobrança já paga não permite nova geração de Pix.
6. Apenas Pix como forma de pagamento em V1.
7. Apenas uma conta Mercado Pago por tenant.

### 3.5 Não Incluído / Não-objetivos (V1)

| Item | Motivo |
|---|---|
| Pagamento via cartão de crédito/débito ou boleto | Fora de visão — pode entrar em V2 |
| Parcelamento | Fora de visão — pode entrar em V2 |
| Estorno/reembolso via gateway | Adiado — complexidade operacional e contábil |
| Notificação push ao cliente quando Pix é gerado | Adiado — depende de infraestrutura de push notifications ainda não existente |
| Relatório de repasse Mercado Pago | Adiado — escopo financeiro/contábil separado |
| Múltiplas contas Mercado Pago por tenant | Fora de visão — sem caso de uso identificado |
| Cancelamento manual de Pix ativo | Adiado para vNext — sem caso de uso claro em V1 |
| Notificação ao cliente após pagamento confirmado | Adiado para vNext — email transacional e push fora de V1 |

### 3.6 Telas impactadas

| Tela | Status | O que muda |
|---|---|---|
| Configurações (web) | Existente — nova seção | Nova seção "Integração de Pagamento" para conectar/desconectar conta MP |
| Cobranças (web) | Existente — muda | Ação "Gerar Pix" por cobrança; indicador de status do Pix (ativo/pago/expirado) |
| Cobranças (mobile) | Existente — muda | Botão "Gerar Pix" ou "Ver Pix ativo" por cobrança pendente; QR Code e copia-e-cola |

---

## 4. Stakeholders

Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Como interage | Frequência | Nível técnico |
|---|---|---|---|
| **Operador** | Dono ou funcionário da locadora; gerencia o tenant no web | Setup único (conexão MP) + eventual (Pix avulso) | Médio |
| **Cliente Final** | Locatário da moto; paga cobranças pelo app | Mensal (ciclo da locação) | Básico |

### 5.2 User Stories

**Operador**

- **US-001** — Como **Operador**, quero conectar a conta Mercado Pago do meu tenant nas configurações do sistema, para que o sistema passe a processar cobranças via gateway sem configuração externa.
- **US-002** — Como **Operador**, quero desconectar a conta Mercado Pago quando necessário, para poder trocar de conta ou revogar o acesso ao gateway.
- **US-003** — Como **Operador**, quero gerar o Pix de uma cobrança diretamente no web, para poder copiar o código e enviar ao cliente via WhatsApp ou outro canal sem sair do sistema.
- **US-004** — Como **Operador**, quero visualizar o status do Pix de cada cobrança (ativo, pago, expirado), para saber quais cobranças estão aguardando pagamento e quais já foram quitadas automaticamente.

**Cliente Final**

- **US-005** — Como **Cliente**, quero gerar o QR Code Pix de uma cobrança pendente diretamente no app, para pagar sem precisar contatar o operador.
- **US-006** — Como **Cliente**, quero copiar o código Pix (copia-e-cola) da cobrança no app, para conseguir pagar pelo banco que preferir.
- **US-007** — Como **Cliente**, quero ver minha cobrança marcada como paga após efetuar o pagamento, para ter confirmação de que o valor foi recebido.

**Fluxo multi-persona (sequencial)**

Operador conecta conta MP (US-001) → Sistema fica apto a processar cobranças → Cliente gera Pix no app (US-005/006) → Pagamento confirmado pelo gateway → Cobrança baixada automaticamente (US-007) → Operador vê status atualizado (US-004).

---

## 6. Fluxos Funcionais

### 6.1 Fluxo Principal A — Conexão da conta Mercado Pago (Operador, web)

```
1. Operador acessa Configurações → aba "Integração de Pagamento"
2. Clica em "Conectar Mercado Pago"
3. Sistema redireciona o navegador para o site do Mercado Pago (OAuth)
4. Operador faz login na conta MP da locadora e autoriza o acesso ao sistema
5. Mercado Pago redireciona de volta ao GoMoto com código de autorização
6. Sistema armazena as credenciais de acesso vinculadas ao tenant
7. Tela exibe: "Conta Mercado Pago conectada com sucesso" + nome/e-mail da conta conectada
```

### 6.2 Fluxo Principal B — Geração de Pix e pagamento (Cliente, app)

```
1. Cliente acessa app → tela de Cobranças
2. Seleciona cobrança pendente
3. Toca em "Gerar Pix"
4. Sistema verifica existência de Pix ativo para a cobrança:
   └─ Pix ativo (gerado há menos de 24h) → retorna o mesmo código (sem nova geração)
   └─ Pix inexistente ou expirado → solicita novo Pix ao gateway e retorna código
5. App exibe QR Code + código copia-e-cola + valor + horário de vencimento do Pix (24h)
6. Cliente abre o app bancário, escaneia ou cola o código e confirma o pagamento
7. Gateway confirma pagamento ao sistema (via notificação assíncrona)
8. Sistema marca a cobrança como paga automaticamente
9. Cliente vê status "Pago" ao retornar para a tela de Cobranças ou detalhe da cobrança
   — ambas fazem refresh ao receber foco
```

### 6.3 Fluxo Principal C — Geração de Pix pelo Operador (web)

```
1. Operador acessa tela de Cobranças (web)
2. Localiza cobrança pendente do cliente
3. Clica em "Gerar Pix"
4. Sistema verifica existência de Pix ativo (gerado há menos de 24h):
   └─ Pix ativo → retorna o mesmo código
   └─ Pix inexistente ou expirado → gera novo junto ao gateway
5. Sistema exibe código copia-e-cola + QR Code em modal
6. Operador copia o código e envia ao cliente via WhatsApp ou outro canal
```

### 6.4 Fluxos Alternativos

| Situação | Comportamento |
|---|---|
| Tenant sem conta MP conectada | Botão "Gerar Pix" aparece desabilitado com orientação: "Configure a integração de pagamento nas Configurações" |
| Cobrança já paga | Botão "Gerar Pix" não é exibido; status indica "Pago" |
| Pix expirado (≥ 24h) e usuário solicita novo | Sistema gera novo Pix automaticamente — sem confirmação extra do usuário |
| Operador e cliente solicitam Pix da mesma cobrança | Ambos recebem o mesmo código ativo; nunca são gerados dois Pix simultâneos para a mesma cobrança |

### 6.5 Fluxos de Erro

| Situação | Comportamento esperado |
|---|---|
| Operador cancela o OAuth no site do MP | Sistema retorna para a tela de configurações com mensagem: "Conexão cancelada. Nenhuma conta foi vinculada." |
| Falha de comunicação com o gateway ao gerar Pix | Exibe mensagem de erro clara; cobrança permanece no estado anterior; usuário pode tentar novamente |
| Gateway não confirma pagamento (notificação atrasada ou perdida) | Cobrança permanece "pendente" até a confirmação chegar; atualiza no próximo refresh da tela |
| Tentativa de gerar Pix para cobrança já paga | Sistema rejeita e exibe: "Esta cobrança já foi paga." |
| Tenant desconecta a conta MP enquanto há Pix ativos | Pix já gerados permanecem válidos até o vencimento (24h); novos Pix ficam bloqueados |

---

## 7. Requisitos Funcionais

### RF — Integração de Pagamento (Configurações, web)

- **RF-001** — O sistema exibe uma seção "Integração de Pagamento" nas Configurações do tenant, indicando se há conta Mercado Pago conectada ou não.
- **RF-002** — O operador pode iniciar a conexão da conta Mercado Pago via fluxo OAuth a partir da tela de Configurações.
- **RF-003** — Após autorização OAuth bem-sucedida, o sistema armazena as credenciais de acesso vinculadas exclusivamente ao tenant do operador.
- **RF-004** — A tela de Configurações exibe o nome ou e-mail da conta Mercado Pago conectada enquanto a integração estiver ativa.
- **RF-005** — O operador pode desconectar a conta Mercado Pago a qualquer momento. Após a desconexão, o sistema não processa novos Pix para o tenant.

### RF — Geração de Pix (web e mobile)

- **RF-006** — O sistema exibe a opção "Gerar Pix" para cobranças com status pendente, desde que o tenant tenha conta Mercado Pago conectada.
- **RF-007** — Quando há Pix ativo (gerado há menos de 24 horas) para uma cobrança, o sistema retorna o código existente sem gerar um novo.
- **RF-008** — Quando não há Pix ativo para uma cobrança (inexistente ou expirado), o sistema solicita a geração de novo Pix ao gateway.
- **RF-009** — O sistema exibe o QR Code e o código copia-e-cola do Pix, juntamente com o valor e o horário de vencimento (24 horas após a geração).
- **RF-010** — No web: quando o tenant não possui conta Mercado Pago conectada, a opção "Gerar Pix" é exibida como desabilitada com mensagem orientando o operador a configurar a integração nas Configurações.
- **RF-011** — No app mobile: quando o tenant não possui conta Mercado Pago conectada, a opção de pagamento não é exibida ao cliente — a tela de cobranças mostra apenas os dados da cobrança, sem nenhum controle de geração de Pix.
- **RF-012** — O sistema não exibe a opção de geração de Pix para cobranças com status pago.

### RF — Confirmação automática de pagamento

- **RF-013** — O sistema recebe e processa notificações de confirmação de pagamento enviadas pelo Mercado Pago.
- **RF-014** — Ao receber confirmação positiva de pagamento do gateway, o sistema marca a cobrança correspondente como paga sem ação manual do operador.
- **RF-015** — O sistema rejeita qualquer tentativa de gerar Pix para cobrança já marcada como paga, exibindo mensagem informativa ao usuário.

### RF — Atualização de status no app (mobile)

- **RF-016** — A tela de Cobranças no app atualiza os dados ao receber foco (ao ser acessada ou ao retornar para ela).
- **RF-017** — A tela de detalhe de uma cobrança no app atualiza os dados ao receber foco.

### RF — Visibilidade de status no web

- **RF-018** — A tela de Cobranças no web exibe, para cada cobrança, o status do Pix associado: sem Pix, Pix ativo, Pix expirado ou pago via gateway.

---

## 8. Requisitos Não Funcionais

### RNF — Performance

- **RNF-001** — A geração de Pix (incluindo a chamada ao gateway) deve completar em até 5 segundos em condições normais de rede, com indicador visual de carregamento enquanto aguarda.
- **RNF-002** — O processamento da notificação de confirmação de pagamento pelo sistema deve completar em até 10 segundos após o recebimento, de forma que o status da cobrança esteja atualizado na próxima abertura da tela pelo usuário.

### RNF — Segurança

- **RNF-003** — As credenciais de acesso da conta Mercado Pago nunca são expostas ao cliente (app ou browser) — apenas o sistema as utiliza em chamadas servidor-a-servidor.
- **RNF-004** — A tela de Configurações de Integração de Pagamento é acessível apenas para usuários autenticados com papel de operador do tenant.
- **RNF-005** — O sistema valida a autenticidade das notificações recebidas do gateway antes de processar qualquer atualização de status de cobrança.

### RNF — Isolamento entre tenants

- **RNF-006** — As credenciais Mercado Pago de um tenant nunca são utilizadas para processar cobranças de outro tenant. O sistema garante isolamento completo por tenant.

### RNF — Privacidade (LGPD)

- **RNF-007** — Credenciais de acesso ao Mercado Pago não são registradas em logs de auditoria ou de aplicação em texto claro.

### RNF — Resiliência

- **RNF-008** — A indisponibilidade do Mercado Pago afeta apenas a geração de Pix e o recebimento de confirmações — as demais funcionalidades do sistema continuam operando normalmente.
- **RNF-009** — Notificações de confirmação de pagamento que cheguem com atraso (gateway com retry) devem ser processadas corretamente mesmo após o Pix ter expirado, desde que o pagamento seja válido.

### RNF — Compatibilidade

- **RNF-010** — O fluxo OAuth de conexão deve funcionar nos browsers modernos utilizados pelo operador (Chrome, Safari, Firefox — versões dos últimos 2 anos).
- **RNF-011** — A geração de Pix no app deve funcionar em dispositivos iOS e Android suportados pelo Expo SDK em uso.

---

## 9. Regras de Negócio

- **RN-001** — Um tenant possui no máximo uma conta Mercado Pago conectada por vez. Para conectar uma nova conta, a anterior deve ser desconectada primeiro.
- **RN-002** — O sistema só gera Pix de cobrança para tenants que possuam conta Mercado Pago conectada. Sem integração ativa, a funcionalidade de pagamento via Pix é indisponível.
- **RN-003** — Uma cobrança pode ter no máximo um Pix ativo por vez. Pix ativo é aquele gerado há menos de 24 horas e ainda não pago.
- **RN-004** — Um Pix de cobrança é válido por exatamente 24 horas a partir do momento de sua geração. Após esse prazo, o Pix é considerado expirado.
- **RN-005** — Quando há Pix ativo para uma cobrança, qualquer solicitação de Pix — feita pelo cliente no app ou pelo operador no web — retorna o mesmo código existente, sem gerar um novo.
- **RN-006** — Quando o Pix de uma cobrança está expirado ou inexistente, o sistema gera um novo Pix automaticamente ao ser solicitado, sem necessidade de ação adicional do usuário.
- **RN-007** — Cobrança com status "pago" não pode ter Pix gerado. O pagamento confirmado é definitivo — não há reversão automática para "pendente".
- **RN-008** — A confirmação de pagamento via gateway é idempotente: receber a mesma notificação de pagamento mais de uma vez não resulta em múltiplas baixas da cobrança.
- **RN-009** — A desconexão da conta Mercado Pago pelo operador não invalida Pix já gerados e ativos. Esses Pix permanecem válidos até o vencimento de 24 horas, mas novos Pix não podem ser gerados enquanto o tenant estiver desconectado.
- **RN-010** — Os dados de pagamento e as credenciais Mercado Pago de um tenant são estritamente isolados dos demais tenants. Nunca se utiliza a conta de um tenant para processar cobranças de outro.

---

## 10. Critérios de Aceite

### CA-001 (vincula RF-001)

- **Dado** que o operador está autenticado e acessa Configurações
- **Quando** navega para a seção "Integração de Pagamento"
- **Então** o sistema exibe o status atual da integração (conectada ou não conectada)

### CA-002 (vincula RF-002)

- **Dado** que o tenant não possui conta MP conectada
- **Quando** o operador clica em "Conectar Mercado Pago"
- **Então** o sistema redireciona o navegador para o fluxo OAuth do Mercado Pago

### CA-003 (vincula RF-003)

- **Dado** que o operador autorizou o acesso no site do MP
- **Quando** o Mercado Pago redireciona de volta ao GoMoto
- **Então** o sistema armazena as credenciais vinculadas ao tenant e exibe confirmação de sucesso

### CA-004 (vincula RF-003 — borda: OAuth cancelado)

- **Dado** que o operador iniciou o OAuth mas cancelou no site do MP
- **Quando** o sistema recebe o retorno sem autorização
- **Então** exibe mensagem "Conexão cancelada. Nenhuma conta foi vinculada." e permanece desconectado

### CA-005 (vincula RF-004)

- **Dado** que o tenant possui conta MP conectada
- **Quando** o operador acessa Configurações → Integração de Pagamento
- **Então** o sistema exibe o nome ou e-mail da conta MP conectada

### CA-006 (vincula RF-005)

- **Dado** que o tenant possui conta MP conectada
- **Quando** o operador clica em "Desconectar" e confirma
- **Então** o sistema remove as credenciais e passa a exibir o tenant como desconectado

### CA-007 (vincula RF-006)

- **Dado** que o tenant possui conta MP conectada e há cobrança pendente
- **Quando** o operador acessa a tela de Cobranças no web
- **Então** a opção "Gerar Pix" está visível e habilitada para essa cobrança

### CA-008 (vincula RF-007)

- **Dado** que há Pix ativo (gerado há menos de 24h) para uma cobrança
- **Quando** operador ou cliente solicita Pix para essa cobrança
- **Então** o sistema retorna o mesmo código Pix sem gerar um novo junto ao gateway

### CA-009 (vincula RF-008)

- **Dado** que não há Pix ativo para uma cobrança pendente (inexistente ou expirado)
- **Quando** o cliente solicita geração de Pix no app
- **Então** o sistema gera novo Pix junto ao gateway e exibe o código ao usuário

### CA-010 (vincula RF-009)

- **Dado** que um Pix foi gerado ou recuperado
- **Quando** o usuário visualiza o Pix
- **Então** o sistema exibe QR Code, código copia-e-cola, valor da cobrança e horário de vencimento (24h após a geração)

### CA-011 (vincula RF-010)

- **Dado** que o tenant não possui conta MP conectada
- **Quando** o operador acessa a tela de Cobranças no web
- **Então** a opção "Gerar Pix" aparece desabilitada com mensagem orientando a configurar a integração nas Configurações

### CA-012 (vincula RF-011)

- **Dado** que o tenant não possui conta MP conectada
- **Quando** o cliente acessa a tela de Cobranças no app
- **Então** nenhuma opção de geração de Pix é exibida

### CA-013 (vincula RF-012)

- **Dado** que uma cobrança possui status "pago"
- **Quando** o usuário acessa o detalhe da cobrança
- **Então** a opção "Gerar Pix" não é exibida em nenhuma plataforma (web ou app)

### CA-014 (vincula RF-013 + RF-014)

- **Dado** que o cliente efetuou o pagamento via Pix
- **Quando** o Mercado Pago envia notificação de pagamento confirmado
- **Então** o sistema marca a cobrança como paga automaticamente, sem ação do operador

### CA-015 (vincula RF-013 — borda: notificação duplicada)

- **Dado** que a cobrança já está marcada como paga
- **Quando** o gateway envia a mesma notificação de pagamento novamente
- **Então** o sistema processa sem erro e o status da cobrança permanece "pago" — sem duplicação de baixa

### CA-016 (vincula RF-015)

- **Dado** que uma cobrança está com status "pago"
- **Quando** o usuário tenta gerar Pix
- **Então** o sistema exibe mensagem "Esta cobrança já foi paga" e não gera código

### CA-017 (vincula RF-016)

- **Dado** que uma cobrança foi paga enquanto o cliente estava em outra tela
- **Quando** o cliente retorna para a tela de Cobranças
- **Então** a cobrança exibe status "Pago" atualizado

### CA-018 (vincula RF-017)

- **Dado** que uma cobrança foi paga enquanto o cliente visualizava outra tela
- **Quando** o cliente retorna para o detalhe dessa cobrança
- **Então** o status exibido é "Pago"

### CA-019 (vincula RF-018)

- **Dado** que o tenant possui cobranças em diferentes estados de Pix
- **Quando** o operador acessa a tela de Cobranças no web
- **Então** cada cobrança exibe seu status de Pix correspondente: sem Pix, Pix ativo, Pix expirado ou pago via gateway

---

## 11. Dependências e Riscos

### 11.1 Dependências

**PRDs e Specs relacionados**

| Dependência | Tipo | Status |
|---|---|---|
| PRD 0004 — Locações e Cobranças | PRD base | Aprovado — entidade `cobrança` e seus estados são fundação desta feature |

**ADRs a criar**

| ADR | Motivo |
|---|---|
| ADR: Estratégia de recebimento de notificações do gateway | Decisão entre webhook (MP notifica o sistema) vs. polling (sistema consulta MP periodicamente). Impacta arquitetura do backend e confiabilidade da confirmação automática. |
| ADR: Abstração de gateway de pagamento | Feature desenhada para permitir substituição futura do Mercado Pago. Decisão sobre camada de abstração (interface comum, adaptador ou acoplamento direto com refactor futuro) deve ser documentada antes da Spec. |

**Sistemas e serviços externos**

| Dependência | Tipo | Risco associado |
|---|---|---|
| Mercado Pago API | Gateway de pagamento externo | Disponibilidade e mudanças de API fora do controle do GoMoto |
| Endpoint público de webhook | Infraestrutura | O sistema precisa de URL pública e acessível para receber notificações do MP — requer deploy em produção antes de poder testar o fluxo completo |

**Pré-condições de produto**

| Pré-condição | Observação |
|---|---|
| Deploy no Vercel (produção) | Webhook do MP exige URL pública. Fluxo OAuth também requer redirect URI de produção registrada no MP. Esta feature não pode ser validada end-to-end em ambiente local sem tunelamento (ex.: ngrok). |
| Conta de desenvolvedor no Mercado Pago | Necessária para registrar a aplicação, obter Client ID/Secret e configurar redirect URI. |

### 11.2 Riscos

| Risco | Categoria | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| MP altera fluxo OAuth ou depreca versão da API sem aviso antecipado suficiente | Técnico | Média | Alto | Monitorar changelog do MP; ADR de abstração de gateway reduz o custo de troca futura |
| Webhook do MP não chega (falha de rede, IP bloqueado, endpoint indisponível) | Técnico | Baixa | Alto | Pix continua válido; cobrança permanece pendente até próxima tentativa do gateway. Operador pode registrar pagamento manualmente como fallback (fluxo já existente) |
| Tenant tem dificuldade em conectar conta MP (não tem conta, não sabe fazer OAuth) | Produto | Média | Médio | Tela de configuração com instruções claras e link para criar conta MP; fallback manual continua disponível |
| Credenciais MP vazam via log ou exposição acidental | Segurança | Baixa | Alto | RNF-003 e RNF-007 endereçam isso; revisão de segurança obrigatória antes do deploy |
| Deploy em produção atrasado bloqueia validação end-to-end do webhook | Operacional | Alta | Médio | Usar ngrok ou Cloudflare Tunnel para ambiente de homologação durante desenvolvimento |
| Pix gerado com valor errado (desconto ou juros não refletidos) | Dados | Baixa | Alto | Pix deve usar o valor final calculado da cobrança (coberto pela regra `calculateFinalAmount` do PRD 0004); CA-010 valida o valor exibido |

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

| ID | Questão | Status |
|---|---|---|
| Q-001 | Valor mínimo de Pix aceito pelo Mercado Pago — o gateway tem restrições de valor mínimo por tipo de conta. | Adiado para Spec — constraint técnico do gateway, não regra de domínio do GoMoto. |
| Q-002 | Ambiente sandbox do Mercado Pago para desenvolvimento e testes — como configurar credenciais de teste. | Adiado para Spec — decisão de infraestrutura de desenvolvimento. |
| Q-003 | Cancelamento manual de Pix ativo antes do vencimento de 24h — o operador pode cancelar um Pix gerado? | Adiado para vNext — sem caso de uso claro em V1; fluxo atual é aguardar expiração natural. |
| Q-004 | Notificação ao cliente após confirmação automática de pagamento (email, push). | Adiado para vNext — push e email transacional fora de V1. |

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1: todos os itens explicitamente adiados para Spec ou vNext)
- [x] Todos os 18 RFs têm ao menos 1 CA correspondente
- [x] Todos os 19 CAs apontam para RF ou RN
- [x] Personas identificadas (2) e cada uma com ≥1 US
- [x] Fluxos principais (A, B, C), alternativos e de erro documentados
- [x] Dependências e riscos mapeados (2 ADRs sinalizadas, 2 pré-condições, 6 riscos)
- [x] Frontmatter completo (sem campos pendentes de preenchimento)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica

**Aprovado por:** Alan em 2026-06-25
