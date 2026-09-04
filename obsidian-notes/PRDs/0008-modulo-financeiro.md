---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-07-16
adr: "a criar: [[decisions/000X-revisao-modelo-dados-financeiro]], [[decisions/000X-estrategia-calculo-inadimplencia]]"
related:
  - "[[Telas/Cobranças]]"
  - "[[Telas/Locações]]"
  - "[[Telas/Clientes]]"
  - "[[Telas/Motos]]"
  - "[[Banco de Dados]]"
  - "[[Fluxos de Negócio]]"
tags:
  - prd
  - modulo-financeiro
  - financeiro
  - caucao
  - encargos
  - inadimplencia
  - roi
---

# PRD 0008 — Módulo Financeiro

> 🟢 **Status: aprovado** em 2026-07-16. Módulo financeiro completo do GoMoto: caução como passivo, encargos por atraso configuráveis por evento, geração automática de cobranças, crédito do cliente, reajuste de locação, controle de inadimplência, painel financeiro da empresa e ROI por veículo. Próximo passo: `/spec-generator obsidian-notes/PRDs/0008-modulo-financeiro.md`

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto é um ERP de locadora de motocicletas com multi-tenancy, desenhado para operar com frota de dezenas a centenas de veículos por tenant. O módulo de locação (PRD 0004) gera cobranças de ciclo automaticamente, mas o financeiro da empresa permanece cego em aspectos críticos: manutenções cobradas do cliente não geram cobrança, multas atribuídas ao cliente não geram cobrança, caução é registrada sem fluxo de devolução ou retenção, juros por atraso são calculados na leitura mas não são configuráveis nem persistidos, e crédito do cliente não existe como entidade. O modelo de dados atual — com `incomes`, `billings`, `expenses`, `fines` como tabelas isoladas — não suporta visão financeira consolidada e será revisado como parte deste módulo.

### 1.2 Problema

O operador não tem visão financeira consolidada do negócio. Quatro elos estão quebrados:

1. **Elos de receita não capturados:** manutenção com participação do cliente, multa de trânsito de responsabilidade do cliente e despesa repassada ao cliente existem no sistema mas não geram cobrança automaticamente — a receita fica perdida se o operador não lançar manualmente.
2. **Juros sem controle:** cobranças em atraso não acumulam juros ou multa configurável; o operador não tem como aplicar e registrar encargos por atraso de forma rastreável.
3. **Passivos não rastreados:** caução recebida não tem fluxo de encerramento (devolução integral, parcial ou retenção com justificativa); crédito do cliente por reembolso ou estorno não existe como saldo controlado.
4. **Visão diária inexistente:** não há tela que consolide cobranças em atraso, valores a receber no mês e valores já recebidos no mês.

### 1.3 Resumo Executivo

Criar o módulo financeiro completo do GoMoto com revisão do modelo de dados existente. O módulo fecha os quatro elos quebrados: geração automática de cobranças a partir de manutenção, multa e despesa do cliente; juros e multa por atraso configuráveis por evento e rastreáveis; controle de caução como passivo com fluxo de encerramento; controle de crédito do cliente; reajuste de valor e encargos de locações ativas; controle de inadimplência com classificação automática; e painel financeiro com visão diária (a receber, recebido, em atraso) e visão mensal de receita, despesas e resultado da empresa, além de ROI por veículo.

### 1.4 Por que agora

O sistema não está em produção. É o momento de estabelecer o modelo financeiro e o modelo de dados corretos antes do primeiro deploy — qualquer refatoração pós-produção em tabelas financeiras tem custo e risco muito maiores.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Cobrança** | Documento financeiro que representa uma obrigação do cliente para com a empresa. Pode originar de locação (ciclo), manutenção, multa de trânsito, despesa repassada ou ajuste manual. Uma cobrança não é receita — é uma expectativa de recebimento. |
| **Pagamento** | Registro de recebimento que quita totalmente uma cobrança. Em V1 não há pagamento parcial. |
| **Encargo por atraso** | Valor adicional gerado automaticamente quando uma cobrança não é paga até a data de vencimento. Composto por: **multa por atraso** (valor fixo ou percentual, aplicada uma vez) + **juros** (percentual diário acumulado). Configurável por evento. |
| **Multa por atraso** | Penalidade financeira por pagamento fora do prazo, aplicada uma única vez sobre o valor da cobrança. Não confundir com **multa de trânsito**. |
| **Multa de trânsito** | Infração de trânsito registrada pelas autoridades contra um veículo da frota. Pode ser de responsabilidade da empresa ou do cliente. Termo distinto de "multa por atraso". |
| **Juros** | Encargo diário calculado sobre o valor líquido da cobrança em aberto, acumulado a partir do dia seguinte ao vencimento da carência. |
| **Caução** | Valor recebido do cliente como garantia da locação. Registrado como passivo da empresa — não compõe receita operacional. |
| **Retenção de caução** | Utilização parcial ou total da caução para cobrir débitos do cliente no encerramento da locação. Exige justificativa registrada. |
| **Devolução de caução** | Retorno ao cliente do saldo da caução não retido ao encerrar a locação. |
| **Crédito do cliente** | Saldo financeiro positivo do cliente junto à empresa, originado por reembolso, estorno ou ajuste manual. Pode ser abatido automaticamente ou manualmente em cobranças futuras. |
| **Receita** | Valor efetivamente recebido pela empresa via pagamento de cobranças. Excluem-se cauções recebidas (passivo) e créditos gerados (saldo de terceiros). |
| **Despesa** | Custo incorrido pela empresa: manutenção, seguro, documentação, multas de trânsito da empresa, entre outros. |
| **Resultado financeiro** | Diferença entre receitas e despesas de um período. Positivo = lucro; negativo = prejuízo. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

- Dar ao operador visão financeira consolidada da empresa — resultado do mês, a receber, recebido e em atraso — sem precisar abrir planilha externa.
- Garantir que nenhuma receita potencial seja perdida por falta de geração automática: toda manutenção, multa de trânsito ou despesa com participação financeira do cliente deve gerar cobrança sem intervenção manual.
- Tornar o ciclo de vida financeiro de cada veículo rastreável do início ao fim — do valor de compra até o resultado líquido acumulado.

### 3.2 Objetivos do usuário (Operador)

O que o operador passa a poder fazer que hoje não consegue:
- Ver no painel da empresa: total recebido no mês, total a receber, cobranças em atraso e resultado (receita − despesa).
- Registrar caução de uma locação e encerrá-la com devolução, retenção parcial ou retenção total — com justificativa rastreável.
- Ver encargos por atraso calculados automaticamente sobre cobranças vencidas, com multa e juros configuráveis por evento.
- Consultar o histórico financeiro completo de um veículo e seu ROI desde a aquisição.
- Consultar o resumo financeiro de uma locação específica — quanto foi cobrado, recebido, pendente, de caução e de encargos.
- Reajustar o valor do ciclo e os encargos de uma locação ativa, com atualização das cobranças pendentes.
- Classificar clientes por nível de inadimplência e bloquear clientes problemáticos de novas locações.
- Gerar crédito para um cliente e aplicá-lo em cobranças futuras.

### 3.3 Métricas de sucesso / KPIs

| Métrica | Alvo |
|---|---|
| Cobranças de manutenção/multa/despesa do cliente lançadas manualmente | 0 — 100% geradas automaticamente |
| Caução de locações ativas com status desconhecido | 0 — toda caução tem status rastreado |
| Tempo para o operador ver o resultado financeiro do mês | Disponível na abertura do painel, sem cálculo manual |
| Veículos sem histórico financeiro de ROI | 0 — todo veículo tem histórico desde o cadastro |

### 3.4 Incluído em V1

