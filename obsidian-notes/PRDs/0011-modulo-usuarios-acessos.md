---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-08-07
related:
  - "[[PRDs/0001-area-administrativa-plataforma]]"
  - "[[Telas/Configurações]]"
  - "[[Banco de Dados]]"
  - "[[Segurança]]"
tags:
  - prd
  - modulo-usuarios-acessos
  - rbac
  - multi-tenant
  - controle-de-acesso
---

# PRD 0011 — Módulo de Usuários e Controle de Acesso

> ✅ **Status: aprovado.** Versão 1.0 — 2026-08-07. Resolve a ausência total de criação de usuários (administração da plataforma e tenants) e substitui o papel fixo atual por uma base de controle de acesso (RBAC) preparada para evoluir a papéis customizados. Próximo passo: `/spec-generator obsidian-notes/PRDs/0011-modulo-usuarios-acessos.md`.

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto opera como SaaS multi-tenant B2B ([[PRDs/0001-area-administrativa-plataforma|PRD 0001]]): cada locadora de motos é um tenant isolado, com uma administração da plataforma operando por cima de todos os tenants. Hoje, a criação de usuários é resolvida apenas para o caso mínimo: a administração da plataforma cria uma empresa-cliente e o primeiro usuário (o dono da locadora) recebe acesso automaticamente nesse momento. A partir daí, não existe nenhum caminho para a própria locadora incluir mais pessoas da sua equipe, nem para a administração da plataforma incluir novos administradores do zero — hoje só é possível dar esse papel a alguém que já tenha conta criada por outro caminho.

O controle de acesso, por sua vez, se resume a um papel único e fixo por usuário (dono, administrador, operador ou visualizador), sem possibilidade de ajuste fino — não há como, por exemplo, dar a um funcionário acesso a cobranças mas não a contratos.

### 1.2 Resumo executivo

- A administração da plataforma passa a poder criar novos Administradores do Sistema do zero, sem depender de conta pré-existente.
- Cada locadora passa a gerenciar sua própria equipe de acesso: convidar, listar, alterar papel, revogar e reativar usuários — hoje isso não existe em nenhuma tela.
- O controle de acesso continua usando os papéis já existentes nesta versão (Owner/Admin/Operador/Visualizador), mas a base de permissões nasce organizada por módulo funcional, preparando o terreno para Papéis Customizados numa versão futura sem retrabalho estrutural.
- Administração da Plataforma permanece com o modelo atual (Owner/Operator) — sem mudanças de permissão granular neste PRD.
- Este PRD estende o modelo de identidade formalizado no PRD 0001; uma ADR de modelo de controle de acesso configurável precisa ser criada antes da Spec.

### 1.3 Problema

**Problema A — Não existe forma de criar usuários.** Nem a administração da plataforma nem as locadoras conseguem incluir novas pessoas no sistema além do caso já resolvido (primeiro usuário do tenant, no momento da criação da empresa). Toda inclusão adicional de pessoa hoje exige intervenção manual fora do produto.

**Problema B — Controle de acesso é rígido demais para crescer.** O papel de cada usuário é fixo e definido pelo sistema; a locadora não tem nenhuma forma de ajustar o que cada funcionário pode ou não fazer. Conforme as empresas-cliente crescem e contratam mais pessoas com funções diferentes, essa rigidez tende a virar um bloqueio real de operação.

**Resultado esperado:**

