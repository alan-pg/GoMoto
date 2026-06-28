---
status: aprovado
versão: 2.1
autor: Alan (com agente IA)
data: 2026-06-27
revisão: v2.1 em 2026-06-27 — remove conceito de dual-role; platform_admin e tenant_member são mutuamente exclusivos; unicidade global de email no plano web
adr:
  - "[[decisions/0003-escopo-e-auth-do-mobile-cliente]]"
  - "[[decisions/0004-control-plane-e-identidade-do-cliente]]"
related:
  - "[[Arquitetura Proposta]]"
  - "[[Banco de Dados]]"
  - "[[Segurança]]"
tags:
  - prd
  - plataforma
  - multi-tenant
  - autenticacao
---

# PRD 0001 — Área Administrativa da Plataforma e Identidade de Usuários

> ✅ **Status: aprovado.** Versão 2.1 — revisada em 2026-06-27. Elimina o conceito de dual-role: platform_admin e tenant_member são papéis mutuamente exclusivos. O mesmo email não pode ser usado para ambos. Remove RF-013 (seletor de contexto), RN-015 e CA-015. Adiciona RN-015 (novo) com regra de exclusividade.

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto opera como SaaS multi-tenant B2B: cada empresa locadora de motos é um *tenant* independente. A plataforma já possui três camadas de acesso implementadas — administração da plataforma (Control Plane), operação de cada empresa (Tenant Plane) e app mobile para clientes finais. A interface de criação e gerenciamento de tenants está funcional.

Contudo, a implementação atual apresenta uma falha crítica de isolamento de identidade: ao autenticar com o usuário de um tenant recém-criado, o sistema exibe dados de outro tenant — clientes e veículos incorretos aparecem na tela. Isso indica que a resolução do contexto do tenant não está ocorrendo de forma confiável a partir do usuário autenticado, tornando o sistema inseguro para operação real com múltiplas empresas.

Adicionalmente, as regras de identidade do sistema — especialmente a identidade do cliente final que pode ser locatário de múltiplas empresas — nunca foram formalizadas, gerando ambiguidade na implementação.

### 1.2 Problema

**Problema A — Isolamento de tenant quebrado (crítico):** O contexto do tenant na sessão do usuário não é resolvido de forma confiável a partir da identidade autenticada. Resultado: um usuário de um tenant visualiza dados de outro tenant, violando a premissa fundamental de privacidade e segurança do produto.

**Problema B — Regras de identidade não formalizadas:** As regras que governam como um cliente final se autentica, como seu perfil se relaciona com múltiplos tenants e como o isolamento é garantido no mobile nunca foram documentadas de forma clara e testável, gerando implementações divergentes.

### 1.3 Resultado esperado

- Qualquer usuário autenticado vê **exclusivamente** dados do seu próprio tenant — sem exceção e sem possibilidade de cruzamento acidental.
- As regras de identidade do sistema estão formalizadas, testáveis e servem de referência para corrigir e validar a implementação existente.
- Clientes finais autenticam com CPF e senha no mobile e visualizam locações de diferentes empresas em contextos completamente separados.
- O mesmo cliente físico pode ser locatário de N empresas distintas com um único login, com isolamento total entre os perfis de cada empresa.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Control Plane** | Área administrativa da plataforma. Opera *sobre* os tenants: cria empresas, visualiza métricas globais, suspende e reativa contas. Acessível apenas por Platform Admins. |
| **Tenant Plane** | Área operacional *dentro* de um tenant. É o dashboard que cada empresa-cliente usa no dia a dia para gerenciar frota, clientes, contratos, cobranças e manutenções. |
| **Platform Admin** | Usuário com permissão de operar o Control Plane. Não opera nenhum tenant específico e não pode ser, simultaneamente, membro de nenhum tenant. Os papéis de Platform Admin e Membro de Tenant são mutuamente exclusivos. |
| **Tenant** | Uma empresa locadora de motos que usa o GoMoto como plataforma. Também chamada de "empresa-cliente" ou "locadora" na interface de produto. Cada tenant tem seus dados completamente isolados dos demais. |
| **Tenant Owner** | O usuário principal de um tenant — papel de maior privilégio dentro da empresa-cliente. Criado pelo Platform Admin no momento do onboarding. |
| **Membro do Tenant** | Qualquer usuário com acesso ao Tenant Plane de uma empresa: Owner, Admin, Operador ou Visualizador. Opera exclusivamente dentro do seu tenant. |
| **Cliente Final** | Pessoa física que aluga moto de uma ou mais empresas-cliente. Acessa o sistema exclusivamente pelo app mobile. Pode ter vínculo com múltiplos tenants simultaneamente. |
| **Perfil de Cliente** | O conjunto de dados que um tenant mantém sobre um Cliente Final (dados cadastrais, contratos, cobranças). Cada tenant possui seu próprio Perfil de Cliente, invisível aos demais tenants. |
| **Contexto Ativo de Tenant** | O tenant cujos dados estão sendo exibidos na sessão atual. Para membros de tenant, é sempre e somente o tenant ao qual pertencem. Para clientes com vínculo em múltiplos tenants, é o tenant selecionado na tela de escolha de locadora. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio (V1)