1. **Revisão do modelo de dados financeiro** — `incomes`, `billings`, `expenses`, `fines` e tabelas relacionadas revisadas ou substituídas conforme necessário para suportar os itens abaixo.
2. **Geração automática de cobranças** a partir de: manutenção com participação do cliente, multa de trânsito de responsabilidade do cliente, despesa repassada ao cliente.
3. **Encargos por atraso** — multa por atraso (valor fixo ou percentual, aplicado uma vez) + juros diários, configuráveis por evento (locação, manutenção, multa, despesa), com padrão global editável como ponto de partida. Exibidos como item embutido na cobrança original sem alterar seu valor base.
4. **Caução** — recebimento como passivo na criação da locação (opcional); fluxo de encerramento com devolução integral, devolução parcial ou retenção (total ou parcial) com justificativa obrigatória; saldo de caução sempre rastreado.
5. **Crédito do cliente** — saldo originado por reembolso, estorno ou ajuste manual; abatimento manual pelo operador ou automático na próxima cobrança (configuração do tenant); histórico de utilização.
6. **Reajuste de locação** — operador pode reajustar valor do ciclo e regras de encargo de locação ativa, com atualização das cobranças pendentes e histórico imutável.
7. **Controle de inadimplência** — classificação automática por limiar configurável (Adimplente / Em atraso / Inadimplente / Bloqueado); bloqueio manual e automático; impedimento de nova locação para clientes bloqueados.
8. **Painel financeiro da empresa** — visão diária: cobranças em atraso, total a receber no mês, total recebido no mês; visão mensal: receita, despesas, resultado.
9. **Histórico financeiro e ROI por veículo** — valor de compra, receitas acumuladas de locação, custos acumulados (manutenção, seguro, documentação, outras despesas), resultado líquido e ROI.
10. **Resumo financeiro por locação** — total cobrado, total recebido, saldo pendente, encargos acumulados, caução (valor e status) e créditos aplicados.

### 3.5 Não incluído em V1

| Item | Motivo |
|---|---|
| Pagamento parcial | Não representa a operação atual; adiado para V2 |
| Renegociação / parcelamento de cobranças | Caso raro; cobrança avulsa já cobre o essencial |
| DRE formal / balanço patrimonial | Sofisticação contábil além do escopo operacional atual |
| Centro de custos | Análise gerencial avançada; adiado para V2 |
| Relatório financeiro por cliente | Prioridade menor; candidato a V2 |
| Notificações de cobrança vencida (email/push) | Coberto pelo roadmap de Resend — PRD separado |
| Integração de gateway de pagamento | PRD 0005 (Mercado Pago) |
| Expiração de crédito do cliente | Adiado para V2 |

### 3.6 Telas afetadas

| Tela | Situação |
|---|---|
| `/financeiro` | Nova — painel da empresa (diário + mensal) |
| `/financeiro/veiculos/[id]` | Nova — histórico financeiro e ROI do veículo |
| `/locacoes/[id]/financeiro` | Nova — resumo financeiro da locação |
| `/locacoes` | Modificada — adiciona caução opcional, encargos, reajuste e encerramento financeiro |
| `/cobrancas` | Modificada — exibe encargos por atraso embutidos, créditos aplicados |
| `/manutencao` | Modificada — painel de confirmação de cobrança automática com encargos |
| `/multas` | Modificada — painel de confirmação de cobrança automática com encargos |
| `/despesas` | Modificada — painel de confirmação de cobrança automática com encargos |
| `/clientes` | Modificada — exibe status de inadimplência; ações de bloqueio/desbloqueio |
| `/configuracoes` | Modificada — aba Financeiro com encargos padrão e limiares de inadimplência |

---

## 4. Stakeholders

Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Como interage | Frequência | Nível técnico |
|---|---|---|---|
| **Operador** | Gerencia toda a operação financeira via web: configura encargos, registra e encerra cauções, acompanha painel da empresa, consulta ROI de veículos, classifica inadimplência e aplica créditos. Controle de perfis de acesso é adiado para V2 — por ora todos os operadores têm acesso igual. | Diária | Intermediário — familiarizado com o sistema, sem conhecimento técnico de TI |
| **Cliente** | Locatário da moto. Consulta cobranças e seus detalhes (valores, encargos, status) via app mobile. Não acessa caução, créditos nem painel financeiro. | Eventual | Básico — usuário de smartphone |

### 5.2 User Stories

**Operador**

- **US-001** — Como Operador, quero ver no painel da empresa o total recebido no mês, total a receber, cobranças em atraso e resultado financeiro do período, para saber se o negócio está saudável sem precisar de planilha externa.
- **US-002** — Como Operador, quero configurar as regras de encargo por atraso no momento de criar uma locação, manutenção ou multa, com um padrão global como ponto de partida, para que o sistema calcule automaticamente o valor total a cobrar de clientes inadimplentes.
- **US-003** — Como Operador, quero registrar o recebimento da caução ao criar uma locação, para que esse valor fique registrado como passivo separado da receita operacional.
- **US-004** — Como Operador, quero encerrar financeiramente uma locação informando o destino da caução (devolução integral, parcial ou retenção com justificativa), para fechar o ciclo sem deixar saldo de garantia em aberto.
- **US-005** — Como Operador, quero que o sistema gere automaticamente uma cobrança para o cliente sempre que registrar manutenção, multa de trânsito ou despesa com participação financeira do cliente, para não perder receita por esquecimento de lançamento manual.
- **US-006** — Como Operador, quero gerar crédito para um cliente (por reembolso, estorno ou ajuste) e aplicá-lo manualmente ou automaticamente em cobranças futuras, para não precisar fazer acertos fora do sistema.
- **US-007** — Como Operador, quero consultar o histórico financeiro completo de um veículo — receitas de locação, custos de manutenção, seguro e documentação, e o ROI desde a aquisição — para saber se cada moto está sendo lucrativa.
- **US-008** — Como Operador, quero ver o resumo financeiro de uma locação específica — total cobrado, recebido, pendente, encargos acumulados e caução — para responder ao cliente ou auditar a conta sem precisar consolidar manualmente.
- **US-009** — Como Operador, quero ver os encargos por atraso calculados automaticamente embutidos nas cobranças vencidas, para saber exatamente quanto o cliente deve incluindo penalidades — sem calcular na mão.
- **US-010** — Como Operador, quero reajustar o valor do ciclo e os encargos de uma locação ativa com atualização das cobranças pendentes, para refletir reajustes contratuais sem recriar a locação.
- **US-011** — Como Operador, quero visualizar o status de inadimplência de cada cliente e bloquear clientes problemáticos de novas locações, para proteger a frota de clientes com histórico ruim.

**Cliente**

- **US-012** — Como Cliente, quero visualizar no app mobile o detalhe de uma cobrança em atraso com o valor base, o encargo por atraso e o total a pagar, para entender exatamente quanto devo e por quê o valor é maior que o original.

---

## 6. Fluxos Funcionais

### F1 — Configuração do padrão global de encargos

1. Operador acessa **Configurações → Financeiro → Encargos padrão**.
2. Define os valores padrão: multa por atraso (R$ fixo **ou** percentual), juros diários (% ao dia) e dias de carência.
3. Salva. Esses valores são usados como **pré-preenchimento** nos formulários de criação de locação, manutenção, multa de trânsito e despesa — não são aplicados automaticamente sem confirmação do operador.

**FA1 — Zerar encargos:** operador pode definir multa = R$0 e juros = 0% para desabilitar encargos sem remover a configuração.

---

### F2 — Caução: recebimento na criação da locação

