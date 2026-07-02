# ADR 0010 — Galeria de fotos de veículo como tabela `vehicle_photos` com slots nomeados

- **Status:** Aceita
- **Data:** 2026-07-01
- **Autores:** Alan (com agente IA)
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação via Server Action), [[decisions/0006-manutencao-preventiva-plano-responsabilidade-registro|ADR 0006]] (padrão de tabela filha por entidade de domínio)
- **PRD de origem:** [[PRDs/0006-cadastro-de-veiculos-revisao]]
- **Spec:** [[Specs/0006-cadastro-de-veiculos-revisao]] §2.3 (D1), §4.4

## Contexto

O cadastro de veículos existente (resultado do PRD 0002) armazena uma única foto por moto no campo `motorcycles.photo_url TEXT`. O PRD 0006 introduz uma galeria padronizada de 6 slots nomeados (principal, frente, lateral esquerda, lateral direita, traseira, painel), onde cada slot comporta exatamente uma imagem e todos são opcionais.

Três abordagens foram avaliadas:

1. **6 colunas em `motorcycles`** (`photo_principal_url`, `photo_front_url`, etc.) — sem JOIN para a listagem; polui a tabela já extensa; adicionar 7º slot no futuro exige migration.
2. **JSONB `photos` em `motorcycles`** — flexível, mas sem RLS granular, sem tipagem SQL, sem indexação útil por slot.
3. **Tabela filha `vehicle_photos`** com ENUM `vehicle_photo_slot` e UNIQUE INDEX em `(motorcycle_id, slot)` — JOIN necessário na listagem; metadados futuros (tamanho, hash) triviais; RLS independente; alinhado com o padrão `vehicle_documents`/`vehicle_obligations` já estabelecido.

## Decisão

Adotar a **tabela filha `vehicle_photos`**.

```sql
CREATE TYPE vehicle_photo_slot AS ENUM (
  'principal', 'front', 'left_side', 'right_side', 'rear', 'dashboard'
);

CREATE TABLE vehicle_photos (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  motorcycle_id UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,
  slot          vehicle_photo_slot NOT NULL,
  url           TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_vehicle_photos_slot ON vehicle_photos(motorcycle_id, slot);
```

O campo `motorcycles.photo_url` é **depreciado** (mantido nullable para não quebrar código existente) e migrado para `vehicle_photos(slot='principal')` via migration de backfill. Remoção formal em PRD futuro.

Upload acontece **diretamente do cliente ao Supabase Storage** (bucket `vehicle-photos`, privado) com a sessão JWT do usuário. A Server Action recebe apenas a URL resultante. Slot substituído via `UPSERT` (UNIQUE constraint garante exatamente 1 foto por slot — RN-013).

## Consequências

**Positivas:**
- Consistente com o padrão de tabelas filhas do domínio (`vehicle_documents`, `vehicle_obligations`).
- RLS granular por slot se necessário no futuro.
- Adicionar metadados por foto (hash, tamanho original, mime type) é ADD COLUMN sem impacto.
- Path de storage hierárquico limpo: `{tenantId}/{motorcycleId}/{slot}/{filename}`.
- Remoção de slot é `DELETE WHERE motorcycle_id AND slot` + `storage.remove` — sem UPDATE em `motorcycles`.

**Negativas:**
- A listagem precisa de uma sub-query separada para buscar a foto do slot `principal`. Mitigado via dois-fetch com `Promise.all` + `Map` no cliente (sem N+1, O(n) linear para ≤200 motos).
- Tabela adicional a manter e com RLS a configurar.

**Padrão estabelecido para o projeto:**
Módulos futuros que precisem de galeria estruturada (clientes, sinistros, checklistagens) devem seguir este padrão: tabela filha com ENUM de slots + UNIQUE INDEX + bucket Storage privado.