- A administração da plataforma consegue criar novos administradores do sistema diretamente, sem depender de a pessoa já ter conta por outro caminho.
- O dono de cada locadora consegue criar e convidar novos usuários para sua equipe, atribuindo a cada um um papel de acesso.
- A base de controle de acesso é desenhada para evoluir — sem retrabalho estrutural — até papéis customizáveis por tenant e regras mais finas de permissão, à medida que a necessidade aparecer.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Papel de Acesso (Role)** | Conjunto nomeado de permissões que pode ser atribuído a um usuário. Determina o que essa pessoa pode ver e fazer no sistema. Não confundir com "papel" no sentido de persona/função de negócio (ex.: "Dono da Locadora") — um Papel de Acesso é a unidade técnica de concessão; uma persona pode usar qualquer Papel de Acesso configurado. |
| **Papel de Sistema** | Papel de Acesso pré-definido pelo GoMoto, disponível para todo tenant sem necessidade de configuração (os papéis já existentes — Owner, Admin, Operador, Visualizador). Não é editável pelo tenant. |
| **Papel Customizado** | Papel de Acesso criado pelo próprio tenant, com um nome e um conjunto de permissões escolhidos pelo Dono da Locadora ou Administrador. Capacidade prevista na arquitetura deste módulo, mas fora da V1 (ver Seção 3). |
| **Permissão** | Autorização atômica para executar uma ação (ver, criar, editar, excluir) sobre um módulo específico. É a unidade mínima que compõe um Papel de Acesso. |
| **Módulo** | Área funcional do GoMoto usada como unidade de concessão de acesso (ex.: Frota, Clientes, Contratos, Financeiro, Manutenção, Vistoria, Configurações). Não se refere a pacote de código — é um agrupamento de produto. |
| **Controle de Acesso por Papel (RBAC)** | Modelo em que o acesso de um usuário é determinado pelo(s) Papel(is) de Acesso atribuído(s) a ele. |
| **Controle de Acesso por Atributo (ABAC)** | Modelo complementar em que uma permissão só vale sob uma condição adicional baseada em um atributo do dado ou do contexto (ex.: "só edita registros da própria filial", "só aprova cobranças abaixo de X"). Tratado como capacidade prevista para evolução — fora da V1. |
| **Usuário do Sistema** | Termo guarda-chuva deste PRD para qualquer conta com login no GoMoto do lado operador: Administrador da Plataforma ou Membro do Tenant. **Não inclui** o Cliente Final (locatário, acesso via mobile com CPF) — esse já está formalizado no [[PRDs/0001-area-administrativa-plataforma|PRD 0001]] e permanece fora de escopo aqui. |
| **Convite de Usuário** | Mecanismo pelo qual um Usuário do Sistema já existente (Administrador da Plataforma ou Dono/Administrador de tenant) inclui uma nova pessoa, gerando o acesso inicial dela via link de definição de senha — reaproveitando o mesmo mecanismo já usado hoje para o primeiro usuário de um tenant (PRD 0001, RF-002). |
| **Plano de Assinatura** | Nível comercial futuro que definirá quais Módulos um tenant pode usar. Não existe hoje no GoMoto e sua criação é PRD próprio (já registrado como fora de escopo no PRD 0001). Citado aqui apenas porque este módulo deve nascer com a extensibilidade de, no futuro, checar Plano de Assinatura ao decidir Módulos disponíveis — sem implementar isso agora. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio (V1)

1. **Permitir que a administração da plataforma inclua novos Administradores do Sistema sem depender de uma conta pré-existente** — hoje só é possível promover alguém que já tem login por outro caminho.
2. **Permitir que cada locadora monte sua própria equipe de acesso**, sem depender da administração da plataforma para incluir cada novo funcionário.
3. **Preparar a base de controle de acesso para evoluir** — papéis customizados por tenant e regras mais finas de permissão — sem exigir redesenho estrutural quando isso for priorizado.

### 3.2 Objetivos do usuário

- O Administrador da Plataforma passa a poder criar um novo Administrador do zero, informando nome e email.
- O Dono ou Administrador da Locadora passa a poder convidar, listar, alterar o papel de, revogar e reativar o acesso de usuários da sua própria equipe — nenhuma dessas ações existe hoje.

### 3.3 Métricas de sucesso / KPIs

| Métrica | Como medir |
|---|---|
| Zero intervenção manual no banco para incluir pessoa | Nenhuma criação de Administrador do Sistema ou Usuário do Sistema depende de acesso direto ao banco de dados |
| Tenants com mais de 1 usuário ativo | Hoje só o Owner tem acesso em praticamente todos os tenants; a métrica deve crescer conforme os times aumentam |
| Revogação de acesso é imediata | Usuário removido/desativado perde acesso na próxima requisição, sem exceção |

### 3.4 Incluído em V1

1. Administração da plataforma cria novo Administrador do Sistema informando nome e email (convite, reaproveitando o mecanismo de link de definição de senha já usado hoje para o primeiro usuário de um tenant).
2. Dono/Administrador de tenant convida novo Usuário do Sistema para seu tenant, atribuindo um Papel de Sistema (Owner/Admin/Operador/Visualizador).
3. Dono/Administrador de tenant lista os usuários do seu tenant (nome, email, papel, status, data de ingresso) — busca simples por nome/email, sem necessidade de paginação pesada para o volume esperado (dezenas por tenant).
4. Dono/Administrador de tenant altera o Papel de Sistema de um usuário existente do seu tenant.
5. Dono/Administrador de tenant revoga o acesso de um usuário do seu tenant, preservando o histórico de ações já registradas por ele.
6. Dono/Administrador de tenant reativa o acesso de um usuário previamente revogado, restaurando o papel que ele tinha antes da revogação, sem novo convite.
7. A administração da plataforma mantém a visão somente-leitura dos membros de cada tenant, já formalizada no PRD 0001 — sem mudança aqui.