1. Operador cria locação em `/locacoes`.
2. Campo **Caução** disponível (opcional). Se preenchido, informa o valor recebido.
3. Seção **Encargos por atraso** exibida no formulário, pré-preenchida com o padrão global. Operador pode ajustar: multa, juros diários e dias de carência **para esta locação**.
4. Sistema registra a caução como passivo e persiste as regras de encargo definidas — essas taxas valem para todas as cobranças de ciclo geradas por esta locação.
5. Locação criada; encargos fixados por locação a partir deste momento.

---

### F3 — Caução: encerramento financeiro da locação

1. Operador acessa locação ativa → **"Encerrar locação"**.
2. Se a locação possui caução registrada, o sistema exibe o saldo disponível e solicita o destino antes de confirmar o encerramento.
3. Operador escolhe:
   - **Devolução integral:** informa data da devolução; sistema registra devolução e zera o saldo da caução.
   - **Devolução parcial:** informa valor devolvido, valor retido e motivo obrigatório; sistema registra ambos.
   - **Retenção integral:** informa motivo obrigatório; sistema registra retenção total.
4. Locação encerrada; veículo liberado; saldo de caução zerado com histórico completo registrado.

**FA — Caução insuficiente para cobrir débitos:** se o operador informa que reteve R$X mas a locação tem cobranças abertas maiores que R$X, o sistema alerta e oferece gerar cobrança avulsa complementar pelo valor da diferença.

**FA — Locação sem caução:** sistema pula a etapa de caução e vai direto para confirmação de encerramento.

---

### F4 — Geração automática de cobrança (manutenção, multa de trânsito, despesa)

**Manutenção com participação do cliente:**
1. Operador registra manutenção e informa participação financeira do cliente (valor ou percentual).
2. Antes de salvar, sistema exibe painel de confirmação com: valor da cobrança, vencimento sugerido e seção de encargos por atraso pré-preenchida com o padrão global — editável.
3. Operador revisa, ajusta encargos se necessário e confirma.
4. Sistema salva a manutenção e gera a cobrança com as regras de encargo definidas neste momento, persistidas nessa cobrança.

**Multa de trânsito com responsabilidade = cliente:**
1. Operador registra multa e define responsabilidade como "cliente".
2. Painel de confirmação análogo: valor, vencimento sugerido e encargos pré-preenchidos, editáveis.
3. Operador confirma; sistema gera cobrança com encargos fixados.

**Despesa com responsabilidade = cliente (ou compartilhada):**
1. Operador registra despesa com participação do cliente.
2. Painel de confirmação análogo.
3. Operador confirma; sistema gera cobrança com encargos fixados.

**FA — Sem locação ativa vinculável:** sistema alerta e permite que o operador selecione manualmente a locação à qual vincular a cobrança (incluindo locações recentemente encerradas), ou crie a cobrança como avulsa.

---

### F5 — Encargos por atraso: visualização e dispensa

1. Operador (ou cliente no mobile) abre cobrança com status **vencida**.
2. Sistema calcula os encargos usando as **taxas fixadas na criação da cobrança**: multa por atraso (aplicada uma vez, após os dias de carência) + juros acumulados (dias em atraso × taxa diária da cobrança) = **total a pagar**.
3. Ao registrar pagamento, sistema apresenta o total calculado como valor sugerido. Operador confirma valor recebido e forma de pagamento. Sistema registra com detalhamento (base, multa, juros acumulados) capturado no momento da baixa.

**FA — Dispensa de encargo pelo operador:**
1. Operador clica em **"Dispensar encargos"** na cobrança vencida.
2. Informa motivo obrigatório.
3. Sistema registra dispensa com motivo e operador responsável; encargos zerados para essa cobrança específica.
4. Total do pagamento = apenas valor base.

---

### F6 — Crédito do cliente: geração e aplicação

**Geração:**
1. Operador acessa ficha do cliente → **"Novo crédito"**.
2. Informa: valor, origem (reembolso de manutenção / estorno / ajuste manual) e motivo.
3. Sistema registra crédito com saldo disponível e histórico de origem.

**Aplicação manual:**
1. Operador acessa cobrança pendente ou vencida de cliente com crédito disponível.
2. Sistema exibe banner: *"[Cliente] tem R$X de crédito disponível."*
3. Operador clica em **"Aplicar crédito"**; informa valor a abater.
4. Sistema reduz saldo do crédito, registra o abatimento e atualiza o valor final da cobrança.

**Aplicação automática (configuração do tenant):**
1. Quando configurado, ao gerar nova cobrança para cliente com crédito disponível, sistema aplica automaticamente o crédito até o limite do valor da cobrança.
2. Operador vê a cobrança com abatimento já aplicado e histórico do crédito utilizado.

---

### F7 — Painel financeiro da empresa

1. Operador acessa `/financeiro`.
2. **Visão diária:** lista de cobranças em atraso (com valor, cliente e veículo), total a receber no mês corrente e total já recebido no mês corrente.
3. **Visão mensal:** receita do período (soma de pagamentos recebidos), despesas da empresa no período e resultado (receita − despesas).
4. Operador pode navegar entre meses.

---

### F8 — Histórico financeiro e ROI por veículo

1. Operador acessa `/financeiro/veiculos/[id]`.
2. Sistema exibe: valor de aquisição, receitas acumuladas de locação, custos acumulados (manutenção, seguro, documentação, outras despesas), resultado líquido e ROI.
3. **FA — Veículo alienado:** operador registra valor e data de venda; sistema inclui no resultado e recalcula o ROI final do ciclo de vida.

---

### F9 — Resumo financeiro da locação

1. Operador acessa `/locacoes/[id]/financeiro`.
2. Sistema exibe: total cobrado, total recebido, saldo pendente, encargos acumulados, caução (valor e status) e créditos aplicados nessa locação.

---

### F10 — Cliente visualiza encargo no app mobile

1. Cliente abre cobrança vencida no app.
2. Detalhe exibe: valor base, multa por atraso, juros acumulados e **total a pagar** em destaque.
3. Se encargos foram dispensados, detalhe exibe apenas o valor base.

---

### F11 — Reajuste de locação

1. Operador acessa locação ativa → **"Reajustar locação"**.
2. Formulário exibe os valores atuais pré-preenchidos e editáveis: novo valor do ciclo (R$), encargos por atraso (multa, juros diários, carência) e justificativa (obrigatória).
3. Sistema exibe impacto antes da confirmação: *"X cobranças pendentes serão atualizadas de R$Y para R$Z. As novas regras de encargo valerão para cobranças pendentes e futuras desta locação. Cobranças pagas e vencidas não serão alteradas."*
4. Operador confirma.
5. Sistema atualiza todas as cobranças **pendentes** para o novo valor do ciclo; atualiza as taxas de encargo da locação; registra histórico imutável do reajuste.

**FA — Cobranças pro rata pendentes:** recalculadas proporcionalmente com base no novo valor do ciclo.

**FA — Locação sem cobranças pendentes:** sistema informa que não há cobranças pendentes; novo valor e encargos valem a partir da próxima renovação.

---

### F12 — Controle de inadimplência

**Setup (configuração por tenant):**
1. Operador acessa **Configurações → Financeiro → Inadimplência**.
2. Define limiares de classificação: quantidade de cobranças vencidas e/ou dias de atraso para cada nível.
3. Define se o status **Bloqueado** é atingido automaticamente por limiar ou apenas manualmente.

**Runtime — Classificação automática:**
1. Sistema classifica automaticamente cada cliente em: **Adimplente**, **Em atraso**, **Inadimplente** ou **Bloqueado**, com base nas regras configuradas.
2. Status visível na listagem de clientes e na ficha individual.

**Bloqueio manual:**
1. Operador acessa ficha do cliente → **"Bloquear cliente"** com motivo.
2. Sistema registra bloqueio com data, operador e motivo.

