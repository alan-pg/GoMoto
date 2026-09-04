# ADR 0024 — Ledger financeiro com contrapartida e classificação por tenant

- **Status:** Aceita
- **Data:** 2026-08-12
- **Autores:** Alan + agente IA
- **Substitui:** [[decisions/0009-geracao-cobracas-upfront-vs-cron|ADR 0009]], [[decisions/0013-revisao-modelo-dados-financeiro|ADR 0013]], [[decisions/0014-estrategia-inadimplencia-trigger|ADR 0014]]
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]], [[decisions/0011-historico-de-status-append-only|ADR 0011]], [[decisions/0016-escrita-cliente-mobile-route-handler|ADR 0016]], [[Specs/0014-redesenho-financeiro]]

## Contexto

O domínio financeiro cresceu por acréscimo: seis tabelas passaram a registrar "dinheiro que entrou ou saiu", cada uma com seu vocabulário de status e sua própria noção de "pago" — `billings`, `payments`, `expenses`, `vehicle_obligations`, `fines`, `maintenances`, mais `deposits` e `customer_credits` com saldo em coluna mutável.

Não existe um registro único de movimento financeiro. O sintoma mais claro é a view `vehicle_financial_events`, que faz `UNION ALL` de quatro tabelas para produzir "uma linha por evento financeiro do veículo" — a forma exata de um ledger, remontada a cada consulta, sem invariante e sem enxergar receita.

Vinte achados foram levantados na análise. Quatro são críticos e foram reproduzidos contra o banco local:

| # | Achado | Evidência |
|---|---|---|
| F-01 | `vehicle_cost_summary` cruza 4 `LEFT JOIN` irmãos e depois soma — fan-out multiplica toda agregação | Medido: verdade R$ 200, view retorna R$ 1.000 (5× = nº de manutenções) |
| F-02 | O webhook do Mercado Pago só faz `UPDATE billings`; nunca insere em `payments` | Painel soma `payments` → receita paga pelo app é invisível |
| F-03 | Três definições incompatíveis de receita, uma por tela | `dashboard/page.tsx:160`, `financial.ts:167`, `financial.ts:229` |
| F-04 | O controle de inadimplência é inerte | Ver "Reversão da ADR 0014" abaixo |

Em paralelo, os requisitos registrados em `nova-proposta-financeiro.md` e `proposta-refatoracao-financeiro.md` pedem pagamento parcial, estorno, renegociação, parcelamento, créditos e carteira — exatamente os gatilhos que a ADR 0013 nomeou na seção *Quando reavaliar*.

O sistema não tem dados em produção. O custo de reescrita estrutural é o custo do código, não o de migração de dados.

## Decisão

Substituir o domínio financeiro por um **ledger de movimentos com contrapartida**, com sete princípios invioláveis:

1. **Todo fato financeiro é uma transação balanceada.** Nada de dinheiro entra no sistema por outro caminho.
2. **Saldo nunca é coluna.** Todo saldo é agregação de lançamentos.
3. **Lançamento é imutável.** Correção é estorno, nunca `UPDATE`.
4. **Estado derivável do relógio não se persiste.** Atraso e inadimplência são consultas.
5. **Documento emitido é imutável.** O que muda é o cronograma que ainda não virou documento.
6. **Fato e classificação são coisas distintas.** O ledger registra o fato; o tenant escolhe como classificá-lo.
7. **Dinheiro se reparte em valores, nunca em percentuais.**

O núcleo é `financial_transactions` + `financial_entries`, com `amount_signed` gerada (débito positivo, crédito negativo) e a invariante `SUM(amount_signed) = 0` por transação, garantida por `CONSTRAINT TRIGGER DEFERRABLE`.

O detalhamento técnico — DDL completo, views, serviços e plano de migrations — vive em [[Specs/0014-redesenho-financeiro]].

### Reversão da ADR 0009 — geração upfront

A ADR 0009 gera todas as cobranças na assinatura (até 104 para um rent-to-own semanal de 2 anos). Duas consequências:

- **"Total a receber" perde significado.** O dashboard soma todas as cobranças pendentes sem recorte de data — o comentário no código é explícito: *"total receivable covers ALL months, not just current"*. O indicador passa a ser a carteira contratada inteira, não contas a receber.
- **Reajuste reescreve documento financeiro.** A ADR previu isso ("implicará em `UPDATE` em lote nas cobranças futuras") e classificou como fora de escopo da V1 — mas `rental_adjustments`, `adjust_rental` e `regenerate_rental_schedule` já existem e fazem exatamente isso, violando o Princípio 5.

