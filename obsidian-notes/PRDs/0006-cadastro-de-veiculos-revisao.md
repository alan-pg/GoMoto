---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-06-30
adr: "[[decisions/000X-historico-de-status-e-slots-de-fotos]]"
related:
  - "[[Telas/Motos]]"
  - "[[Banco de Dados]]"
  - "[[Fluxos de Negócio]]"
  - "[[PRDs/0002-cadastro-de-motos-documentacao-e-tco]]"
tags:
  - prd
  - cadastro-de-veiculos-revisao
  - veiculos
---

# PRD 0006 — Revisão do Módulo de Veículos

> ✅ **Status: aprovado** em 2026-06-30. Estende o PRD 0002 com ciclo de vida completo de status (7 estados + histórico de auditoria), rastreador GPS, seguro como dado de cadastro, galeria de fotos estruturada em slots nomeados e redesenho das telas de listagem, detalhe e edição. Próximo passo: criar ADR e implementar migration de histórico de status + novos campos.

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto possui um cadastro de veículos funcional, resultado do PRD 0002 (implementado). O cadastro atual cobre identificação técnica, documentação (CRV/CRLV), obrigações anuais (IPVA, licenciamento) e histórico de manutenção. Entretanto, o módulo apresenta lacunas que impedem uma gestão completa da frota:

1. **Ciclo de vida do veículo incompleto.** O status atual contempla apenas quatro estados (`available`, `rented`, `maintenance`, `inactive`), insuficientes para representar situações reais como reserva, sinistro, venda e desativação. Não há registro de transições: quem mudou o status, quando e de qual estado anterior.

2. **Ausência de rastreamento físico.** Veículos com rastreador GPS instalado não têm campo para registrar o equipamento (marca, modelo, IMEI). A informação fica em anotações externas ou não é registrada.

3. **Seguro facultativo sem visibilidade.** O PRD 0002 modelou seguro como obrigação anual. Falta um registro imediato no cadastro do veículo indicando se ele está segurado e qual o custo mensal da apólice.

4. **Fotos do veículo sem gerenciamento estruturado.** O cadastro permite uma única foto de entrada. Não há galeria padronizada para registrar o estado visual do veículo em diferentes ângulos.

5. **Experiência de tela fragmentada.** Não existe tela dedicada de detalhe por veículo com áreas de informação organizadas. Listagem, filtros e navegação para detalhe/edição precisam de redesenho.

### 1.2 Resumo executivo

Este PRD define a **revisão do módulo de veículos**, transformando o cadastro atual em um módulo completo de gestão de frota. A entrega inclui:

- Nova tela de listagem com filtros expandidos e foto principal do veículo
- Tela dedicada de detalhe por veículo com áreas de informação separadas
- Formulário de cadastro/edição em seções visíveis simultaneamente (sem wizard)
- Ciclo de vida com 7 estados e trilha de auditoria imutável de mudanças de status
- Seção de rastreador GPS (marca, modelo, IMEI)
- Seção de seguro (possui/não possui, valor mensal, vencimento)
- Galeria de fotos em 6 slots nomeados padronizados

### 1.3 Problema central

> O operador não consegue visualizar o estado completo de um veículo em um único lugar — documentos, seguro, rastreador, histórico de status e fotos estão fragmentados ou ausentes — o que gera retrabalho operacional e falta de controle da frota.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Status do veículo** | Estado operacional atual do veículo na frota. Determina disponibilidade e visibilidade em telas de contrato e fila. |
| **Disponível** | Veículo sem contrato ativo, em condições de ser locado. |
| **Locado** | Veículo com contrato de locação ativo vinculado. |
| **Reservado** | Veículo marcado pelo operador como reservado. V1: apenas estado de status, sem vínculo funcional com fila ou cliente específico. |
| **Em manutenção** | Veículo fora de operação por reparo ou revisão programada. |
| **Sinistrado** | Veículo envolvido em acidente, roubo ou perda parcial/total. V1: apenas estado de status, sem fluxo funcional dedicado. |
| **Vendido** | Veículo alienado pela empresa. V1: apenas estado de status. |
| **Desativado** | Veículo retirado da frota por decisão administrativa. V1: apenas estado de status. |
| **Histórico de status** | Registro cronológico de cada mudança de status do veículo: status anterior, status novo, data/hora e usuário responsável. Finalidade: auditoria interna. |
| **Rastreador** | Equipamento GPS instalado fisicamente no veículo, identificado por IMEI. O GoMoto não integra com a plataforma do rastreador em V1 — registra apenas os dados cadastrais do equipamento. |
| **IMEI do rastreador** | Código único de 15 dígitos que identifica o equipamento rastreador instalado no veículo. |
| **Seguro do veículo** | Campos cadastrais indicando se o veículo possui apólice ativa, o valor mensal e a data de vencimento. Informação de cadastro; contabilização de gastos fica para PRD futuro. |
| **Galeria de fotos** | Conjunto de imagens do veículo em 6 slots nomeados padronizados. Diferente do campo "foto de entrada" único do cadastro anterior. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

