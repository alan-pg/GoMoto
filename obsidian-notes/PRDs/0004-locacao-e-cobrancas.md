---
status: aprovado
versão: 1.1
autor: Alan (com agente IA)
data: 2026-06-24
emenda: "2026-06-24 — v1.1: adicionados tipos de locação (Rental / Rent-to-Own), vigência mínima por tipo e multa por rescisão antecipada (RF-038, RF-039, RN-034–RN-037, CA-039–CA-040)."
adr: "[[decisions/0009-geracao-cobracas-upfront-vs-cron]], [[decisions/0003-escopo-e-auth-do-mobile-cliente]], [[decisions/0004-control-plane-e-identidade-do-cliente]]"
related:
  - "[[Telas/Cobranças]]"
  - "[[Telas/Fila]]"
  - "[[Banco de Dados]]"
tags:
  - prd
  - locacao-e-cobrancas
  - locacao
  - cobrancas
  - mobile
---

# PRD 0004 — Módulo de Locação e Cobranças Automáticas

> 🟢 **Status: aprovado** em 2026-06-24. Refatoração do módulo de locação com geração automática de cobranças, ciclos configuráveis, pro rata, encerramento/renovação de contratos e tela de cobranças no app mobile do cliente. Próximo passo: `/spec-generator obsidian-notes/PRDs/0004-locacao-e-cobrancas.md`

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto gerencia locação de motocicletas para uma operação com frota pequena e operador único. Hoje, a criação de locações acontece pela tela de Fila de Espera (fechamento de contrato em 5 mutações compostas). Cobranças são criadas manualmente, uma a uma, na tela `/cobrancas`, sem periodicidade configurável, sem automação e sem vínculo estruturado com a locação que as originou. O app mobile do cliente não possui tela de cobranças. A tela `/contratos` gerencia apenas modelos `.docx` para geração de documento físico — seu conteúdo e variáveis são tratados em PRD próprio.

### 1.2 Modelo de dados do domínio

Uma **locação** vincula exatamente **um veículo** a **um cliente**. Um cliente pode ter mais de uma locação ativa simultaneamente.

### 1.3 Problema

O módulo de locação atual apresenta cinco lacunas críticas para a operação:

1. **Sem automação de cobrança:** o operador cria cada cobrança manualmente — escalabilidade zero para múltiplos contratos.
2. **Sem periodicidade configurável:** não existe suporte a ciclos semanais ou mensais com dia de vencimento definido.
3. **Sem pro rata:** cobranças de início e fim de locação não são calculadas proporcionalmente, forçando ajuste manual ou cobranças cheias inconsistentes.
4. **Cliente sem visibilidade:** o app mobile não exibe cobranças nem permite pagamento; todo contato financeiro é mediado pelo operador.
5. **Histórico fragmentado:** não é possível visualizar o histórico de cobranças de uma locação específica — só existe uma listagem global.

### 1.4 Resumo Executivo

Refatoração do módulo de locação do GoMoto para:
- Centralizar a criação de locações (via fila ou direta) em tela unificada `/locacoes`.
- Automatizar a geração de cobranças conforme periodicidade contratada (semanal ou mensal, com dia de vencimento configurável).
- Suportar pro rata na primeira e última cobrança, além de cobranças avulsas e descontos com histórico auditável.
- Disponibilizar ao cliente no app mobile a visualização das cobranças por locação.
- Permitir encerramento antecipado com cancelamento automático de cobranças futuras e renovação com recálculo de cobranças.

### 1.5 Por que agora

O sistema está em desenvolvimento ativo, sem dados em produção, sem restrições de retrocompatibilidade. É o momento de estabelecer a estrutura correta antes do primeiro deploy.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Locação** | Registro operacional no sistema que vincula um veículo a um cliente, com periodicidade de cobrança, valor, datas de início/fim e configurações de vencimento. É a entidade central deste módulo. Pode ser do tipo **Rental** ou **Rent-to-Own**. |
| **Rental** | Tipo padrão de locação. O veículo retorna ao operador ao final do contrato. Tem vigência mínima de 3 meses; rescisão dentro desse período gera multa contratual. |
| **Rent-to-Own** | Tipo de locação em que o veículo é transferido ao cliente ao final do período contratado (2 anos). Rescisão antes do cumprimento integral gera multa contratual. |
| **Vigência mínima** | Período mínimo obrigatório de uma locação antes que o encerramento antecipado gere multa. Para Rental: 3 meses. Para Rent-to-Own: 2 anos. |
| **Multa por rescisão** | Valor fixo cobrado do cliente quando a locação é encerrada antes do término da vigência mínima. Não é gerada automaticamente — o operador lança como cobrança avulsa após o alerta do sistema. |
| **Contrato** | Documento físico (`.docx`) gerado a partir dos dados de uma locação, destinado à impressão e assinatura pelo cliente. Não é uma entidade de cobrança. |
| **Ciclo** | Periodicidade de cobrança configurada na locação: **semanal** (7 dias) ou **mensal** (mês calendário). |
| **Dia de vencimento** | Configuração da locação que define em qual dia do ciclo as cobranças vencem. Para ciclo semanal: dia da semana (segunda a domingo). Para ciclo mensal: dia do mês (1 a 28). |
| **Cobrança** | Registro financeiro individual gerado automaticamente pelo sistema conforme o ciclo da locação. Possui valor, data de vencimento e status (`pendente`, `pago`, `vencida`, `cancelada`, `prejuízo`). |
| **Pro rata** | Cálculo proporcional do valor da cobrança para períodos incompletos no início ou no fim de uma locação. Aplica-se à primeira e à última cobrança. |
| **Cobrança cheia** | Cobrança pelo valor integral do ciclo, independente do período real de uso — sem cálculo proporcional. |
| **Baixa** | Ação do operador de registrar manualmente o pagamento de uma cobrança, informando data de pagamento e forma de pagamento. |
| **Fila de espera** | Lista de clientes aguardando disponibilidade de veículo. Uma locação pode ser criada tanto para um cliente na fila quanto para um cliente fora dela. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

