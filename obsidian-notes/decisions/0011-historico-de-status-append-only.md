# ADR 0011 — Histórico de status de veículo como tabela append-only

- **Status:** Aceita
- **Data:** 2026-07-01
- **Autores:** Alan (com agente IA)
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0002-padrao-canonico-pagina-server-actions|ADR 0002]] (padrão de mutação via Server Action + `logAction`), [[decisions/0010-galeria-de-fotos-vehicle-photos|ADR 0010]] (tabela filha por entidade de domínio)
- **PRD de origem:** [[PRDs/0006-cadastro-de-veiculos-revisao]]
- **Spec:** [[Specs/0006-cadastro-de-veiculos-revisao]] §2.3 (D4), §3.5, §4.3, §6.3

## Contexto

O PRD 0006 exige trilha de auditoria imutável de mudanças de status do veículo (RN-006, RN-007): toda transição — manual, via ação dedicada ou automática via contrato — gera obrigatoriamente um registro com status anterior, status novo, data/hora e usuário responsável. Nenhum usuário pode editar ou excluir esses registros.

O projeto já possui `audit_logs` (tabela genérica de CRUD) escrita por Server Actions via `logAction()`. A questão era se o histórico de status deveria:

**A) Ser escrito via Postgres trigger** (dispara em qualquer UPDATE de `motorcycles.status`):
- Garantia de banco — nenhum bypass possível via Studio, API direta ou scripts futuros.
- Captura `auth.uid()` via `current_setting` — funciona para sessões autenticadas, mas retorna NULL com service role.
- Novo padrão no projeto; código SQL fora do ciclo TypeScript.

**B) Ser escrito via Server Action** (helper `recordStatusTransition` chamado explicitamente):
- Consistente com o padrão `audit_logs` já estabelecido.
- `user_id` disponível diretamente da sessão (`auth.getUser()`).
- Testável em Vitest/Integration tests sem mock de triggers.
- Depende de disciplina: todo caminho de mudança de status deve chamar o helper.

**C) Usar `audit_logs` genérico** (sem tabela dedicada):
- Sem JOIN para auditoria; operador não consegue consultar histórico de um veículo específico na UI sem filtros complexos.
- Não suporta `previous_status`/`new_status` tipados — seria JSONB em `old_data`/`new_data`.

## Decisão

Adotar **tabela dedicada `vehicle_status_history` (append-only) escrita por Server Action**.

```sql
CREATE TABLE vehicle_status_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  motorcycle_id   UUID NOT NULL REFERENCES motorcycles(id) ON DELETE CASCADE,
  previous_status vehicle_status,     -- NULL na criação do veículo
  new_status      vehicle_status NOT NULL,
  changed_by      UUID,               -- NULL = sistema/migration
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
  -- SEM updated_at: append-only por design
);
```

**Exceção documentada ao padrão de tabela:** sem coluna `updated_at` e sem trigger `update_updated_at_column` — a tabela nunca recebe UPDATEs. A ausência de políticas RLS FOR UPDATE e FOR DELETE garante imutabilidade no banco.

**Helper `recordStatusTransition`** em `apps/web/src/lib/vehicle-status-history.ts`:
- Lança exceção em falha (não retorna `ActionResult`) — garante que a action caller seja interrompida se o histórico não puder ser escrito.
- Compartilhado entre `motos/actions.ts` e `contratos/actions.ts`.
- Chamada obrigatória em: `createVehicle`, `updateVehicle` (quando status muda), `changeVehicleStatus`, `createContract` (nova lógica), `terminateContractByCustomer`, `terminateContractByCompany`.

**Revisão para trigger Postgres** deve ser considerada se:
- Status de veículos puder ser alterado fora de Server Actions (scripts de manutenção, acesso via service role, futuro BFF).
- Mais de um módulo não-web precisar gravar status (ex: Edge Function de integração GPS).

## Consequências

**Positivas:**
- Histórico consultável diretamente pelo operador na UI (`/motos/[id]` área Status) — JOIN simples por `motorcycle_id`.
- Tipos SQL explícitos (`vehicle_status ENUM`) — sem JSONB, sem parsing.
- Testável via Integration tests (Vitest + Supabase local) sem depender de triggers.
- `changed_by` sempre disponível via `auth.getUser()` na Server Action.
- RLS granular: SELECT + INSERT permitidos; UPDATE + DELETE bloqueados pela ausência de política.

**Negativas:**
- Requer disciplina de implementação: todo ponto de mudança de status deve chamar `recordStatusTransition`. Mitigado por: linter de TypeScript (tipo de retorno da action quebra se o helper não for awaited), Integration tests cobrindo os caminhos cross-módulo.
- Se alguém alterar `motorcycles.status` diretamente via Supabase Studio ou psql, o histórico não será escrito. Aceitável no estágio atual (equipe controlada, acesso administrativo consciente).

**Padrão estabelecido para o projeto:**
Módulos futuros que precisem de trilha de auditoria consultável pelo operador (histórico de status de contrato, histórico de inadimplência) devem seguir este padrão: tabela append-only dedicada + helper de Server Action + RLS sem UPDATE/DELETE. O `audit_logs` genérico continua para rastreabilidade técnica de CRUD; a tabela dedicada serve o domínio de negócio.
