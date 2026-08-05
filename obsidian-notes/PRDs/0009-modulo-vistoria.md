---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-07-29
related:
  - "[[Telas/Locações]]"
  - "[[Telas/Motos]]"
  - "[[Telas/Manutenção]]"
  - "[[Banco de Dados]]"
  - "[[Fluxos de Negócio]]"
  - "[[PRDs/0003-manutencao-preventiva]]"
tags:
  - prd
  - vistoria
  - mobile
  - locacoes
---

# PRD 0009 — Módulo de Vistoria: perfis, check-in/check-out e vistoria periódica

> 🟢 **Status: aprovado** em 2026-07-29. Descoberta completa via `/prd-creator`, 12 seções fechadas, validador automático passou. Próximo passo: gerar a Spec técnica (`/spec-generator`).

---

## 1. Visão Geral

### 1.1 Contexto

Hoje o GoMoto não tem processo formal de vistoria de veículo. Motos são entregues e devolvidas ao cliente sem checklist nem fotos padronizadas, e não existe qualquer mecanismo de acompanhamento periódico do estado do veículo ao longo de uma locação. Uma tentativa anterior de resolver isso ficou incompleta: existe uma tabela de checklist de entrega/devolução herdada do schema inicial do projeto, mas nenhuma tela, hook ou Server Action a utiliza hoje — é código morto que antecede o modelo atual de multi-tenant e a própria renomeação de "moto" para "veículo".

O módulo de manutenção, por sua vez, tem hoje um item de plano chamado "Vistoria mensal" — mas esse item é puramente mecânico (categoria de manutenção preventiva por tempo), sem relação com o que este PRD propõe: avaliação do estado físico do veículo (avarias, danos, itens visuais). Essa sobreposição de nome é acidental e será tratada para não confundir os dois domínios.

O projeto está em fase ativa de estruturação — financeiro, manutenção e contratos já passaram por esse tipo de reformulação recentemente — e vistoria é a próxima peça necessária: dar à operação uma forma de registrar e provar o estado do veículo nos momentos que importam (entrega, devolução e, quando configurado, periodicamente durante o contrato).

### 1.2 Resumo executivo

- Cria módulo de vistoria com **perfis configuráveis por tenant** — checklist de itens (ok/não-ok) + lista de fotos obrigatórias/customizáveis (frente, lateral esquerda, lateral direita, etc.) — no mesmo espírito dos planos de manutenção já existentes.
- **Vistoria de check-in** (início da locação) e **check-out** (encerramento da locação): sempre executada pelo administrador/operador do sistema, via tela web ou versão adaptada para mobile (PWA).
- **Vistoria periódica** (ex.: mensal) durante a locação: configurável, com agendamento automático; executada pelo **cliente via app mobile**, com posterior análise do administrativo.
- Remove o código morto relacionado à antiga tentativa de checklist e mantém o módulo de manutenção sem responsabilidade sobre vistoria de estado do veículo.
- Gera evidência auditável (fotos + checklist) para embasar disputas de dano, cobrança de avarias ou acionamento de seguro.

### 1.3 Problema

Sem vistoria formal, a empresa não consegue provar em que estado o veículo foi entregue nem em que estado voltou — o que impede identificar avarias/danos causados durante a locação e cobrar do responsável, ou reunir evidência para sinistro/seguro. Além disso, não há qualquer mecanismo para acompanhar o estado do veículo *durante* contratos longos: um dano ou desgaste anormal só é percebido na devolução, quando já é tarde para atribuir responsabilidade com precisão.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Perfil de Vistoria** | Conjunto nomeado de itens de checklist e itens de imagem, configurável por tenant, usado para padronizar a execução de vistorias. Ex.: "Perfil Padrão Motocicleta", "Perfil Carro Executivo". |
| **Item de Checklist** | Linha de um Perfil de Vistoria com uma descrição (ex.: "Faróis funcionando", "Pneus em bom estado") que, na execução, recebe resposta binária **OK / Não OK** + observação opcional. |
| **Item de Imagem** | Linha de um Perfil de Vistoria que define uma foto a ser capturada na execução, com rótulo customizável (ex.: "Frente", "Lateral Esquerda", "Lateral Direita", "Traseira", "Painel/Odômetro") e indicação se é obrigatória ou opcional. |
| **Vistoria** | Registro concreto de uma execução de um Perfil de Vistoria aplicado a um veículo em um momento específico: data, responsável, respostas de cada item de checklist, fotos enviadas, observações gerais. |
| **Vistoria de Check-in** | Vistoria executada no início de uma locação (entrega do veículo ao cliente). Sempre executada pelo administrador/operador. |
| **Vistoria de Check-out** | Vistoria executada no encerramento de uma locação (devolução do veículo). Sempre executada pelo administrador/operador. |
| **Vistoria Periódica** | Vistoria recorrente executada pelo cliente durante a vigência da locação, quando configurada. |
| **Agendamento de Vistoria Periódica** | Configuração de recorrência (ex.: a cada 30 dias) associada a uma locação, que determina quando uma nova Vistoria Periódica é disponibilizada para o cliente executar. |
| **Análise da Vistoria** | Revisão feita pelo administrativo sobre uma Vistoria Periódica submetida pelo cliente — confirma se o registro é aceitável ou requer ação (ex.: dano identificado). |