1. **Corrigir o isolamento de tenant** — eliminar o bug crítico em que um usuário autenticado visualiza dados de outro tenant. O GoMoto não pode operar com múltiplos clientes reais enquanto essa falha existir.
2. **Formalizar as regras de identidade** — estabelecer de forma clara e testável como cada tipo de usuário se autentica, qual contexto de tenant é resolvido e como o isolamento é garantido em todas as camadas.
3. **Habilitar clientes em múltiplos tenants** — permitir que o mesmo cliente físico tenha vínculos com N empresas-clientes, acessando cada uma de forma isolada no app mobile.

### 3.2 Métricas de sucesso

| Métrica | Como medir |
|---|---|
| Zero vazamentos cross-tenant | Testes automatizados: usuário de Tenant A não consegue ler, criar, editar ou excluir nenhum dado de Tenant B — nem por acesso direto à API |
| Resolução correta de tenant na sessão | Qualquer usuário autenticado: o sistema resolve o tenant a partir da identidade autenticada no servidor, nunca do cliente |
| Cliente multi-tenant funcional | Cliente com vínculo em ≥2 empresas consegue selecionar e alternar entre elas no mobile sem perder isolamento |

### 3.3 O que o sistema passa a garantir

- Usuário de Tenant B, ao logar, vê **somente** dados de Tenant B — mesmo que Tenant A tenha sido criado antes e tenha mais dados.
- Platform Admin cria nova empresa e gera acesso para o owner sem precisar de acesso ao banco.
- Cliente com CPF já cadastrado em outra empresa é vinculado automaticamente ao novo tenant sem criar um segundo login.
- Cliente com vínculo em múltiplas empresas escolhe qual contexto visualizar no mobile e pode trocar a qualquer momento.

### 3.4 Incluído no V1

- Correção do isolamento de tenant na autenticação (caminho servidor-side)
- Validação e correção do Control Plane existente (criar tenant, criar owner inicial, suspender, reativar, listar)
- Gerenciamento de Platform Admins (listar, promover, remover)
- Regras de identidade do cliente final: CPF como identificador único global, perfil por tenant, vínculo automático ao cadastrar CPF existente
- Tela de seleção de empresa no mobile (cliente com ≥2 vínculos)
- Bloqueio de acesso a tenant suspenso (membros do tenant perdem acesso; Platform Admin mantém)
- Audit log de todas as ações do Control Plane

### 3.5 Explicitamente fora do V1

| Item | Motivo |
|---|---|
| Cobrança dos tenants (planos, MRR, gateway) | Modelo comercial ainda indefinido — PRD próprio |
| Self-service signup de empresas | Onboarding manual é suficiente para o estágio atual |
| Notificações automáticas por email (Resend) | Dependência de serviço externo — fase posterior |
| Impersonação de tenant (login-as) | Risco de segurança alto sem caso de uso concreto |
| White-label / branding por tenant | Fora da visão do produto por ora |
| Usuário membro de múltiplos tenants | Caso raro — resolvido com emails distintos |
| Usuário com duplo papel (platform_admin + tenant_member) | Impossível por design — os papéis são mutuamente exclusivos; o mesmo email/usuário não pode ter os dois |
| Exclusão permanente de tenant | Somente suspensão indefinida no V1 |
| SSO / SAML | Sem demanda identificada |
| LGPD — direito ao esquecimento | PRD próprio quando houver demanda legal |

---

## 4. Stakeholders

Dono único: Alan (LW Tecnologia).

---

## 5. Personas e User Stories

### 5.1 Tabela de personas

| Persona | Papel no sistema | Frequência de uso | Nível técnico |
|---|---|---|---|
| **Alan / Operador de Suporte LW** | Platform Admin — gerencia o ciclo de vida das empresas-cliente, visualiza estado global da plataforma | Eventual (onboarding, suporte, auditoria) | Alto |
| **Dono da Locadora** | Tenant Owner — configura e opera sua empresa, gerencia membros, visualiza relatórios | Diária | Médio |
| **Funcionário da Locadora** | Membro do Tenant (Admin/Operador) — cadastra clientes, cria contratos, registra cobranças e manutenções | Diária | Baixo a médio |
| **Cliente Final** | Locatário de moto — visualiza suas locações, cobranças e manutenções no mobile | Eventual (quando tem contrato ativo ou dívida pendente) | Baixo |

### 5.2 User Stories

**Platform Admin**

> **US-001** — Como Platform Admin, quero criar uma nova empresa-cliente e gerar o acesso do owner inicial, para que a empresa possa começar a operar sem eu precisar acessar o banco de dados.

> **US-002** — Como Platform Admin, quero suspender uma empresa-cliente informando o motivo, para que seus membros percam acesso imediato ao sistema sem perda de dados.

> **US-003** — Como Platform Admin, quero visualizar um painel com o estado geral da plataforma (empresas ativas, total de motos, contratos, cobranças vencidas), para tomar decisões operacionais e comerciais.

> **US-004** — Como Platform Admin, quero consultar o histórico de ações administrativas (quem criou, suspendeu ou reativou cada empresa), para garantir rastreabilidade de todas as mudanças críticas.

**Dono da Locadora / Funcionário**

> **US-005** — Como Membro do Tenant, quero que ao fazer login eu veja exclusivamente os dados da minha empresa, para ter certeza de que informações de outras locadoras nunca aparecem na minha tela.