- Eliminar a criação manual de cobranças recorrentes, reduzindo o trabalho operacional a zero para contratos em andamento.
- Estabelecer um fluxo de entrada claro: registro único do cliente (com documentos) → fila ou locação direta.
- Disponibilizar visibilidade financeira ao cliente no app mobile, reduzindo contatos com o operador para consultas de cobrança.

### 3.2 Objetivos do usuário

- **Operador:** registrar cliente (com upload de documentos) em um único passo; encaminhá-lo para fila ou locação direta; ter cobranças de ciclo geradas automaticamente; lançar cobranças avulsas; aplicar desconto com motivo preservando valor original; registrar pagamentos manuais; visualizar atrasos e histórico por locação; encerrar locações antecipadamente com cancelamento automático; renovar contratos com recálculo correto de cobranças.
- **Cliente:** visualizar cobranças por locação no app mobile (pendentes, pagas, vencidas); acessar histórico com identificação do veículo.

### 3.3 Métricas de sucesso / KPIs

| Métrica | Alvo |
|---|---|
| Cobranças de ciclo criadas manualmente | 0 (100% geradas automaticamente) |
| Etapas para criar locação após registro do cliente | 1 única operação |
| Cliente visualiza cobranças sem contato com operador | Sim (tela mobile disponível) |

### 3.4 Incluído em V1

1. **Registro unificado do cliente** — cadastro de dados + upload de documentos em um único fluxo; pré-requisito obrigatório antes de fila ou locação. *(Requer ajuste na tela `/clientes` — ver Dependências.)*
2. **Tela `/locacoes`** — substitui `/fila`; centraliza: gestão da fila de espera, criação de locação direta, gestão de locações ativas e encerradas.
3. **Dois fluxos pós-registro** — operador decide: adicionar cliente à fila (se habilitado no tenant) ou criar locação diretamente.
4. **Criação de locação** — tipo (Rental ou Rent-to-Own), ciclo (semanal/mensal), dia de vencimento, valor do ciclo, datas de início/fim, opção de pro rata.
5. **Preview de cobranças** — exibição das cobranças que serão geradas antes da confirmação da criação.
6. **Geração automática de cobranças de ciclo** — geradas no ato de criação da locação, até a data de fim, em operação atômica.
7. **Cobranças avulsas** — lançamento manual vinculado a uma locação ativa (multa, caução, manutenção, outros), com descrição e vencimento livres.
8. **Desconto em cobrança** — valor e motivo informados pelo operador; valor original preservado no histórico; valor final = original − desconto.
9. **Encerramento antecipado** — cobranças futuras (não vencidas) canceladas automaticamente; alerta de cobranças vencidas em aberto; locação encerrada libera veículo.
10. **Renovação de contrato** — recálculo da última cobrança e geração de novas cobranças até nova data de fim.
11. **Baixa manual** — data e forma de pagamento (PIX, dinheiro, cartão de crédito, cartão de débito, transferência).
12. **Listagem de cobranças em atraso** — web, visível ao operador.
13. **Histórico de cobranças por locação** — web (operador) e mobile (cliente).
14. **Tela de cobranças no app mobile** — lista única com placa/modelo do veículo por item; filtro por status; detalhe com valor original, desconto e valor final.

### 3.5 Não Incluído / Não-objetivos (V1)

| Item | Motivo |
|---|---|
| Integração de gateway de pagamento | Outro PRD |
| Geração do contrato `.docx` e variáveis | Outro PRD |
| Desconto automático vinculado ao módulo de manutenção | Outro PRD |
| Emails/notificações automáticas de vencimento | Roadmap separado (Resend) |
| Reajuste automático de valor por índice (IGPM, etc.) | Fora da visão atual |
| Locação com múltiplos veículos por registro | Fora do modelo de domínio |
| App mobile para o operador | Operador usa apenas o web |
| Cobranças avulsas sem locação associada | Toda cobrança tem locação obrigatória |

### 3.6 Telas afetadas

| Tela | Situação |
|---|---|
| `/clientes` | Modificada — adiciona upload de documentos ao registro |
| `/locacoes` | Nova — substitui `/fila` |
| `/cobrancas` | Modificada — adiciona histórico por locação, filtro de atraso, desconto e avulsas |
| Mobile: cobranças | Nova tela no app do cliente |

---

## 4. Stakeholders

Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Como interage | Frequência | Nível técnico |
|---|---|---|---|
| **Operador** | Gerencia toda a operação via web: registra clientes, cria locações, controla fila, lança cobranças, registra pagamentos e encerra contratos. | Diária | Intermediário — familiarizado com o sistema, sem conhecimento técnico de TI |
| **Cliente** | Locatário da moto. Consulta cobranças e histórico financeiro das próprias locações via app mobile. | Eventual (consultas pontuais) | Básico — usuário de smartphone, sem familiaridade com sistemas de gestão |

### 5.2 User Stories