> ⚠️ **Nota de desambiguação:** o item "Vistoria mensal" hoje existente como sugestão de item de **plano de manutenção** (categoria mecânica/preventiva por tempo) é um conceito **não relacionado** ao módulo de Vistoria descrito nesta PRD. São domínios distintos que compartilham o nome por acidente histórico. Esta PRD não resolve o item de manutenção — o tratamento dessa ambiguidade (renomear, manter, ou remover) é registrado como questão adiada em §12.1 e como dependência em §11.1.

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

- Fornecer evidência formal (fotos + checklist) do estado do veículo em cada locação, reduzindo disputas sobre responsabilidade por avarias/danos.
- Viabilizar acionamento de seguro/sinistro com registro auditável do estado do veículo.
- Permitir acompanhamento do estado do veículo ao longo de contratos longos via vistoria periódica.

### 3.2 Objetivos do usuário

- Administrador/operador cria Perfis de Vistoria reutilizáveis (checklist + fotos) sem retrabalho a cada locação.
- Administrador vê, num painel único, todas as pendências de vistoria (check-in, check-out, periódicas) de todas as locações — sem precisar entrar locação por locação para saber o que falta.
- Administrador executa vistoria de check-in/check-out tanto a partir dessa lista de pendências quanto diretamente da tela da locação — no computador do escritório ou em dispositivo móvel no pátio, via tela web responsiva.
- Cliente executa vistoria periódica agendada diretamente pelo app mobile, sem depender do administrativo para iniciar.
- Administrador visualiza, num único lugar, a comparação entre a vistoria de check-in e a de check-out de uma locação encerrada.
- Qualquer usuário consegue ver o histórico completo de vistorias (check-in, check-out, periódicas) de um veículo específico, na tela do veículo — não só por locação.

### 3.3 Métricas de sucesso / KPIs

- % de locações (entre as que habilitaram a funcionalidade) com vistoria de check-in **e** check-out registradas.
- % de vistorias periódicas concluídas dentro do prazo configurado (entre as habilitadas).

### 3.4 Incluído em V1

- Criação/edição/arquivamento de Perfis de Vistoria por tenant (itens de checklist + itens de imagem customizáveis, com rótulo e obrigatoriedade próprios).
- Associação de Perfil de Vistoria à locação em **dois vínculos independentes**: (a) **Check-in/Check-out** — presença do vínculo implica ambos pendentes/disponíveis nos respectivos momentos; (b) **Vistoria Periódica** — presença do vínculo + frequência habilita a vistoria periódica do cliente.
- **Check-in nasce pendente automaticamente ao criar a locação** (quando o vínculo (a) existe).
- **Check-out fica disponível automaticamente ao encerrar a locação** (quando o vínculo (a) existe).
- Tela dedicada com lista de pendências: check-ins, check-outs e vistorias periódicas aguardando execução.
- Execução de check-in/check-out pelo administrador a partir dessa lista de pendências **ou** diretamente da tela da locação (duas entradas para a mesma ação).
- Agendamento automático de vistorias periódicas conforme frequência configurada na locação.
- Execução de vistoria periódica **exclusivamente pelo app do cliente**; visível tanto na lista de pendências do administrativo quanto na tela da locação.
- Análise/revisão pelo administrativo das vistorias periódicas submetidas pelo cliente.
- Visualização comparativa (lado a lado) da vistoria de check-in e check-out de uma locação encerrada.
- Histórico de check-in, check-out e vistorias periódicas acessível **na tela do veículo** (agregando todas as locações daquele veículo).
- Remoção do código morto relacionado à antiga tentativa de checklist (tabela legada sem uso).