Isso toca duas telas: a já existente de Administradores da Plataforma (hoje só promove usuário existente — passa a permitir criar do zero) e uma nova tela de Usuários do Tenant (gestão da própria equipe, junto de [[Telas/Configurações|Configurações]]).

### 3.5 Não Incluído / Não-objetivos (V1)

| Item | Motivo |
|---|---|
| Criação de Papéis Customizados por tenant (construtor de papel com permissões por módulo) | V2 — este PRD prepara a base de permissões por módulo, mas não expõe a tela de criar papel |
| ABAC — regras por atributo (filial, valor do registro, autoria) | V3 — sem caso de uso concreto priorizado agora |
| Gating de Módulo por Plano de Assinatura | Depende de modelo de billing/planos que ainda não existe — PRD próprio, já registrado como fora de escopo no PRD 0001 |
| Alteração do modelo de permissões da Administração da Plataforma (permanece Owner/Operator fixo) | Decisão explícita desta rodada de escopo — o modelo atual já atende |
| Autenticação multifator, SSO/SAML | Sem demanda identificada — mesma decisão do PRD 0001 |
| Usuário do Sistema como membro de múltiplos tenants | Fora de visão — mesma decisão já registrada no PRD 0001 (§3.5) |
| Notificações automáticas por email do convite (Resend) | Dependência de serviço externo — reaproveita o mesmo padrão manual do PRD 0001 (responsável envia o link) |

---

## 4. Stakeholders

Dono único: Alan (LW Tecnologia). Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Como interage | Frequência |
|---|---|---|
| **Administrador da Plataforma** | Cria e gerencia Administradores do Sistema | Eventual (onboarding, expansão da equipe interna) |
| **Dono da Locadora** | Cria, edita e revoga acesso de usuários da sua equipe | Eventual (conforme a equipe muda) |
| **Administrador da Locadora** | Membro do Tenant com papel Admin — mesma capacidade de gestão de usuários que o Owner | Eventual |
| **Novo Usuário do Sistema (convidado)** | Recebe convite e define seu acesso inicial | Setup-only (uma vez) |

> Dono da Locadora e Administrador da Locadora têm exatamente as mesmas capacidades neste módulo (a política de acesso já os trata de forma equivalente para gestão de membros) — por isso compartilham as mesmas User Stories abaixo, sem duplicação.

### 5.2 User Stories

**Administrador da Plataforma**

- **US-001** — Como Administrador da Plataforma, quero criar um novo Administrador do Sistema informando nome e email, para incluir alguém na equipe de suporte/operação da plataforma sem precisar que essa pessoa já tenha conta por outro caminho.

**Dono da Locadora / Administrador da Locadora**

- **US-002** — Como Dono ou Administrador da Locadora, quero convidar um novo usuário para minha equipe atribuindo um papel de acesso, para que ele comece a usar o sistema sem depender da administração da plataforma.
- **US-003** — Como Dono ou Administrador da Locadora, quero visualizar todos os usuários da minha equipe com seus papéis e status, para saber quem tem acesso ao quê.
- **US-004** — Como Dono ou Administrador da Locadora, quero alterar o papel de um usuário da minha equipe, para ajustar o acesso dele quando sua função mudar.
- **US-005** — Como Dono ou Administrador da Locadora, quero revogar o acesso de um usuário da minha equipe, para remover imediatamente o acesso de alguém que saiu da empresa ou não deveria mais ter acesso.
- **US-006** — Como Dono ou Administrador da Locadora, quero reativar o acesso de um usuário previamente revogado, para reincluir alguém que voltou à empresa sem precisar de um novo convite.

**Novo Usuário do Sistema (convidado)**

- **US-007** — Como Usuário do Sistema recém-convidado, quero definir minha senha a partir do link de convite, para acessar o sistema pela primeira vez.

---

## 6. Fluxos Funcionais

### 6.1 Fluxo A — Administrador da Plataforma cria novo Administrador do Sistema

**Principal:**
1. Administrador da Plataforma (papel Owner) acessa a tela de Administradores do Sistema e aciona "Novo Administrador"
2. Informa nome e email
3. Sistema valida que o email não pertence a nenhum usuário existente (Administrador do Sistema ou Usuário do Sistema de qualquer tenant)
4. Sistema cria o novo Administrador do Sistema com o papel informado (Owner ou Operator) e gera link de definição de senha válido por 72 horas
5. Ação é registrada no audit log da plataforma
6. Administrador da Plataforma envia o link manualmente ao novo administrador