**Substituição:** `rental_billing_schedules` (plano, mutável — onde o reajuste atua) separado de `charges` (documento emitido por período, imutável). A objeção de infraestrutura da ADR ("sem job agendado") não se aplica mais: o web roda em Vercel, onde Cron é nativo, e o Supabase oferece pg_cron.

### Reversão da ADR 0013 — `UNIQUE(billing_id)` em `payments`

A constraint proíbe pagamento parcial por construção. Foi uma escolha consciente para a V1, e a própria ADR nomeia parcelamento e estorno como gatilhos de reavaliação — ambos agora requisitos.

**Substituição:** `payment_allocations` N:N entre pagamento e cobrança.

A ADR 0013 também afirma, em *Limites desta decisão*, que despesas "permanecem como `expenses` com `is_company_expense = true`, que já existem no schema". **Essa coluna nunca existiu** (verificado em `information_schema`), e por isso responsabilidade de despesa é hoje inmodelável (F-07).

Da ADR 0013 **permanece válida** a separação entre *ordem de pagamento* (cobrança) e *recibo* (pagamento).

### Reversão da ADR 0014 — inadimplência por trigger

O mecanismo escolhido **não funciona, e não pode funcionar**, por duas falhas independentes:

- O trigger dispara em `AFTER INSERT OR UPDATE OF status ON billings`. Uma cobrança fica vencida pela **passagem do tempo**, que não é um `UPDATE` — o trigger nunca dispara para o caso que importa.
- Ainda que disparasse, `fn_recalculate_delinquency` conta `WHERE status = 'overdue'` e **nada no repositório jamais grava esse valor**. Não há pg_cron, job nem `UPDATE` em migration alguma. As únicas ocorrências são normalização em memória na leitura (`packages/data/src/repositories/billings.ts:33` e `:81`) e fixtures de teste.

Consequência: `customers.delinquency_status` permanece `current` para sempre, justamente para quem está inadimplente. O enum `delinquency_level`, a tabela `delinquency_blocks`, os limiares em `settings` e `classifyDelinquency` estão todos inertes — e o guard que a ADR diz que "pode confiar no valor" confia num campo estruturalmente limpo.

A ADR rejeitou a view calculada alegando "200 subqueries de agregação" para 200 clientes. É um diagnóstico incorreto: um `GROUP BY` sobre índice `(tenant_id, customer_id, due_date)` é *um* scan agregado. O argumento de performance que justificou o trigger não se sustenta.

**Substituição:** views `charge_balances` e `customer_delinquency`, com atraso derivado de `due_date < CURRENT_DATE`. A classificação em `current/late/delinquent/blocked` permanece função pura em `@gomoto/core` sobre política versionada. O bloqueio manual continua estado real — é decisão humana, não derivação.

## Multi-tenant: o que é estrutural e o que é política

O GoMoto é SaaS. Empresas em Simples Nacional, Lucro Presumido e Lucro Real podem receber orientações contábeis divergentes sobre o mesmo fato, e nenhuma delas é "a certa". Cravar um tratamento no plano de contas global impõe a política de uma empresa a todas.

**Estrutural — não configurável:** caução é passivo (é dinheiro de terceiro), crédito ao cliente é passivo, caixa e recebível são ativo, toda transação fecha em zero.

**Política do tenant — configurável e versionada:** a linha de DRE de cada conta marcada `is_configurable`, e o que compõe a base de receita bruta. Repasse de multa/manutenção lança em conta própria de `kind = 'reimbursement'`; `tenant_account_mappings` decide se aquilo aparece como receita bruta ou recuperação de despesa.

Isso é viável por uma propriedade aritmética: **o resultado não muda**. Com aluguel de R$ 500 e multa de R$ 200 repassada, o tratamento bruto dá `700 − 200 = 500` e o líquido dá `500 − 0 = 500`. Só a composição difere — por isso a escolha pode ser presentação, e não estrutura.

A consequência de projeto é que o lançamento **nunca funde dois fatos economicamente distintos**: repasse jamais é abatido dentro de `despesa_multa` nem somado a `receita_locacao`. É essa granularidade que permite reconstruir qualquer das duas visões do mesmo ledger.