### 3.5 Não Incluído / Não-objetivos (V1)

- **Assinatura digital do cliente na vistoria** — adiado.
- **Comparação automática de fotos** (diff de imagem / detecção de dano por IA) entre check-in e check-out — fora de escopo; V1 oferece apenas visualização lado a lado manual.
- **Notificação push/e-mail** quando vistoria periódica está pendente ou atrasada — adiado, mesmo padrão de outros módulos (ex. manutenção) que deixaram notificações para um PRD futuro de "automações".
- **Bloqueio operacional** — nem o início nem o encerramento da locação são bloqueados pela ausência de vistoria; a funcionalidade é sempre opcional/configurável por locação (RN-006).
- **Perfil de vistoria vinculado a categoria/modelo de veículo** — fora do V1; o perfil é selecionado livremente na locação, sem regra automática por tipo de veículo.
- **Resolução da colisão de nome com "Vistoria mensal"** (item de manutenção) — fica registrada como dependência a resolver (§11), mas a decisão de renomear/remover não é tomada nesta PRD.

---

## 4. Stakeholders

Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Como interage | Frequência |
|---|---|---|
| **Administrativo** (staff do tenant) | Cria/edita Perfis de Vistoria; associa perfil aos vínculos de check-in/check-out e periódica na locação; executa check-in e check-out (web ou tela responsiva no pátio); analisa vistorias periódicas submetidas pelo cliente; consulta histórico de vistorias no veículo. | Check-in/check-out: alta (toda locação). Criação de perfil: ocasional (setup). Análise de periódica: conforme agendamento configurado. |
| **Cliente** (mobile) | Executa vistoria periódica agendada pelo app; acompanha pendências e histórico das próprias vistorias. | Conforme frequência configurada na locação (ex.: mensal). |

### 5.2 User Stories

- **US-001** — Como Administrativo, quero criar e editar Perfis de Vistoria com itens de checklist e itens de imagem customizáveis, para padronizar o que é verificado em cada vistoria sem redigitar tudo a cada locação.
- **US-002** — Como Administrativo, quero associar um Perfil de Vistoria para check-in/check-out e, opcionalmente, um Perfil de Vistoria Periódica (com frequência) à locação, para adaptar a exigência de vistoria a cada contrato.
- **US-003** — Como Administrativo, quero ver uma lista central de pendências de check-in, check-out e vistorias periódicas, para saber rapidamente o que falta executar sem abrir locação por locação.
- **US-004** — Como Administrativo, quero executar a vistoria de check-in ou check-out pelo celular no pátio (tela web responsiva), para registrar o estado do veículo no exato momento da entrega/devolução.
- **US-005** — Como Administrativo, quero visualizar lado a lado a vistoria de check-in e a de check-out de uma locação encerrada, para identificar rapidamente o que mudou no veículo.
- **US-006** — Como Administrativo, quero analisar (aprovar/rejeitar) uma vistoria periódica submetida pelo cliente, para confirmar que o registro é aceitável ou sinalizar um problema.
- **US-007** — Como Administrativo, quero consultar o histórico completo de vistorias de um veículo específico na tela do veículo, para acompanhar seu estado ao longo de múltiplas locações.
- **US-008** — Como Cliente, quero executar a vistoria periódica agendada pelo app mobile, para cumprir a exigência configurada na minha locação sem depender do administrativo.
- **US-009** — Como Cliente, quero ver o histórico e status das minhas vistorias periódicas no app, para saber se estão pendentes, aprovadas ou precisam de correção.

> Cenário multi-persona: US-008 (Cliente submete) → US-006 (Administrativo analisa) formam o fluxo de aprovação de vistoria periódica.

---

## 6. Fluxos Funcionais

### 6.1 Fluxo principal

