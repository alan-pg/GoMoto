---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-07-01
adr: "[[decisions/000X-generalizacao-motorcycle-para-vehicle]]"
related:
  - "[[PRDs/0002-cadastro-de-motos-documentacao-e-tco]]"
  - "[[PRDs/0006-cadastro-de-veiculos-revisao]]"
  - "[[Banco de Dados]]"
  - "[[Arquitetura]]"
tags:
  - prd
  - generalizacao-entidade-veiculo
  - veiculos
---

# PRD 0007 — Generalização da Entidade Veículo (motorcycle → vehicle)

> ✅ **Status: aprovado** em 2026-07-01. Define a substituição total da entidade `motorcycle` pela entidade `vehicle` em todas as camadas do sistema — banco de dados, domínio, dados e interface — como pré-requisito para a implementação do PRD 0006. Próximo passo: criar ADR em `obsidian-notes/decisions/` e implementar migration de rename.

---

## 1. Visão Geral

### 1.1 Contexto

O GoMoto nasceu como sistema de gestão de locação de motocicletas. A entidade central do domínio foi modelada como `motorcycle`, com telas, formulários e relações (contratos, manutenções, multas, fila, despesas, cobranças) apontando para esse conceito. À medida que o produto evoluiu para cobrir locação de veículos em geral, uma segunda entidade `vehicle` foi introduzida — criando duas representações paralelas do mesmo conceito no sistema.

O sistema ainda está em desenvolvimento e não entrou em produção. Esta janela é a oportunidade de consolidar as entidades antes do lançamento, sem necessidade de migração de dados de produção.

O PRD 0006 (aprovado em 2026-06-30) estende o módulo de veículos com ciclo de vida, galeria de fotos, rastreador e seguro. A implementação do PRD 0006 ocorre **depois** deste PRD — ou seja, este PRD é pré-requisito para o PRD 0006.

### 1.2 Resumo executivo

Este PRD define a **generalização da entidade central de frota**, substituindo `motorcycle` por `vehicle` como entidade canônica e única em todo o sistema. A mudança inclui:

- Consolidação em uma única entidade `vehicle`, que absorve todos os campos e relações da entidade `motorcycle`
- Atualização de todas as relações do domínio (contratos, manutenções, multas, fila, despesas, cobranças) para referenciar `vehicle`
- Atualização da linguagem de produto nas telas: rótulos genéricos "moto" → "veículo", rota `/motos` → `/veiculos`, menu "Motos" → "Veículos"

Tipo de veículo (moto, carro, van…) é escopo do PRD 0006 e não entra neste PRD.

### 1.3 Problema central

> O sistema possui dois modelos coexistentes para representar o mesmo conceito — o ativo locável da frota. Essa dualidade cria inconsistência no domínio e impede a implementação limpa do PRD 0006. A consolidação precisa ocorrer antes da entrada em produção e antes de qualquer nova feature do módulo de veículos.

---

## 2. Glossário

Nenhum termo novo. Vocabulário existente do domínio GoMoto é suficiente.

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

| Objetivo | Critério observável |
|---|---|
| Domínio unificado | Nenhum artefato do sistema (tabela, tipo, schema, hook, repositório, componente) usa o nome `motorcycle` |
| Linguagem de produto consistente | Nenhuma tela exibe "moto" em rótulo genérico; menu e rotas refletem "veículos" |
| Base limpa para PRD 0006 | A implementação do PRD 0006 parte da entidade `vehicle` consolidada, sem herança da entidade `motorcycle` |

### 3.2 Objetivos do usuário

- O Operador de Frota navega pelo sistema usando a terminologia "veículos" em menus, rotas e telas.
- O Cliente Locatário vê as informações do seu veículo com terminologia genérica no app mobile.

### 3.3 Métricas de sucesso

- `pnpm build` passa sem erros após a generalização.
- Todos os testes E2E passam após atualização de terminologia.
- Busca por "motorcycle" no código retorna zero ocorrências fora de migrations históricas.
- Menu e rota `/veiculos` ativos e funcionais na aplicação web.

### 3.4 Incluído em V1