**Impacto do bloqueio:**
- Sistema impede a criação de nova locação para cliente bloqueado, exibindo alerta ao operador.
- Operador pode desbloquear com justificativa.

---

### Fluxos de Erro

| Situação | Comportamento esperado |
|---|---|
| Encerrar locação com caução sem informar destino | Sistema bloqueia: "Informe o destino da caução antes de encerrar a locação." |
| Recusar geração de cobrança automática | Sistema salva o registro sem cobrança; operador pode gerar manualmente depois via cobrança avulsa |
| Dispensar encargo sem informar motivo | Sistema bloqueia: "Motivo obrigatório para dispensa de encargos." |
| Gerar crédito com valor zero ou negativo | Sistema bloqueia com mensagem de validação |
| Aplicar crédito maior que saldo disponível | Sistema bloqueia: "Abatimento não pode superar o saldo disponível (R$X)." |
| Aplicar crédito maior que o valor da cobrança | Sistema bloqueia: "Abatimento não pode superar o valor da cobrança." |
| Reajustar valor para zero ou negativo | Sistema bloqueia com mensagem de validação |
| Criar locação para cliente bloqueado | Sistema bloqueia com alerta do status e motivo do bloqueio |
| Valor de aquisição do veículo não registrado ao consultar ROI | Sistema exibe ROI como "Indisponível" com instrução para cadastrar o valor de compra |
| Falha de rede ao salvar evento com cobrança automática | Operação não é salva; nenhuma cobrança é gerada; operador vê mensagem de erro |

---

## 7. Requisitos Funcionais

### Configurações financeiras do tenant
- **RF-001** — O tenant deve poder configurar um padrão global de encargos por atraso: multa (R$ fixo ou percentual), juros diários (% ao dia) e dias de carência.
- **RF-002** — O padrão global de encargos deve pré-preencher automaticamente os formulários de criação de locação e de confirmação de cobranças automáticas, sem impedir a edição.

### Caução
- **RF-003** — O formulário de criação de locação deve disponibilizar campo opcional de caução, com valor em R$.
- **RF-004** — Caução registrada deve ser tratada como passivo da locação, separada das receitas operacionais.
- **RF-005** — O sistema deve manter o saldo e o status da caução de cada locação rastreados a qualquer momento.
- **RF-006** — Ao encerrar uma locação com caução registrada, o sistema deve exigir que o operador informe o destino da caução antes de confirmar o encerramento.
- **RF-007** — O destino da caução deve ser: devolução integral, devolução parcial ou retenção integral.
- **RF-008** — Qualquer retenção (total ou parcial) deve exigir motivo obrigatório registrado.
- **RF-009** — Se o valor retido for insuficiente para cobrir cobranças pendentes, o sistema deve alertar o operador e oferecer a criação de cobrança avulsa complementar pelo valor da diferença.
- **RF-010** — O histórico da caução (valor recebido, movimentações, destino final, motivos) deve ser acessível no resumo financeiro da locação.

### Encargos por atraso
- **RF-011** — O formulário de criação de locação deve exibir seção de encargos por atraso (multa, juros diários, dias de carência), pré-preenchida com o padrão global e editável pelo operador.
- **RF-012** — O painel de confirmação exibido antes de gerar cobranças automáticas (manutenção, multa de trânsito, despesa) deve incluir os campos de encargos por atraso, pré-preenchidos com o padrão global e editáveis.
- **RF-013** — As taxas de encargo devem ser fixadas por cobrança no momento da criação, independentemente de alterações posteriores no padrão global.
- **RF-014** — Ao exibir cobrança com status vencida, o sistema deve apresentar: valor base, multa por atraso (aplicada uma vez após os dias de carência), juros acumulados (dias em atraso × taxa diária da cobrança) e total a pagar.
- **RF-015** — O operador deve poder dispensar os encargos de uma cobrança específica, com motivo obrigatório.
- **RF-016** — A dispensa de encargo deve ser registrada com: operador responsável, data e motivo.

### Geração automática de cobranças
- **RF-017** — Ao registrar manutenção com participação financeira do cliente, o sistema deve exibir painel de confirmação com: valor da cobrança, vencimento sugerido e configuração de encargos — antes de gerar a cobrança.
- **RF-018** — Ao registrar multa de trânsito com responsabilidade atribuída ao cliente, o sistema deve exibir painel de confirmação análogo antes de gerar a cobrança.
- **RF-019** — Ao registrar despesa com participação financeira do cliente, o sistema deve exibir painel de confirmação análogo antes de gerar a cobrança.
- **RF-020** — O operador deve poder recusar a geração da cobrança automática; o evento deve ser salvo normalmente sem cobrança associada.
- **RF-021** — Se não houver locação ativa vinculável ao veículo no momento do registro, o sistema deve permitir ao operador selecionar manualmente uma locação existente ou criar a cobrança como avulsa.

### Crédito do cliente
- **RF-022** — O operador deve poder criar crédito para um cliente, informando: valor, origem (reembolso de manutenção / estorno / ajuste manual) e motivo.
- **RF-023** — Ao acessar cobrança de cliente com crédito disponível, o sistema deve exibir banner informando o saldo disponível.
- **RF-024** — O operador deve poder aplicar crédito manualmente em uma cobrança, informando o valor a abater; o sistema deve bloquear abatimento superior ao saldo disponível ou ao valor da cobrança.
- **RF-025** — O tenant deve poder configurar aplicação automática de crédito ao gerar nova cobrança para cliente com saldo disponível.
- **RF-026** — O sistema deve manter histórico de cada crédito: saldo original, saldo disponível, utilizações (data, cobrança, valor) e origem.

### Reajuste de locação
- **RF-027** — O operador deve poder reajustar o valor do ciclo e as regras de encargo de uma locação ativa.
- **RF-028** — O reajuste deve exigir justificativa obrigatória.
- **RF-029** — Antes de confirmar o reajuste, o sistema deve exibir prévia do impacto: quantas cobranças serão atualizadas, valor anterior e novo valor.
- **RF-030** — O reajuste deve atualizar apenas cobranças com status pendente; cobranças pagas e vencidas devem ser preservadas.
- **RF-031** — O sistema deve manter histórico de reajustes da locação: valores anteriores, valores novos, data, operador e justificativa.

### Controle de inadimplência
- **RF-032** — O tenant deve poder configurar os limiares de classificação de inadimplência: quantidade de cobranças vencidas e/ou dias de atraso para cada nível.
- **RF-033** — O sistema deve classificar automaticamente cada cliente em: **Adimplente**, **Em atraso**, **Inadimplente** ou **Bloqueado**, com base nas regras configuradas.
- **RF-034** — O status de inadimplência deve ser visível na listagem de clientes e na ficha individual do cliente.
- **RF-035** — O operador deve poder bloquear um cliente manualmente, com motivo obrigatório.
- **RF-036** — O operador deve poder desbloquear um cliente, com justificativa obrigatória.
- **RF-037** — O sistema deve impedir a criação de nova locação para cliente com status **Bloqueado**, exibindo alerta com o motivo do bloqueio.

### Painel financeiro da empresa
- **RF-038** — O painel financeiro deve exibir visão diária: lista de cobranças em atraso (cliente, veículo, valor), total a receber no mês corrente e total já recebido no mês corrente.
- **RF-039** — O painel financeiro deve exibir visão mensal: receita do período (pagamentos recebidos), despesas da empresa no período e resultado (receita − despesas).
- **RF-040** — O operador deve poder navegar entre meses no painel financeiro.