```
1. Administrativo cadastra (ou já tem) Perfis de Vistoria — checklist + itens de imagem.
2. Ao criar a locação, Administrativo associa:
   a. Perfil de Vistoria (Check-in/Check-out) — opcional
   b. Perfil de Vistoria Periódica + frequência (ex.: mensal) — opcional, independente de (a)
3. Sistema cria a locação:
   - Se (a) associado → check-in nasce PENDENTE.
   - Se (b) associado → primeira vistoria periódica é agendada conforme frequência.
4. Administrativo executa o check-in (tela de locação ou lista de pendências) na entrega do veículo:
   - Preenche cada item de checklist (OK / Não OK) + observação opcional
   - Captura as fotos exigidas pelo perfil (obrigatórias e opcionais)
   - Salva → vistoria de check-in registrada (responsável, data/hora, respostas, fotos)
5. Ao longo da locação, conforme a frequência configurada, novas vistorias periódicas
   ficam disponíveis para o cliente.
6. Cliente abre o app mobile, vê a vistoria periódica pendente, preenche checklist + fotos, envia.
7. Administrativo analisa a vistoria periódica submetida (lista de pendências) → aprova ou rejeita.
8. Locação é encerrada → se (a) associado, check-out fica DISPONÍVEL.
9. Administrativo executa o check-out (mesma dinâmica do check-in).
10. Administrativo acessa a comparação lado a lado (check-in × check-out) da locação encerrada.
11. Histórico de todas as vistorias (check-in, check-out, periódicas) fica acessível na tela do veículo.
```

### 6.2 Fluxos alternativos

- **Execução via tela responsiva no pátio:** mesmo fluxo de dados do passo 4/9, UI adaptada para uso em celular/tablet pelo Administrativo no momento da entrega/devolução.
- **Locação sem nenhum vínculo de perfil:** nenhuma vistoria é criada; a locação simplesmente não aparece na lista de pendências.
- **Locação só com Perfil de Vistoria Periódica** (sem check-in/check-out): apenas a vistoria periódica é agendada; sem pendência de check-in/check-out.
- **Tenant sem nenhum Perfil de Vistoria cadastrado:** o seletor de perfil na locação aparece vazio — Administrativo simplesmente não associa nada até criar um perfil em outra tela (sem bloqueio, sem atalho obrigatório de criação inline).
- **Vistoria periódica rejeitada:** cliente vê o motivo no app e reenvia com correção → novo registro vinculado ao mesmo agendamento; o registro rejeitado permanece como histórico (mesmo padrão já usado no módulo de manutenção).

### 6.3 Fluxos de erro

- **Cliente sem conexão ao enviar vistoria periódica:** app impede o envio; formulário preenchido permanece na tela até o cliente reconectar e tentar novamente (sem fila offline automática no V1).
- **Falha de upload de foto obrigatória:** vistoria não é submetida enquanto alguma foto obrigatória do perfil não for enviada com sucesso.
- **Concorrência (dois administrativos na mesma vistoria):** última gravação salva vence — aceitável no V1 (pátio único, concorrência rara).
- **Vistoria periódica vence o prazo sem execução:** fica com status "atrasada" (mesmo tratamento visual de manutenção vencida), sem bloquear nenhum outro fluxo da locação.
- **Perfil de Vistoria Periódica associado sem frequência definida:** validação impede salvar a associação — frequência é obrigatória quando esse vínculo existe.

---

## 7. Requisitos Funcionais