> **US-006** — Como Funcionário da Locadora, quero cadastrar um cliente informando apenas o CPF, para que o sistema identifique automaticamente se esse cliente já existe e evite duplicação de cadastro.

**Cliente Final**

> **US-007** — Como Cliente Final, quero acessar o app mobile com meu CPF e senha, para não precisar lembrar de um email específico.

> **US-008** — Como Cliente Final com contratos em mais de uma locadora, quero escolher qual empresa visualizar ao entrar no app, para ver as informações da locadora correta sem misturar dados de empresas diferentes.

> **US-009** — Como Cliente Final, quero alternar entre minhas locadoras dentro do app sem precisar fazer logout, para acessar rapidamente contratos de empresas diferentes.

---

## 6. Fluxos Funcionais

### 6.1 Fluxo A — Login de Membro do Tenant (web)

**Principal:**
1. Usuário acessa o sistema web e informa email e senha
2. Sistema autentica e **resolve o tenant a partir da identidade autenticada no servidor**
3. Sistema direciona para o dashboard da empresa, exibindo exclusivamente os dados daquele tenant
4. Todas as operações da sessão ficam restritas ao tenant resolvido — sem exceção

**Alternativo A1 — Usuário é Platform Admin:**
1. Após autenticação, sistema direciona automaticamente para o Control Plane
2. Sem seleção de contexto

**Erro — Tenant suspenso:**
1. Membro do tenant autentica com sucesso
2. Sistema detecta que o tenant está suspenso na próxima requisição
3. Exibe tela "Sua empresa está temporariamente indisponível" — sem acesso a qualquer dado
4. Platform Admin, ao autenticar, **não é bloqueado** pela suspensão do tenant

**Erro — Credenciais inválidas:**
1. Sistema exibe mensagem genérica sem revelar se o email existe ou não

---

### 6.2 Fluxo B — Login do Cliente Final (mobile)

**Principal (1 vínculo):**
1. Cliente informa CPF e senha
2. Sistema valida o formato do CPF localmente (antes de consultar o servidor)
3. Sistema autentica e identifica os vínculos do cliente
4. Com 1 vínculo: direciona diretamente para o dashboard daquela empresa

**Alternativo B1 — Cliente com N ≥ 2 vínculos:**
1. Após autenticação, sistema exibe tela de seleção de empresa
2. Lista mostra cada empresa com o status do contrato mais recente (ativo, encerrado); empresas de tenants suspensos aparecem como "Temporariamente indisponível" sem opção de acesso
3. Cliente seleciona uma empresa ativa
4. Dashboard exibe exclusivamente os dados daquela empresa
5. Botão "Trocar de empresa" permanece visível durante toda a navegação

**Erro — CPF com formato inválido:**
1. Sistema rejeita antes de consultar o servidor com mensagem de formato
2. Não há chamada de rede para CPF mal formatado

**Erro — CPF não cadastrado ou senha incorreta:**
1. Sistema exibe mensagem genérica: "CPF ou senha incorretos" — não revela qual campo está errado

---

### 6.3 Fluxo C — Onboarding de nova empresa (Platform Admin)

**Principal:**
1. Platform Admin inicia criação de nova empresa no Control Plane
2. Informa dados da empresa (nome, identificador único) e dados do owner inicial (nome, email)
3. Sistema cria a empresa e o usuário owner
4. Sistema gera link de definição de senha para o owner, válido por 72 horas
5. Platform Admin recebe o link e o envia manualmente ao owner (WhatsApp, email)
6. Owner acessa o link, define sua senha e acessa o dashboard da empresa pela primeira vez
7. Ação registrada no audit log com data, responsável e empresa criada

**Erro — Email do owner já em uso:**
1. Sistema detecta que o email informado já pertence a outro usuário
2. Exibe aviso claro; não cria a empresa até o email ser substituído

**Erro — Nome ou identificador de empresa duplicado:**
1. Sistema detecta duplicação e exibe sugestão de alternativa

---

### 6.4 Fluxo D — Cadastro de cliente pelo Membro do Tenant

**Principal (cliente novo no sistema):**
1. Operador inicia cadastro de cliente e informa o CPF
2. Sistema valida o CPF (formato e dígito verificador) antes de consultar o servidor
3. Sistema confirma: CPF não existe no sistema
4. Operador preenche os demais dados (nome, telefone; email de contato é opcional)
5. Sistema cria o cliente e gera link de definição de senha válido por 72 horas
6. Operador envia o link ao cliente

**Alternativo D1 — CPF já existe em outro tenant:**
1. Operador informa o CPF
2. Sistema detecta que o CPF já tem login ativo no GoMoto
3. Exibe aviso: "Este cliente já tem acesso ao GoMoto. Ele usará o mesmo CPF e senha que já possui."
4. Operador preenche os dados do perfil para este tenant (podem ser diferentes dos de outro tenant)
5. Sistema vincula o cliente ao tenant atual — sem criar novo login, sem enviar novo link de senha
6. Empresa de origem do cliente nunca é revelada ao operador

**Erro — CPF inválido:**
1. Bloqueado client-side e server-side com mensagem de formato
2. Sem consulta ao servidor enquanto o CPF for inválido