| Objetivo | Critério observável |
|---|---|
| Gestão completa do ciclo de vida do veículo | Operador consegue registrar e transitar entre os 7 estados de status com histórico auditável |
| Cadastro organizado e extensível | Formulário estruturado em seções visíveis, cobrindo identificação, aquisição, documentação, rastreador, seguro e fotos |
| Rastreabilidade de equipamentos | Todo veículo com rastreador tem IMEI e dados do equipamento registrados no sistema |
| Visibilidade do seguro | Operador sabe se cada veículo está segurado, o custo mensal e o vencimento da apólice |
| Navegação clara por veículo | Existe tela dedicada por veículo com todas as informações organizadas em áreas separadas |

### 3.2 O que o operador passa a conseguir fazer

- Filtrar e buscar veículos por status e texto livre na listagem; ver foto principal na tabela.
- Navegar para tela dedicada de um veículo e visualizar todas as informações em áreas organizadas.
- Cadastrar e editar veículo com todas as seções visíveis simultaneamente, sem wizard.
- Registrar o tipo de aquisição (zero km, usado, quitado, financiado, consignado, doação, outros) com campos básicos.
- Mudar o status entre 7 estados e consultar histórico completo de transições (de/para, data, usuário).
- Registrar dados do rastreador GPS (marca, modelo, IMEI).
- Informar dados de seguro (possui/não possui, valor mensal, vencimento da apólice).
- Registrar fotos em 6 slots nomeados: principal, frente, lateral esquerda, lateral direita, traseira, painel.

### 3.3 Incluído em V1

1. Tela de listagem com filtros por status e busca textual; exibe foto principal do veículo.
2. Tela dedicada de detalhe por veículo (`/motos/[id]`) com áreas de informação separadas.
3. Formulário de cadastro/edição em seções visíveis (sem wizard).
4. 7 estados de status com trilha de auditoria automática (histórico de status).
5. Seção de rastreador (possui/não possui + marca, modelo, IMEI).
6. Seção de seguro (possui/não possui + valor mensal + vencimento da apólice).
7. Fotos em 6 slots nomeados: principal, frente, lateral esquerda, lateral direita, traseira, painel.
8. Seção de aquisição com tipos: zero km, usado, quitado, financiado, consignado, doação, outros.

### 3.4 Não-objetivos (explicitamente fora de V1)

| Item | Motivo |
|---|---|
| Controle e alertas de documentação vencida | PRD futuro dedicado; este PRD garante apenas que os dados estejam estruturados |
| Integração com plataforma de rastreamento GPS | PRD futuro; V1 registra apenas dados cadastrais do equipamento |
| Contabilização de seguro e obrigações no TCO | PRD futuro; V1 apenas registra os dados |
| Fluxo funcional para status "Reservado", "Sinistrado", "Vendido" ou "Desativado" | V1: estados puros, sem lógica vinculada |
| Alertas automáticos (push, email, dashboard) | PRD futuro |
| OCR ou integração DETRAN | Fora de visão do produto |
| App mobile para gestão de frota | Escopo exclusivo da aplicação web |

### 3.5 Telas impactadas

| Tela | Tipo de mudança |
|---|---|
| `/motos` (listagem) | Refatoração: filtros expandidos, foto principal, layout revisado |
| `/motos/[id]` (detalhe) | **Nova** tela dedicada por veículo |
| `/motos/[id]/editar` (edição) | **Nova** tela de edição com formulário em seções |
| `/motos/novo` (criação) | Refatoração: de wizard para formulário em seções |

---

## 4. Stakeholders

Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Descrição | Frequência de uso | Nível técnico |
|---|---|---|---|
| **Operador de Frota** | Qualquer usuário autenticado do tenant. Inclui dono e funcionários. Sem distinção de papel para este módulo em V1. | Diária (listagem, status) / Eventual (cadastro, fotos, rastreador) | Básico — usuário de sistema web simples |

### 5.2 User Stories