- **RF-001** — Administrativo consegue criar um Perfil de Vistoria com nome e descrição.
- **RF-002** — Administrativo consegue adicionar itens de checklist a um Perfil de Vistoria, cada um com um nome descritivo.
- **RF-003** — Administrativo consegue adicionar itens de imagem a um Perfil de Vistoria, cada um com rótulo customizável (ex.: "Frente", "Lateral Esquerda") e indicação de obrigatoriedade.
- **RF-004** — Administrativo consegue editar um Perfil de Vistoria existente (nome, descrição, itens).
- **RF-005** — Administrativo consegue arquivar um Perfil de Vistoria; perfis arquivados deixam de aparecer para novas associações, mas continuam válidos nas vistorias e locações que já os referenciam.
- **RF-006** — Administrativo consegue associar um Perfil de Vistoria à locação para o vínculo de Check-in/Check-out.
- **RF-007** — Administrativo consegue associar um Perfil de Vistoria e uma frequência (ex.: mensal) à locação para o vínculo de Vistoria Periódica, independente do vínculo de Check-in/Check-out.
- **RF-008** — O mesmo Perfil de Vistoria pode ser usado em ambos os vínculos (Check-in/Check-out e Periódica) e em múltiplas locações simultaneamente.
- **RF-009** — Ao criar uma locação com Perfil de Check-in/Check-out associado, o sistema cria automaticamente uma vistoria de check-in com status pendente.
- **RF-010** — Ao encerrar uma locação com Perfil de Check-in/Check-out associado, o sistema disponibiliza automaticamente a vistoria de check-out para execução.
- **RF-011** — Enquanto a locação está ativa e tem Perfil de Vistoria Periódica associado, o sistema agenda automaticamente novas vistorias periódicas conforme a frequência configurada.
- **RF-012** — Administrativo consegue executar uma vistoria de check-in ou check-out pendente, preenchendo cada item de checklist do perfil como "OK" ou "Não OK".
- **RF-013** — Administrativo consegue adicionar uma observação textual a qualquer item de checklist durante a execução.
- **RF-014** — Sistema exige o envio de todas as fotos obrigatórias do perfil antes de permitir salvar a vistoria; fotos opcionais podem ser adicionadas ou omitidas.
- **RF-015** — Sistema registra, em cada vistoria executada, o responsável pela execução e a data/hora.
- **RF-016** — Cliente consegue executar, pelo app mobile, uma vistoria periódica pendente da sua locação, preenchendo checklist e fotos do perfil.
- **RF-017** — Sistema exibe uma lista centralizada com todas as vistorias pendentes (check-in, check-out, periódicas) do tenant.
- **RF-018** — Administrativo consegue iniciar a execução de uma vistoria de check-in/check-out tanto pela lista de pendências quanto diretamente pela tela da locação.
- **RF-019** — Administrativo consegue aprovar uma vistoria periódica submetida pelo cliente.
- **RF-020** — Administrativo consegue rejeitar uma vistoria periódica submetida pelo cliente, informando um motivo obrigatório.
- **RF-021** — Cliente consegue reenviar uma vistoria periódica rejeitada com correção; o registro rejeitado permanece visível como histórico.
- **RF-022** — Administrativo consegue visualizar, lado a lado, a vistoria de check-in e a de check-out de uma locação encerrada.
- **RF-023** — Sistema exibe, na tela do veículo, o histórico de todas as vistorias (check-in, check-out, periódicas) realizadas naquele veículo ao longo de todas as suas locações.

---

## 8. Requisitos Não Funcionais

- **RNF-001** — A tela de execução de vistoria (check-in/check-out) em modo responsivo funciona corretamente em smartphones comuns (Android/iOS, navegador padrão), sem necessidade de zoom horizontal, para uso no pátio de entrada/saída.
- **RNF-002** — O envio de uma vistoria (checklist + fotos) exibe feedback de progresso durante o upload e confirmação clara de sucesso ou falha ao usuário.
- **RNF-003** — Fotos e dados de uma vistoria são visíveis apenas a usuários do tenant ao qual a locação pertence; o cliente só acessa vistorias da própria locação.
- **RNF-004** — O app mobile do cliente suporta os mesmos dispositivos e versões de sistema operacional já suportados pelo restante do aplicativo mobile existente.
- **RNF-005** — Fotos e registros de vistoria permanecem acessíveis por tempo indeterminado (sem expurgo automático), acompanhando o histórico do veículo.

> RNF descreve qualidade percebida pelo usuário ou negócio. Mecanismos técnicos (RLS, índices, cache, compressão de imagem, storage) ficam na Spec.

---

## 9. Regras de Negócio