---

### 6.5 Fluxo E — Suspensão e reativação de tenant

**Suspensão:**
1. Platform Admin acessa o detalhe da empresa no Control Plane
2. Aciona "Suspender" e informa o motivo (obrigatório)
3. Sistema registra suspensão com data, motivo e responsável
4. Na próxima requisição, membros do tenant veem tela de indisponibilidade e perdem acesso a todos os dados
5. Dados da empresa são preservados integralmente
6. Ação registrada no audit log

**Reativação:**
1. Platform Admin aciona "Reativar" na empresa suspensa
2. Sistema remove a suspensão
3. Membros recuperam acesso imediatamente
4. Ação registrada no audit log

---

## 7. Requisitos Funcionais

### 7.1 Control Plane — Gestão de Empresas

**RF-001** — O sistema permite ao Platform Admin criar uma nova empresa informando nome, identificador único e dados do owner inicial (nome e email).

**RF-002** — Ao criar uma empresa, o sistema gera automaticamente o acesso do owner inicial e disponibiliza um link de definição de senha válido por 72 horas.

**RF-003** — O sistema permite ao Platform Admin listar todas as empresas cadastradas, com filtro por status (ativa / suspensa) e busca por nome.

**RF-004** — O sistema permite ao Platform Admin suspender uma empresa ativa, exigindo motivo (preenchimento obrigatório). A suspensão é registrada com data, responsável e motivo.

**RF-005** — O sistema permite ao Platform Admin reativar uma empresa suspensa, restaurando o acesso de todos os seus membros.

**RF-006** — O sistema permite ao Platform Admin visualizar os membros de uma empresa (nome, papel, data de ingresso) em modo somente leitura.

**RF-007** — O sistema permite ao Platform Admin gerenciar a lista de Platform Admins: adicionar usuário existente, remover e alterar papel (Owner / Operator).

**RF-008** — O Control Plane exibe um painel com KPIs agregados: total de empresas ativas e suspensas, total de motos no sistema, total de contratos ativos e total de cobranças vencidas.

**RF-009** — Toda ação executada no Control Plane (criar empresa, suspender, reativar, promover admin) é registrada em audit log com: ator, ação, alvo e data/hora.

---

### 7.2 Autenticação e Isolamento de Tenant

**RF-010** — O sistema resolve o tenant do usuário autenticado exclusivamente a partir da identidade do usuário no servidor, nunca a partir de dados enviados pelo cliente.

**RF-011** — Um usuário autenticado como membro de tenant acessa exclusivamente os dados do seu próprio tenant. Nenhum dado de outro tenant é retornado — em tela, em API ou em exportações.

**RF-012** — Na próxima requisição após a suspensão do seu tenant, o membro recebe tela de indisponibilidade e perde acesso a todos os dados. A sessão de autenticação permanece válida — apenas o acesso aos dados é bloqueado.

**RF-013** — O sistema impede que o mesmo usuário (identificado pelo email) seja simultaneamente Platform Admin e membro de qualquer tenant. Ao tentar criar um tenant com email de Platform Admin existente, ou ao tentar promover a Platform Admin um usuário que é membro de tenant, o sistema rejeita a operação com mensagem de conflito de papel.

**RF-014** — Um usuário sem papel de Platform Admin recebe resposta de "não encontrado" ao tentar acessar rotas do Control Plane, sem revelar a existência dessas rotas.

---

### 7.3 Identidade e Autenticação do Cliente Final

**RF-015** — O cliente final autentica no app mobile informando CPF e senha.

**RF-016** — O sistema valida o formato e o dígito verificador do CPF no dispositivo antes de qualquer consulta ao servidor. CPF inválido é rejeitado imediatamente com mensagem de formato.

**RF-017** — Em falha de autenticação (CPF não cadastrado ou senha incorreta), o sistema exibe mensagem genérica sem revelar qual dos dois campos está errado.

**RF-018** — Cliente com vínculo em exatamente 1 empresa é direcionado automaticamente ao dashboard dessa empresa após autenticação.

**RF-019** — Cliente com vínculo em 2 ou mais empresas vê tela de seleção de empresa após autenticação, com nome da empresa e status do contrato mais recente de cada uma. Empresas com tenant suspenso aparecem como "Temporariamente indisponível" sem opção de acesso.

**RF-020** — Cliente pode alternar entre empresas no app a qualquer momento, sem precisar fazer logout e login novamente.

**RF-021** — Ao visualizar dados no app, o cliente vê exclusivamente os dados da empresa selecionada no contexto ativo. Dados de outras empresas não aparecem em nenhuma tela.

---

### 7.4 Cadastro de Cliente pelo Membro do Tenant

**RF-022** — O sistema valida o CPF informado no cadastro de cliente (formato e dígito verificador) antes de consultar o servidor.

**RF-023** — Ao cadastrar um cliente com CPF já existente no sistema, o sistema vincula o cliente ao tenant atual sem criar novo login, sem enviar novo link de senha, e exibe aviso ao operador.

**RF-024** — O aviso de CPF existente não revela a qual empresa o cliente pertence — apenas informa que o cliente já tem acesso ao GoMoto.