- **US-001** — Como Operador, quero registrar um novo cliente com seus documentos em um único fluxo e, ao finalizar, escolher entre adicioná-lo à fila ou criar uma locação diretamente, para não repetir dados em etapas separadas e manter o processo de entrada ágil.
- **US-002** — Como Operador, quero criar uma locação configurando ciclo (semanal/mensal), dia de vencimento, valor, datas de início/fim e opção de pro rata, para ter todas as cobranças do contrato geradas automaticamente sem nenhuma criação manual.
- **US-003** — Como Operador, quero visualizar um preview das cobranças que serão geradas antes de confirmar a locação, para detectar erros de configuração antes de persistir os dados.
- **US-004** — Como Operador, quero lançar cobranças avulsas (multa, caução, manutenção, outros) vinculadas a uma locação existente, para registrar valores extras fora do ciclo regular com rastreabilidade por locação.
- **US-005** — Como Operador, quero aplicar desconto em uma cobrança informando valor e motivo, com o valor original preservado, para registrar acordos com o cliente (ex.: divisão de custo de troca de óleo) com histórico auditável.
- **US-006** — Como Operador, quero dar baixa em uma cobrança informando data e forma de pagamento, para manter o histórico financeiro preciso e saber quando e como cada cobrança foi paga.
- **US-007** — Como Operador, quero visualizar a lista de cobranças em atraso de todas as locações, para priorizar a cobrança de inadimplentes e agir rapidamente.
- **US-008** — Como Operador, quero visualizar o histórico completo de cobranças de uma locação específica, para ter visibilidade financeira por contrato ao atender um cliente ou auditar pagamentos.
- **US-009** — Como Operador, quero encerrar uma locação antecipadamente com cancelamento automático das cobranças futuras não vencidas, para refletir a devolução do veículo sem precisar cancelar cobrança por cobrança.
- **US-010** — Como Operador, quero renovar um contrato de locação informando nova data de fim, para estender a locação com recálculo correto das cobranças sem recriar a locação do zero.
- **US-011** — Como Cliente, quero visualizar no app mobile uma lista única de todas as minhas cobranças identificando o veículo (pendentes, pagas, vencidas) com valor original, desconto e valor final, para saber exatamente o que devo e o que já paguei sem precisar ligar para o operador.

---

## 6. Fluxos Funcionais

### 6.1 Fluxo Principal — Criar nova locação

**Pré-condição:** cliente já cadastrado no sistema, ou será registrado agora.

**Entrada via cliente existente:**
1. Operador acessa `/locacoes` → "Nova locação".
2. Seleciona cliente já cadastrado na busca.
3. Segue para o passo 5.

**Entrada via novo cliente:**
1. Operador acessa `/clientes` → "Novo cliente".
2. Preenche dados cadastrais e faz upload de documentos.
3. Salva. A partir deste momento o cliente fica disponível para locação ou fila a qualquer momento.
4. Sistema oferece ação imediata: **"Adicionar à fila"** ou **"Criar locação"** (atalho pós-registro).

**Sequência comum:**
5. Operador configura locação: veículo disponível, ciclo (semanal/mensal), dia de vencimento, valor do ciclo, data de início, data de fim, e opção **pro rata** ou **cobrança cheia**.
6. Sistema exibe preview das cobranças que serão geradas (quantidade, valores e vencimentos).
7. Operador confirma.
8. Sistema gera automaticamente todas as cobranças de ciclo. Primeira e última cobranças são proporcionais ao período se pro rata estiver ativo; cobranças intermediárias são pelo valor cheio do ciclo.
9. Locação criada com status **ativa**.

### 6.2 Fluxos Alternativos

**FA1 — Adicionar cliente à fila:**
1. Operador acessa `/locacoes` → aba Fila → "Adicionar à fila".
2. Seleciona cliente cadastrado (ou registra novo conforme F1 passos 1–3).
3. Cliente entra na fila de espera.
4. Quando veículo fica disponível, operador seleciona cliente na fila → abre formulário de locação (passo 5 do F1).
5. Sequência comum do F1 a partir do passo 5; cliente sai da fila e locação fica ativa.

**FA2 — Renovação de contrato:**
1. Operador acessa locação ativa em `/locacoes` → **"Renovar contrato"**.
2. Informa nova data de fim.
3. Sistema verifica o status da última cobrança:
   - **Não paga:** sistema recalcula o período, ajustando a cobrança para cobrir o ciclo completo até o próximo vencimento regular.
   - **Já paga (pro rata):** sistema mantém a cobrança paga e gera uma **cobrança complementar** com o valor da diferença, com data de vencimento igual ao próximo vencimento regular do ciclo.
4. Sistema gera as novas cobranças de ciclo a partir do ponto de renovação até a nova data de fim.
5. Última cobrança do novo período é proporcional ao período se pro rata estiver ativo.
6. Locação mantém status **ativa** com data de fim atualizada.

**FA3 — Baixa manual de cobrança:**
1. Operador acessa a cobrança (via histórico da locação ou lista de atraso).
2. Clica em **"Registrar pagamento"**.
3. Informa data de pagamento e forma de pagamento.
4. Sistema marca cobrança como **paga**.

**FA4 — Cobrança avulsa:**
1. Operador acessa uma locação ativa.
2. Clica em **"Nova cobrança avulsa"**.
3. Preenche: descrição (ex.: "Caução", "Multa por arranhão"), valor e data de vencimento.
4. Sistema cria cobrança vinculada à locação com status **pendente**.

**FA5 — Desconto em cobrança:**
1. Operador acessa uma cobrança (de ciclo ou avulsa).
2. Clica em **"Aplicar desconto"**.
3. Informa valor do desconto e motivo.
4. Sistema preserva valor original; exibe valor final = original − desconto; registra motivo no histórico.

**FA6 — Encerramento antecipado:**
1. Operador acessa locação ativa → **"Encerrar locação"**.
2. Sistema exibe alerta informando quantas cobranças vencidas permanecem abertas para pagamento.
3. Operador confirma.
4. Sistema cancela automaticamente cobranças com vencimento posterior à data de encerramento (status **cancelada**).
5. Cobranças já vencidas (pagas ou em atraso) permanecem intactas.
6. Locação passa para status **encerrada**; veículo fica disponível.

**FA7 — Cliente consulta cobranças no app mobile:**
1. Cliente abre o app e autentica.
2. Acessa **"Minhas Cobranças"**.
3. Sistema exibe lista única de todas as cobranças do cliente, com placa e modelo do veículo em cada item.
4. Cliente filtra por status (todas / pendentes / pagas / vencidas).
5. Cliente toca em uma cobrança: vê valor original, desconto (se houver), valor final, vencimento, status e — se paga — data e forma de pagamento.

### 6.3 Fluxos de Erro