**Alternativo A1 — Email já é Usuário do Sistema de um tenant:**
1. Sistema detecta o conflito de papel (mesma regra do PRD 0001, RN-015) e rejeita com mensagem de conflito — não cria o Administrador

**Erro — Email já em uso por outro Administrador do Sistema:**
1. Sistema rejeita com aviso de email duplicado, sem criar

**Erro — Ação executada por Administrador com papel Operator:**
1. Sistema nega — só Owner pode criar/gerenciar Administradores da Plataforma (regra já existente no PRD 0001)

### 6.2 Fluxo B — Dono/Administrador da Locadora convida novo Usuário do Sistema

**Principal:**
1. Dono ou Administrador da Locadora acessa a tela de Usuários do seu tenant e aciona "Convidar Usuário"
2. Informa nome, email e seleciona um Papel de Sistema (Owner/Admin/Operador/Visualizador)
3. Sistema valida que o email não pertence a nenhum Administrador da Plataforma nem a nenhum Usuário do Sistema de outro tenant
4. Sistema cria o vínculo do usuário ao tenant com o papel escolhido e gera link de definição de senha válido por 72 horas
5. Ação é registrada no audit log do tenant
6. Dono/Administrador envia o link manualmente ao novo usuário

**Erro — Email já é Administrador da Plataforma:**
1. Sistema rejeita com mensagem de conflito de papel (herdada do PRD 0001)

**Erro — Email já é Usuário do Sistema de outro tenant:**
1. Sistema rejeita — Usuário do Sistema pertence a um único tenant (decisão da Seção 3, fora de escopo permitir vínculo múltiplo)

**Erro — Email já é usuário do mesmo tenant:**
1. Sistema rejeita — já existe vínculo ativo com esse email neste tenant

**Erro — Convite feito por usuário com papel Operador ou Visualizador:**
1. Sistema nega — só Owner/Admin do tenant podem convidar novos usuários

### 6.3 Fluxo C — Editar papel de um usuário existente do tenant

**Principal:**
1. Dono/Administrador acessa a lista de Usuários do tenant
2. Seleciona um usuário e altera o Papel de Sistema atribuído
3. Sistema salva a mudança e registra no audit log (papel anterior → novo papel)
4. Na próxima requisição, o usuário passa a operar com o novo papel

**Erro — Tentativa de rebaixar o único Owner do tenant:**
1. Sistema bloqueia — precisa existir ao menos 1 Owner ativo no tenant (mesma proteção que já existe para Platform Admin Owner no PRD 0001)

**Erro — Usuário com papel Admin tenta se promover a Owner:**
1. Sistema nega — evita escalonamento de privilégio pelo próprio usuário

### 6.4 Fluxo D — Revogar e reativar acesso de um usuário do tenant

**Principal (revogação):**
1. Dono/Administrador acessa a lista de Usuários do tenant
2. Seleciona um usuário e aciona "Revogar acesso"
3. Sistema pede confirmação (ação sensível)
4. Sistema desativa o acesso — o usuário não consegue mais autenticar nem acessar dados do tenant
5. Histórico de ações já registradas por esse usuário permanece intacto
6. Ação é registrada no audit log

**Alternativo D1 — Reativar usuário revogado:**
1. Dono/Administrador acessa a lista de Usuários do tenant (que inclui revogados)
2. Seleciona um usuário revogado e aciona "Reativar acesso"
3. Sistema restaura o vínculo do usuário ao tenant, com o mesmo Papel de Sistema que ele tinha antes da revogação
4. Usuário recupera acesso imediatamente — a credencial (senha) já definida anteriormente continua válida, sem necessidade de novo convite ou link
5. Ação é registrada no audit log

**Erro — Tentativa de revogar o único Owner do tenant:**
1. Sistema bloqueia — mesma proteção do Fluxo C

**Erro — Usuário tenta revogar o próprio acesso:**
1. Sistema bloqueia essa ação nessa tela — evita perda acidental do próprio acesso; precisa de outro Owner/Admin para revogar

**Erro — Ação concorrente (dois Admins revogam o mesmo usuário ao mesmo tempo):**
1. A segunda tentativa recebe confirmação de "usuário já sem acesso", sem erro destrutivo

---

## 7. Requisitos Funcionais

### 7.1 Administração da Plataforma — Criação de Administradores