1. Banco de dados: renomear tabela central e todas as chaves estrangeiras dependentes.
2. `@gomoto/core`: renomear tipos TypeScript, schemas Zod e regras de negócio.
3. `@gomoto/data`: renomear hooks TanStack Query e repositórios Supabase.
4. `apps/web`: atualizar todas as referências de código e rótulos de UI; renomear rota `/motos` → `/veiculos` e item de menu.
5. `apps/mobile`: atualizar todas as referências de código e rótulos de UI.
6. Testes E2E e helpers: atualizar referências.
7. Seed de desenvolvimento: atualizar dados de exemplo.

### 3.5 Não-objetivos (explicitamente fora de V1)

| Item | Motivo |
|---|---|
| Campo "tipo de veículo" (moto, carro, van…) | Escopo do PRD 0006 |
| Novas features ou mudança de regras de negócio | Este PRD é padronização — sem nova lógica |
| Migração de dados em produção | Sistema ainda em desenvolvimento; não há dados de produção |
| Redesenho de telas ou UX | Escopo do PRD 0006; V1 preserva layouts existentes |
| Atualização de migrations históricas | Migrations existentes são imutáveis; a generalização cria nova migration |

### 3.6 Módulos e arquivos impactados

| Camada | Escopo |
|---|---|
| Banco de dados | Tabela `motorcycles`; FKs `motorcycle_id` em: `vehicle_documents`, `vehicle_obligations`, `billings`, `maintenances`, `fines`, `expenses`, `maintenance_records`, `maintenance_plans` |
| `@gomoto/core` | Tipos `Motorcycle`, `MotorcycleStatus`, `MotorcycleCostSummary`, `MotorcycleFinancialEvent`; schemas `MotorcycleSchema`; regras em `motorcycles.ts` |
| `@gomoto/data` | Hooks `useMotorcycles`, `useMotorcycleCosts`; repositórios `motorcycles.ts`, `motorcycleCosts.ts` |
| `apps/web` | 11 arquivos de tela/action: contratos, locações, manutenção, motos, multas, clientes, dashboard, aprovações, despesas, entradas, admin; componente `MotorcycleMap.tsx` |
| `apps/mobile` | 3 arquivos: tela de manutenções, modal de registro de manutenção, tela de cobranças |
| Testes | 3 specs E2E + arquivo helpers |
| Seed | `supabase/seed.sql` |

### 3.7 Telas e rotas impactadas

| Tela / Rota | Tipo de mudança |
|---|---|
| `/motos` → `/veiculos` | Renomeação de rota + rótulos de UI |
| Sidebar / menu de navegação | Rótulo "Motos" → "Veículos" |
| Contratos, Locações, Manutenção, Multas, Clientes, Dashboard, Aprovações, Despesas, Entradas, Admin | Atualização de referências internas (sem mudança de layout) |
| App mobile: manutenções, modal de manutenção, cobranças | Atualização de rótulos e referências internas |

---

## 4. Stakeholders

Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Descrição | Frequência de uso | Nível técnico |
|---|---|---|---|
| **Operador de Frota** | Usuário autenticado do tenant (dono ou funcionário). Gerencia frota, contratos, manutenções e cobranças via aplicação web. | Diária | Básico — usuário de sistema web simples |
| **Cliente Locatário** | Cliente com contrato ativo. Acessa o app mobile para visualizar manutenções e cobranças do veículo locado. | Eventual | Básico — usuário de app mobile |

### 5.2 User Stories

| # | Como | Quero | Para |
|---|---|---|---|
| US-001 | Operador de Frota | navegar pelo sistema usando a terminologia "veículos" em menus, rotas e telas | que o sistema reflita a realidade da frota, que pode incluir qualquer tipo de veículo |
| US-002 | Operador de Frota | que todos os módulos (contratos, manutenção, multas, cobranças, despesas) referenciem "veículo" de forma consistente | eliminar confusão terminológica no dia a dia de operação |
| US-003 | Cliente Locatário | ver as informações do meu veículo com terminologia genérica no app mobile | que as mensagens façam sentido independentemente do tipo de veículo que eu alugar |

---

## 6. Fluxos Funcionais

Esta feature é uma padronização — os fluxos existentes são preservados. Os documentos abaixo descrevem onde a experiência muda na jornada do usuário.

### 6.1 Fluxo Principal — Operador navega para gestão de frota

```
[Operador] acessa o sistema autenticado

Menu lateral:
  ANTES: item "Motos"     → rota /motos
  DEPOIS: item "Veículos" → rota /veiculos

[Operador] clica em "Veículos"
  → Lista de veículos exibida (mesmo layout atual)
  → Botão "Novo veículo" (era "Nova moto")
  → Colunas e filtros com terminologia "veículo"
```