### Histórico financeiro e ROI por veículo
- **RF-041** — O cadastro de veículo deve incluir campos de valor de aquisição (R$) e data de compra.
- **RF-042** — O sistema deve exibir o histórico financeiro do veículo: valor de aquisição, receitas acumuladas de locação, custos acumulados por categoria (manutenção, seguro, documentação, outras despesas), resultado líquido e ROI.
- **RF-043** — O operador deve poder registrar a alienação do veículo (valor de venda e data); o sistema deve incluir o valor de venda no cálculo de resultado e ROI final.
- **RF-044** — Se o valor de aquisição não estiver cadastrado, o sistema deve exibir o ROI como "indisponível" com instrução para cadastrar o valor de compra.

### Resumo financeiro da locação
- **RF-045** — O sistema deve exibir resumo financeiro por locação: total cobrado, total recebido, saldo pendente, encargos acumulados, caução (valor e status) e créditos aplicados.
- **RF-046** — O histórico de reajustes de valor da locação deve ser acessível no resumo financeiro da locação.

### App mobile — Cliente
- **RF-047** — O detalhe de cobrança vencida no app mobile deve exibir: valor base, multa por atraso, juros acumulados e total a pagar em destaque.
- **RF-048** — Se os encargos de uma cobrança foram dispensados pelo operador, o app deve exibir apenas o valor base, sem mencionar encargos.

### Integridade do modelo financeiro
- **RF-049** — O sistema não deve exigir lançamento manual duplicado para registrar que uma cobrança foi paga; o pagamento deve quitar a cobrança em uma única operação.

---

## 8. Requisitos Não Funcionais

### Performance
- **RNF-001** — O painel financeiro da empresa deve carregar em menos de 3 segundos para tenants com até 500 cobranças no mês corrente.
- **RNF-002** — O histórico financeiro e ROI de um veículo deve carregar em menos de 3 segundos, considerando o ciclo de vida completo do veículo.
- **RNF-003** — O resumo financeiro de uma locação deve carregar em menos de 2 segundos.
- **RNF-004** — A classificação de inadimplência dos clientes deve refletir o estado atual das cobranças em até 60 segundos após qualquer alteração relevante (pagamento, nova cobrança vencida).

### Integridade e imutabilidade
- **RNF-005** — Nenhum registro financeiro (cobrança, pagamento, crédito, movimentação de caução, dispensa de encargo, reajuste) pode ser excluído fisicamente. Correções ocorrem via estorno ou ajuste com rastreabilidade.
- **RNF-006** — Operações que envolvem múltiplos registros — encerramento financeiro de locação com caução, geração de cobrança automática, reajuste de cobranças pendentes — devem ser atômicas: ou todas as alterações são persistidas ou nenhuma.
- **RNF-007** — O valor base de uma cobrança é imutável após criação. Ajustes ocorrem via reajuste de locação (novo registro histórico) ou via desconto/crédito aplicado separadamente.

### Auditabilidade
- **RNF-008** — Toda operação financeira deve registrar: usuário responsável, data e hora, valores anteriores e valores novos (quando aplicável) e motivo (quando exigido pelo fluxo).
- **RNF-009** — O sistema deve permitir reconstruir o histórico financeiro completo de uma locação, de um veículo ou de um cliente a partir dos registros persistidos — sem depender de cálculos externos.

### Segurança e isolamento
- **RNF-010** — Dados financeiros de um tenant nunca devem ser visíveis ou acessíveis a outro tenant, independentemente do canal de acesso (web ou mobile).
- **RNF-011** — Um cliente autenticado no app mobile deve visualizar exclusivamente suas próprias cobranças — nunca dados financeiros de outro cliente do mesmo tenant.
- **RNF-012** — Apenas usuários autenticados e pertencentes ao tenant podem acessar dados financeiros daquele tenant.

### Rastreabilidade de origem
- **RNF-013** — Toda cobrança gerada automaticamente deve manter vínculo rastreável com o evento que a originou (manutenção, multa de trânsito ou despesa) e com a locação à qual está associada.

### Privacidade
- **RNF-014** — Dados financeiros de clientes não devem ser expostos a terceiros não autorizados, em conformidade com a LGPD.

---

## 9. Regras de Negócio

### Isolamento de dados
- **RN-001** — Dados financeiros de um tenant nunca são visíveis ou acessíveis a outro tenant.

### Caução
- **RN-002** — Caução é registrada como passivo da empresa, não como receita operacional.
- **RN-003** — Uma locação pode ter no máximo uma caução ativa.
- **RN-004** — O saldo disponível da caução é igual ao valor recebido menos as retenções já aplicadas.
- **RN-005** — A devolução da caução não pode superar o saldo disponível.
- **RN-006** — Qualquer retenção de caução (total ou parcial) exige motivo registrado.
- **RN-007** — A caução deve ter seu destino definido (devolução ou retenção) no encerramento da locação; não pode permanecer com status "recebida" após o encerramento.

### Encargos por atraso
- **RN-008** — Encargos só incidem sobre cobranças com status vencida.
- **RN-009** — O período de carência é contado a partir do dia seguinte ao vencimento da cobrança.
- **RN-010** — A multa por atraso é aplicada uma única vez, no primeiro dia após o encerramento do período de carência.
- **RN-011** — Os juros acumulam diariamente a partir do primeiro dia após o encerramento do período de carência.
- **RN-012** — Os encargos são calculados sobre o valor líquido da cobrança (valor base menos desconto aplicado, se houver).
- **RN-013** — As taxas de encargo (multa e juros) são fixadas no momento da criação da cobrança e não se alteram por mudança posterior no padrão global do tenant.
- **RN-014** — A dispensa de encargo pelo operador zera os encargos daquela cobrança específica; é irreversível e registrada com operador, data e motivo.
- **RN-015** — Encargos dispensados não reaparecem se a cobrança permanecer em aberto.

### Geração automática de cobrança
- **RN-016** — Cobrança automática só é gerada após confirmação explícita do operador no painel de confirmação.
- **RN-017** — Se o operador recusar a geração, o evento (manutenção, multa ou despesa) é salvo sem cobrança; o operador pode criar a cobrança manualmente depois via cobrança avulsa.
- **RN-018** — Toda cobrança gerada automaticamente mantém vínculo permanente e rastreável com o evento que a originou.

### Crédito do cliente
- **RN-019** — O saldo disponível de crédito de um cliente é a soma dos créditos criados menos a soma dos abatimentos já aplicados.
- **RN-020** — O abatimento de crédito não pode superar o saldo disponível do cliente.
- **RN-021** — O abatimento de crédito não pode superar o valor líquido da cobrança na qual é aplicado.
- **RN-022** — O abatimento de crédito reduz o valor a pagar da cobrança; o valor base permanece imutável.
- **RN-023** — Crédito do cliente não expira em V1.

### Reajuste de locação
- **RN-024** — Somente locações com status ativo podem ter valor de ciclo e encargos reajustados.
- **RN-025** — O reajuste atualiza o valor de todas as cobranças com status pendente da locação para o novo valor do ciclo.
- **RN-026** — Cobranças com status pago ou vencido não são afetadas pelo reajuste.
- **RN-027** — Cobranças pendentes com valor pro rata são recalculadas proporcionalmente com base no novo valor do ciclo.
- **RN-028** — Cada reajuste gera registro histórico imutável: valor anterior, valor novo, encargos anteriores, encargos novos, data, operador e justificativa.

### Controle de inadimplência
- **RN-029** — A classificação de inadimplência de um cliente é calculada com base em suas cobranças vencidas dentro do mesmo tenant.
- **RN-030** — **Adimplente:** cliente sem cobranças com status vencida.
- **RN-031** — **Em atraso:** cliente com ao menos uma cobrança vencida, dentro dos limiares configurados para "inadimplente".
- **RN-032** — **Inadimplente:** cliente que excede os limiares configurados (dias de atraso e/ou quantidade de cobranças vencidas).
- **RN-033** — **Bloqueado:** cliente que excede o limiar de bloqueio automático configurado, ou bloqueado manualmente pelo operador.
- **RN-034** — Cliente com status Bloqueado não pode ter nova locação criada.
- **RN-035** — Desbloqueio exige justificativa registrada; histórico de bloqueios e desbloqueios é preservado.
- **RN-036** — A classificação de inadimplência é recalculada automaticamente pelo sistema, sem ação manual do operador.