- **RF-001** — O sistema permite ao Administrador da Plataforma com papel Owner criar um novo Administrador do Sistema informando nome, email e papel (Owner ou Operator).
- **RF-002** — Ao criar um Administrador do Sistema, o sistema gera automaticamente um link de definição de senha válido por 72 horas.
- **RF-003** — O sistema rejeita a criação de Administrador do Sistema cujo email já pertença a um Usuário do Sistema de qualquer tenant, exibindo mensagem de conflito de papel.
- **RF-004** — O sistema rejeita a criação de Administrador do Sistema cujo email já pertença a outro Administrador do Sistema.
- **RF-005** — Toda criação de Administrador do Sistema é registrada no audit log da plataforma.

### 7.2 Tenant — Convite de Usuários

- **RF-006** — O sistema permite ao Dono ou Administrador da Locadora convidar um novo Usuário do Sistema para seu tenant, informando nome, email e um Papel de Sistema (Owner/Admin/Operador/Visualizador).
- **RF-007** — Ao convidar um Usuário do Sistema, o sistema gera automaticamente um link de definição de senha válido por 72 horas.
- **RF-008** — O sistema rejeita o convite cujo email já pertença a um Administrador do Sistema, exibindo mensagem de conflito de papel.
- **RF-009** — O sistema rejeita o convite cujo email já pertença a um Usuário do Sistema vinculado a outro tenant.
- **RF-010** — O sistema rejeita o convite cujo email já pertença a um Usuário do Sistema já vinculado ao mesmo tenant.
- **RF-011** — Apenas Dono ou Administrador da Locadora podem convidar novos usuários; Operador e Visualizador não têm acesso a essa ação.
- **RF-012** — Toda inclusão de Usuário do Sistema é registrada no audit log do tenant.

### 7.3 Tenant — Gestão de usuários existentes

- **RF-013** — O sistema permite ao Dono ou Administrador da Locadora listar todos os Usuários do Sistema do seu tenant, exibindo nome, email, papel, status (ativo/revogado) e data de ingresso.
- **RF-014** — O sistema permite busca da lista de usuários por nome ou email.
- **RF-015** — O sistema permite ao Dono ou Administrador da Locadora alterar o Papel de Sistema de um usuário existente do seu tenant.
- **RF-016** — O sistema impede que um usuário altere o próprio papel para um nível de acesso mais alto do que possui.
- **RF-017** — O sistema impede a alteração de papel que resulte em zero Owners ativos no tenant.
- **RF-018** — O sistema permite ao Dono ou Administrador da Locadora revogar o acesso de um usuário existente do seu tenant.
- **RF-019** — O sistema impede que um usuário revogue o próprio acesso.
- **RF-020** — O sistema impede a revogação que resulte em zero Owners ativos no tenant.
- **RF-021** — Um usuário com acesso revogado não consegue autenticar nem acessar dados do tenant a partir do momento da revogação.
- **RF-022** — A revogação de acesso preserva o histórico de ações já registradas pelo usuário revogado.
- **RF-023** — Toda alteração de papel e toda revogação de acesso são registradas no audit log do tenant.
- **RF-024** — O sistema permite ao Dono ou Administrador da Locadora reativar o acesso de um usuário previamente revogado do seu tenant, restaurando o Papel de Sistema que ele tinha antes da revogação.
- **RF-025** — Ao reativar um usuário, o sistema não exige novo convite nem novo link de definição de senha — a credencial já existente do usuário volta a ser válida.
- **RF-026** — Toda reativação de acesso é registrada no audit log do tenant.

---

## 8. Requisitos Não Funcionais

### 8.1 Performance

- **RNF-001** — A lista de usuários do tenant carrega em p95 < 1 segundo para tenants com até 50 usuários.
- **RNF-002** — A criação de um novo Usuário do Sistema (convite) é concluída, do envio do formulário até a confirmação na tela, em p95 < 2 segundos.

### 8.2 Segurança

- **RNF-003** — Apenas Dono e Administrador do tenant acessam a tela de gestão de usuários; Operador e Visualizador recebem resposta de "não encontrado" ao tentar acessar diretamente essa área, sem revelar sua existência.
- **RNF-004** — Apenas Administrador da Plataforma com papel Owner acessa a criação de novos Administradores do Sistema; Operator recebe a ação negada.
- **RNF-005** — O registro de auditoria de criação, alteração de papel e revogação de usuário é imutável — nenhum usuário, incluindo Owner, pode editar ou excluir esses registros após criados (mesma garantia já estabelecida no PRD 0001).

### 8.3 Privacidade (LGPD)

- **RNF-006** — Dados de um usuário revogado (nome, email, histórico de ações) permanecem acessíveis apenas dentro do próprio tenant — nunca ficam visíveis a outro tenant, nem à administração da plataforma além da visão somente-leitura já existente no PRD 0001.

> RNFs de disponibilidade e compatibilidade não são repetidos aqui — já cobertos de forma geral pelo PRD 0001; esta seção cobre apenas o que é específico deste módulo.