| Situação | Comportamento esperado |
|---|---|
| Criar locação com veículo já ativo em outra locação | Sistema bloqueia: "Veículo já possui locação ativa." |
| Data de fim anterior ou igual à data de início | Sistema bloqueia com mensagem de validação no formulário. |
| Desconto maior que o valor da cobrança | Sistema bloqueia: "Desconto não pode ser maior que o valor da cobrança." |
| Baixa em cobrança já paga | Sistema bloqueia a ação. |
| Renovar locação já encerrada | Opção de renovação indisponível para locações encerradas. |
| Falha de rede ao salvar locação | Operação é atômica: nenhuma cobrança é gerada parcialmente; sistema exibe mensagem de erro. |
| Cliente acessa app sem conexão | Sistema exibe última lista em cache com indicador de ausência de rede. |

---

## 7. Requisitos Funcionais

### Cadastro de cliente
- **RF-001** — O sistema deve permitir upload de documentos do cliente durante o cadastro.
- **RF-002** — Após salvar um novo cliente, o sistema deve oferecer ação imediata de "Adicionar à fila" ou "Criar locação".

### Locações — Criação e configuração
- **RF-003** — O sistema deve permitir criar locação selecionando cliente já cadastrado por busca, a qualquer momento.
- **RF-004** — O formulário de locação deve exigir: veículo, ciclo (semanal ou mensal), dia de vencimento, valor do ciclo, data de início e data de fim.
- **RF-005** — O formulário de locação deve permitir escolher entre **pro rata** e **cobrança cheia**.
- **RF-006** — O sistema deve bloquear criação de locação para veículo que já possui locação ativa.
- **RF-007** — Ao confirmar a criação da locação, o sistema deve gerar automaticamente todas as cobranças de ciclo até a data de fim — em operação atômica (ou gera todas ou não gera nenhuma).
- **RF-008** — Quando pro rata estiver ativo, a primeira cobrança deve ter valor proporcional ao período entre a data de início e o primeiro vencimento.
- **RF-009** — Quando pro rata estiver ativo, a última cobrança deve ter valor proporcional ao período entre o último vencimento e a data de fim.
- **RF-036** — O formulário de criação de locação deve exibir um preview das cobranças que serão geradas (quantidade, valores e vencimentos) antes de o operador confirmar.

### Locações — Tipo e vigência mínima
- **RF-038** — O formulário de locação deve permitir selecionar o tipo: **Rental** (padrão) ou **Rent-to-Own**.
- **RF-039** — Ao encerrar antecipadamente uma locação dentro da vigência mínima do seu tipo, o sistema deve exibir alerta informando que há multa contratual aplicável ao cliente.

### Fila de espera
- **RF-010** — O sistema deve permitir, por configuração do tenant, habilitar ou desabilitar o uso da fila de espera.
- **RF-011** — O sistema deve permitir adicionar cliente cadastrado à fila de espera.
- **RF-012** — O sistema deve permitir criar locação a partir de um cliente na fila, removendo-o da fila ao confirmar.

### Locações — Gestão e encerramento
- **RF-013** — A tela `/locacoes` deve listar locações ativas e encerradas com identificação de cliente e veículo.
- **RF-014** — O operador deve poder encerrar uma locação ativa antecipadamente.
- **RF-015** — Ao encerrar antecipadamente, o sistema deve cancelar automaticamente todas as cobranças com vencimento posterior à data de encerramento, atribuindo-lhes status **cancelada**.
- **RF-016** — Cobranças vencidas (pagas ou em atraso) não devem ser afetadas pelo encerramento antecipado.
- **RF-037** — Ao encerrar uma locação antecipadamente, o sistema deve exibir alerta informando quantas cobranças vencidas permanecem abertas para pagamento.

### Locações — Renovação
- **RF-017** — O operador deve poder renovar uma locação ativa informando nova data de fim.
- **RF-018** — Ao renovar, se a última cobrança ainda não foi paga, o sistema deve recalcular seu valor para cobrir o ciclo completo (até o próximo vencimento regular).
- **RF-019** — Ao renovar, se a última cobrança já foi paga em valor pro rata, o sistema deve gerar cobrança complementar com o valor da diferença, data de vencimento igual ao próximo vencimento regular do ciclo, e descrição gerada automaticamente identificando o período coberto.
- **RF-020** — Ao renovar, o sistema deve gerar as novas cobranças de ciclo do ponto de renovação até a nova data de fim, aplicando pro rata na última se configurado.

### Cobranças — Visualização
- **RF-021** — O sistema deve exibir para cada cobrança: valor original, desconto aplicado (se houver), valor final, data de vencimento e status.
- **RF-022** — O sistema deve exibir o histórico completo de cobranças de uma locação específica.
- **RF-023** — O sistema deve listar cobranças em atraso de todas as locações em visão dedicada ao operador.
- **RF-024** — O operador deve poder filtrar cobranças por status: todas, pendentes, pagas, vencidas, canceladas.

### Cobranças — Baixa manual
- **RF-025** — O operador deve poder registrar pagamento de uma cobrança informando data de pagamento e forma de pagamento.
- **RF-026** — O sistema deve bloquear baixa em cobrança com status já pago.

### Cobranças — Avulsas
- **RF-027** — O operador deve poder criar cobrança avulsa vinculada a uma locação ativa, informando descrição, valor e data de vencimento.
- **RF-028** — Toda cobrança avulsa deve estar obrigatoriamente vinculada a uma locação.

### Cobranças — Desconto
- **RF-029** — O operador deve poder aplicar desconto em qualquer cobrança (de ciclo ou avulsa), informando valor do desconto e motivo.
- **RF-030** — O sistema deve preservar o valor original da cobrança após aplicação de desconto, exibindo ambos.
- **RF-031** — O sistema deve bloquear desconto cujo valor seja maior que o valor original da cobrança.

