# ADR 0007 — Semântica OR para status de manutenção com gatilho duplo (KM + data)

- **Status:** Aceita
- **Data:** 2026-06-20
- **Autores:** Stakeholder + agente IA
- **Substitui:** —
- **Relacionada:** [[decisions/0006-manutencao-preventiva-plano-responsabilidade-registro|ADR 0006]] (regime de manutenção)
- **PRD de origem:** [[PRDs/0003-manutencao-preventiva]] (V1, fechada em 2026-06-20)

## Contexto

`calculateMaintenanceStatus` em `packages/core/src/rules/maintenance.ts` classifica uma manutenção em `overdue` / `upcoming` / `scheduled` / `completed`. Cada item pode ter dois gatilhos:

- **Por KM**: `predicted_km` (alvo absoluto, gerado em conclusão como `completion_km + interval_km`).
- **Por data**: `scheduled_date` (alvo absoluto, gerado como `completion_date + interval_days`).

A V1 da PRD 0003 fechou implementando **prioridade KM-first**: se `predicted_km` existe, a rota por data é ignorada. Justificativa implícita: moto de aluguel roda ~1000 km/semana, KM é o gatilho dominante.

**Problema descoberto** (auditoria em 2026-06-20): quando ambos os gatilhos existem na mesma linha — caso real para manutenções "a cada 5.000 km ou 6 meses, o que vier primeiro" — a UI mostrava `scheduled` mesmo com a data já vencida. Operador percebe como bug.

## Decisão

Trocar a semântica para **OR (pior status vence)**:

- Roda as duas rotas (KM e data) quando os dois gatilhos estão presentes.
- Combina via `worstStatus()` usando o ranking `overdue` < `upcoming` < `scheduled` < `completed`.
- Mantém comportamento original para linhas com **apenas um** gatilho — nada quebra para itens KM-only ou data-only.

Implementação extraiu duas funções privadas `statusByKm()` e `statusByDate()` que retornam status ou `null`. O combinador no `calculateMaintenanceStatus` fica:

```ts
const byKm = statusByKm(input, pct)
const byDate = statusByDate(input, today, pct)
if (byKm !== null && byDate !== null) return worstStatus(byKm, byDate)
return byKm ?? byDate ?? 'scheduled'
```

## Alternativas consideradas

1. **Manter KM-first** e documentar como decisão. Rejeitada — vai contra a expectativa universal de CMMS (Fleetio, Samsara, Fiix usam OR) e mascara dívida real em itens com forte componente de tempo (filtro de ar, fluido de freio, etc.).
2. **Data-first**. Rejeitada — inverte o problema sem resolver.
3. **Expor preferência no plano** (`prefer_km | prefer_date | or | and`). Rejeitada como overengineering para o V1; a regra OR cobre 95% do caso real.

## Consequências

- **Positivas**:
  - Operador vê item como `overdue` assim que QUALQUER gatilho vence — alinhado com expectativa de mercado.
  - Itens mistos (KM + data) funcionam como manuais técnicos descrevem ("a cada X km **ou** Y dias").
  - 6 novos testes Vitest cobrem o combo (overdue+overdue, overdue+scheduled em cada direção, upcoming+scheduled, scheduled+scheduled).

- **Custos**:
  - Quem tem item misto e contava com prioridade KM passa a ver itens vencidos por data que antes ficavam ocultos. Não há migração de dados — é só mudança de leitura.
  - Necessário comunicar a mudança em release notes/changelog do tenant.

## Rastreamento

- Testes: `packages/core/src/rules/maintenance.test.ts` — bloco `describe('calculateMaintenanceStatus — combo KM + data (OR, pior vence)')`.
- Implementação: `packages/core/src/rules/maintenance.ts:48-114`.
