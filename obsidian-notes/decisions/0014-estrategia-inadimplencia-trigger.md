# ADR 0014 — Estratégia de classificação de inadimplência: trigger vs. view vs. pg_cron

- **Status:** Aceita
- **Data:** 2026-07-19
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0013-revisao-modelo-dados-financeiro|ADR 0013]], [[PRDs/0008-modulo-financeiro|PRD 0008]], [[Specs/0008-modulo-financeiro|Spec 0008]]

## Contexto

O módulo financeiro (PRD 0008) exige que o status de inadimplência do cliente (`current`, `late`, `delinquent`, `blocked`) seja **sempre consistente** com o estado das cobranças vencidas (RF-033). O RNF-004 define o SLA: "atualização em até 60 segundos após mudança no status de uma cobrança".

Há três arquiteturas candidatas para manter essa consistência:

### Opção A — View calculada (sem coluna materializada)

Um `VIEW` ou `FUNCTION` que calcula o status em tempo real a cada SELECT:

```sql
CREATE VIEW customer_delinquency AS
SELECT customer_id,
       CASE WHEN overdue_count = 0 THEN 'current'
            WHEN overdue_count >= 3 OR max_days >= 30 THEN 'delinquent'
            ELSE 'late' END AS status
FROM (
  SELECT customer_id, COUNT(*) AS overdue_count, MAX(CURRENT_DATE - due_date) AS max_days
  FROM billings WHERE status = 'overdue' GROUP BY customer_id
) s;
```

### Opção B — Trigger em `billings` (coluna materializada em `customers`)

Um trigger `AFTER INSERT OR UPDATE OF status ON billings` recalcula e grava `customers.delinquency_status` de forma síncrona dentro da transação que alterou a cobrança.

### Opção C — pg_cron / job externo

Um job agendado (pg_cron, Supabase Edge Function scheduler ou serviço externo) roda periodicamente (ex.: a cada minuto) e recalcula os status em batch.

## Decisão

**Adotar a Opção B — trigger `trg_billings_delinquency`.**

O trigger `AFTER INSERT OR UPDATE OF status ON billings` chama `fn_recalculate_delinquency()`, que:

1. Lê `customers.delinquency_status` — se já for `'blocked'` (bloqueio manual), **não sobrescreve**.
2. Lê os limiares configurados pelo tenant em `settings.delinquency_thresholds`.
3. Conta cobranças vencidas e calcula `MAX(dias de atraso)` para o cliente.
4. Determina o novo status com base nos limiares.
5. Faz `UPDATE customers SET delinquency_status = novo_status`.

A função tem bloco `EXCEPTION WHEN OTHERS THEN RAISE WARNING` — falha silenciosa, sem bloquear a transação principal.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **A — View calculada** | Cálculo em tempo real a cada SELECT. Para a tela de listagem de clientes com 200 registros, executa 200 subqueries de agregação. Não há coluna indexável para filtrar por status. Inviável para RF-034 (status visível na listagem). |
| **C — pg_cron** | Exige infraestrutura de job agendado inexistente no projeto. Janela de inconsistência de até 1 minuto (ou mais, dependendo do intervalo). Introduz estado eventual onde o operador pode criar uma locação para um cliente que se tornou `blocked` durante o intervalo. Complexidade operacional sem benefício em escala atual. |

## Justificativa para Opção B

**SLA atendido:** o trigger é síncrono — `delinquency_status` é atualizado na **mesma transação** que mudou o status da cobrança. Latência efetiva < 1s, muito abaixo do RNF-004 (≤ 60s).

**Indexável:** `customers.delinquency_status` é uma coluna real, indexada por `idx_customers_tenant_delinquency`. A listagem de clientes filtra por status em O(log n).

**Semântica de bloqueio manual preservada:** a verificação `IF delinquency_status = 'blocked' THEN RETURN NEW` garante que um `unblockCustomer` explícito seja necessário — o trigger nunca remove um bloqueio manual ao quitar cobranças.

**Sem nova infra:** usa apenas capacidade nativa do PostgreSQL disponível no Supabase.

**Falha silenciosa aceitável:** o bloco `EXCEPTION` garante que uma falha no recálculo de inadimplência não cause rollback da transação de pagamento — operação crítica que não pode ser abortada por efeito colateral.

## Estrutura do trigger

```sql
CREATE TRIGGER trg_billings_delinquency
  AFTER INSERT OR UPDATE OF status ON billings
  FOR EACH ROW EXECUTE FUNCTION fn_recalculate_delinquency();
```

`UPDATE OF status` — o trigger só dispara quando a coluna `status` muda, não em qualquer UPDATE de billings. Isso evita recálculos desnecessários em updates de `discount_amount`, `charges_waived`, etc.

## Consequências

### Positivas

- `delinquency_status` sempre consistente com cobranças vencidas (dentro da mesma transação).
- Listagem de clientes por status é query simples com índice.
- Guard em `createRentalWithDeposit` pode confiar no valor em `customers.delinquency_status` sem query adicional.
- Sem infraestrutura adicional.

### Negativas / riscos aceitos

- **Trigger oculta lógica de negócio no banco:** a classificação de inadimplência vive em PL/pgSQL, não em `@gomoto/core`. Para mitigar, a função pura `classifyDelinquency` em `packages/core/rules/delinquency.ts` documenta a mesma lógica e é coberta por unit tests — o trigger é a versão de performance, a função é a versão legível e testável.
- **Recálculo por cliente, não batch:** cada UPDATE de billing recalcula um cliente. Se em algum momento um batch de billings for atualizado para `overdue` (ex.: script de migração), o trigger dispara N vezes. Para a escala atual é aceitável; para migrações em lote, usar `SET session_replication_role = 'replica'` temporariamente ou fazer o batch dentro de uma função que recalcula ao final.
- **Dependência de `settings` no trigger:** se a linha de configuração não existir, `v_thresholds` será NULL e os defaults hardcoded (`3 cobranças` / `30 dias`) serão usados. Documentado no seed.

## Limites desta decisão

Esta ADR cobre a **atualização reativa** do status (em resposta a mudanças em `billings`). Não cobre:

- Recálculo periódico para detectar cobranças que *ficaram* vencidas sem mudança de status (ex.: cobrança `pending` que passou do `due_date` sem nenhum UPDATE). Para esse caso, uma view de diagnóstico ou script manual é suficiente em V1 — o status `overdue` já é normalizado na leitura via hook (RFC 33e1f3c).
- Expiração automática de crédito — não existe em V1 (QA-11 adiado).

## Quando reavaliar

- Adoção de pg_cron para outro módulo: ponto natural para migrar o recálculo de inadimplência para job batch e remover o trigger.
- Volume de tenants com > 1.000 clientes ativos e queries lentas no trigger.
- Requisito de recálculo diário para cobranças que "envelhecessem" para `overdue` sem UPDATE (hoje normalizado client-side).

## Referências

- [[PRDs/0008-modulo-financeiro]] — RF-033, RF-034, RF-035, RF-036, RF-037, RN-029 a RN-036, RNF-004.
- [[Specs/0008-modulo-financeiro]] — §2.2 triggers, §3 FT-08, §4.5 `trg_billings_delinquency`, §8.4.
- [[decisions/0013-revisao-modelo-dados-financeiro|ADR 0013]] — `payments` que dispara o trigger ao mudar `billings.status`.