| # | Como | Quero | Para |
|---|---|---|---|
| US-001 | Operador de Frota | listar e filtrar veículos por status e busca textual | localizar rapidamente um veículo específico |
| US-002 | Operador de Frota | visualizar todos os dados de um veículo em uma tela dedicada com áreas organizadas | ter visão completa do ativo sem navegar por múltiplas telas |
| US-003 | Operador de Frota | cadastrar e editar um veículo com todas as seções visíveis simultaneamente | manter o cadastro completo e atualizado de forma eficiente |
| US-004 | Operador de Frota | mudar o status do veículo e consultar o histórico de transições (de/para, data, usuário) | saber o estado atual e rastrear quem fez cada mudança para fins de auditoria |
| US-005 | Operador de Frota | registrar marca, modelo e IMEI do rastreador instalado no veículo | saber qual equipamento está em qual moto |
| US-006 | Operador de Frota | registrar se o veículo possui seguro, o valor mensal e o vencimento da apólice | ter visibilidade imediata do custo e validade do seguro de cada veículo |
| US-007 | Operador de Frota | registrar fotos do veículo em 6 slots nomeados (principal, frente, lateral esquerda, lateral direita, traseira, painel) | documentar o estado visual do veículo de forma padronizada |

---

## 6. Fluxos Funcionais

### 6.1 Fluxo Principal — Cadastrar veículo novo

```
[Operador] /motos → "Novo veículo" → /motos/novo

  Formulário em seções visíveis:
  ┌ Identificação: placa, RENAVAM, marca, modelo, ano fab/mod,
  │   cor, combustível, chassi, cilindrada, KM de entrada, observações
  ├ Aquisição: tipo (zero km/usado/quitado/financiado/consignado/
  │   doação/outros), data da compra, valor pago, valor FIPE
  │   → se tipo ≠ zero km: dono anterior + CPF do vendedor
  ├ Documento: proprietário registrado (nome + CPF/CNPJ), UF,
  │   nº CRV, transferência feita?, data da transferência
  ├ Status: seletor — Disponível (default) / Reservado /
  │   Em manutenção / Sinistrado
  │   (Locado, Vendido e Desativado não aparecem na criação)
  ├ Rastreador: possui rastreador? → se sim: marca, modelo, IMEI
  ├ Seguro: possui seguro? → se sim: valor mensal, vencimento
  └ Fotos: 6 slots — principal, frente, lateral esquerda,
      lateral direita, traseira, painel

[Operador] → "Salvar"
[Sistema]
  1. Valida campos obrigatórios (placa, RENAVAM, marca, modelo)
  2. Verifica placa duplicada no tenant
  3. Persiste veículo
  4. Registra 1ª entrada no histórico de status (status inicial + usuário + data)
  5. Faz upload das fotos preenchidas
  6. Redireciona para /motos/[id]

[Resultado] Veículo aparece na listagem; foto principal exibida na linha da tabela.
```

### 6.2 Fluxo Alternativo — Visualizar detalhe do veículo

```
[Operador] /motos → clica no veículo → /motos/[id]

Áreas da tela de detalhe:
  • Identificação   • Aquisição   • Documento
  • Rastreador      • Seguro      • Fotos (grade 6 slots)
  • Documentação anual (PRD 0002)
  • Manutenção (existente)
  • Status
      └ Badge do status atual
      └ Histórico: tabela [de | para | data/hora | usuário]
        ordenado do mais recente para o mais antigo
      └ Ações contextuais:
          — Se status ≠ Locado, Vendido e Desativado:
              botões "Vender" e "Desativar"
          — Se status = Vendido ou Desativado:
              botão "Reativar"
          — Se status = Locado:
              botões "Vender" e "Desativar" ausentes

[Operador] → "Editar" → /motos/[id]/editar
```

### 6.3 Fluxo Alternativo — Editar veículo

```
[Operador] /motos/[id] → "Editar" → /motos/[id]/editar

  Formulário idêntico ao de criação, pré-preenchido.
  Campos editáveis: todos exceto KM de entrada (imutável).
  Status editável via seletor: Disponível / Reservado /
    Em manutenção / Sinistrado
  → Se veículo está Locado: seletor de status exibido como
    somente-leitura até encerramento do contrato
  (Locado, Vendido e Desativado não aparecem no seletor)

[Operador] → "Salvar"
[Sistema]
  1. Valida campos obrigatórios
  2. Se status mudou: registra no histórico (de → para, usuário, data)
  3. Persiste alterações e fotos modificadas
  4. Redireciona para /motos/[id]
```

### 6.4 Fluxo Alternativo — Vender ou Desativar veículo

```
[Operador] /motos/[id] → área Status → "Vender" ou "Desativar"
  → Modal de confirmação:
    "Este veículo será marcado como [Vendido/Desativado].
     Esta ação pode ser revertida com Reativar. Confirmar?"
  → "Cancelar": fecha modal, sem alteração
  → "Confirmar":
      [Sistema]
      1. Atualiza status do veículo
      2. Registra no histórico: status anterior → Vendido/Desativado,
         data/hora, usuário
      3. Veículo some do filtro padrão da listagem

Pré-condição: status ≠ Locado (botões ausentes se veículo está locado).
```