### App mobile — Cliente
- **RF-032** — O app mobile deve exibir lista única de todas as cobranças do cliente autenticado, identificando placa e modelo do veículo em cada item.
- **RF-033** — O cliente deve poder filtrar suas cobranças por status: todas, pendentes, pagas, vencidas.
- **RF-034** — O cliente deve poder visualizar o detalhe de uma cobrança: valor original, desconto (se houver), valor final, vencimento, status e — se paga — data e forma de pagamento.
- **RF-035** — O app deve exibir a última lista conhecida em cache quando o cliente estiver sem conexão, com indicador de ausência de rede.

---

## 8. Requisitos Não Funcionais

### Performance
- **RNF-001** — A criação de locação com geração de cobranças deve concluir em menos de 3 segundos para contratos com até 104 cobranças (2 anos de ciclo semanal).
- **RNF-002** — A listagem de cobranças de uma locação deve carregar em menos de 2 segundos para históricos com até 200 cobranças.
- **RNF-003** — A tela de cobranças do app mobile deve exibir a lista em menos de 3 segundos em conexão 4G.

### Integridade de dados
- **RNF-004** — A criação de locação e suas cobranças é uma operação indivisível: ou todas as cobranças são salvas ou nenhuma é — sem estado parcial visível ao operador.
- **RNF-005** — Toda baixa, desconto e cobrança avulsa devem registrar o operador responsável e a data/hora da ação para fins de auditoria.

### Segurança e isolamento
- **RNF-006** — Um cliente autenticado no app mobile deve visualizar exclusivamente as cobranças vinculadas às suas próprias locações — nunca dados de outro cliente do mesmo tenant.
- **RNF-007** — Todos os registros criados por este módulo — locações, cobranças de ciclo, cobranças avulsas, descontos, baixas, entradas de fila e documentos de clientes — pertencem exclusivamente ao tenant que os criou e nunca são visíveis ou acessíveis a outro tenant, independente do canal de acesso (web ou mobile).

### Compatibilidade
- **RNF-008** — O app mobile deve funcionar em Android (versão 10+) e iOS (versão 14+), compatível com Expo Go para desenvolvimento e build nativo para distribuição.
- **RNF-009** — A interface web deve funcionar nos navegadores Chrome, Firefox, Edge e Safari nas versões dos últimos 2 anos.

### Privacidade
- **RNF-010** — Dados financeiros do cliente (cobranças, valores, formas de pagamento) não devem ser expostos a terceiros não autorizados, em conformidade com a LGPD.

---

## 9. Regras de Negócio

### Isolamento de dados
- **RN-001** — Todo registro deste módulo (locação, cobrança, entrada de fila, documento) pertence a um único tenant e nunca é visível a outro tenant.

### Locação — Cardinalidade e validade
- **RN-002** — Uma locação vincula exatamente um veículo a exatamente um cliente.
- **RN-003** — Um cliente pode ter mais de uma locação ativa simultaneamente.
- **RN-004** — Um veículo só pode ter uma locação com status **ativa** por vez.
- **RN-005** — A data de fim da locação deve ser estritamente posterior à data de início.

### Vencimento e ciclo
- **RN-006** — Para ciclo semanal, o dia de vencimento é um dia da semana (segunda a domingo).
- **RN-007** — Para ciclo mensal, o dia de vencimento é um inteiro entre 1 e 28. O intervalo 1–28 garante que o dia sempre existe em qualquer mês.

### Geração de cobranças — Pro rata
- **RN-008** — Quando pro rata está ativo, o valor da primeira cobrança é proporcional ao número de dias entre a data de início da locação e o primeiro vencimento, em relação ao comprimento do ciclo completo.
- **RN-009** — Quando pro rata está ativo, o valor da última cobrança é proporcional ao número de dias entre o último vencimento e a data de fim da locação, em relação ao comprimento do ciclo completo.
- **RN-010** — Cobranças intermediárias (nem a primeira nem a última) são sempre geradas pelo valor cheio do ciclo, independente da opção pro rata.
- **RN-011** — Quando cobrança cheia está ativa, todas as cobranças — incluindo a primeira e a última — são geradas pelo valor integral do ciclo.
- **RN-012** — Valores pro rata são arredondados para 2 casas decimais com regra matemática padrão (≥0,005 → sobe).

### Status do ciclo de vida de uma cobrança
- **RN-013** — Uma cobrança nasce com status **pendente**.
- **RN-014** — Uma cobrança é considerada **vencida** quando sua data de vencimento é anterior à data atual e seu status ainda é **pendente**.
- **RN-015** — Apenas cobranças com status **pendente** ou **vencida** podem receber baixa (pagamento).
- **RN-016** — Uma cobrança com status **cancelada** não pode ser paga, editada nem receber desconto.
- **RN-017** — Uma cobrança com status **pago** não pode receber baixa novamente.

### Desconto
- **RN-018** — O valor do desconto não pode ser maior que o valor original da cobrança.
- **RN-019** — O valor final cobrado de uma cobrança é: valor original − desconto. Se não houver desconto, o valor final é igual ao valor original.
- **RN-020** — O valor original da cobrança é imutável após criação — o desconto é registrado separadamente e não altera o valor original.

### Encerramento antecipado
- **RN-021** — Ao encerrar uma locação antecipadamente, toda cobrança com data de vencimento **posterior** à data de encerramento tem seu status alterado para **cancelada**.
- **RN-022** — Cobranças com data de vencimento **anterior ou igual** à data de encerramento não são afetadas pelo encerramento, independente do status atual (pendente, vencida, paga).