---

## 9. Regras de Negócio

### 9.1 Identidade e exclusividade de papel

- **RN-001** — Um Usuário do Sistema pertence a exatamente um tenant; não há vínculo simultâneo com dois ou mais tenants (mesma decisão já registrada no PRD 0001, §3.5 — aqui aplicada ativamente pelas regras de convite).
- **RN-002** — Um mesmo email é ou de um Administrador da Plataforma ou de um Usuário do Sistema de um tenant — nunca os dois simultaneamente (herdada do PRD 0001, RN-015).

### 9.2 Papéis e hierarquia dentro do tenant

- **RN-003** — Todo tenant precisa ter, a qualquer momento, ao menos 1 usuário com papel Owner ativo. Nenhuma alteração de papel, revogação ou reativação pode resultar em zero Owners.
- **RN-004** — Um usuário não pode alterar o próprio papel para um nível de acesso superior ao que já possui.
- **RN-005** — Um usuário não pode revogar o próprio acesso — a revogação é sempre executada por outro Owner ou Admin do mesmo tenant.
- **RN-006** — Somente usuários com papel Owner ou Admin no tenant podem convidar, editar o papel de, revogar ou reativar o acesso de outros usuários do mesmo tenant.
- **RN-007** — Somente Administrador da Plataforma com papel Owner pode criar novos Administradores do Sistema (herdada do PRD 0001, RN-012/RN-013).

### 9.3 Ciclo de vida do acesso

- **RN-008** — A revogação de acesso desativa o vínculo do usuário ao tenant, mas não apaga o histórico de ações já registradas por ele.
- **RN-009** — Ao revogar o acesso, o usuário perde a capacidade de autenticar a partir desse momento; se já tiver sessão ativa, perde acesso aos dados na próxima requisição (mesmo padrão de bloqueio já usado para suspensão de tenant no PRD 0001).
- **RN-010** — Um usuário revogado pode ser reativado por um Owner ou Admin do tenant, recuperando o Papel de Sistema que possuía no momento da revogação, sem necessidade de novo convite ou nova credencial.

### 9.4 Papéis de Sistema nesta versão

- **RN-011** — Nesta versão, todo Usuário do Sistema recebe um Papel de Sistema pré-definido (Owner/Admin/Operador/Visualizador); não existe Papel Customizado atribuível.

### 9.5 Auditoria

- **RN-012** — Toda criação de usuário, alteração de papel, revogação e reativação de acesso gera um registro de auditoria contendo: quem executou, qual ação, qual o alvo (usuário afetado) e quando. Esse registro é imutável — mesma garantia já estabelecida no PRD 0001.

---

## 10. Critérios de Aceite

### 10.1 Administração da Plataforma — Criação de Administradores

**CA-001 (RF-001, RF-002)** — Criação de Administrador do Sistema
- **Dado** que sou Administrador da Plataforma com papel Owner,
- **Quando** informo nome, email e papel do novo Administrador e confirmo,
- **Então** o Administrador é criado, um link de definição de senha válido por 72 horas é gerado, e a ação aparece no audit log da plataforma.

**CA-002 (RF-003)** — Rejeição por conflito com Usuário do Sistema
- **Dado** que informo um email que já pertence a um Usuário do Sistema de algum tenant,
- **Quando** confirmo a criação do Administrador,
- **Então** o sistema rejeita e exibe mensagem de conflito de papel, sem criar o Administrador.

**CA-003 (RF-004)** — Rejeição por email duplicado
- **Dado** que informo um email que já pertence a outro Administrador do Sistema,
- **Quando** confirmo a criação,
- **Então** o sistema rejeita com aviso de email duplicado.

**CA-004 (RF-005)** — Auditoria da criação
- **Dado** que um novo Administrador do Sistema foi criado,
- **Quando** consulto o audit log da plataforma,
- **Então** encontro um registro com meu usuário como responsável, a ação e a data/hora.

**CA-005 (RF-001)** — Restrição de papel Operator
- **Dado** que sou Administrador da Plataforma com papel Operator,
- **Quando** tento acessar a criação de novo Administrador,
- **Então** a ação é negada.

### 10.2 Tenant — Convite de Usuários

**CA-006 (RF-006, RF-007)** — Convite de novo usuário
- **Dado** que sou Dono ou Administrador da Locadora,
- **Quando** informo nome, email e papel do novo usuário e confirmo,
- **Então** o usuário é vinculado ao meu tenant, um link de definição de senha válido por 72 horas é gerado, e a ação aparece no audit log do tenant.