### 6.5 Fluxo Alternativo — Reativar veículo

```
[Operador] /motos/[id] → área Status → "Reativar"
  → Sem confirmação extra (ação não-destrutiva)
[Sistema]
  1. Atualiza status para Disponível
  2. Registra no histórico: Vendido/Desativado → Disponível, usuário, data
```

### 6.6 Fluxo Automático — Locação e encerramento de contrato

```
Ao criar contrato de locação vinculado ao veículo:
[Sistema]
  1. Atualiza status do veículo para Locado
  2. Registra no histórico: status anterior → Locado,
     data/hora, usuário que criou o contrato

Ao encerrar contrato (encerramento ou cancelamento):
[Sistema]
  1. Atualiza status do veículo para Disponível
  2. Registra no histórico: Locado → Disponível,
     data/hora, usuário que encerrou o contrato
```

### 6.7 Fluxos de Erro

| Situação | Comportamento |
|---|---|
| Placa já cadastrada no tenant | Mensagem inline: "Esta placa já está cadastrada." Bloqueia submissão. |
| Campos obrigatórios em branco | Mensagem inline por campo. Bloqueia submissão. |
| IMEI com formato inválido (≠ 15 dígitos numéricos) | Mensagem inline: "IMEI deve ter 15 dígitos." Bloqueia submissão. |
| Upload de foto inválida (formato ou tamanho) | Mensagem inline no slot: "Use JPG, PNG ou WEBP até 5MB." Slot mantém foto anterior se houver. |
| Tentativa de Vender/Desativar veículo Locado | Botões "Vender" e "Desativar" não são exibidos. Ação bloqueada na regra de negócio. |
| Falha de rede ao salvar | Toast de erro. Formulário mantém dados preenchidos. |
| Falha ao mudar status (Vender/Desativar/Reativar) | Modal exibe erro. Status não é alterado. Histórico não registra a tentativa. |

---

## 7. Requisitos Funcionais

### Listagem de veículos

- **RF-001** — O sistema exibe a lista de veículos do tenant com paginação ou scroll infinito, ordenada por data de criação decrescente.
- **RF-002** — O operador pode filtrar veículos por status usando pílulas de seleção. Cada pílula exibe o contador dinâmico de veículos naquele estado.
- **RF-003** — O filtro padrão da listagem exibe apenas veículos com status Disponível, Locado, Reservado, Em manutenção e Sinistrado. Vendido e Desativado só aparecem quando o operador seleciona explicitamente esses filtros.
- **RF-004** — O operador pode buscar veículos por texto livre (placa, marca, modelo). A busca é aplicada sobre o filtro de status ativo.
- **RF-005** — A listagem exibe a foto do slot "principal" do veículo. Quando não há foto principal cadastrada, exibe placeholder padrão.

### Tela de detalhe

- **RF-006** — A tela de detalhe do veículo (`/motos/[id]`) exibe as informações em áreas separadas: Identificação, Aquisição, Documento, Status, Rastreador, Seguro, Fotos, Documentação anual e Manutenção.
- **RF-007** — A área de Status exibe o badge do status atual e uma tabela de histórico com as colunas: status anterior, status novo, data/hora e usuário responsável, ordenada da mais recente para a mais antiga.
- **RF-008** — A área de Status exibe o botão "Vender" e o botão "Desativar" quando o status atual for diferente de Locado, Vendido e Desativado.
- **RF-009** — A área de Status exibe o botão "Reativar" quando o status atual for Vendido ou Desativado.
- **RF-010** — Quando o status for Locado, os botões "Vender", "Desativar" e "Reativar" não são exibidos.

### Cadastro e edição

- **RF-011** — O formulário de cadastro e edição de veículo apresenta todas as seções visíveis simultaneamente, sem wizard. As seções são: Identificação, Aquisição, Documento, Status, Rastreador, Seguro e Fotos.
- **RF-012** — Os campos obrigatórios no cadastro são: placa, RENAVAM, marca e modelo. Os demais campos são opcionais.
- **RF-013** — O sistema rejeita o cadastro de veículo com placa já existente no mesmo tenant e exibe mensagem de erro inline no campo.
- **RF-014** — A seção de Aquisição exibe os campos "dono anterior" e "CPF do vendedor" apenas quando o tipo de aquisição for diferente de "zero km".
- **RF-015** — O campo KM de entrada é exibido apenas no cadastro e é imutável após a criação do veículo.
- **RF-016** — O formulário de edição permite alterar o status entre Disponível, Reservado, Em manutenção e Sinistrado. Os status Locado, Vendido e Desativado não aparecem no seletor. Quando o veículo está com status Locado, o seletor de status é exibido como somente-leitura (bloqueado) até que o contrato seja encerrado.
- **RF-017** — Toda alteração de status — seja pelo formulário de edição, pelas ações Vender/Desativar/Reativar ou automaticamente via contrato — gera um registro no histórico contendo: status anterior, status novo, data/hora e usuário responsável.