### Renovação
- **RN-023** — Somente locações com status **ativa** podem ser renovadas.
- **RN-024** — A nova data de fim informada na renovação deve ser estritamente posterior à data de fim atual da locação.
- **RN-025** — Os limites do ciclo não se alteram com a renovação — o padrão de vencimento regular é preservado. A última cobrança original (truncada/pro rata) tem seu período estendido até o **próximo vencimento regular do ciclo**, tornando-se uma cobrança de ciclo completo.
- **RN-026** — Ao renovar, se a última cobrança ainda não foi paga, seu valor é recalculado para o valor integral do ciclo (período estendido até o próximo vencimento regular).
- **RN-027** — Ao renovar, se a última cobrança já foi paga em valor pro rata, o sistema gera automaticamente uma cobrança complementar cujo valor é: valor do ciclo completo − valor já pago. Essa cobrança recebe descrição gerada pelo sistema identificando o período coberto e data de vencimento igual ao próximo vencimento regular do ciclo.
- **RN-028** — Novas cobranças geradas pela renovação seguem o padrão regular de ciclo. A última cobrança do novo período é proporcional (pro rata) se a opção pro rata estiver ativa na locação. Podem existir duas cobranças pro rata no mesmo contrato renovado: a cobrança complementar da emenda (RN-027) e a última cobrança do novo fim do contrato.
- **RN-032** — A data de vencimento da cobrança complementar gerada na renovação (RN-027) é igual ao próximo vencimento regular do ciclo após a data de fim original da locação.

### Tipo de locação e vigência mínima
- **RN-034** — Para locação do tipo **Rental**, a vigência mínima é de 3 meses a partir da data de início.
- **RN-035** — Para locação do tipo **Rent-to-Own**, a vigência mínima é de 2 anos a partir da data de início.
- **RN-036** — O encerramento antecipado dentro da vigência mínima implica multa contratual de R$ 1.000 ao cliente. O sistema emite alerta ao operador; a multa não é gerada automaticamente — o operador a lança como cobrança avulsa (RF-027).
- **RN-037** — Ao encerrar uma locação do tipo **Rent-to-Own** após o cumprimento integral da vigência mínima (2 anos), o veículo é considerado transferido ao cliente. O sistema registra esse encerramento com status distinto (**transferido**) em vez de **encerrada**.

### Cobrança avulsa
- **RN-029** — Uma cobrança avulsa só pode ser criada para uma locação com status **ativa**.
- **RN-030** — Toda cobrança avulsa deve estar vinculada a uma locação. Não existem cobranças avulsas sem locação associada.

### Fila de espera
- **RN-031** — O uso da fila de espera é configurável por tenant: quando desabilitado, locações são criadas diretamente sem etapa de fila.
- **RN-033** — Um cliente registrado está disponível para ser adicionado à fila ou ter uma locação criada diretamente a qualquer momento, independente de quando foi cadastrado.

---

## 10. Critérios de Aceite

### CA-001 (RF-001)
- **Dado** o operador está no formulário de cadastro de cliente
- **Quando** faz upload de um documento
- **Então** o documento fica associado ao cliente e visível após salvar

### CA-002 (RF-002)
- **Dado** o operador acabou de salvar um novo cliente
- **Quando** a operação conclui
- **Então** o sistema oferece as ações "Adicionar à fila" e "Criar locação"

### CA-003 (RF-003)
- **Dado** o operador acessa "Nova locação" em `/locacoes`
- **Quando** busca cliente pelo nome
- **Então** o sistema exibe o cliente cadastrado para seleção

### CA-004 (RF-004)
- **Dado** o operador está no formulário de locação
- **Quando** tenta confirmar sem preencher campo obrigatório
- **Então** o sistema bloqueia e exibe mensagem de validação identificando o campo

### CA-005 (RF-005)
- **Dado** o operador seleciona "pro rata" no formulário
- **Quando** confirma a locação
- **Então** o sistema gera a primeira e última cobranças com valores proporcionais ao período

### CA-006 (RF-006)
- **Dado** o veículo X possui locação ativa
- **Quando** o operador tenta criar nova locação para o veículo X
- **Então** o sistema bloqueia com "Veículo já possui locação ativa."

### CA-007 (RF-006)
- **Dado** a locação do veículo X foi encerrada
- **Quando** o operador cria nova locação para o veículo X
- **Então** o sistema permite (veículo não tem locação ativa)

### CA-008 (RF-007)
- **Dado** o operador confirma criação de locação semanal de 4 semanas
- **Quando** a operação conclui com sucesso
- **Então** exatamente 4 cobranças são criadas vinculadas à locação

### CA-009 (RF-007)
- **Dado** ocorre falha de rede durante a criação de locação
- **Quando** o sistema detecta o erro
- **Então** nenhuma cobrança é criada e o operador vê mensagem de erro (sem estado parcial)

### CA-010 (RF-008)
- **Dado** locação semanal com vencimento toda segunda-feira começa na quarta-feira e pro rata está ativo
- **Quando** a locação é criada
- **Então** a primeira cobrança tem valor proporcional a 3/7 do valor semanal (arredondado para 2 casas decimais)

### CA-011 (RF-008)
- **Dado** locação semanal começa exatamente na segunda-feira (dia do vencimento) e pro rata está ativo
- **Quando** a locação é criada
- **Então** a primeira cobrança é pelo valor integral do ciclo (período não está truncado)

### CA-012 (RF-009)
- **Dado** locação mensal com vencimento todo dia 5 termina no dia 15 e pro rata está ativo
- **Quando** a locação é criada
- **Então** a última cobrança tem valor proporcional aos dias entre o dia 5 e o dia 15 do mês

### CA-013 (RF-010)
- **Dado** o tenant tem fila de espera desabilitada
- **Quando** o operador acessa `/locacoes`
- **Então** a opção "Adicionar à fila" não está disponível

### CA-014 (RF-011)
- **Dado** o tenant tem fila habilitada e o operador seleciona um cliente cadastrado
- **Quando** clica em "Adicionar à fila"
- **Então** o cliente aparece na lista da fila de espera

### CA-015 (RF-012)
- **Dado** um cliente está na fila de espera
- **Quando** o operador cria locação a partir do cliente na fila e confirma
- **Então** o cliente é removido da fila e a locação é criada com status ativa

### CA-016 (RF-013)
- **Dado** existem locações ativas e encerradas no sistema
- **Quando** o operador acessa `/locacoes`
- **Então** ambas aparecem na listagem com identificação de cliente e veículo