### Painel financeiro da empresa
- **RN-037** — Receita do período = soma dos pagamentos recebidos no período, excluindo cauções recebidas e créditos gerados.
- **RN-038** — Despesa do período = soma das despesas de responsabilidade da empresa registradas no período.
- **RN-039** — Resultado do período = Receita − Despesa.

### Histórico financeiro e ROI por veículo
- **RN-040** — As receitas do veículo compreendem todos os pagamentos recebidos de cobranças vinculadas a locações daquele veículo.
- **RN-041** — Os custos do veículo compreendem: valor de aquisição, manutenções, despesas de seguro, despesas de documentação e outras despesas vinculadas ao veículo de responsabilidade da empresa.
- **RN-042** — Resultado líquido do veículo = receitas acumuladas + valor de venda (se alienado) − custos acumulados.
- **RN-043** — ROI do veículo = resultado líquido / valor de aquisição × 100%.
- **RN-044** — O ROI só é calculado quando o valor de aquisição está registrado no cadastro do veículo.
- **RN-045** — Para veículo não alienado, o ROI é calculado sem valor de venda — representa o resultado operacional parcial até a data atual.

### Integridade do modelo financeiro
- **RN-046** — Nenhum registro financeiro pode ser excluído fisicamente do sistema.
- **RN-047** — O registro de pagamento de uma cobrança é a única operação que a marca como quitada; não existe lançamento duplicado em tabela separada de entradas.

---

## 10. Critérios de Aceite

### CA-001 (RF-001)
- **Dado** o operador está em Configurações → Financeiro → Encargos padrão
- **Quando** define multa de R$30, juros de 0,5%/dia e 5 dias de carência e salva
- **Então** valores são persistidos como padrão global do tenant

### CA-002 (RF-002)
- **Dado** o padrão global tem multa de R$30 e juros de 0,5%/dia
- **Quando** operador abre o formulário de criação de locação
- **Então** campos de encargo aparecem pré-preenchidos com R$30 e 0,5% e são editáveis

### CA-003 (RF-003)
- **Dado** o operador está no formulário de criação de locação
- **Quando** não preenche o campo caução e confirma
- **Então** locação é criada sem caução registrada

### CA-004 (RF-003)
- **Dado** o operador preenche caução de R$500 no formulário de locação
- **Quando** confirma a criação
- **Então** caução de R$500 é registrada como passivo vinculado à locação com status "recebida"

### CA-005 (RF-004, RN-002)
- **Dado** locação tem caução de R$500 registrada
- **Quando** o painel financeiro exibe a receita do mês
- **Então** os R$500 da caução não aparecem no total de receitas

### CA-006 (RF-005, RN-004)
- **Dado** locação tem caução de R$500 e R$200 foram retidos anteriormente
- **Quando** operador consulta o resumo financeiro da locação
- **Então** saldo disponível da caução exibido é R$300

### CA-007 (RF-006)
- **Dado** locação tem caução de R$500 registrada
- **Quando** operador tenta encerrar a locação sem informar destino da caução
- **Então** sistema bloqueia com "Informe o destino da caução antes de encerrar a locação."

### CA-008 (RF-007)
- **Dado** operador seleciona "devolução integral" ao encerrar locação com caução de R$500 e informa a data
- **Quando** confirma
- **Então** caução fica com status "devolvida integralmente" e saldo zerado

### CA-009 (RF-007)
- **Dado** operador seleciona "devolução parcial" ao encerrar locação com caução de R$500
- **Quando** informa R$300 devolvido, R$200 retido e motivo
- **Então** sistema registra devolução de R$300 e retenção de R$200 com motivo

### CA-010 (RF-007, RF-008)
- **Dado** operador seleciona "retenção integral" e informa motivo
- **Quando** confirma o encerramento
- **Então** caução fica com status "retida integralmente" e motivo registrado

### CA-011 (RF-008)
- **Dado** operador seleciona qualquer modalidade de retenção
- **Quando** tenta confirmar sem preencher o motivo
- **Então** sistema bloqueia com campo motivo destacado como obrigatório

### CA-012 (RF-009)
- **Dado** locação tem caução de R$200 e cobranças vencidas de R$500
- **Quando** operador informa retenção integral (R$200)
- **Então** sistema exibe alerta de diferença de R$300 e oferece criação de cobrança complementar

### CA-013 (RF-010)
- **Dado** locação teve caução de R$500, devolução parcial de R$300 e retenção de R$200 com motivo
- **Quando** operador acessa o resumo financeiro da locação
- **Então** histórico exibe: recebido R$500, devolvido R$300, retido R$200, motivo e data de cada movimentação

### CA-014 (RF-011)
- **Dado** padrão global tem multa de R$25 e juros de 0,3%/dia
- **Quando** operador abre formulário de criação de locação
- **Então** seção de encargos aparece pré-preenchida com R$25 e 0,3%, editável

### CA-015 (RF-012)
- **Dado** padrão global tem multa de 5% e juros de 0,1%/dia
- **Quando** operador registra manutenção com participação do cliente e sistema exibe painel de confirmação
- **Então** seção de encargos aparece pré-preenchida com 5% e 0,1% e é editável antes de confirmar

### CA-016 (RF-013, RN-013)
- **Dado** cobrança criada com multa de 5% e juros de 0,1%/dia
- **Quando** tenant altera o padrão global para multa de 10% e juros de 0,2%/dia
- **Então** a cobrança original continua calculando encargos com multa de 5% e juros de 0,1%/dia

### CA-017 (RF-014)
- **Dado** cobrança de R$500 com multa de R$25, sem carência, vencida há 10 dias com juros de 0,5%/dia
- **Quando** operador abre a cobrança
- **Então** sistema exibe: valor base R$500, multa R$25, juros R$25 (10 × 0,5% × R$500), total a pagar R$550

### CA-018 (RF-014, RN-009)
- **Dado** cobrança com 5 dias de carência vencida há 3 dias
- **Quando** operador abre a cobrança
- **Então** encargos exibidos são zero (ainda dentro do período de carência)

### CA-019 (RF-014, RN-010)
- **Dado** cobrança com 5 dias de carência vencida há 6 dias
- **Quando** operador abre a cobrança
- **Então** sistema exibe multa aplicada uma vez + juros de 1 dia (primeiro dia após a carência)

### CA-020 (RF-015)
- **Dado** cobrança vencida com encargos calculados
- **Quando** operador clica em "Dispensar encargos" e informa motivo
- **Então** encargos zerados nessa cobrança; total a pagar = valor base

### CA-021 (RF-015)
- **Dado** operador tenta dispensar encargos de cobrança vencida
- **Quando** clica em confirmar sem informar motivo
- **Então** sistema bloqueia com "Motivo obrigatório para dispensa de encargos."

### CA-022 (RF-016)
- **Dado** encargos foram dispensados de uma cobrança
- **Quando** operador consulta o histórico da cobrança
- **Então** registro de dispensa exibe: operador responsável, data e motivo

### CA-023 (RF-017)
- **Dado** operador registra manutenção de R$300 com 50% de responsabilidade do cliente
- **Quando** clica em salvar
- **Então** sistema exibe painel: "Uma cobrança de R$150 será gerada para [Cliente] — Manutenção: [Descrição]." com campos de vencimento e encargos antes de confirmar