- **RN-001** — Uma locação só possui vistoria de check-in/check-out se tiver um Perfil de Vistoria (Check-in/Check-out) associado; a ausência do vínculo significa ausência da vistoria, não "vistoria desabilitada".
- **RN-002** — A vistoria de check-in nasce com status pendente automaticamente no momento da criação da locação, quando há Perfil de Check-in/Check-out associado.
- **RN-003** — A vistoria de check-out fica disponível para execução automaticamente no momento em que a locação é encerrada, quando há Perfil de Check-in/Check-out associado.
- **RN-004** — O vínculo de Perfil de Vistoria Periódica é independente do vínculo de Check-in/Check-out; uma locação pode ter um, outro, ambos ou nenhum.
- **RN-005** — Não é possível associar o vínculo de Vistoria Periódica sem definir uma frequência.
- **RN-006** — Nenhuma vistoria (check-in, check-out ou periódica) bloqueia o início ou o encerramento da locação — a ausência de execução não impede o fluxo operacional.
- **RN-007** — Uma vistoria não pode ser salva sem que todas as fotos obrigatórias definidas pelo Perfil de Vistoria tenham sido enviadas.
- **RN-008** — Um Perfil de Vistoria arquivado permanece válido para as vistorias e locações que já o referenciam, mas não pode ser selecionado em novas associações.
- **RN-009** — A vistoria periódica que ultrapassa o prazo da frequência configurada sem ser executada permanece com status "atrasada" até ser concluída — sem expiração automática.
- **RN-010** — Uma vistoria periódica rejeitada permanece no histórico; a correção do cliente gera um novo registro vinculado ao mesmo agendamento, sem substituir o anterior.
- **RN-011** — A vistoria periódica só pode ser executada pelo cliente; check-in e check-out só podem ser executados pelo administrativo.
- **RN-012** — O histórico de vistorias de um veículo agrega os registros de todas as locações desse veículo, não apenas a locação atual.
- **RN-013** — Cada agendamento de vistoria periódica tem no máximo um registro aprovado; resubmissões após rejeição não geram aprovação duplicada.

---

## 10. Critérios de Aceite

### CA-001 (vincula RF-001)
- **Dado** que o Administrativo está na tela de Perfis de Vistoria
- **Quando** ele informa nome e descrição e salva
- **Então** um novo Perfil de Vistoria é criado e listado

### CA-002 (vincula RF-002)
- **Dado** um Perfil de Vistoria em edição
- **Quando** o Administrativo adiciona um item de checklist com nome
- **Então** o item passa a fazer parte do perfil e será exigido em toda vistoria que o usar

### CA-003 (vincula RF-003)
- **Dado** um Perfil de Vistoria em edição
- **Quando** o Administrativo adiciona um item de imagem com rótulo (ex.: "Lateral Esquerda") e marca como obrigatório
- **Então** o item passa a exigir uma foto com esse rótulo em toda vistoria que usar o perfil

### CA-004 (vincula RF-004)
- **Dado** um Perfil de Vistoria já existente
- **Quando** o Administrativo altera nome, descrição ou itens e salva
- **Então** as alterações são refletidas para futuras vistorias que usarem esse perfil

### CA-005 (vincula RF-005, RN-008)
- **Dado** um Perfil de Vistoria já usado em vistorias anteriores
- **Quando** o Administrativo arquiva o perfil
- **Então** ele some da lista de perfis selecionáveis em novas associações, mas as vistorias e locações que já o referenciam continuam acessíveis normalmente

### CA-006 (vincula RF-006, RN-001)
- **Dado** uma locação em criação
- **Quando** o Administrativo associa um Perfil de Vistoria ao vínculo Check-in/Check-out e salva
- **Então** a locação passa a ter esse vínculo registrado

### CA-007 (vincula RF-007, RN-005)
- **Dado** uma locação em criação
- **Quando** o Administrativo tenta associar um Perfil de Vistoria Periódica sem informar a frequência
- **Então** o sistema impede o salvamento e exige a frequência

### CA-008 (vincula RF-008)
- **Dado** um Perfil de Vistoria "Padrão"
- **Quando** ele é associado ao vínculo Check-in/Check-out de uma locação e também ao vínculo Periódica de outra locação
- **Então** ambas as associações funcionam normalmente, sem conflito

### CA-009 (vincula RF-009, RN-002)
- **Dado** uma locação com Perfil de Check-in/Check-out associado
- **Quando** a locação é criada
- **Então** uma vistoria de check-in é criada automaticamente com status pendente

### CA-010 (vincula RF-010, RN-003)
- **Dado** uma locação ativa com Perfil de Check-in/Check-out associado
- **Quando** a locação é encerrada
- **Então** a vistoria de check-out fica disponível para execução

### CA-011 (vincula RF-011)
- **Dado** uma locação ativa com Perfil de Vistoria Periódica associado (frequência mensal)
- **Quando** o ciclo mensal se completa
- **Então** uma nova vistoria periódica é agendada e disponibilizada para o cliente