### 6.2 Fluxos Alternativos

**Operador cadastra ou edita veículo:**

```
[Operador] /veiculos → "Novo veículo"
  → Formulário de cadastro (campos idênticos ao atual)
  → Rótulos genéricos usam "veículo" em vez de "moto"
  → Salvar → redireciona para /veiculos

[Operador] /veiculos → seleciona veículo → "Editar"
  → Mesmo comportamento; terminologia atualizada
```

**Operador acessa módulos relacionados:**

```
Contratos / Locações / Manutenção / Multas / Despesas / Cobranças:
  → Campos e rótulos que referenciavam "moto" agora exibem "veículo"
  → Funcionalidade e layout inalterados
```

**Cliente Locatário no app mobile:**

```
[Cliente] abre app → aba Manutenções

  ANTES:
    Subtítulo: "Próximas e histórico da sua moto"
    Campo:     "KM atual da moto"
    Vazio:     "Nenhuma manutenção pendente — sua moto está em dia."
    Fallback:  "Moto não identificada"

  DEPOIS:
    Subtítulo: "Próximas e histórico do seu veículo"
    Campo:     "KM atual do veículo"
    Vazio:     "Nenhuma manutenção pendente — seu veículo está em dia."
    Fallback:  "Veículo não identificado"

  → Funcionalidade inalterada
```

### 6.3 Fluxos de Erro

| Situação | Comportamento |
|---|---|
| Operador acessa rota `/motos` diretamente (bookmark antigo) | Redirecionamento automático para `/veiculos` |
| Qualquer erro funcional existente (validação, rede, duplicidade) | Comportamento idêntico ao atual — esta feature não altera lógica de erro |

---

## 7. Requisitos Funcionais

### Navegação e roteamento

- **RF-001** — O sistema redireciona automaticamente acessos à rota `/motos` para `/veiculos`.
- **RF-002** — O menu de navegação da aplicação web exibe o item "Veículos" apontando para `/veiculos`. Nenhum item chamado "Motos" existe no menu.

### Tela de listagem e formulários (web)

- **RF-003** — A tela de listagem de veículos (`/veiculos`) exibe a terminologia "veículo / veículos" em: título da página, botão de criação, rótulos de colunas e filtros.
- **RF-004** — O formulário de cadastro e edição de veículo exibe "veículo" em rótulos genéricos de entidade. Rótulos específicos de atributo (Placa, RENAVAM, Cilindrada, Chassi e similares) permanecem inalterados.

### Módulos relacionados (web)

- **RF-005** — As telas de Contratos, Locações, Manutenção, Multas, Despesas, Cobranças, Entradas, Dashboard e Admin exibem "veículo" em qualquer coluna, filtro ou mensagem que anteriormente referenciava "moto" de forma genérica.

### App mobile

- **RF-006** — O modal de registro de manutenção no app mobile exibe o rótulo "KM atual do veículo".
- **RF-007** — A tela de manutenções do app mobile exibe: subtítulo "Próximas e histórico do seu veículo", estado vazio "Nenhuma manutenção pendente — seu veículo está em dia." e fallback "Veículo não identificado".

### Entidade canônica e integridade funcional

- **RF-008** — O domínio de frota é representado exclusivamente pela entidade "veículo". Após a generalização, nenhuma camada do sistema (banco de dados, domínio, dados, interface) possui entidade nomeada "motorcycle".
- **RF-009** — Todos os módulos dependentes do ativo da frota (contratos, manutenções, multas, cobranças, despesas) referenciam "veículo" como entidade central. Nenhuma funcionalidade existente é removida ou alterada comportamentalmente.

---

## 8. Requisitos Não Funcionais

### Integridade de dados

- **RNF-001** — A generalização não deve resultar em perda de dados. Todos os registros existentes de veículos, contratos, manutenções, multas, despesas e cobranças devem estar integralmente presentes e acessíveis após a migration de banco de dados.
- **RNF-002** — Todas as relações entre entidades (contratos vinculados a veículos, manutenções vinculadas a veículos, etc.) devem ser preservadas com a mesma integridade referencial após a generalização.

### Segurança e isolamento de tenant