**RF-025** — Ao cadastrar cliente novo (CPF não existente), o sistema gera link de definição de senha válido por 72 horas e o disponibiliza para o operador enviar ao cliente.

**RF-026** — O operador pode gerar um novo link de definição de senha para um cliente cujo link anterior expirou.

---

### 7.5 Links de Acesso

**RF-027** — Link de definição de senha (para owner inicial e para novo cliente) expira em 72 horas após a geração.

**RF-028** — Link de redefinição de senha (esqueci minha senha) expira em 1 hora após a geração.

**RF-029** — Platform Admin pode gerar novo link de definição de senha para owner de empresa cujo link expirou.

---

## 8. Requisitos Não Funcionais

### 8.1 Performance

**RNF-001** — O dashboard do tenant (tela principal após login) carrega e exibe os dados em p95 < 3 segundos para tenants com até 500 motos cadastradas.

**RNF-002** — O fluxo de autenticação completo (login + resolução de tenant + redirecionamento) é concluído em p95 < 2 segundos.

**RNF-003** — A tela de seleção de empresa no mobile (cliente com múltiplos vínculos) renderiza a lista em p95 < 1,5 segundo após a autenticação.

### 8.2 Segurança

**RNF-004** — A sessão web expira após 8 horas de inatividade. A sessão mobile usa refresh token com validade de 30 dias; após expiração, o cliente precisa autenticar novamente com CPF e senha.

**RNF-005** — O sistema aplica limite de tentativas de autenticação: após 5 tentativas consecutivas malsucedidas, o acesso pelo mesmo identificador é bloqueado por 15 minutos.

**RNF-006** — Nenhum dado de tenant B é retornado em resposta a requisições de um usuário autenticado no tenant A — mesmo com manipulação de parâmetros, IDs ou headers na requisição.

**RNF-007** — O audit log do Control Plane é imutável: nenhum tipo de usuário (incluindo Platform Admin) pode editar ou excluir registros após criação.

### 8.3 Privacidade (LGPD)

**RNF-008** — CPF e demais dados pessoais do cliente (nome, telefone) são acessíveis apenas por membros do tenant ao qual o cliente está vinculado. A empresa A não enxerga nenhum dado de como a empresa B cadastrou o mesmo cliente.

**RNF-009** — O sistema não revela a existência de um CPF no sistema a nenhum usuário externo (anti-enumeração): falhas de autenticação retornam mensagem genérica sem distinção entre "CPF não existe" e "senha incorreta".

**RNF-010** — Dados de clientes não são compartilhados entre tenants em nenhuma circunstância, mesmo quando dois tenants possuem vínculo com o mesmo cliente físico.

### 8.4 Disponibilidade

**RNF-011** — O sistema mantém disponibilidade de 99,5% em horário comercial (07h–20h, horário de Brasília). Manutenções programadas são comunicadas com antecedência mínima de 24 horas.

### 8.5 Compatibilidade

**RNF-012** — A interface web é funcional nos dois últimos major releases dos navegadores Chrome, Firefox e Safari (desktop).

**RNF-013** — O app mobile é funcional em dispositivos com Android 10 ou superior e iOS 14 ou superior.

---

## 9. Regras de Negócio

### 9.1 Identidade e autenticação

**RN-001** — Um email é associado a um e somente um usuário em todo o sistema. Não é possível criar dois usuários com o mesmo email, independentemente do tipo de usuário ou tenant.

**RN-002** — Um CPF identifica globalmente uma única pessoa física no sistema. Um CPF corresponde a um único login de cliente final — não há dois logins para o mesmo CPF.

**RN-003** — O login de Platform Admins e membros de tenant usa email e senha. O login de clientes finais usa CPF e senha. Os dois mecanismos são independentes e não intercambiáveis.

**RN-004** — O contexto de tenant de uma sessão é sempre determinado pelo servidor a partir da identidade autenticada. O sistema nunca aceita o identificador de tenant enviado pelo cliente como fonte de verdade.

### 9.2 Isolamento de dados entre tenants

**RN-005** — Todo dado criado dentro de um tenant pertence exclusivamente àquele tenant e nunca é acessível por usuários de outro tenant, seja por interface, API ou exportação.

**RN-006** — Um membro de tenant não pode ler, criar, editar ou excluir dados de nenhum outro tenant — mesmo que conheça identificadores válidos de registros de outros tenants.

**RN-007** — Um cliente final visualiza, em cada sessão, apenas os dados do tenant selecionado como contexto ativo. Dados de outros tenants onde o cliente também possui vínculo não aparecem em nenhuma tela.

### 9.3 Cliente final em múltiplos tenants

**RN-008** — Um cliente final pode ter perfil em múltiplos tenants simultaneamente. Cada perfil é independente: os dados podem diferir entre tenants e são gerenciados de forma isolada por cada empresa.

**RN-009** — Ao cadastrar um CPF que já possui login no sistema, o tenant atual recebe um novo perfil de cliente vinculado ao login existente. Nenhum novo login é criado. O cliente usa as mesmas credenciais para acessar qualquer tenant onde esteja vinculado.

**RN-010** — Um tenant que cadastra um CPF existente não recebe nenhuma informação sobre os outros tenants onde esse cliente possui vínculo.

**RN-011** — O email de contato do perfil de cliente (campo opcional) é usado exclusivamente para comunicação. Nunca é usado para autenticação e não precisa ser único no sistema.

