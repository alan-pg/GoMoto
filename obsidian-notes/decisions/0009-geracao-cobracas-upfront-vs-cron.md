# ADR 0009 — Geração de cobranças: upfront (síncrono) vs. cron (assíncrono)

- **Status:** Aceita
- **Data:** 2026-06-24
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação via Server Action), [[PRDs/0004-locacao-e-cobrancas|PRD 0004]]

## Contexto

O módulo de locação (PRD 0004) gera cobranças de ciclo automaticamente para toda a duração do contrato. Um contrato do tipo **Rent-to-Own** com ciclo semanal tem duração de 2 anos → **104 cobranças** geradas de uma vez. Um contrato mensal tem no máximo 24.

Antes de implementar, é necessário decidir **quando e como** essas cobranças são geradas:

- **Opção A — Upfront:** todas as cobranças são geradas no ato de criação da locação, em uma única operação atômica (RPC PostgreSQL).
- **Opção B — Cron:** apenas a cobrança corrente (ou as próximas N) é gerada. Um job agendado gera as demais periodicamente (semanal/mensal) conforme o contrato avança.
- **Opção C — Híbrido:** primeiras N cobranças geradas upfront (ex.: 3 meses); o restante via cron.

O sistema está em desenvolvimento ativo, sem dados em produção, sem infraestrutura de jobs agendados.

## Decisão

Adotar a **Opção A — geração upfront** para V1.

Ao confirmar a criação da locação, a Server Action `createRental` invoca o RPC PostgreSQL `create_rental_with_charges`, que:

1. Faz `SELECT FOR UPDATE NOWAIT` no veículo para evitar race condition.
2. Insere a locação em `rentals`.
3. Insere todas as cobranças de ciclo em `billings` via um único `INSERT ... SELECT ... FROM jsonb_array_elements(p_charges)`.

As três operações ocorrem na **mesma transação** — ou todas persistem, ou nenhuma.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **B — Cron** | Exige infraestrutura de job agendado (pg_cron, Supabase Edge Functions scheduler, ou serviço externo) inexistente no projeto. Introduz consistência eventual: há janelas em que a locação existe mas as cobranças futuras ainda não. Dificulta o preview de cobranças antes da confirmação (RF-036). |
| **C — Híbrido** | Complexidade dupla: mantém a lógica upfront para as primeiras cobranças e adiciona cron para as demais. Sem benefício concreto enquanto o bulk insert for rápido o suficiente. |

## Justificativa para Opção A

**Performance:** benchmark com `jsonb_to_recordset` em Supabase Postgres padrão para 104 linhas:

| Passo | Estimativa |
|---|---|
| SELECT FOR UPDATE NOWAIT (índice) | ~2ms |
| INSERT INTO rentals | ~3ms |
| INSERT INTO billings (104 rows, bulk) | ~15ms |
| Overhead de rede e serialização | ~50–100ms |
| **Total estimado** | **< 130ms** |

Margem ampla em relação ao RNF-001 (< 3 segundos). O índice `idx_rentals_motorcycle ON rentals(tenant_id, motorcycle_id)` é obrigatório para que o lock scan não degrade para seq scan.

**Preview possível:** `generateCycleCharges()` em `@gomoto/core` roda client-side antes da confirmação, gerando a mesma lista que o RPC persistirá. Isso só é possível porque a geração é determinística e síncrona (RF-036).

**Atomicidade simples:** sem estados intermediários observáveis. O operador nunca vê uma locação sem cobranças ou com cobranças parciais (RNF-004).

**Auditabilidade:** todas as cobranças têm `created_at` igual ao da locação — rastreabilidade completa de quando foram geradas e por quem.

**Sem nova infra:** a decisão não requer pg_cron, workers, filas nem nenhum componente externo ao stack atual (Next.js + Supabase Postgres).

## Consequências

### Positivas

- Operação atômica: locação + todas as cobranças em uma transação.
- Preview de cobranças antes da confirmação (RF-036) usa a mesma função da geração real.
- Operador vê o histórico financeiro completo imediatamente após criar a locação.
- Nenhuma cobrança pode ser "esquecida" por falha de job.
- Renovação de contrato (`renewRental`) segue o mesmo padrão — novas cobranças geradas upfront via RPC.

### Negativas / riscos aceitos

- **104 INSERTs em uma transação:** aceitável dado o bulk insert; monitorar `latencyMs` nos primeiros deploys. Se exceder 500ms consistentemente, investigar antes de reavaliar a opção.
- **Cobranças futuras são registros reais:** o banco acumula linhas com `due_date` 2 anos à frente. Para a escala atual (dezenas de contratos), irrelevante. Para centenas de contratos Rent-to-Own ativos simultaneamente, avaliar impacto em `billings`.
- **Cancelamento antecipado cria "lixo" de cobranças canceladas:** ao encerrar uma locação, as cobranças futuras mudam de `pending` para `cancelled`. São registros históricos válidos (auditoria), não lixo de verdade.

### Neutras

- A periodicidade de vencimento é determinística (dia fixo da semana ou do mês); não há geração probabilística nem recalculo após criação.
- Reajuste de valor por índice (IGPM etc.) não é escopo de V1 — quando for, implicará em UPDATE em lote nas cobranças futuras, mas a decisão upfront vs. cron não muda.

## Limites desta decisão

Esta ADR cobre **contratos com até 104 cobranças** (2 anos semanais). Se no futuro forem adicionados:

- Contratos com duração > 3 anos (> 156 semanas), ou
- Cobranças que dependem de valores variáveis calculados próximos ao vencimento (ex.: juros flutuantes),

a geração upfront deve ser reavaliada.

## Quando reavaliar

- `latencyMs` de `rental.created` exceder 500ms em produção de forma consistente.
- Adição de tipo de contrato com > 200 cobranças.
- Adoção de job scheduler (pg_cron ou Supabase Functions scheduler) para outros módulos — ponto natural para avaliar migração.
- Requisito de reajuste automático de valor por índice (PRD futuro).

## Referências

- [[PRDs/0004-locacao-e-cobrancas]] — PRD de origem (RNF-001, RF-007, RF-036, RNF-004).
- [[Specs/0004-locacao-e-cobrancas]] — §3.1 (fluxo de criação), §4.4 (RPC `create_rental_with_charges`), §8 (análise de performance).
- [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] — Server Action como ponto de orquestração das mutações.