### CA-012 (vincula RF-012)
- **Dado** uma vistoria de check-in pendente com itens de checklist
- **Quando** o Administrativo marca cada item como "OK" ou "Não OK" e salva
- **Então** as respostas ficam registradas na vistoria

### CA-013 (vincula RF-013)
- **Dado** um item de checklist marcado como "Não OK"
- **Quando** o Administrativo adiciona uma observação
- **Então** a observação fica associada a esse item na vistoria salva

### CA-014 (vincula RF-014, RN-007)
- **Dado** uma vistoria em execução com um item de imagem obrigatório ("Frente") ainda não enviado
- **Quando** o Administrativo tenta salvar a vistoria
- **Então** o sistema impede o salvamento até que a foto obrigatória seja enviada

### CA-015 (vincula RF-015)
- **Dado** uma vistoria concluída e salva
- **Quando** ela é consultada posteriormente
- **Então** exibe o responsável pela execução e a data/hora exata

### CA-016 (vincula RF-016, RN-011)
- **Dado** um Cliente com uma vistoria periódica pendente na sua locação
- **Quando** ele abre o app mobile, preenche o checklist e as fotos e envia
- **Então** a vistoria periódica é registrada com os dados enviados

### CA-017 (vincula RF-017)
- **Dado** múltiplas locações com vistorias pendentes de diferentes tipos
- **Quando** o Administrativo abre a lista de pendências
- **Então** vê check-ins, check-outs e vistorias periódicas pendentes de todas as locações, num único lugar

### CA-018 (vincula RF-018)
- **Dado** uma vistoria de check-in pendente
- **Quando** o Administrativo a inicia pela lista de pendências **ou** pela tela da locação
- **Então** o mesmo formulário de execução é aberto, com o mesmo resultado ao salvar

### CA-019 (vincula RF-019)
- **Dado** uma vistoria periódica submetida pelo cliente, status pendente de análise
- **Quando** o Administrativo aprova
- **Então** a vistoria passa a status aprovada e some da lista de pendências de análise

### CA-020 (vincula RF-020)
- **Dado** uma vistoria periódica submetida pelo cliente
- **Quando** o Administrativo tenta rejeitar sem informar motivo
- **Então** o sistema impede a rejeição e exige o motivo

### CA-021 (vincula RF-021, RN-010)
- **Dado** uma vistoria periódica rejeitada com motivo
- **Quando** o cliente reenvia com correção
- **Então** um novo registro é criado vinculado ao mesmo agendamento, e o registro rejeitado permanece visível no histórico

### CA-022 (vincula RF-022)
- **Dado** uma locação encerrada com check-in e check-out executados
- **Quando** o Administrativo abre a comparação da locação
- **Então** vê os dois registros (itens de checklist e fotos) lado a lado

### CA-023 (vincula RF-023, RN-012)
- **Dado** um veículo com múltiplas locações passadas, cada uma com vistorias executadas
- **Quando** o Administrativo abre a tela do veículo
- **Então** vê o histórico de todas as vistorias (check-in, check-out, periódicas) de todas as locações daquele veículo

### CA-024 (vincula RN-001)
- **Dado** uma locação criada sem Perfil de Check-in/Check-out associado
- **Quando** a locação é salva
- **Então** nenhuma vistoria de check-in é criada, e a locação não aparece na lista de pendências de check-in

### CA-025 (vincula RN-006)
- **Dado** uma locação com check-in ainda pendente (nunca executado)
- **Quando** o Administrativo encerra a locação
- **Então** o encerramento é concluído normalmente, e o check-in permanece como pendência em aberto no histórico

### CA-026 (vincula RN-009)
- **Dado** uma vistoria periódica agendada cujo prazo já passou sem execução
- **Quando** o Administrativo consulta a lista de pendências
- **Então** ela aparece com status "atrasada", sem impedir nenhum outro fluxo da locação

### CA-027 (vincula RN-013)
- **Dado** uma vistoria periódica já aprovada para um agendamento
- **Quando** uma tentativa de gerar uma segunda aprovação para o mesmo agendamento ocorre
- **Então** o sistema não permite duas aprovações válidas simultâneas para o mesmo agendamento

### CA-028 (vincula RN-004)
- **Dado** uma locação em criação
- **Quando** o Administrativo associa apenas o vínculo de Vistoria Periódica (sem Check-in/Check-out), ou apenas o vínculo de Check-in/Check-out (sem Periódica)
- **Então** cada vínculo é registrado e funciona de forma independente — a locação pode ter check-in/check-out sem periódica, periódica sem check-in/check-out, ambos ou nenhum, sem que a presença de um exija o outro