O mapeamento é versionado e resolvido por `effective_from` contra a **data do fato**, não a da consulta — mudar a política hoje não reescreve o demonstrativo do ano passado.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **Corrigir os bugs sem mudar o modelo** | Corrige instâncias, não classes. O fan-out volta na próxima view que cruzar tabelas irmãs; a terceira definição de receita volta na próxima tela. E não destrava pagamento parcial, estorno nem renegociação. |
| **Ledger single-entry** (uma tabela, valor sinalizado) | Sem invariante de balanceamento, nada garante que caixa e contas a receber fiquem coerentes. Caução, estorno e crédito viram convenção, não garantia. É essencialmente o modelo atual, unificado. |
| **Partidas dobradas contábeis completas** (plano de contas contábil, períodos, fechamento) | Balancete e DRE formais, integração contábil direta — mas exige disciplina contábil na operação e está acima da necessidade atual. O desenho adotado não impede evoluir para lá. |
| **Strangler incremental** com escrita dupla | Dual-write é fonte clássica de divergência, e pagaria custo de compatibilidade sem ter dados legados a proteger. |

## Consequências

### Positivas

- **Classes de bug deixam de ser expressáveis.** Fan-out é impossível com uma tabela de fatos; divergência de receita é impossível com uma fórmula; caução como receita é impossível quando caução é passivo; saldo dessincronizado é impossível quando saldo não é coluna.
- **Custo marginal de módulo novo cai** de "coluna + valor de enum + índice + cópia da lógica de sincronização" para "declarar `source_module` e emitir itens". Zero DDL.
- **Contas a receber volta a medir o que o nome diz** — emitido e não pago.
- **Margem por veículo é imune à política contábil**: `net_result` soma receita e reembolso e subtrai despesa, resultado idêntico em qualquer configuração.
- **Assinatura e recorrência** deixam de ser módulo futuro: são o cronograma e o job de emissão que passam a existir.

### Negativas / riscos aceitos

- **Janela longa de app quebrado.** A modalidade escolhida pelo humano é substituição total; 54 arquivos em `apps/` e `packages/` tocam tabelas financeiras. Mitigação: commits por camada com typecheck verde e `db:reset` funcional em cada um.
- **Toda escrita financeira passa por um serviço.** Bug nele afeta todos os módulos. Mitigação: funções puras em `@gomoto/core` com teste por evento; a invariante do banco barra lançamento incoerente mesmo com bug no serviço.
- **Tudo derivado tem custo de leitura.** Para a escala atual (500 locações ≈ 24 mil lançamentos/ano) é irrelevante. Escape hatch documentado na Spec: snapshot mensal e particionamento por `occurred_at`, sem alterar nenhuma consulta de negócio.
- **A suíte E2E inteira (16 specs Playwright) precisa ser reescrita.**

### Neutras

- O catálogo `financial_accounts` é global, sem `tenant_id` — exceção deliberada à regra do CLAUDE.md, seguindo o precedente já existente de `permissions` e `permission_modules`. Abrir contas analíticas por tenant no futuro é acrescentar `tenant_id` nullable, sem tocar em lançamentos.

## Decisão deliberada de não fazer

**Receita diferida por competência.** O rigor manda reconhecer aluguel ao longo do período, não na emissão. Corrigir a ADR 0009 — emitir por período em vez do contrato inteiro — elimina quase toda a distorção sem a máquina de diferimento. Reavaliar se houver auditoria externa ou necessidade de DRE mensal formal.

**Depreciação.** As contas já existem no plano; falta cronograma e job mensal. Ligar depende de o resultado *mensal* por veículo virar métrica de produto — o ROI de ciclo de vida atual não precisa dela.

## Quando reavaliar

- Necessidade de balancete formal ou auditoria externa → avaliar partidas dobradas completas.
- Tenant exigindo plano de contas analítico próprio.
- Volume de `financial_entries` acima de ~1M por tenant → snapshot de saldos.
- Requisito de DRE mensal formal → receita diferida.

## Referências

- [[Specs/0014-redesenho-financeiro]] — DDL, views, serviços, plano de migrations e estratégia de teste.
- `obsidian-notes/nova-proposta-financeiro.md`, `obsidian-notes/proposta-refatoracao-financeiro.md` — requisitos de origem.
- [[decisions/0011-historico-de-status-append-only|ADR 0011]] — precedente direto do Princípio 3.