### CA-017 (RF-014, RF-015, RF-016)
- **Dado** locação ativa tem cobranças com vencimentos: ontem (pendente), amanhã (pendente), semana que vem (pendente) e há 3 dias (paga)
- **Quando** o operador encerra a locação hoje e confirma
- **Então** cobranças de amanhã e semana que vem ficam com status **cancelada**; cobrança de ontem permanece pendente/vencida; cobrança paga permanece paga

### CA-018 (RF-017, RF-018)
- **Dado** locação semanal tem data de fim na quarta-feira e a última cobrança (pro rata, não paga) cobre de segunda a quarta
- **Quando** o operador renova o contrato
- **Então** a última cobrança tem valor recalculado para o ciclo completo (segunda a segunda seguinte)

### CA-019 (RF-019)
- **Dado** a última cobrança pro rata (3/7 do valor semanal) já foi paga antes da renovação
- **Quando** o operador renova o contrato
- **Então** o sistema gera cobrança complementar com valor de 4/7 do ciclo, data de vencimento igual ao próximo vencimento regular, e descrição identificando o período coberto

### CA-020 (RF-020)
- **Dado** o operador renova locação com nova data de fim 3 semanas à frente
- **Quando** a operação conclui
- **Então** novas cobranças de ciclo são geradas do ponto de renovação até a nova data de fim

### CA-021 (RF-020, RN-028)
- **Dado** locação foi renovada com pro rata ativo e a última cobrança original já foi paga
- **Quando** cobranças são visualizadas
- **Então** o histórico exibe a cobrança complementar da emenda e a última cobrança do novo período, ambas com valores proporcionais identificados

### CA-022 (RF-021)
- **Dado** cobrança tem valor original R$100 e desconto R$30
- **Quando** o operador visualiza a cobrança
- **Então** o sistema exibe: valor original R$100, desconto R$30, valor final R$70

### CA-023 (RF-022)
- **Dado** operador acessa histórico de uma locação específica
- **Quando** a tela carrega
- **Então** todas as cobranças vinculadas àquela locação são exibidas (ciclo, avulsas e complementares)

### CA-024 (RF-023)
- **Dado** existem cobranças vencidas de múltiplas locações
- **Quando** o operador acessa a lista de atraso
- **Então** apenas cobranças com status **vencida** são exibidas

### CA-025 (RF-024)
- **Dado** o operador seleciona o filtro "canceladas"
- **Quando** o filtro é aplicado
- **Então** apenas cobranças com status **cancelada** são exibidas

### CA-026 (RF-025)
- **Dado** cobrança está com status **pendente**
- **Quando** operador registra pagamento informando data e forma
- **Então** status muda para **pago** e os dados de pagamento ficam registrados

### CA-027 (RF-026)
- **Dado** cobrança está com status **pago**
- **Quando** operador tenta dar baixa novamente
- **Então** o sistema bloqueia a ação

### CA-028 (RF-027)
- **Dado** operador acessa locação ativa e clica em "Nova cobrança avulsa"
- **Quando** preenche descrição, valor e vencimento e confirma
- **Então** cobrança é criada vinculada à locação com status **pendente**

### CA-029 (RF-028)
- **Dado** operador tenta criar cobrança avulsa sem locação associada
- **Quando** tenta confirmar
- **Então** o sistema bloqueia a operação

### CA-030 (RF-029, RF-030)
- **Dado** cobrança tem valor original R$200
- **Quando** operador aplica desconto de R$50 com motivo "50% troca de óleo"
- **Então** valor original R$200 é preservado; desconto R$50 e motivo ficam registrados; valor final exibido é R$150

### CA-031 (RF-031)
- **Dado** cobrança tem valor R$100
- **Quando** operador tenta aplicar desconto de R$150
- **Então** sistema bloqueia: "Desconto não pode ser maior que o valor da cobrança."

### CA-032 (RF-032)
- **Dado** cliente autenticado tem cobranças em locações de duas motos diferentes
- **Quando** acessa "Minhas Cobranças" no app
- **Então** a lista exibe todas as cobranças com placa e modelo do veículo identificados em cada item

### CA-033 (RF-033)
- **Dado** cliente está na tela de cobranças do app
- **Quando** seleciona filtro "pendentes"
- **Então** apenas cobranças com status **pendente** são exibidas

### CA-034 (RF-034)
- **Dado** cobrança tem desconto aplicado
- **Quando** cliente toca na cobrança no app
- **Então** o detalhe exibe valor original, desconto e valor final

### CA-035 (RF-034)
- **Dado** cobrança foi paga pelo operador
- **Quando** cliente toca na cobrança no app
- **Então** o detalhe exibe data e forma de pagamento registrados

### CA-036 (RF-035)
- **Dado** cliente está sem conexão de internet
- **Quando** abre o app
- **Então** a última lista em cache é exibida com indicador de ausência de rede

### CA-037 (RF-036)
- **Dado** o operador preencheu todos os campos do formulário de locação
- **Quando** antes de confirmar
- **Então** o sistema exibe lista com todas as cobranças que serão geradas (quantidade, valor e data de vencimento de cada uma)

### CA-038 (RF-037)
- **Dado** locação ativa tem 2 cobranças vencidas e 3 cobranças futuras
- **Quando** o operador clica em "Encerrar locação"
- **Então** o sistema exibe alerta: "2 cobranças vencidas permanecem abertas para pagamento." antes de confirmar o encerramento

### CA-039 (RF-038)
- **Dado** o operador está no formulário de locação e seleciona o tipo **Rent-to-Own**
- **Quando** informa a data de início
- **Então** o sistema pré-calcula e sugere a data de fim para exatamente 2 anos após o início

### CA-040 (RF-039, RN-036)
- **Dado** locação do tipo **Rental** tem 2 meses de vigência (vigência mínima = 3 meses)
- **Quando** o operador clica em "Encerrar locação"
- **Então** o sistema exibe alerta: "Esta locação está dentro da vigência mínima. Rescisão antecipada implica multa contratual de R$ 1.000 ao cliente." antes de confirmar o encerramento