---

## 11. Dependências e Riscos

### 11.1 Dependências

- **Remoção de código morto:** a tabela de checklist legada (entrega/devolução, sem uso em nenhuma tela ou Server Action hoje) deve ser removida como parte desta entrega.
- **Reaproveitamento de padrão:** o módulo de manutenção (perfis/planos por tenant, associação a entidade, itens configuráveis) serve de referência estrutural direta — não é bloqueio, mas há um precedente já validado no produto.
- **Infraestrutura de upload/armazenamento de fotos:** o módulo depende do mecanismo de upload e armazenamento de arquivos por tenant já usado por outros módulos do produto (documentos de cliente, evidências de manutenção) — reaproveitamento, não introdução de capacidade nova.
- **App mobile do cliente:** o app mobile já existe (papel `customer`) — este módulo adiciona uma nova área dentro dele, não um app novo.
- **Tela responsiva para uso no pátio:** depende de garantir usabilidade da tela de execução de vistoria em viewport mobile — não é uma tecnologia nova, mas um requisito de UX a validar na Spec.
- **ADR a criar:** o modelo de dados do Perfil de Vistoria (uma entidade reaproveitada em dois vínculos distintos por locação — Check-in/Check-out e Periódica — em vez de duas entidades separadas) é uma decisão arquitetural não trivial. Será registrada como ADR em `obsidian-notes/decisions/` antes da implementação.
- **Resolução da colisão de nome com "Vistoria mensal"** (item de plano de manutenção): fica como pendência a resolver — decisão de manter, renomear ou remover esse item específico não é tomada nesta PRD, mas deve ser endereçada antes ou durante a Spec para evitar confusão operacional.

### 11.2 Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Como nenhuma vistoria bloqueia o fluxo (RN-006), a operação pode simplesmente não adotar o hábito de fazer check-in/check-out mesmo com perfil associado, e o problema original (falta de evidência) persiste | Média | Alto | Acompanhar a métrica de adoção definida em §3.3; reavaliar tornar obrigatório em versão futura se a adoção ficar baixa |
| Baixa adoção da vistoria periódica pelo cliente (sem notificação push no V1, fácil de esquecer) | Média | Médio | Métrica de acompanhamento (§3.3); lembrete manual via canais já existentes até "automações" ser priorizado |
| Upload de fotos em conexão ruim no pátio (Wi-Fi fraco) causa frustração ou abandono do fluxo pelo Administrativo | Média | Médio | Feedback de progresso (RNF-002); compressão de imagem antes do upload fica como decisão técnica da Spec |
| Ambiguidade entre "Vistoria mensal" (manutenção) e o novo módulo de Vistoria confunde operadores no dia a dia | Média | Médio | Nomenclatura clara na UI + resolução da colisão de nome sinalizada em §11.1 |
| Volume de fotos armazenadas cresce indefinidamente (RNF-005 não prevê expurgo) | Alta (longo prazo) | Baixo/Médio | Revisitar política de retenção em PRD futuro se custo de storage se tornar relevante |

> Categorias: adoção/produto (linhas 1-2), técnico (linha 3), operacional (linha 4), dados (linha 5).

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

- [x] **Colisão de nome entre "Vistoria mensal"** (item de plano de manutenção) **e o novo módulo de Vistoria** — **adiado**: a decisão de renomear, manter ou remover o item de manutenção será tomada durante a Spec/implementação. Não bloqueia a aprovação desta PRD.

> Sem outras questões em aberto — todas as decisões estruturais (vínculo por locação, toggles vs. presença de perfil, não-bloqueio, offline, concorrência) foram fechadas ao longo da descoberta.

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 vazia ou explicitamente adiada)
- [x] Todos os RFs têm ao menos 1 CA correspondente
- [x] Todos os CAs apontam para um RF ou RN
- [x] Personas identificadas e cada uma com ≥1 US
- [x] Fluxos principais, alternativos e de erro documentados
- [x] Dependências e riscos mapeados
- [x] Frontmatter completo (sem `<!-- preencher -->`)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica

**Aprovado por:** Alan em 2026-07-29
