# ADR 0015 — Perfil de Vistoria: entidade única com dois vínculos independentes por locação

- **Status:** Aceita
- **Data:** 2026-07-30
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0006-manutencao-preventiva-plano-responsabilidade-registro|ADR 0006]] (precedente estrutural de perfil configurável por tenant), [[PRDs/0009-modulo-vistoria|PRD 0009]], [[Specs/0009-modulo-vistoria|Spec 0009]] §2, §4

## Contexto

O PRD 0009 define o Perfil de Vistoria (checklist + itens de foto, configurável por tenant) e exige que ele seja associável a uma locação de duas formas **independentes**:

- **Vínculo Check-in/Check-out** — presença implica ambos pendentes/disponíveis nos respectivos momentos da locação.
- **Vínculo Vistoria Periódica** — presença + frequência habilita a vistoria recorrente do cliente.

RN-004 fixa a cardinalidade: uma locação pode ter um vínculo, outro, ambos ou nenhum — nunca mais de um perfil por tipo de vínculo na mesma locação. RF-008 exige que **o mesmo Perfil de Vistoria** possa ser usado no vínculo Check-in/Check-out de uma locação, no vínculo Periódica de outra, e em múltiplas locações simultaneamente — ou seja, o perfil não pertence a um único vínculo ou a uma única locação.

Havia três desenhos de dados candidatos para representar isso.

## Decisão

Adotar **uma única entidade `inspection_profiles`** (com `inspection_profile_checklist_items` e `inspection_profile_photo_items` associados), referenciada por **duas colunas FK nullable independentes em `rentals`**:

```sql
rentals.checkin_checkout_inspection_profile_id  UUID REFERENCES inspection_profiles(id)
rentals.periodic_inspection_profile_id          UUID REFERENCES inspection_profiles(id)
rentals.periodic_inspection_frequency_days      INTEGER  -- obrigatório sse o vínculo periódico existe (RN-005)
```

Cada coluna representa um vínculo; a ausência (`NULL`) representa a ausência do vínculo (RN-001), não um estado "desabilitado". Nenhuma tabela de associação (junção) é criada.

## Alternativas consideradas

| Opção | Por que descartada |
|---|---|
| **B — Duas entidades separadas** (`checkin_checkout_profiles` e `periodic_profiles`, cada uma com seus próprios itens de checklist/foto) | Duplica schema, CRUD, telas e validação Zod para uma diferença que é puramente **de uso**, não de **natureza** — os dois tipos de perfil têm exatamente os mesmos campos (checklist + fotos). Também violaria RF-008 diretamente: o PRD exige que o *mesmo* perfil sirva aos dois vínculos, o que é estruturalmente impossível se forem entidades distintas. |
| **C — Tabela de junção `rental_inspection_profile_links(rental_id, link_type, profile_id, frequency_days)`** | Permitiria N vínculos do mesmo tipo por locação (ex.: dois perfis periódicos simultâneos), capacidade que RN-004 explicitamente não pede (cardinalidade fixa em 0–1 por tipo). Introduzir uma tabela N:N para representar uma relação 0–1 fixa é complexidade não solicitada pelo PRD — violaria o princípio de YAGNI já documentado em [[Arquitetura Proposta]] §12.2 ("cada nova abstração precisa de justificativa"). |

## Justificativa para a entidade única + colunas

**RF-008 exige literalmente uma entidade compartilhada.** Não há como satisfazer "o mesmo perfil pode ser usado em ambos os vínculos e em múltiplas locações" com entidades separadas por tipo de vínculo.

**RN-004 é satisfeita estruturalmente, não por validação de aplicação.** Com duas colunas FK (uma por tipo de vínculo), é logicamente impossível uma locação ter dois perfis periódicos — a cardinalidade 0–1 por tipo está no próprio shape da tabela, não depende de um `CHECK` ou de lógica de Server Action para ser garantida.

**Consulta trivial sem join.** "Esta locação tem check-in habilitado?" é `checkin_checkout_inspection_profile_id IS NOT NULL` — sem precisar de junção com uma tabela de vínculos.

**Precedente já validado no produto.** O padrão de FK única nullable em `motorcycles.maintenance_plan_id` (introduzido na [[decisions/0006-manutencao-preventiva-plano-responsabilidade-registro|ADR 0006]]) resolve exatamente o mesmo formato de problema (entidade configurável por tenant, referenciada por uma entidade operacional via FK opcional).

## Consequências

### Positivas

- Uma única superfície de CRUD/UI para Perfil de Vistoria (RF-001 a RF-005), sem duplicação entre "perfil de check-in/out" e "perfil periódico".
- RF-008 (reuso do mesmo perfil) é trivial — não exige nenhuma modelagem extra.
- RN-004 (cardinalidade 0–1 por tipo) é impossível de violar por construção do schema.
- `inspections.inspection_profile_id` (execução) referencia a mesma tabela independentemente do `kind` (`checkin`/`checkout`/`periodic`) — histórico e comparação (RF-022, RF-023) fazem uma única query sem `UNION` entre tabelas de perfil diferentes.

### Negativas / riscos aceitos

- **Rentals ganha mais duas colunas + 1 constraint** — `rentals` já é uma tabela com histórico de extensões incrementais (financeiro, depósito, contrato); este é mais um incremento no mesmo padrão já estabelecido, não uma mudança de forma.
- **Limite estrutural de exatamente 2 "slots" de vínculo.** Se um V2 exigir um terceiro tipo de vínculo (ex.: vistoria de manutenção preventiva vinculada à locação), o caminho é adicionar uma terceira coluna — aceitável dado que é o padrão já usado nesta tabela, mas não escala indefinidamente para N tipos.

### Neutras

- `inspections` grava snapshot dos itens do perfil no momento da execução (decisão de Spec 0009 §1, não desta ADR) — editar ou arquivar um perfil depois não afeta vistorias já registradas. Isso independe de qual dos três desenhos foi escolhido aqui.

## Quando reavaliar

- Se surgir necessidade de **mais de um perfil simultâneo do mesmo tipo** por locação (ex.: um perfil por item da frota dentro do mesmo contrato) — reabrir para a Opção C (tabela de junção).
- Se **Perfil de Vistoria precisar se vincular a outras entidades além de locação** (ex.: diretamente a veículo, independente de locação) — reavaliar se a FK direta em `rentals` ainda é suficiente ou se vale um modelo polimórfico.
- Se um **terceiro tipo de vínculo** for proposto — decidir entre uma terceira coluna (consistente com o padrão atual) ou migrar para a Opção C nesse momento, quando o custo de manter N colunas superar o custo de uma tabela de junção.

## Referências

- [[PRDs/0009-modulo-vistoria]] — RF-001 a RF-011, RN-001, RN-004, RN-005, RN-008.
- [[Specs/0009-modulo-vistoria]] — §2 (Arquitetura), §4 (Modelo de Dados, SQL concreto das tabelas e colunas).
- [[decisions/0006-manutencao-preventiva-plano-responsabilidade-registro|ADR 0006]] — precedente de perfil/plano configurável por tenant referenciado por FK nullable.