- **RNF-003** — O isolamento de tenant deve ser mantido após a generalização. Dados de veículos, contratos e módulos relacionados de um tenant nunca são visíveis a outro tenant. A renomeação das entidades não deve alterar esse comportamento.

### Qualidade de entrega

- **RNF-004** — O build completo do monorepo (`pnpm build`) deve passar sem erros após a generalização. Nenhum erro de tipo TypeScript ou falha de compilação é aceitável.
- **RNF-005** — Os testes E2E existentes devem continuar passando após a generalização (adaptados para a nova terminologia onde necessário). Nenhum teste existente deve ser removido — apenas atualizado.

### Performance

- **RNF-006** — A generalização não deve introduzir regressão de performance observável em nenhuma tela. Os tempos de resposta existentes são mantidos como referência.

---

## 9. Regras de Negócio

### Substituição e coexistência

- **RN-001** — A entidade `vehicle` substitui totalmente a entidade `motorcycle`. As duas entidades não coexistem no sistema após a generalização. Não há período de transição com ambas ativas em paralelo.

### Preservação de regras existentes

- **RN-002** — Todas as regras de negócio que operavam sobre a entidade `motorcycle` são preservadas sem alteração semântica na entidade `vehicle`. Isso inclui: unicidade de placa por tenant, imutabilidade do KM de entrada, ciclo de vida de contratos, vínculos de manutenção, multa, despesa e cobrança.
- **RN-003** — A placa de um veículo é única dentro do mesmo tenant. Esta regra é herdada da entidade `motorcycle` e mantida integralmente na entidade `vehicle`.

### Escopo da renomeação

- **RN-004** — A generalização é estritamente uma renomeação de entidade e atualização de terminologia. Nenhuma regra de negócio nova é introduzida e nenhuma regra existente é modificada ou removida neste PRD.
- **RN-005** — O nome do produto "GoMoto" não é afetado pela generalização. Apenas rótulos internos de entidade são atualizados de "moto/motorcycle" para "veículo/vehicle".

### Histórico e migrations

- **RN-006** — Migrations históricas são imutáveis. A generalização introduz nova migration sem alterar o histórico existente de migrações do banco de dados.

---

## 10. Critérios de Aceite

### Navegação e roteamento

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-001 (RF-001) | Operador possui link ou bookmark para `/motos` | Acessa essa rota no navegador | É redirecionado automaticamente para `/veiculos` |
| CA-002 (RF-002) | Operador está autenticado no sistema | Visualiza o menu lateral | O item "Veículos" é exibido; o item "Motos" não existe no menu |

### Tela de listagem e formulários (web)

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-003 (RF-003) | Operador acessa `/veiculos` | Visualiza a tela de listagem | Título da página, botão de criação e rótulos de colunas usam "veículo/veículos" |
| CA-004 (RF-004) | Operador acessa o formulário de cadastro de veículo | Visualiza os rótulos genéricos de entidade | Vê "veículo" nos rótulos de entidade; não vê "moto" em nenhum rótulo genérico |

### Módulos relacionados (web)

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-005 (RF-005) | Operador acessa a tela de Contratos | Visualiza a coluna que antes exibia "Moto" | Coluna exibe "Veículo" |
| CA-006 (RF-005) | Operador acessa a tela de Manutenção | Visualiza rótulos genéricos de entidade | Vê "veículo" nos rótulos; não vê "moto" |

### App mobile

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-007 (RF-006) | Cliente locatário abre o modal de registro de manutenção | Visualiza o campo de quilometragem | Rótulo exibe "KM atual do veículo" |
| CA-008 (RF-007) | Cliente locatário acessa a tela de manutenções | Não há manutenções pendentes | Estado vazio exibe "Nenhuma manutenção pendente — seu veículo está em dia." |
| CA-009 (RF-007) | Cliente locatário acessa a tela de manutenções | Sistema não consegue identificar o veículo | Texto de fallback exibe "Veículo não identificado" |
| CA-010 (RF-007) | Cliente locatário acessa a tela de manutenções | Visualiza o subtítulo da tela | Subtítulo exibe "Próximas e histórico do seu veículo" |

### Entidade canônica e integridade funcional