### Mudança de status — ações da tela de detalhe

- **RF-018** — Ao acionar "Vender" ou "Desativar", o sistema exibe modal de confirmação antes de executar a ação.
- **RF-019** — Ao confirmar "Vender", o status do veículo é atualizado para Vendido e uma entrada é registrada no histórico.
- **RF-020** — Ao confirmar "Desativar", o status do veículo é atualizado para Desativado e uma entrada é registrada no histórico.
- **RF-021** — Ao acionar "Reativar", o status do veículo é atualizado para Disponível sem confirmação adicional e uma entrada é registrada no histórico.

### Mudança de status — automático via contrato

- **RF-022** — Ao criar um contrato de locação vinculado a um veículo, o sistema atualiza automaticamente o status do veículo para Locado e registra a transição no histórico com o usuário que criou o contrato.
- **RF-023** — Ao encerrar ou cancelar um contrato de locação, o sistema atualiza automaticamente o status do veículo para Disponível e registra a transição no histórico com o usuário que encerrou o contrato.

### Rastreador

- **RF-024** — A seção de Rastreador permite indicar se o veículo possui rastreador. Quando positivo, exibe os campos: marca, modelo e IMEI.
- **RF-025** — O sistema valida que o IMEI possui exatamente 15 dígitos numéricos e exibe mensagem de erro inline caso contrário.

### Seguro

- **RF-026** — A seção de Seguro permite indicar se o veículo possui seguro ativo. Quando positivo, exibe os campos: valor mensal (R$) e data de vencimento da apólice.

### Fotos

- **RF-027** — A seção de Fotos oferece 6 slots nomeados: principal, frente, lateral esquerda, lateral direita, traseira e painel. Cada slot aceita uma imagem. Todos os slots são opcionais.
- **RF-028** — O sistema aceita imagens nos formatos JPG, PNG e WEBP com tamanho máximo de 5MB por slot. Arquivo inválido exibe mensagem de erro inline no slot sem remover imagem anterior.
- **RF-029** — A foto do slot "principal" é exibida na listagem de veículos.

---

## 8. Requisitos Não Funcionais

### Performance

- **RNF-001** — A listagem de veículos deve carregar e renderizar em menos de 2 segundos para frotas de até 200 veículos.
- **RNF-002** — O upload de cada foto deve exibir feedback visual de progresso. O slot deve confirmar o upload concluído em menos de 10 segundos para arquivos de até 5MB em conexão banda larga padrão.
- **RNF-003** — A tela de detalhe do veículo deve carregar todas as áreas em menos de 3 segundos.

### Segurança e isolamento

- **RNF-004** — Apenas usuários autenticados e pertencentes ao tenant têm acesso aos dados de veículos. Dados de um tenant nunca são visíveis a outro.
- **RNF-005** — Fotos e documentos armazenados em storage são acessíveis apenas por usuários autenticados do tenant proprietário (URLs assinadas com expiração).

### Compatibilidade

- **RNF-006** — A interface deve funcionar corretamente nos navegadores Chrome, Firefox, Edge e Safari nas duas últimas versões estáveis.
- **RNF-007** — A tela de listagem e a tela de detalhe devem ser utilizáveis em telas a partir de 1024px de largura. Formulários podem ter scroll vertical em telas menores.

### Privacidade e dados

- **RNF-008** — Dados de proprietário registrado (nome e CPF/CNPJ) e de dono anterior são tratados como dados pessoais. O sistema deve permitir a exclusão ou anonimização desses campos mediante solicitação, sem excluir o registro do veículo.

### Confiabilidade

- **RNF-009** — Falha no upload de uma foto não deve bloquear o salvamento dos demais dados do veículo. O sistema deve salvar os dados textuais e informar quais fotos não foram enviadas para nova tentativa.

---

## 9. Regras de Negócio

### Status e ciclo de vida