### CA-041 (RN-037)
- **Dado** locação do tipo **Rent-to-Own** tem exatamente 2 anos de vigência cumpridos e o operador encerra
- **Quando** confirma o encerramento
- **Então** a locação é registrada com status **transferido** (e não **encerrada**) e o veículo fica disponível

---

## 11. Dependências e Riscos

### 11.1 Dependências

#### PRDs relacionados

| PRD / Item | Relação |
|---|---|
| PRD 0003 — Manutenção preventiva (concluído) | Futuro PRD integrará desconto automático na cobrança a partir do módulo de manutenção. Este PRD deixa o desconto manual como base para essa automação. |
| PRD a criar — Gateway de pagamento | Definirá como o cliente paga via app mobile. A tela de cobranças mobile deste PRD já reserva o ponto de integração. |
| PRD a criar — Geração de contrato `.docx` | Definirá quais variáveis da locação alimentam o documento para assinatura. Sem impacto no escopo deste PRD. |
| PRD a criar — Notificações / emails | Cobrirá alertas de vencimento por Resend. Sem impacto no escopo deste PRD. |

#### ADRs existentes

| ADR | Relevância |
|---|---|
| ADR 0002 — Padrão canônico de tela (Server Actions + hooks de leitura) | Toda tela nova (`/locacoes`) e modificada (`/cobrancas`) deve seguir esse padrão. |

#### ADRs a criar

| Decisão | Motivo |
|---|---|
| **Geração de cobranças: upfront vs. cron** | Este PRD adota geração no ato de criação da locação (upfront). Para contratos longos (ex.: 2 anos semanais = 104 cobranças), essa decisão tem implicações de performance e atomicidade que merecem ser documentadas. Será criada ADR em `obsidian-notes/decisions/`. |
| **Auth mobile + tenant scope** | O app mobile expõe dados financeiros do cliente. A Fase 5 da arquitetura trata multi-tenancy completo; esta decisão deve ser formalizada em ADR antes do release mobile externo. |

#### Dependências de módulos existentes

| Módulo | O que muda |
|---|---|
| `/clientes` (web) | Estender para suportar upload de documentos no cadastro. |
| `/fila` (web) | Substituída por `/locacoes`. Fluxos existentes (swap de posição, auditoria de movimentação) migram para a nova tela. |
| `@gomoto/core` | Novas regras puras: cálculo pro rata, geração de ciclo de cobranças, validação de dia de vencimento. |
| App mobile (`@gomoto/mobile`) | Nova tela de cobranças do cliente. |

### 11.2 Riscos

| Risco | Categoria | Probabilidade | Impacto | Mitigação |
|---|---|---|---|---|
| Cálculo pro rata com edge cases (início no dia do vencimento, meses curtos) gera cobranças incorretas | Produto | Média | Alto | Cobrir todos os edge cases com testes unitários em `@gomoto/core` antes de qualquer UI |
| Operador cria locação com configuração errada (valor ou dia incorreto) e todas as cobranças são geradas com erro | Produto | Média | Alto | Preview de cobranças (RF-036) antes da confirmação |
| Operador encerra locação sem perceber que cobranças vencidas permanecem abertas | Produto | Média | Médio | Alerta no encerramento (RF-037) listando cobranças vencidas em aberto |
| Geração atômica de 104+ cobranças atinge timeout do banco | Técnico | Baixa | Médio | Definir limite máximo ou usar transação com timeout explícito — detalhe na ADR de geração upfront |
| Cliente no mobile acessa cobranças de outro tenant por falha de RLS | Técnico | Muito baixa | Crítico | RLS e auth com tenant scope devem estar prontos e testados antes do release mobile externo |
| Cache offline do mobile exibe cobranças desatualizadas após baixa registrada pelo operador | Técnico | Alta | Baixo | Indicador visual de "última atualização" e refresh automático ao reconectar |
| Migração dos dados existentes de `/fila` para o novo modelo de `/locacoes` gera inconsistência | Dados | Média | Médio | Sistema em desenvolvimento — `pnpm db:reset` com novo seed cobre a migração |

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

Nenhuma questão aberta — pronto para spec.

| ID | Decisão tomada |
|---|---|
| QA-01 | Pro rata arredonda para 2 casas decimais com regra matemática padrão (≥0,005 → sobe). Incorporado em RN-012. |
| QA-02 | Preview de cobranças virou RF-036 e CA-037. |
| QA-03 | Alerta de cobranças vencidas no encerramento virou RF-037 e CA-038. |
| QA-04 | Data de vencimento da cobrança complementar = próximo vencimento regular do ciclo. Incorporado em RN-032 e RF-019. |
| QA-05 *(v1.1)* | Tipos de locação: `rental` (padrão) e `rent_to_own` (renomeia `loyalty`). Vigência mínima mantida: 3 meses (Rental) e 2 anos (Rent-to-Own). Multa por rescisão = R$ 1.000, lançada manualmente como avulsa. Incorporado em RN-034–RN-037, RF-038, RF-039, CA-039–CA-041. |
| QA-06 *(v1.1)* | Status adicional na locação Rent-to-Own concluída: `transferred` (em vez de `closed`). Incorporado em RN-037, CA-041. |

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 vazia ou explicitamente adiada)
- [x] Todos os RFs têm ao menos 1 CA correspondente
- [x] Todos os CAs apontam para um RF ou RN
- [x] Personas identificadas e cada uma com ≥1 US
- [x] Fluxos principais, alternativos e de erro documentados
- [x] Dependências e riscos mapeados
- [x] Frontmatter completo (sem campos por preencher)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica (SQL, paths, pacotes, libs)

**Aprovado por:** Alan em 2026-06-24
**Emenda v1.1 aprovada por:** Alan em 2026-06-24 (tipos de locação, vigência mínima, multa por rescisão — RF-038, RF-039, RN-034–RN-037, CA-039–CA-041)
