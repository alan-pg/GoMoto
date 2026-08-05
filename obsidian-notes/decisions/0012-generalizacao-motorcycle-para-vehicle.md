# ADR 0012 — Generalização da entidade canônica de frota: motorcycle → vehicle

- **Status:** Aceita
- **Data:** 2026-07-01
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação), [[PRDs/0006-cadastro-de-veiculos-revisao|PRD 0006]] (feature que depende desta decisão)
- **PRD de origem:** [[PRDs/0007-generalizacao-entidade-veiculo]]
- **Spec:** [[Specs/0007-generalizacao-entidade-veiculo]]

## Contexto

O GoMoto nasceu como sistema de gestão de locação de motocicletas. A entidade central do domínio foi modelada como `motorcycle` (tabela `motorcycles`, tipos `Motorcycle`, hooks `useMotorcycles`). À medida que o produto evoluiu para locação de veículos em geral, uma segunda entidade `vehicle` foi introduzida pontualmente — criando duas representações paralelas do mesmo conceito.

No momento desta decisão, o sistema ainda está em desenvolvimento e não entrou em produção. Essa janela pré-lançamento é a oportunidade de consolidar as entidades antes que dados reais tornem a migração custosa.

O PRD 0006 (revisão do módulo de veículos) depende da entidade `vehicle` como base consolidada. Implementar o PRD 0006 antes da consolidação forçaria mais trabalho sobre a dualidade — aumentando o custo da mudança a cada sprint.

## Decisão

**Substituir `motorcycle` por `vehicle` como entidade canônica e única em todo o sistema.**

Escopo da decisão:

- Banco de dados: `ALTER TABLE motorcycles RENAME TO vehicles`; renomear FK `motorcycle_id` → `vehicle_id` em todas as tabelas dependentes; recriar views com nomes e referências atualizados.
- `@gomoto/core`: renomear tipos TypeScript (`Motorcycle` → `Vehicle`, `MotorcycleStatus` → `VehicleStatus`, etc.), schemas Zod e função pura `isIdleMotorcycle` → `isIdleVehicle`.
- `@gomoto/data`: renomear hooks e repositórios.
- `apps/web`: renomear rota `/motos` → `/veiculos`, Sidebar, componente `MotorcycleMap`, todas as referências internas; redirect HTTP 308 permanente.
- `apps/mobile`: atualizar rótulos de UI.

As duas entidades **não coexistem** em nenhum momento — a troca é atômica via migration transacional (`BEGIN/COMMIT`). Não há período de transição nem alias de compatibilidade.

Tipo de veículo (moto, carro, van…) não é escopo desta decisão — fica para o PRD 0006.

## Alternativas consideradas

| Alternativa | Por que descartada |
|---|---|
| **Manter coexistência (`motorcycle` + `vehicle`)** | Perpetua a inconsistência do domínio. O PRD 0006 precisaria lidar com as duas entidades, ampliando o débito. Sem ganho observável para o usuário. |
| **Alias de compatibilidade (`motorcycle` como view ou tipo alias de `vehicle`)** | Reduz o impacto imediato mas mantém dois nomes para o mesmo conceito no código. Gera confusão para novos contribuidores e não elimina o débito — só o adia. |
| **Aguardar a implementação do PRD 0006 para consolidar** | O PRD 0006 estende o módulo de veículos com novas features. Implementá-lo antes da consolidação aumenta o custo de mudança: cada nova tela, hook e tabela criada pelo PRD 0006 teria que ser renomeada depois. A ordem correta é consolidar primeiro. |
| **Criar tabela `vehicles` nova e migrar dados** | Mais complexo que `RENAME` e sem benefício — não há dados de produção. `ALTER TABLE RENAME` é transacional, preserva constraints, triggers e políticas RLS automaticamente. |

## Consequências

### Positivas

- **Domínio coerente:** uma palavra para um conceito em todo o sistema — banco, tipos, hooks, rotas, rótulos.
- **Base limpa para o PRD 0006:** toda feature nova de veículos parte de `vehicle` sem herança de nomes legados.
- **Busca por "motorcycle" no código retorna zero** (exceto migrations históricas imutáveis) — critério verificável de sucesso.
- **Migration transacional:** `BEGIN/COMMIT` garante que o banco jamais fica em estado intermediário com tabela renomeada mas FKs antigas.
- **Custo da mudança é único:** feito agora, pré-produção, sem dados reais para migrar.

### Negativas / riscos aceitos

- **Amplitude grande (~30 arquivos, 4 camadas):** risco de referência esquecida que só aparece no build. Mitigado pela ordem de implementação obrigatória (core → data → web/mobile) e pelo gate `pnpm build` em cada camada.
- **Irreversível após entrada em produção:** se dados reais existirem quando a migration rodar, o rollback exige down migration e re-deploy. Aceitável porque a decision foi tomada pré-produção.
- **Testes E2E precisam ser atualizados:** `motos.spec.ts` → `veiculos.spec.ts` e referências de texto. Risco de regressão mascarada se algum spec for esquecido — mitigado pelo inventário completo na Spec 0007.

### Neutras

- Comportamento funcional de todas as telas e fluxos é preservado integralmente.
- Migrations históricas (`20260611002632_initial_schema.sql` etc.) permanecem imutáveis — registram a história do domínio, não precisam ser reescritas.
- O nome do produto "GoMoto" não é afetado.

## Quando reavaliar

Esta decisão é essencialmente irreversível após entrar em produção com dados reais. Documentada para:

- Rastrear por que o nome `vehicle` foi escolhido como canônico (e não `asset`, `unit` ou outro).
- Justificar por que não há coexistência ou alias.
- Servir de referência ao PRD 0006 e features subsequentes do módulo de frota.

## Referências

- [[PRDs/0007-generalizacao-entidade-veiculo]] — PRD de origem com escopo, RFs, RNFs, RNs e critérios de aceite completos.
- [[Specs/0007-generalizacao-entidade-veiculo]] — Spec técnica com migration SQL, ordem de implementação e matriz de rastreabilidade.
- [[PRDs/0006-cadastro-de-veiculos-revisao]] — PRD que depende desta consolidação como pré-requisito.
- `supabase/migrations/20260611002632_initial_schema.sql` — migration original da tabela `motorcycles`.
- `supabase/migrations/20260617120300_motorcycle_cost_views.sql` — views originais (`motorcycle_cost_summary`, `motorcycle_financial_events`).
- `supabase/migrations/20260627232713_fix_views_security_invoker.sql` — correção de isolamento de tenant nas views (pattern preservado na migration de rename).