- **RN-001** — Um veículo com status Locado não pode ter seu status alterado para Vendido ou Desativado enquanto houver contrato ativo.
- **RN-002** — O status Locado só pode ser atribuído ou removido automaticamente pelo sistema como consequência de criação ou encerramento de contrato. Nenhum operador pode definir ou remover o status Locado manualmente.
- **RN-003** — Os status Vendido e Desativado só podem ser atribuídos via ações dedicadas na tela de detalhe do veículo. O formulário de edição não oferece esses estados como opção.
- **RN-004** — A ação Reativar sempre transiciona o veículo para Disponível, independentemente do estado anterior a Vendido ou Desativado.
- **RN-005** — Todo veículo possui exatamente um status ativo em qualquer momento.

### Histórico de status

- **RN-006** — Toda mudança de status — seja manual, via ação dedicada ou automática via contrato — gera obrigatoriamente um registro no histórico contendo: status anterior, status novo, data/hora e identificação do usuário responsável. Não existe mudança de status sem registro correspondente no histórico.
- **RN-007** — O histórico de status é imutável. Nenhum usuário pode editar ou excluir registros do histórico.
- **RN-008** — O cadastro de um novo veículo gera o primeiro registro no histórico, com o status inicial definido na criação e o usuário que realizou o cadastro.

### Identificação e unicidade

- **RN-009** — A placa de um veículo é única dentro do mesmo tenant. O mesmo número de placa pode existir em tenants distintos.
- **RN-010** — O campo KM de entrada registra a quilometragem do veículo no momento do cadastro e é imutável após a criação.

### Aquisição

- **RN-011** — Os dados de dono anterior (nome e CPF/CNPJ do vendedor) são aplicáveis somente quando o tipo de aquisição for diferente de "zero km". Para veículos zero km, esses campos não existem no contexto daquela aquisição.

### Rastreador

- **RN-012** — Um veículo pode ter no máximo um rastreador registrado por vez. O upload de dados de novo equipamento substitui os dados do rastreador anterior.

### Fotos

- **RN-013** — Cada slot de foto comporta exatamente uma imagem. O upload de nova imagem em slot já preenchido substitui a anterior.

---

## 10. Critérios de Aceite

### Listagem

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-001 (RF-001) | Tenant tem 3 veículos ativos cadastrados | Operador acessa `/motos` | Sistema exibe os 3 veículos na tabela |
| CA-002 (RF-002) | Tenant tem 2 veículos Disponíveis e 1 Em manutenção | Operador clica na pílula "Em manutenção" | Lista exibe apenas o veículo em manutenção; pílula mostra contador "1" |
| CA-003 (RF-003) | Tenant tem 1 veículo Disponível e 1 Vendido | Operador acessa `/motos` sem selecionar filtro | Apenas o veículo Disponível aparece na lista; o Vendido não é exibido |
| CA-004 (RF-003) | Tenant tem 1 veículo Vendido | Operador seleciona filtro "Vendido" | Veículo Vendido aparece na lista |
| CA-005 (RF-004) | Tenant tem veículos de marcas Honda e Yamaha | Operador digita "honda" no campo de busca | Apenas veículos Honda são exibidos |
| CA-006 (RF-005) | Veículo tem foto no slot "principal" | Operador visualiza a listagem | Foto principal é exibida na coluna correspondente da linha do veículo |
| CA-007 (RF-005) | Veículo não tem foto no slot "principal" | Operador visualiza a listagem | Placeholder padrão é exibido no lugar da foto |

### Tela de detalhe

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-008 (RF-006) | Veículo cadastrado com rastreador e seguro | Operador acessa `/motos/[id]` | Tela exibe todas as áreas: Identificação, Aquisição, Documento, Status, Rastreador, Seguro, Fotos, Documentação anual e Manutenção |
| CA-009 (RF-007) | Veículo teve 3 mudanças de status | Operador visualiza a área Status | Tabela exibe 4 linhas (criação + 3 mudanças), ordenadas da mais recente para a mais antiga, com status anterior, status novo, data/hora e usuário |
| CA-010 (RF-008) | Veículo com status Disponível | Operador visualiza a área Status | Botões "Vender" e "Desativar" são exibidos; botão "Reativar" não é exibido |
| CA-011 (RF-009) | Veículo com status Vendido | Operador visualiza a área Status | Botão "Reativar" é exibido; botões "Vender" e "Desativar" não são exibidos |
| CA-012 (RF-010) | Veículo com status Locado | Operador visualiza a área Status | Botões "Vender", "Desativar" e "Reativar" não são exibidos |