### CA-024 (RF-018)
- **Dado** operador registra multa de trânsito de R$200 com responsabilidade = cliente
- **Quando** clica em salvar
- **Então** sistema exibe painel de confirmação com valor R$200, vencimento sugerido e encargos editáveis

### CA-025 (RF-019)
- **Dado** operador registra despesa de R$100 com responsabilidade = cliente
- **Quando** clica em salvar
- **Então** sistema exibe painel de confirmação análogo com valor R$100

### CA-026 (RF-020)
- **Dado** sistema exibe painel de confirmação de cobrança automática
- **Quando** operador clica em "Recusar"
- **Então** evento é salvo normalmente sem cobrança; nenhuma cobrança é gerada

### CA-027 (RF-021)
- **Dado** veículo X não tem locação ativa
- **Quando** operador registra manutenção com participação do cliente para veículo X e confirma a cobrança
- **Então** sistema alerta ausência de locação ativa e permite selecionar locação existente ou criar cobrança avulsa

### CA-028 (RF-022)
- **Dado** operador acessa ficha do cliente e clica em "Novo crédito"
- **Quando** informa R$150, origem "reembolso de manutenção" e motivo e confirma
- **Então** crédito de R$150 é registrado com saldo disponível de R$150

### CA-029 (RF-023)
- **Dado** cliente tem crédito disponível de R$100
- **Quando** operador abre cobrança pendente desse cliente
- **Então** sistema exibe banner "Este cliente tem R$100 de crédito disponível."

### CA-030 (RF-024, RN-022)
- **Dado** cobrança de R$300 e cliente com crédito de R$100
- **Quando** operador aplica R$100 de crédito
- **Então** valor a pagar da cobrança passa a R$200; saldo de crédito do cliente vai para R$0; valor base R$300 permanece inalterado

### CA-031 (RF-024, RN-020)
- **Dado** cliente tem saldo de crédito de R$50
- **Quando** operador tenta aplicar abatimento de R$80
- **Então** sistema bloqueia: "Abatimento não pode superar o saldo disponível (R$50)."

### CA-032 (RF-024, RN-021)
- **Dado** cobrança de R$30 e cliente com crédito de R$100
- **Quando** operador tenta aplicar abatimento de R$50
- **Então** sistema bloqueia: "Abatimento não pode superar o valor da cobrança."

### CA-033 (RF-025)
- **Dado** tenant configurou aplicação automática de crédito e cliente tem crédito de R$80
- **Quando** nova cobrança de R$200 é gerada para esse cliente
- **Então** sistema aplica automaticamente R$80 de crédito; cobrança com valor a pagar de R$120

### CA-034 (RF-026)
- **Dado** cliente teve crédito de R$200, usou R$50 em uma cobrança e R$30 em outra
- **Quando** operador consulta histórico de crédito do cliente
- **Então** sistema exibe: saldo original R$200, utilizações de R$50 e R$30 com datas e cobranças associadas, saldo disponível R$120

### CA-035 (RF-027, RF-028)
- **Dado** locação ativa com valor de R$500/ciclo
- **Quando** operador acessa "Reajustar locação", informa novo valor R$600 sem preencher justificativa e tenta confirmar
- **Então** sistema bloqueia com campo justificativa destacado como obrigatório

### CA-036 (RF-029)
- **Dado** locação ativa com 8 cobranças pendentes de R$500
- **Quando** operador informa novo valor R$600 e justificativa
- **Então** sistema exibe prévia: "8 cobranças pendentes serão atualizadas de R$500 para R$600. Cobranças pagas e vencidas não serão alteradas."

### CA-037 (RF-030, RN-025, RN-026)
- **Dado** locação tem 3 cobranças pagas (R$500), 1 vencida (R$500) e 5 pendentes (R$500)
- **Quando** operador reajusta para R$600 e confirma
- **Então** as 5 cobranças pendentes passam para R$600; as 3 pagas e a 1 vencida permanecem em R$500

### CA-038 (RF-031, RN-028)
- **Dado** locação sofreu reajuste de R$500 para R$600
- **Quando** operador acessa histórico de reajustes da locação
- **Então** registro exibe: valor anterior R$500, valor novo R$600, encargos anteriores, encargos novos, data, operador e justificativa

### CA-039 (RF-032, RF-033, RN-032)
- **Dado** tenant configurou Inadimplente = mais de 2 cobranças vencidas
- **Quando** cliente acumula 3 cobranças vencidas
- **Então** sistema classifica o cliente como "Inadimplente"

### CA-040 (RF-033, RN-030)
- **Dado** cliente não tem cobranças vencidas
- **Quando** operador consulta a listagem de clientes
- **Então** cliente aparece com status "Adimplente"

### CA-041 (RF-034)
- **Dado** cliente está classificado como "Inadimplente"
- **Quando** operador abre a listagem de clientes
- **Então** status "Inadimplente" é visível na linha do cliente

### CA-042 (RF-035)
- **Dado** operador acessa ficha do cliente e clica em "Bloquear cliente"
- **Quando** informa motivo e confirma
- **Então** cliente passa para status "Bloqueado" e histórico registra operador, data e motivo

### CA-043 (RF-036)
- **Dado** cliente está bloqueado
- **Quando** operador clica em "Desbloquear" e informa justificativa
- **Então** cliente retorna à classificação automática e histórico registra o desbloqueio com justificativa

### CA-044 (RF-036)
- **Dado** operador tenta desbloquear cliente
- **Quando** clica em confirmar sem preencher a justificativa
- **Então** sistema bloqueia com campo justificativa como obrigatório

### CA-045 (RF-037, RN-034)
- **Dado** cliente está com status "Bloqueado"
- **Quando** operador tenta criar nova locação para esse cliente
- **Então** sistema bloqueia com alerta exibindo status e motivo do bloqueio

### CA-046 (RF-038)
- **Dado** existem cobranças vencidas de três clientes diferentes
- **Quando** operador abre o painel financeiro
- **Então** as três cobranças aparecem na lista de atraso com cliente, veículo e valor

### CA-047 (RF-039, RN-037, RN-038, RN-039)
- **Dado** em julho foram recebidos R$5.000 em pagamentos, a empresa teve R$2.000 em despesas e cauções recebidas foram R$500
- **Quando** operador acessa visão mensal de julho
- **Então** painel exibe: receita R$5.000 (excluindo a caução), despesas R$2.000, resultado R$3.000

### CA-048 (RF-040)
- **Dado** operador está no painel financeiro de julho
- **Quando** clica para navegar para junho
- **Então** painel exibe os dados de junho

### CA-049 (RF-041)
- **Dado** operador acessa o cadastro de um veículo
- **Quando** preenche valor de aquisição R$8.000 e data de compra e salva
- **Então** dados são persistidos e usados no cálculo de ROI

### CA-050 (RF-042, RN-042, RN-043)
- **Dado** veículo com aquisição R$8.000, receitas acumuladas R$12.000 e custos acumulados R$3.000 (não alienado)
- **Quando** operador acessa histórico financeiro do veículo
- **Então** sistema exibe: resultado líquido R$1.000 (12.000 − 8.000 − 3.000) e ROI 12,5%

### CA-051 (RF-043)
- **Dado** veículo com resultado líquido de R$1.000 antes de alienação
- **Quando** operador registra venda por R$5.000
- **Então** sistema recalcula: resultado líquido R$6.000 (1.000 + 5.000) e ROI 75%

### CA-052 (RF-044)
- **Dado** veículo sem valor de aquisição cadastrado
- **Quando** operador acessa histórico financeiro do veículo
- **Então** ROI exibido como "Indisponível — cadastre o valor de compra no cadastro do veículo."