### 9.4 Control Plane e ciclo de vida de tenants

**RN-012** — Somente um Platform Admin com papel Owner pode criar, suspender ou reativar tenants.

**RN-013** — Somente um Platform Admin com papel Owner pode promover ou remover outros Platform Admins.

**RN-014** — O primeiro Platform Admin Owner é criado por processo de bootstrap controlado, fora da interface do sistema.

**RN-015** — Os papéis de Platform Admin e Membro de Tenant são mutuamente exclusivos para o mesmo usuário (email). Um usuário não pode ser simultaneamente Platform Admin e membro de qualquer tenant. O sistema reforça essa regra em nível de banco de dados (trigger) e em nível de aplicação (Server Actions de criação de tenant e promoção de Platform Admin).

### 9.5 Suspensão de tenant

**RN-016** — A suspensão de um tenant exige motivo obrigatório, registrado permanentemente no audit log junto com data e responsável.

**RN-017** — Um tenant suspenso tem todos os dados preservados integralmente. A suspensão bloqueia acesso, não apaga dados.

**RN-018** — Membros de um tenant suspenso perdem acesso na próxima requisição ao sistema. A sessão de autenticação não é invalidada — apenas o acesso aos dados é bloqueado.

**RN-019** — A suspensão de um tenant não afeta o acesso de um cliente final que possui vínculo em outros tenants ativos. O cliente continua acessando os demais tenants normalmente.

**RN-020** — Um membro de tenant suspenso mantém seu vínculo com o tenant. Ao reativar o tenant, o membro recupera o acesso sem necessidade de recadastro ou novo convite.

### 9.6 Audit log

**RN-021** — Toda ação executada no Control Plane gera um registro no audit log contendo: quem executou, qual ação, qual o alvo e quando. Esse registro é imutável — não pode ser editado ou excluído por nenhum tipo de usuário.

**RN-022** — O audit log do Control Plane é separado dos registros operacionais de cada tenant.

---

## 10. Critérios de Aceite

### 10.1 Control Plane — Gestão de empresas

**CA-001 (RF-001, RF-002)** — Criação de empresa
> **Dado** que sou Platform Admin Owner no Control Plane,
> **Quando** preencho nome da empresa, identificador único, nome e email do owner e confirmo,
> **Então** a empresa é criada com status ativo, um link de definição de senha válido por 72 horas é gerado para o owner, e a ação aparece no audit log com meu usuário como responsável.

**CA-002 (RF-001)** — Email do owner já em uso
> **Dado** que sou Platform Admin Owner,
> **Quando** informo o email do owner com um endereço já cadastrado no sistema,
> **Então** o sistema exibe aviso de email em uso e não cria a empresa até que o email seja substituído.

**CA-003 (RF-003)** — Listagem e filtro de empresas
> **Dado** que sou Platform Admin,
> **Quando** acesso a lista de empresas e filtro por status "suspensa",
> **Então** apenas empresas com status suspenso são exibidas, sem misturar empresas ativas.

**CA-004 (RF-004)** — Suspensão com motivo
> **Dado** que sou Platform Admin Owner e existe uma empresa ativa,
> **Quando** aciono "Suspender" e informo o motivo,
> **Então** a empresa passa para status suspenso e o audit log registra: meu usuário, data/hora e o motivo informado.

**CA-005 (RF-004)** — Suspensão sem motivo bloqueada
> **Dado** que sou Platform Admin Owner,
> **Quando** aciono "Suspender" sem preencher o campo de motivo,
> **Então** o sistema bloqueia a ação e exige o preenchimento do motivo antes de prosseguir.

**CA-006 (RF-005)** — Reativação de empresa
> **Dado** que uma empresa está com status suspenso,
> **Quando** Platform Admin Owner aciona "Reativar",
> **Então** a empresa volta ao status ativo, a ação é registrada no audit log, e os membros recuperam acesso na próxima requisição.

**CA-007 (RF-006)** — Membros do tenant: somente leitura no Control Plane
> **Dado** que sou Platform Admin,
> **Quando** acesso a lista de membros de um tenant no Control Plane,
> **Então** vejo nome, papel e data de ingresso de cada membro, sem nenhuma opção de edição, remoção ou adição disponível.

**CA-008 (RF-007, RN-013)** — Restrição de gestão de Platform Admins
> **Dado** que sou Platform Admin com papel Operator (não Owner),
> **Quando** tento adicionar ou remover um Platform Admin,
> **Então** a ação é negada — a interface exibe a opção desabilitada e a API rejeita a requisição.

**CA-009 (RF-008)** — KPIs do painel
> **Dado** que sou Platform Admin,
> **Quando** acesso o painel do Control Plane,
> **Então** os números exibidos de tenants ativos, motos e contratos são consistentes com os valores reais nas tabelas do sistema.

**CA-010 (RF-009)** — Imutabilidade do audit log
> **Dado** que uma ação foi registrada no audit log do Control Plane,
> **Quando** qualquer usuário (incluindo Platform Admin Owner) tenta editar ou excluir esse registro,
> **Então** a operação é negada — o registro permanece inalterado.

---

### 10.2 Autenticação e isolamento de tenant

