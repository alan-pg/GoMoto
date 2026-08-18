# ADR 0025 — Leitura em escala: paginação, agregação e índice

- **Status:** Proposta — dívida registrada, revisão pendente
- **Data:** 2026-08-18
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]], [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]], [[Specs/0014-redesenho-financeiro]]

## Contexto

Testando o sistema como operador, três defeitos apareceram em sequência — todos
do mesmo tipo, todos invisíveis para os portões do repositório, e todos
descobertos só porque o banco de desenvolvimento cresceu:

| Onde | Sintoma | Causa |
|---|---|---|
| Tela de Cobranças | Coluna Descrição exibindo "Cobrança" em **todas** as linhas | `.in()` com 258 ids → URI de 10 KB → **HTTP 414** do Kong, engolido por `?? []` |
| `reconciliacao.spec.ts` | 25 cobranças acusadas de não ter lançamento | Leitura de `financial_entries` truncada em **1.000 linhas** |
| Dashboard | "Total a Receber", "Em Atraso", "Recebido no Mês" | Linhas trazidas e somadas no cliente — mesma truncagem em 1.000 |

Os dois limites são de plataforma e não geram erro visível:

- **PostgREST devolve no máximo 1.000 linhas** por requisição. A resposta vem
  cortada, sem erro e sem cabeçalho de aviso.
- **Kong recusa URI acima de ~8 KB** com 414. Um UUID ocupa ~37 bytes
  codificado, então `.in()` estoura a partir de ~200 ids.

O modo de falha do segundo caso é o pior: em vez de tela vazia — que alguém
nota —, produz **número plausível e errado**. Um KPI financeiro que soma 1.000
das 3.000 cobranças da carteira não parece quebrado; parece um mês fraco.

Volume atual do banco de desenvolvimento, para calibrar quão distante está o
problema:

| Tabela | Linhas |
|---|---|
| `financial_entries` | 1.636 |
| `financial_transactions` | 824 |
| `charge_items` | 349 |
| `charges` | 313 |
| `customers` | 186 |
| `vehicles` | 166 |

`financial_entries` **já passou** de 1.000. As demais cruzam esse limite com
alguns meses de operação real de um único tenant.

### Por que nenhum portão pega

- `pnpm typecheck` não enxerga tamanho de URL nem limite de linhas.
- `pnpm check:schema` confere nome de tabela e coluna, não volume.
- A suíte E2E só quebrou quando o banco de teste cresceu o bastante — e, quando
  quebrou, a primeira leitura foi "flake", não "defeito".

## Decisão

Ainda **não tomada**. Esta ADR registra a dívida e o que precisa ser decidido.

O que já foi corrigido pontualmente (não é a decisão, é contenção):

- `listChargesForCockpit` — enriquecimento em lotes de 100, com erro propagado.
- `reconciliacao.spec.ts` — varreduras paginadas por `range()`.
- Dashboard — `receivables_summary` e `receivables_by_month` agregam no banco.

## Questões a decidir

1. **Separar por intenção.** A hipótese de trabalho é que "paginar tudo" é a
   resposta errada, e que o critério deve ser o propósito da consulta:
   - agregação (KPI, total, contagem) → view agregada no banco;
   - lista para o operador → `limit` explícito, ordenação estável e indicação de
     "mostrando N de M";
   - enriquecimento por ids → lotes, sempre.
2. **Onde entra paginação real na UI.** Hoje nenhuma listagem tem controle de
   página. Cobranças, Clientes, Veículos e Despesas vão precisar — falta decidir
   entre offset, cursor por chave, ou scroll infinito.
3. **Índices.** Nenhuma medição foi feita. As views derivadas
   (`charge_balances`, `customer_financial_position`, `vehicle_financial_position`,
   `income_statement`) agregam sobre `financial_entries` a cada consulta, sem
   plano verificado. Precisa de `EXPLAIN ANALYZE` com volume representativo
   antes de decidir índice, índice parcial ou view materializada.
4. **Busca.** Os filtros de texto das listagens hoje são feitos em memória,
   depois de trazer as linhas. Com paginação isso deixa de funcionar: buscar
   passa a exigir ida ao banco (`ilike`, ou índice de texto).
5. **Portão automatizado.** Um teste que popula acima de 1.000 linhas e confere
   os totais pegaria a classe inteira. Sem isso, o próximo caso volta a ser
   descoberto por acaso.

## Consequências

Enquanto a decisão não é tomada:

- Toda consulta nova em tabela que cresce deve declarar `limit`/`range` ou
  agregar no banco — e **nunca** ler resultado com `?? []` sem checar o erro.
- Correções pontuais continuam sendo feitas quando o defeito aparece, o que é
  reativo por definição: os três casos acima chegaram à tela antes de serem
  vistos.

## Quando reavaliar

Antes do primeiro tenant com operação real, ou assim que qualquer tabela de
domínio passar de 1.000 linhas em produção — o que vier primeiro.