| # | Dado | Quando | Então |
|---|---|---|---|
| CA-011 (RF-008) | Generalização implementada | Sistema está em execução | Nenhuma tabela, tipo TypeScript, schema Zod, hook ou repositório usa o nome "motorcycle" |
| CA-012 (RF-009) | Operador tem veículo com contrato de locação ativo | Acessa a tela de Contratos após a generalização | Contrato exibe os dados do veículo corretamente, sem perda de informação |
| CA-013 (RF-009) | Operador tem registros históricos de manutenção vinculados a um veículo | Acessa a tela de Manutenção após a generalização | Todos os registros de manutenção são exibidos corretamente |

---

## 11. Dependências e Riscos

### 11.1 Dependências

| Dependência | Tipo | Estado | Detalhe |
|---|---|---|---|
| **PRD 0002** — Cadastro de motos, documentação e TCO | PRD interno | Implementado | Fornece a tabela `motorcycles` e todas as tabelas dependentes que este PRD generaliza. |
| **PRD 0006** — Revisão do módulo de veículos | PRD interno | Aprovado, não implementado | Este PRD é pré-requisito do PRD 0006. A implementação do PRD 0006 só deve iniciar após este PRD estar completamente implementado e testado. |
| **Multi-tenancy + RLS** | Infraestrutura | Implementado (Fase 5) | A nova entidade `vehicle` deve herdar as mesmas políticas de isolamento de tenant: `tenant_id NOT NULL`, RLS habilitada, acesso via `get_user_tenants()`. |
| **Monorepo Turbo** | Infraestrutura | Implementado | A generalização afeta três pacotes interdependentes (`@gomoto/core`, `@gomoto/data`, `apps/web`, `apps/mobile`). O build Turbo deve continuar passando com todos os pacotes atualizados em sincronia. |
| **ADR a criar** | Decisão arquitetural | Pendente | A substituição de `motorcycle` por `vehicle` como entidade canônica é uma decisão arquitetural irreversível. Criar ADR em `obsidian-notes/decisions/` antes da implementação. |

### 11.2 Riscos

| # | Risco | Categoria | Prob | Impacto | Mitigação |
|---|---|---|---|---|---|
| R-001 | Atualização de `@gomoto/core` quebra imports em `apps/web` e `apps/mobile` se os pacotes não forem atualizados em sincronia, resultando em erros de tipo TypeScript | Técnico | Alta | Alto | Implementar em ordem: core → data → web → mobile; validar `pnpm build` após cada camada |
| R-002 | Nova tabela `vehicles` não herda corretamente as políticas RLS da tabela `motorcycles`, permitindo acesso indevido entre tenants | Segurança | Baixa | Alto | Incluir na migration a habilitação explícita de RLS e criação das políticas; validar com `pnpm db:reset` |
| R-003 | Migration de renomeação de FKs falha parcialmente, deixando o banco em estado inconsistente | Dados | Baixa | Alto | Encapsular todo o rename em uma única migration transacional; testar via `pnpm db:reset` antes de qualquer push |
| R-004 | Testes E2E com referências hardcoded a "motorcycle" falham sem serem atualizados, mascarando regressões reais | Qualidade | Alta | Médio | Atualizar todos os specs E2E e helpers como parte obrigatória da implementação |
| R-005 | Implementação do PRD 0006 iniciada em paralelo antes deste PRD estar concluído, gerando conflito entre entidades | Processo | Baixa | Alto | Bloquear início do PRD 0006 até merge completo deste PRD |

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

| # | Questão | Resolução |
|---|---|---|
| QA-001 | O status `inactive` presente na entidade `motorcycle` atual — como é mapeado na entidade `vehicle` (mantido, renomeado, removido)? | Adiado para Spec/ADR — é decisão técnica de migration; mapeamento de estados é escopo do PRD 0006 |
| QA-002 | O bucket de storage `vehicle-documents` já usa nomenclatura "vehicle" — outros buckets precisam ser renomeados? | Adiado para Spec — nomenclatura de buckets de storage é detalhe de implementação |

Nenhuma questão aberta bloqueia a aprovação deste PRD.

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 explicitamente adiada)
- [x] Todos os RFs têm ao menos 1 CA correspondente (9 RFs, 13 CAs)
- [x] Todos os CAs apontam para um RF
- [x] Personas identificadas e cada uma com ≥1 US
- [x] Fluxos principal, alternativos e de erro documentados
- [x] Dependências e riscos mapeados
- [x] Frontmatter completo (sem campos por preencher)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica

**Aprovado por:** Alan em 2026-07-01

---

## Tags

`#prd` `#veiculos` `#generalizacao-entidade-veiculo`