**CA-011 (RF-010, RF-011)** — Resolução correta de tenant *(cobre o bug crítico)*
> **Dado** que existem dois tenants (A e B) com usuários distintos e dados distintos,
> **Quando** o usuário do Tenant B faz login,
> **Então** o sistema resolve o contexto como Tenant B e todas as telas exibem exclusivamente dados do Tenant B — nenhum dado do Tenant A aparece.

**CA-012 (RF-011)** — Acesso cross-tenant via parâmetro manipulado
> **Dado** que o usuário do Tenant B está autenticado,
> **Quando** tenta acessar um recurso usando o ID de um registro pertencente ao Tenant A (por manipulação de URL ou parâmetro),
> **Então** o sistema retorna "não encontrado" sem revelar que o recurso existe em outro tenant.

**CA-013 (RF-012)** — Bloqueio de membro na próxima requisição após suspensão
> **Dado** que o Tenant A é suspenso enquanto um membro tem sessão ativa,
> **Quando** o membro faz a próxima requisição ao sistema,
> **Então** o membro vê tela de indisponibilidade e não consegue acessar nenhum dado do Tenant A.

**CA-014 (RF-012, RN-019)** — Suspensão de tenant não afeta cliente em outro tenant ativo
> **Dado** que um cliente possui vínculo no Tenant A (suspenso) e no Tenant B (ativo),
> **Quando** o cliente abre o app mobile,
> **Então** o Tenant A aparece na lista de seleção como "Temporariamente indisponível" (sem acesso) e o cliente acessa o Tenant B normalmente.

**CA-015 (RF-013)** — Rejeição de email conflitante ao criar tenant
> **Dado** que sou Platform Admin Owner,
> **Quando** informo o email do owner de uma nova empresa com um endereço que já pertence a um Platform Admin,
> **Então** o sistema rejeita a criação e exibe mensagem de conflito de papel — informando que o email já é um administrador da plataforma.

**CA-016 (RF-014)** — Proteção das rotas do Control Plane
> **Dado** que um usuário autenticado é apenas membro de tenant (sem papel de Platform Admin),
> **Quando** tenta acessar qualquer rota do Control Plane,
> **Então** recebe resposta de "não encontrado", sem revelar que a rota existe.

---

### 10.3 Autenticação do cliente final (mobile)

**CA-017 (RF-015, RF-016)** — Login com CPF válido
> **Dado** que sou cliente com CPF cadastrado e senha definida,
> **Quando** informo CPF e senha corretos no app mobile,
> **Então** o sistema autentica e me direciona para o dashboard da empresa (ou tela de seleção, se tiver múltiplos vínculos).

**CA-018 (RF-016)** — CPF inválido bloqueado antes de chamada ao servidor
> **Dado** que estou na tela de login do mobile,
> **Quando** informo um CPF com dígito verificador incorreto,
> **Então** o sistema exibe mensagem de CPF inválido imediatamente, sem realizar nenhuma requisição ao servidor.

**CA-019 (RF-017)** — Mensagem genérica em falha de autenticação
> **Dado** que sou cliente,
> **Quando** informo CPF não cadastrado ou senha incorreta,
> **Então** o sistema exibe "CPF ou senha incorretos", sem revelar qual dos dois campos está errado.

**CA-020 (RF-018)** — Cliente com vínculo único vai direto ao dashboard
> **Dado** que sou cliente com vínculo em exatamente 1 empresa,
> **Quando** autentico no app,
> **Então** sou direcionado diretamente ao dashboard dessa empresa, sem passar pela tela de seleção.

**CA-021 (RF-019)** — Cliente com múltiplos vínculos vê tela de seleção
> **Dado** que sou cliente com vínculo em 2 ou mais empresas,
> **Quando** autentico no app,
> **Então** vejo a tela de seleção listando todas as empresas com o status do contrato mais recente de cada uma.

**CA-022 (RF-020, RF-021)** — Alternância de empresa sem logout
> **Dado** que estou no app visualizando dados da Empresa A,
> **Quando** aciono "Trocar de empresa" e seleciono a Empresa B,
> **Então** todas as telas passam a exibir exclusivamente dados da Empresa B — nenhum dado da Empresa A aparece.

---

### 10.4 Cadastro de cliente pelo operador

**CA-023 (RF-022)** — CPF inválido bloqueado no cadastro
> **Dado** que sou operador cadastrando um cliente,
> **Quando** informo um CPF com dígito verificador inválido,
> **Então** o sistema bloqueia o cadastro com mensagem de CPF inválido antes de consultar o servidor.

**CA-024 (RF-023, RF-024)** — CPF existente — vinculação sem revelar origem
> **Dado** que sou operador e o CPF informado já possui login no sistema (em outro tenant),
> **Quando** confirmo o cadastro com os dados do perfil para meu tenant,
> **Então** o sistema vincula o cliente ao meu tenant sem criar novo login, exibe aviso de que o cliente já tem acesso ao GoMoto, e não revela qual outra empresa possui vínculo com esse cliente.

**CA-025 (RF-025, RF-027)** — Link de senha gerado para novo cliente
> **Dado** que um novo cliente foi cadastrado com CPF não existente no sistema,
> **Quando** o operador acessa o cadastro do cliente,
> **Então** um link de definição de senha válido por 72 horas está disponível para envio ao cliente.