**CA-007 (RF-008)** — Rejeição por conflito com Administrador da Plataforma
- **Dado** que informo um email que já pertence a um Administrador da Plataforma,
- **Quando** confirmo o convite,
- **Então** o sistema rejeita com mensagem de conflito de papel.

**CA-008 (RF-009)** — Rejeição por vínculo em outro tenant
- **Dado** que informo um email que já é Usuário do Sistema de outro tenant,
- **Quando** confirmo o convite,
- **Então** o sistema rejeita, informando que o email já possui vínculo com outra empresa.

**CA-009 (RF-010)** — Rejeição por vínculo duplicado no mesmo tenant
- **Dado** que informo um email que já é Usuário do Sistema do meu próprio tenant,
- **Quando** confirmo o convite,
- **Então** o sistema rejeita, informando que o usuário já tem acesso a este tenant.

**CA-010 (RF-011)** — Restrição de quem convida
- **Dado** que sou Usuário do Sistema com papel Operador ou Visualizador,
- **Quando** tento acessar a ação de convidar novo usuário,
- **Então** a ação é negada.

**CA-011 (RF-012)** — Auditoria do convite
- **Dado** que um novo Usuário do Sistema foi convidado,
- **Quando** consulto o audit log do tenant,
- **Então** encontro um registro com o responsável, a ação e a data/hora.

### 10.3 Tenant — Gestão de usuários existentes

**CA-012 (RF-013, RF-014)** — Listagem e busca
- **Dado** que sou Dono ou Administrador da Locadora,
- **Quando** acesso a lista de usuários do meu tenant e busco por nome ou email,
- **Então** vejo apenas os usuários correspondentes, com papel, status e data de ingresso.

**CA-013 (RF-015)** — Alteração de papel
- **Dado** que sou Dono ou Administrador da Locadora e existe um usuário ativo no meu tenant,
- **Quando** altero o papel desse usuário e confirmo,
- **Então** o novo papel é aplicado e a mudança aparece no audit log com o papel anterior e o novo papel.

**CA-014 (RF-016)** — Bloqueio de autopromoção
- **Dado** que sou Administrador do tenant,
- **Quando** tento alterar meu próprio papel para Owner,
- **Então** o sistema bloqueia a ação.

**CA-015 (RF-017, RN-003)** — Bloqueio de zero Owners na edição
- **Dado** que existe exatamente 1 Owner ativo no tenant,
- **Quando** tento rebaixar o papel desse Owner para Admin,
- **Então** o sistema bloqueia a ação e informa que o tenant precisa de ao menos 1 Owner.

**CA-016 (RF-018)** — Revogação de acesso
- **Dado** que sou Dono ou Administrador da Locadora e existe um usuário ativo no meu tenant,
- **Quando** aciono "Revogar acesso" e confirmo,
- **Então** o usuário perde o acesso, seu histórico de ações permanece intacto, e a ação aparece no audit log.

**CA-017 (RF-019, RN-005)** — Bloqueio de autorrevogação
- **Dado** que estou autenticado como Owner ou Admin do tenant,
- **Quando** tento revogar o próprio acesso,
- **Então** o sistema bloqueia a ação.

**CA-018 (RF-020, RN-003)** — Bloqueio de zero Owners na revogação
- **Dado** que existe exatamente 1 Owner ativo no tenant,
- **Quando** tento revogar o acesso desse Owner,
- **Então** o sistema bloqueia a ação e informa que o tenant precisa de ao menos 1 Owner.

**CA-019 (RF-021)** — Bloqueio de acesso após revogação
- **Dado** que o acesso de um usuário foi revogado,
- **Quando** esse usuário tenta autenticar, ou já tinha uma sessão aberta,
- **Então** ele não consegue autenticar, e a sessão já aberta perde acesso aos dados na próxima requisição.

**CA-020 (RF-022)** — Preservação de histórico
- **Dado** que um usuário revogado tinha ações registradas antes da revogação,
- **Quando** qualquer pessoa consulta esse histórico depois,
- **Então** os registros continuam presentes e inalterados.

**CA-021 (RF-023)** — Auditoria de alteração e revogação
- **Dado** que o papel de um usuário foi alterado ou seu acesso foi revogado,
- **Quando** consulto o audit log do tenant,
- **Então** encontro um registro com responsável, ação, alvo e data/hora.

**CA-022 (RF-024, RF-025)** — Reativação de usuário
- **Dado** que existe um usuário revogado no meu tenant,
- **Quando** aciono "Reativar acesso" e confirmo,
- **Então** o usuário recupera o papel que tinha antes da revogação, volta a autenticar com a mesma credencial (sem novo convite), e a ação aparece no audit log.