### Cadastro e edição

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-013 (RF-011) | Operador acessa `/motos/novo` | — | Formulário exibe todas as seções visíveis simultaneamente sem paginação ou passos |
| CA-014 (RF-012) | Formulário com placa, RENAVAM, marca e modelo preenchidos | Operador clica em "Salvar" | Veículo é criado com sucesso |
| CA-015 (RF-012) | Formulário com campo "marca" em branco | Operador clica em "Salvar" | Sistema exibe mensagem de erro inline no campo e bloqueia a submissão |
| CA-016 (RF-013) | Tenant já possui veículo com placa "ABC1234" | Operador tenta cadastrar novo veículo com a mesma placa | Sistema exibe mensagem de erro inline: "Esta placa já está cadastrada." Submissão é bloqueada |
| CA-017 (RF-014) | Operador seleciona tipo de aquisição "zero km" | — | Campos "dono anterior" e "CPF do vendedor" não são exibidos |
| CA-018 (RF-014) | Operador seleciona tipo de aquisição "usado" | — | Campos "dono anterior" e "CPF do vendedor" são exibidos |
| CA-019 (RF-015) | Veículo cadastrado com KM de entrada 1500 | Operador acessa `/motos/[id]/editar` | Campo KM de entrada não é exibido ou aparece somente-leitura no formulário de edição |
| CA-020 (RF-016) | Veículo com status Disponível | Operador acessa `/motos/[id]/editar` | Seletor de status exibe as opções: Disponível, Reservado, Em manutenção, Sinistrado |
| CA-021 (RF-016) | Veículo com status Locado | Operador acessa `/motos/[id]/editar` | Seletor de status é exibido como somente-leitura, mostrando "Locado" sem permitir alteração |

### Histórico de status

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-022 (RF-017) | Veículo com status Disponível | Operador edita o veículo e altera status para "Em manutenção" e salva | Uma entrada é adicionada ao histórico: de "Disponível", para "Em manutenção", com data/hora atual e nome do operador |
| CA-023 (RF-017) | Novo veículo criado com status "Reservado" | — | Histórico contém exatamente uma entrada: status anterior vazio, status novo "Reservado", com data/hora de criação e usuário que cadastrou |

### Vender, Desativar, Reativar

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-024 (RF-018) | Veículo com status Disponível | Operador clica em "Vender" | Modal de confirmação é exibido antes de qualquer alteração |
| CA-025 (RF-018) | Modal de confirmação aberto | Operador clica em "Cancelar" | Modal fecha; status do veículo permanece inalterado; nenhuma entrada no histórico |
| CA-026 (RF-019) | Veículo com status Disponível | Operador clica em "Vender" e confirma | Status é atualizado para Vendido; histórico registra a transição com usuário e data/hora |
| CA-027 (RF-020) | Veículo com status Em manutenção | Operador clica em "Desativar" e confirma | Status é atualizado para Desativado; histórico registra a transição |
| CA-028 (RF-021) | Veículo com status Desativado | Operador clica em "Reativar" | Status é atualizado para Disponível sem modal de confirmação; histórico registra a transição |

### Automático via contrato

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-029 (RF-022) | Veículo com status Disponível | Contrato de locação vinculado ao veículo é criado | Status do veículo é atualizado para Locado; histórico registra a transição com o usuário que criou o contrato |
| CA-030 (RF-023) | Veículo com status Locado | Contrato de locação é encerrado | Status do veículo é atualizado para Disponível; histórico registra a transição com o usuário que encerrou o contrato |

### Rastreador e seguro

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-031 (RF-024) | Toggle "possui rastreador" está desativado | Operador visualiza a seção Rastreador | Campos marca, modelo e IMEI não são exibidos |
| CA-032 (RF-024) | Operador ativa o toggle "possui rastreador" | — | Campos marca, modelo e IMEI são exibidos |
| CA-033 (RF-025) | Campo IMEI preenchido com "12345" (5 dígitos) | Operador tenta salvar | Sistema exibe mensagem inline: "IMEI deve ter 15 dígitos." Submissão é bloqueada |
| CA-034 (RF-025) | Campo IMEI preenchido com "123456789012345" (15 dígitos) | Operador salva | IMEI é aceito e salvo sem erro |
| CA-035 (RF-026) | Toggle "possui seguro" desativado | Operador visualiza a seção Seguro | Campos valor mensal e vencimento da apólice não são exibidos |
| CA-036 (RF-026) | Operador ativa o toggle "possui seguro" e preenche valor mensal e vencimento | Operador salva | Dados de seguro são persistidos e exibidos na tela de detalhe |