**CA-026 (RF-027)** — Link expirado informa o próximo passo
> **Dado** que o link de definição de senha de um cliente foi gerado há mais de 72 horas,
> **Quando** o cliente tenta acessá-lo,
> **Então** o sistema informa que o link expirou e instrui o cliente a solicitar novo link ao operador da locadora.

**CA-027 (RF-026)** — Operador gera novo link para cliente
> **Dado** que o link de definição de senha de um cliente expirou,
> **Quando** o operador aciona "Gerar novo link",
> **Então** um novo link válido por 72 horas é gerado, o anterior é invalidado, e o novo link fica disponível para envio.

**CA-028 (RF-028)** — Link de redefinição de senha expira em 1 hora
> **Dado** que um cliente acionou "Esqueci minha senha" e recebeu o link,
> **Quando** tenta usar o link após 1 hora,
> **Então** o sistema informa que o link expirou e oferece a opção de solicitar novo link.

**CA-029 (RF-029)** — Platform Admin regenera link do owner
> **Dado** que o link de definição de senha de um owner de tenant expirou,
> **Quando** o Platform Admin acessa o detalhe da empresa e aciona "Gerar novo link",
> **Então** um novo link válido por 72 horas é gerado, o anterior é invalidado, e o novo link fica disponível para cópia e envio manual.

---

## 11. Dependências e Riscos

### 11.1 Dependências

**PRDs relacionados:**

| PRD | Relação |
|---|---|
| PRD 0004 — Locação e Cobranças | Depende do isolamento de tenant funcionando corretamente |
| PRD 0005 — Integração Mercado Pago | Depende da identidade de tenant resolvida corretamente para associar pagamentos ao tenant correto |

**ADRs a revisar:**

| ADR | Ação necessária |
|---|---|
| ADR 0003 — Escopo e auth do mobile cliente | Revisar à luz de RN-002 e RN-009 (CPF global, perfil por tenant) |
| ADR 0004 — Control plane e identidade do cliente | Atualizar para refletir a correção da contradição CPF único global vs. cliente em múltiplos tenants |

**Dependências de plataforma:**
- **Supabase Auth** — restrições de design (email único, estrutura do JWT) devem ser respeitadas pela Spec ao implementar o login por CPF.
- Sem novas dependências externas previstas para este escopo.

### 11.2 Riscos

| # | Risco | Categoria | Prob | Impacto | Mitigação |
|---|---|---|---|---|---|
| R-01 | Bug de isolamento está em produção: dados de um tenant podem estar acessíveis a membros de outro tenant | Técnico / Segurança | Alta | Crítico | Bloquear onboarding de novos tenants até CA-011 e CA-012 estarem validados |
| R-02 | CPFs duplicados na tabela de clientes: o mesmo cliente já cadastrado em dois tenants antes da correção do modelo | Dados | Baixa | Médio | Auditar dados existentes antes de qualquer migração; definir política de resolução na Spec |
| R-03 | Link de definição de senha expirado sem regeneração: cliente fica bloqueado sem saber o que fazer | Produto / Operacional | Média | Baixo-Médio | Interface clara com status do link (ativo / expirado) e instrução ao cliente |
| R-04 | Confusão de contexto no mobile: cliente com múltiplos vínculos não percebe em qual empresa está navegando | Produto / UX | Média | Médio | Indicador visual permanente do nome da empresa ativa no header do mobile |
| R-05 | Bootstrap do primeiro Platform Admin: processo crítico executado uma única vez; perda de acesso sem interface de recuperação | Operacional | Baixa | Alto | Documentar o processo explicitamente; manter credenciais de emergência em local seguro |
| R-06 | Scope creep de isolamento: outras partes do sistema (relatórios, exportações, webhooks) também podem não respeitar isolamento | Técnico | Média | Alto | A Spec deve auditar todos os pontos de acesso a dados, não apenas as telas principais |

---

## 12. Questões Abertas e Aprovação Final

### 12.1 Questões abertas

Nenhuma questão aberta. Todas as decisões foram fechadas durante a revisão deste PRD.

*Itens explicitamente adiados para vNext:*

| Item | Motivo |
|---|---|
| Notificações automáticas por email (Resend) | Dependência de serviço externo; operador envia link manualmente no V1 |
| LGPD — direito ao esquecimento e anonimização | PRD próprio quando houver demanda legal |
| Acessibilidade WCAG | Sem demanda identificada para este ciclo |
| Rate limiting — mecanismo (por IP vs. por identificador) | Decisão técnica; pertence à Spec |

### 12.2 Checklist de validação

- [x] Todas as seções obrigatórias presentes (§1, §3, §5, §6, §7, §8, §9, §10, §11, §12)
- [x] Seções opcionais tratadas (§2 Glossário: presente; §4 Stakeholders: pulado — dono único registrado)
- [x] Zero placeholders
- [x] Todo RF tem ≥ 1 CA (29 RFs → 29 CAs)
- [x] Todo CA aponta para RF ou RN
- [x] §12.1 sem item pendente
- [x] Status atualizado para `aprovado`

---

`#prd` `#plataforma` `#multi-tenant` `#autenticacao` `#controle-de-acesso`