**CA-023 (RF-026)** — Auditoria da reativação
- **Dado** que um usuário foi reativado,
- **Quando** consulto o audit log do tenant,
- **Então** encontro um registro da reativação com responsável, alvo e data/hora.

---

## 11. Dependências e Riscos

### 11.1 Dependências

**PRDs relacionados:**

| PRD | Relação |
|---|---|
| [[PRDs/0001-area-administrativa-plataforma\|PRD 0001 — Área Administrativa da Plataforma]] | Este PRD estende o modelo de papéis (de fixo para RBAC configurável) e reaproveita integralmente o mecanismo de convite/link de definição de senha e os audit logs (plataforma e tenant) já formalizados lá |

**ADRs a criar:**

| ADR | Ação necessária |
|---|---|
| Nova ADR — Modelo de controle de acesso configurável | A ser criada em `obsidian-notes/decisions/` antes da Spec. Decide como o papel fixo atual evolui para uma estrutura extensível (permissões organizadas por módulo) sem quebrar o isolamento de tenant já implementado, e sem exigir retrabalho quando Papéis Customizados forem priorizados (V2) |

**Dependências de plataforma:**
- Supabase Auth — reaproveita o mesmo mecanismo de convite (link de definição de senha) já usado no PRD 0001. Nenhuma dependência externa nova.
- Nenhuma dependência de modelo de billing/plano nesta versão — explicitamente fora de escopo (Seção 3).

### 11.2 Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Migrar o papel fixo atual (`owner/admin/operator/viewer`) para uma estrutura extensível pode exigir mudança que afete tenants e usuários já existentes em produção | Média | Alto | A Spec e a ADR devem desenhar a evolução como compatível com os dados existentes — sem exigir re-cadastro de usuários já ativos |
| Falha na regra de "mínimo 1 Owner" deixa um tenant sem nenhum administrador, travando toda a gestão de usuários daquele tenant sem caminho de recuperação pela própria interface | Baixa | Crítico | Cobertura de teste automatizado obrigatória para RN-003 (CA-015, CA-018) antes de considerar a feature pronta |
| Overengineering: construir a estrutura de permissões por módulo maior do que o necessário para o volume atual (dezenas de usuários por tenant) | Média | Médio | V1 fica restrito aos Papéis de Sistema, sem construtor de papel — reavaliar necessidade real de Papéis Customizados antes de abrir V2 |
| Ambiguidade entre "papel" no sentido de persona/função de negócio e "Papel de Acesso" no sentido de RBAC, gerando confusão em conversas futuras sobre o produto | Média | Baixo | Glossário (Seção 2) já formaliza a distinção; manter o termo "Papel de Acesso" nas telas e documentação |
| Link de convite expira antes do novo usuário definir a senha, e ele fica sem saber o que fazer | Média | Baixo-Médio | Reaproveitar a mesma UX de regeneração de link já decidida no PRD 0001 (RF-026/RF-029 daquele PRD) |

> Categorias: R-01 técnico/dados, R-02 técnico, R-03 produto, R-04 produto/comunicação, R-05 produto/operacional.

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

Nenhuma questão aberta. Todas as decisões foram fechadas durante a construção deste PRD.

*Itens explicitamente adiados para vNext:*

| Item | Motivo |
|---|---|
| Papéis Customizados por tenant (construtor de papel com permissões por módulo) | V2 — este PRD prepara a base, mas não expõe a tela de criação |
| ABAC — regras por atributo (filial, valor do registro, autoria) | V3 — sem caso de uso concreto priorizado agora |
| Gating de Módulo por Plano de Assinatura | Depende de modelo de billing/planos ainda inexistente — PRD próprio, mesma decisão do PRD 0001 |
| Notificações automáticas por email do convite (Resend) | Dependência de serviço externo — mesmo padrão manual já usado no PRD 0001 |
| Permissões granulares para Administrador da Plataforma | Decisão explícita desta rodada — o modelo atual (Owner/Operator) já atende |

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 vazia ou explicitamente adiada)
- [x] Todos os RFs têm ao menos 1 CA correspondente
- [x] Todos os CAs apontam para um RF ou RN
- [x] Personas identificadas e cada uma com ≥1 US
- [x] Fluxos principais, alternativos e de erro documentados
- [x] Dependências e riscos mapeados
- [x] Frontmatter completo (sem `<!-- preencher -->`)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica (SQL, paths, pacotes, libs)

**Aprovado por:** Alan em 2026-08-07

---

`#prd` `#rbac` `#multi-tenant` `#controle-de-acesso`