### CA-053 (RF-045)
- **Dado** locação com 10 cobranças (8 pagas, 1 vencida, 1 pendente), caução de R$500 recebida e R$50 de crédito aplicado
- **Quando** operador acessa resumo financeiro da locação
- **Então** sistema exibe: total cobrado, total recebido, saldo pendente, encargos acumulados, caução com status "recebida" e crédito aplicado R$50

### CA-054 (RF-046)
- **Dado** locação sofreu dois reajustes de valor
- **Quando** operador acessa histórico de reajustes no resumo financeiro da locação
- **Então** histórico exibe os dois registros com todos os detalhes

### CA-055 (RF-047)
- **Dado** cobrança vencida de R$400 com multa R$20 e juros acumulados R$12
- **Quando** cliente abre o detalhe da cobrança no app mobile
- **Então** app exibe: valor base R$400, multa por atraso R$20, juros R$12, total a pagar R$432 em destaque

### CA-056 (RF-048)
- **Dado** encargos de uma cobrança foram dispensados pelo operador
- **Quando** cliente abre o detalhe dessa cobrança no app
- **Então** app exibe apenas o valor base sem qualquer menção a encargos

### CA-057 (RF-049, RN-047)
- **Dado** cobrança pendente de R$300
- **Quando** operador registra o pagamento informando data e forma
- **Então** cobrança passa para status "pago" sem exigir lançamento adicional em nenhuma outra tela ou tabela

---

## 11. Dependências e Riscos

### 11.1 Dependências

#### PRDs relacionados

| PRD / Item | Relação |
|---|---|
| **PRD 0004 — Locação e Cobranças** (aprovado e implementado) | Base deste módulo. Entidade `rental` e `billings` são estendidas com caução, encargos e reajuste. Regras de status de cobrança do PRD 0004 permanecem válidas e complementadas pelas deste PRD. |
| **PRD 0005 — Integração Mercado Pago** (aprovado) | Gateway de pagamento futuro. Este PRD estabelece o modelo de pagamento que a integração irá acionar. Nenhum impacto no escopo V1, mas o modelo de dados deve ser compatível. |
| **PRD 0006 / PRD 0007 — Veículos** (existentes) | RF-041 adiciona campos de valor de aquisição e data de compra ao cadastro de veículo. Verificar sobreposição com PRD 0007 antes de implementar. |
| **PRD futuro — Notificações (Resend)** | Alertas de cobrança vencida e de inadimplência são candidatos naturais. Este PRD não cobre notificações — ponto de integração reservado. |

#### ADRs existentes relevantes

| ADR | Relevância |
|---|---|
| **ADR 0002 — Padrão canônico de tela** | Todas as telas novas e modificadas devem seguir o padrão Server Actions + hooks de leitura. |

#### ADRs a criar

| Decisão | Motivo |
|---|---|
| **Revisão do modelo de dados financeiro** | A eliminação da duplicação entre `incomes` e `billings` (RF-049) e a possível reestruturação de `expenses` e `fines` têm impacto amplo. Exige ADR antes da Spec. |
| **Estratégia de cálculo de inadimplência** | Classificação em tempo real via view derivada, campo materializado com trigger ou job periódico — trade-offs de performance e consistência merecem documentação formal. |

#### Dependências de módulos existentes

| Módulo | O que muda |
|---|---|
| `/motos` | Adicionar: valor de aquisição (R$) e data de compra (RF-041). Confirmar sobreposição com PRD 0007. |
| `/locacoes` | Adicionar: caução opcional, encargos editáveis na criação (RF-003, RF-011), encerramento financeiro (RF-006–009), reajuste (RF-027–031). |
| `/manutencao` | Painel de confirmação de cobrança com encargos (RF-017). |
| `/multas` | Painel de confirmação de cobrança com encargos (RF-018). |
| `/despesas` | Painel de confirmação de cobrança com encargos (RF-019). |
| `/clientes` | Status de inadimplência (RF-034), bloqueio/desbloqueio (RF-035, RF-036). |
| `/configuracoes` | Aba Financeiro: encargos padrão (RF-001) e limiares de inadimplência (RF-032). |
| `@gomoto/core` | Novas regras puras: cálculo de encargos, ROI por veículo, classificação de inadimplência. |
| `@gomoto/data` | Novos hooks: painel financeiro, histórico do veículo, resumo da locação, crédito do cliente, histórico de caução. |

### 11.2 Riscos

| Risco | Categoria | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| Revisão de `incomes`/`expenses`/`fines` introduz regressão nas telas existentes | Dados / Produto | Média | Alto | ADR de modelo de dados antes da Spec; `pnpm db:reset` com novo seed cobre a migração (sistema não está em produção) |
| Cálculo de encargos com edge cases: carência terminando em fim de semana, meses curtos, cobrança paga no dia da multa | Produto | Média | Médio | Cobrir todos os edge cases com testes unitários em `@gomoto/core` antes de qualquer UI |
| Campo de valor de aquisição conflita com escopo do PRD 0007 — duplicação de esforço | Produto | Média | Baixo | Alinhar com PRD 0007 antes da Spec |
| Reajuste de locação com muitas cobranças pendentes (ex.: 80 semanas restantes) gera operação pesada | Técnico | Baixa | Médio | Operação atômica em transação; definir comportamento de timeout na Spec |
| Classificação de inadimplência em tempo real com 100+ clientes causa lentidão na listagem | Técnico | Baixa | Médio | ADR de estratégia de cálculo antes da Spec; testar com volume realista |
| Veículos cadastrados antes deste módulo não têm valor de aquisição — ROI indisponível para frota inicial | Produto | Alta | Baixo | Sistema trata graciosamente (CA-052); operador preenche retroativamente — sem bloqueio funcional |
| PRD 0005 (Mercado Pago) assume modelo de pagamento incompatível com o definido aqui | Produto | Baixa | Alto | Revisar modelo de dados de pagamento com a Spec do PRD 0005 antes de finalizar o esquema |

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

Todas as questões foram resolvidas durante a entrevista ou explicitamente adiadas:

| ID | Decisão tomada |
|---|---|
| QA-01 | Pagamento parcial → adiado para V2. Em V1 o pagamento sempre quita o valor total da cobrança. |
| QA-02 | Ledger centralizado como tabela → não implementado em V1. Eliminação de duplicação via RF-049; ADR de modelo de dados define a solução técnica na Spec. |
| QA-03 | Encargos configurados por evento com padrão global editável. Incorporado em RF-001, RF-002, RF-011, RF-012. |
| QA-04 | Reajuste de locação inclui reajuste de encargos. Incorporado em RF-027 e F11. |
| QA-05 | Controle de inadimplência → V1. Incorporado em RF-032–037 e RN-029–036. |
| QA-06 | ROI por veículo → V1. Incorporado em RF-041–044 e RN-040–045. |
| QA-07 | Relatório financeiro por locação → V1. Incorporado em RF-045–046. |
| QA-08 | Base de cálculo dos encargos quando coexistem desconto e crédito aplicado → **adiado para Spec**. Em V1 crédito é tipicamente aplicado antes do vencimento. |
| QA-09 | Sobreposição do campo de valor de aquisição (RF-041) com PRD 0007 → **alinhar antes da Spec**; sem impacto no escopo deste PRD. |

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 — todas resolvidas ou explicitamente adiadas)
- [x] Todos os 49 RFs têm ao menos 1 CA correspondente
- [x] Todos os 57 CAs apontam para ao menos 1 RF ou RN
- [x] Personas identificadas (Operador e Cliente) com ≥ 1 US cada
- [x] Fluxos principais (F1–F12), alternativos e de erro documentados
- [x] Dependências e riscos mapeados (§11)
- [x] Frontmatter completo (sem campos por preencher)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem SQL, paths, pacotes ou rotas técnicas

**Aprovado por:** Alan em 2026-07-16