### Fotos

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-037 (RF-027) | Operador acessa a seção Fotos no formulário | — | 6 slots são exibidos com os rótulos: principal, frente, lateral esquerda, lateral direita, traseira, painel |
| CA-038 (RF-027) | Todos os slots de foto estão vazios | Operador salva o veículo | Veículo é salvo com sucesso; ausência de fotos não bloqueia o cadastro |
| CA-039 (RF-028) | Operador tenta fazer upload de arquivo PDF no slot "frente" | — | Sistema exibe mensagem inline: "Use JPG, PNG ou WEBP até 5MB." Upload é rejeitado; slot permanece vazio |
| CA-040 (RF-028) | Slot "traseira" já possui foto; operador faz upload de nova imagem JPG válida | — | Nova imagem substitui a anterior; slot exibe a nova foto |
| CA-041 (RF-029) | Veículo tem foto no slot "principal" | Operador visualiza a listagem | Foto principal é exibida na linha do veículo na tabela |

---

## 11. Dependências e Riscos

### 11.1 Dependências

| Dependência | Tipo | Estado | Detalhe |
|---|---|---|---|
| **PRD 0002** — Cadastro de motos, documentação e TCO | PRD interno | Implementado | Fornece as tabelas `motorcycles`, `vehicle_documents`, `vehicle_obligations` e os campos de aquisição e documento que este PRD estende. |
| **Módulo de Contratos** | Funcionalidade interna | Implementado | RF-022 e RF-023 dependem de que a criação e o encerramento de contratos disparem a mudança automática de status do veículo. Requer integração com a Server Action de contrato existente. |
| **Storage Supabase** | Infraestrutura | Implementado (buckets de PRD 0002) | Fotos dos veículos precisam de bucket próprio (ex.: `vehicle-photos`). Os buckets `vehicle-documents` e `vehicle-obligation-receipts` do PRD 0002 permanecem separados. |
| **Multi-tenancy + RLS** | Infraestrutura | Implementado (Fase 5) | A nova tabela de histórico de status deve seguir o mesmo padrão: `tenant_id NOT NULL`, RLS via `get_user_tenants()`, trigger `updated_at`. |
| **ADR a criar** | Decisão arquitetural | Pendente | Histórico de status como entidade própria e slots nomeados de fotos são decisões não triviais. Criar ADR em `obsidian-notes/decisions/` antes da implementação. |

### 11.2 Riscos

| # | Risco | Categoria | Prob | Impacto | Mitigação |
|---|---|---|---|---|---|
| R-001 | Módulo de Contratos não expõe ponto de extensão limpo para disparar mudança de status, exigindo acoplamento forte ou refatoração | Técnico | Média | Alto | Mapear o fluxo de criação/encerramento de contratos antes de iniciar; definir na Spec o contrato de interface entre os dois módulos |
| R-002 | Veículos existentes no banco não possuem entrada no histórico de status; tela de detalhe exibirá histórico vazio | Dados | Alta | Médio | Migration de bootstrap: inserir registro inicial no histórico para cada veículo existente com status atual, data da migration e usuário de sistema |
| R-003 | Campo `status` atual aceita apenas 4 valores; expansão para 7 requer alteração do CHECK constraint | Técnico | Baixa | Alto | Verificar na migration que nenhum valor fora do novo conjunto existe antes de alterar o constraint; mapear `inactive` → `deactivated` ou manter alias (decisão para a Spec/ADR) |
| R-004 | Operador marca veículo como Vendido ou Desativado por engano; veículo some do filtro padrão | Operacional | Média | Médio | Ação "Reativar" disponível sem suporte técnico; modal de confirmação reduz incidência |
| R-005 | Volume de fotos (6 slots × N veículos) pode gerar custo de storage relevante conforme frota cresce | Técnico | Baixa | Baixo | Para até 200 veículos o custo é negligenciável; definir política de compressão na Spec |

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

| # | Questão | Resolução |
|---|---|---|
| QA-001 | Mapeamento do status `inactive` existente para o novo conjunto de 7 estados | Adiado para Spec/ADR — é decisão técnica de migration |
| QA-002 | Indicação visual de documentos atrasados na listagem (ícone de alerta na linha da tabela) | Adiado para o PRD dedicado de controle de documentação (§3.4, não-objetivo) |

Nenhuma questão aberta bloqueia a aprovação deste PRD.

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 vazia ou explicitamente adiada)
- [x] Todos os RFs têm ao menos 1 CA correspondente (29 RFs, 41 CAs)
- [x] Todos os CAs apontam para um RF
- [x] Personas identificadas e cada uma com ≥1 US
- [x] Fluxos principais, alternativos e de erro documentados
- [x] Dependências e riscos mapeados
- [x] Frontmatter completo (sem `<!-- preencher -->`)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica

**Aprovado por:** Alan em 2026-06-30

---

## Tags

`#prd` `#veiculos` `#cadastro-de-veiculos-revisao`
