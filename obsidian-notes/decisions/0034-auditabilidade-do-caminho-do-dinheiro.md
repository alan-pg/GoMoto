# ADR 0034 — Auditabilidade e superfície de escrita do caminho do dinheiro

*(por que este dinheiro entrou, quem mandou, e quem consegue mexer)*

- **Status:** 🟢 **Aceita** — Fases 1, 2, **2b**, **2c** e **3** implementadas; Fases 4 e 5 planejadas e priorizadas neste documento.
- **🔴 Contém DOIS achados CRÍTICOS com correção que precisa chegar em produção:** *Problema 3* (razão aberto para `anon`) e *Problema 4* (**escalação de privilégio para administrador da plataforma, ao alcance de qualquer usuário logado**). Os dois foram encontrados **verificando o banco**, não lendo as migrations — o segundo só apareceu porque a verificação da correção do primeiro não bateu.
- **Escopo:** o caminho inteiro do dinheiro de gateway — das três Edge Functions até o razão —, olhado por duas perguntas que nenhum ADR anterior fez: **"dá para reconstruir o que aconteceu?"** e **"quem consegue escrever aqui?"**
- **Data:** 2026-09-06
- **Autores:** Alan + agente IA
- **Substitui:** —
- **Substituída por:** —
- **Relacionada:** [[decisions/0024-ledger-financeiro-com-contrapartida|ADR 0024]], [[decisions/0030-multiplos-gateways-de-pagamento|ADR 0030]], [[decisions/0031-integracao-cora-parceria|ADR 0031]], [[decisions/0032-integracao-infinitepay-checkout|ADR 0032]], [[decisions/0033-dinheiro-para-cobranca-cancelada|ADR 0033]]

---

## Contexto

As ADRs 0030 a 0033 construíram a fundação multi-gateway e fecharam três ciclos em produção. Cada uma respondeu "o dinheiro entra certo?". Nenhuma respondeu as duas perguntas que só aparecem quando algo dá errado:

1. **Auditoria** — apareceu um valor na conta da locadora. Por quê, e quem mandou?
2. **Segurança** — quem, dentro da empresa, consegue escrever nessas tabelas?

A revisão de 2026-09-06 encontrou uma base sólida e duas lacunas de natureza diferente. Vale separar, porque a primeira é ausência de dado e a segunda é permissão concedida a mais.

### O que já estava de pé

Nada disto muda nesta ADR. Está aqui para delimitar o que **não** é o problema:

| Garantia | Onde |
|---|---|
| Razão imutável e balanceado, imposto pelo banco | `trg_entries_balanced`, `trg_ftx_immutable` |
| Idempotência como propriedade do banco | `UNIQUE (provider, provider_event_id)` |
| O corpo do webhook nunca vira dinheiro — a API do provedor decide | os três adapters |
| Tenant resolvido pelo **nosso** registro, nunca pela requisição | `payment_intents.provider_intent_id` |
| Confirmação atômica | `fn_confirm_gateway_payment` |
| Alocação imutável; pagamento imutável em valor, método, data e cliente | `trg_payment_allocations_immutable`, `fn_protect_payment` |
| Eleger o gateway que recebe é ato de **owner** | `fn_assert_gateway_owner` |
| `signature_valid` nunca afirma verificação que não houve | `_shared/signature.ts` |

O desenho estava certo. Faltava conseguir **contar a história depois** — e alguns `GRANT` contradiziam o resto.

---

## Problema 1 — a trilha quebra no salto que mais importa

A pergunta de auditoria não é "o razão fecha?". O razão sempre fecha: a partida dobrada é imposta por trigger. A pergunta é:

> **Apareceu R$ 1.240,00 na conta desta locadora em 12/09. Por quê, e quem mandou?**

O caminho existente ia até certo ponto:

```
financial_entries → financial_transactions (source_id) → payments
                                                            ↓ payment_intent_id
                                                       payment_intents
                                                            ↓ provider_intent_id
                                           ??? gateway_events  ← o salto que não existia
```

O último salto **não era dado**. Era uma busca montada na hora, diferente para cada gateway:

| Provedor | Como se achava o evento |
|---|---|
| Cora | `payload->>'webhook_resource_id'` |
| InfinitePay | `payload->>'order_nsu'` |
| Mercado Pago | `payload->'data'->>'id'` |

Isso não é rastreabilidade — é arqueologia, e depende de alguém que conheça os três formatos estar disponível na hora do incidente.

E no fim da corrente, três marcas de origem ficavam vazias:

- `financial_transactions.created_by` → **NULL** em toda confirmação de gateway
- `payments.received_by` → **NULL** (a coluna existe, e o caminho **manual** a preenche)
- `audit_logs` → **nenhuma linha**

**O único recebimento que ninguém digitou era também o único sem qualquer marca de origem.**

### 1.1 `audit_logs` nunca via dinheiro

`apps/web/src/lib/audit.ts` declarava `payment_confirmed` e `token_refreshed` no vocabulário de ações. **Nenhum dos dois tinha um único escritor.** É a forma exata do padrão já registrado em [[feedback_validated_then_discarded|"validado e descartado"]]: um vocabulário que ninguém escreve.

A causa é estrutural e não é descuido: a confirmação roda em **Deno**, com `service_role`, e `logAction` vive em `apps/web`. É o mesmo motivo de `_shared/inbox.ts` existir.

**Consequência:** a trilha do tenant registrava "conectou gateway" e "gerou Pix", e nunca "recebeu dinheiro" nem "estornou".

### 1.2 A fila de replay era invisível justamente para quem agiria

`gateway_events.tenant_id` só era preenchido no `markProcessed`. A RLS da tabela é `tenant_id IN (SELECT get_user_tenants())`.

**Evento que falhou tinha `tenant_id` NULL e era invisível para todos, exceto `service_role`.** As linhas que representam "dinheiro sem dono a investigar" — exatamente as que a ADR 0033 tornou possíveis ao trocar o silêncio por exceção — eram as únicas que ninguém conseguia ver.

### 1.3 `processing_error` carregava dois significados

O prefixo `CONFIRMADO_SEM_VERIFICACAO:` (ADR 0033) dividia a coluna com falhas reais, distinguido só por `processed_at` estar preenchido e por um texto livre. "Aceito com ressalva" é **estado do negócio**, não mensagem de erro: achar todos dependia de um `LIKE`.

### 1.4 A reconciliação existia só como teste

`apps/web/tests/reconciliacao.spec.ts` faz a pergunta certa — *"existe documento que não virou lançamento?"* — e varre o banco inteiro. Mas roda em CI, contra o banco de teste. **Produção não tem equivalente.**

---

## Problema 2 — permissões concedidas além do necessário

Todos os quatro achados exigem um **membro autenticado do tenant**. Não são acessíveis anonimamente.

Isso não os torna teóricos. O "insider" aqui é o operador ou o *viewer* da locadora — precisamente quem um controle financeiro existe para limitar. E o alcance é o navegador: o PostgREST expõe tudo isto com a anon key mais o JWT do usuário, sem passar por nenhuma linha do nosso código.

> **O princípio que faltava:** quem decide o que é alcançável é o `GRANT`, não o chamador. Uma Server Action rodar no servidor não protege nada se a RPC que ela chama também atende o navegador com o mesmo papel.

### 2.1 🔴 A credencial do gateway saía para qualquer membro, inclusive `viewer`

`fn_provider_credentials` tinha `GRANT EXECUTE ... TO authenticated` e conferia apenas **pertencimento ao tenant**. O `account_id` é legível pelos grants de coluna da tabela. Um `POST /rest/v1/rpc/fn_provider_credentials` devolvia `access_token` e `refresh_token` da Cora ou do Mercado Pago em texto puro.

O contraste dizia tudo: **conectar e eleger** gateway exigiam `owner`, via `fn_assert_gateway_owner`. **Ler o token** exigia só estar na empresa.

O comentário em `cobrancas/[id]/actions.ts` justificava a escolha: *"tudo que `getOrCreateIntent` toca é alcançável por `authenticated` sob RLS... contornar a RLS aqui seria trocar uma garantia do banco por uma comparação escrita à mão."*

O raciocínio está certo **para linhas** — e errado para um segredo do Vault. A RLS decide *quais linhas* um papel enxerga; ela não tem gradação de papel dentro do tenant. Um segredo que movimenta dinheiro não é uma linha do tenant: é uma capacidade.

### 2.2 🔴 `reversed_at` desfazia um recebimento sem tocar no razão

`GRANT ALL ON TABLE payments TO authenticated`. `fn_protect_payment` blindava valor, método, data e cliente — **e não `reversed_at`**.

```sql
UPDATE payments SET reversed_at = now(), reversal_reason = 'x' WHERE id = '...';
```

`charge_balances` filtra as alocações por `p.reversed_at IS NULL`. A cobrança **reabre**, o cliente volta a dever, e o razão continua mostrando o dinheiro em `caixa_e_bancos`. Razão e recebíveis passam a discordar permanentemente, sem transação de estorno, sem `reversed_by` e sem `audit_logs`.

Era o caminho mais curto entre um membro qualquer e uma divergência contábil que ninguém detecta.

### 2.3 🟠 O razão aceitava `INSERT` direto

`GRANT SELECT, INSERT ON financial_transactions, financial_entries TO authenticated` — enquanto `post_financial_transaction` é `SECURITY DEFINER`.

**O grant era desnecessário desde sempre.** Com ele, um membro postava lançamentos balanceados forjados, escolhendo `created_by`, `event_type` e `source_module`. O trigger só exige que a transação some zero; a exigência de duas pernas mora na RPC, que o `INSERT` direto contorna.

### 2.4 🟠 `payment_intents` era escrita direta do navegador

`GRANT ALL` mais policy `FOR ALL`. Qualquer membro podia `UPDATE` ou `DELETE` intents do próprio tenant. Apagar um intent zera `payments.payment_intent_id` (`ON DELETE SET NULL`) e **corta a ligação entre o recebimento e a tentativa que o originou** — exatamente o histórico que o `ON DELETE RESTRICT` em `provider_account_id` foi criado para preservar.

### 2.5 Adjacente: nenhum teste olha para dentro do tenant

A suíte de isolamento (`tenant-isolation-financeiro.spec.ts`) é inteira **tenant 1 vs. tenant 2**, e é boa nisso. Nenhum teste pergunta o que um `viewer` consegue fazer **dentro da própria empresa** — e é aí que estavam os quatro achados acima.

---

## Problema 3 — o razão estava aberto para `anon` 🔴

**Este achado não estava na análise.** Ele apareceu ao *verificar* a Fase 2 contra o banco em vez de confiar na leitura das migrations — e é mais grave do que tudo que a análise havia encontrado, porque não exige nem estar logado.

Reproduzido ao vivo, com a chave anônima e nada mais:

```
POST /rest/v1/rpc/post_financial_transaction
apikey: <anon key — a que viaja no bundle do navegador de toda página publicada>
{ "p_tenant_id": "<qualquer empresa>",
  "p_transaction": {...},
  "p_entries": [ débito 999999, crédito 999999 ] }

→ HTTP 200
→ lançamento de R$ 999.999,00 criado no razão daquela empresa
```

Sem login. Sem pertencer à empresa. Em tenant escolhido a dedo.

### A causa

`20260627230859_grant_authenticated_role.sql` resolveu um problema real — o role `postgres` local não concedia `SELECT/INSERT/UPDATE/DELETE` e o projeto quebrava depois de `db:reset` — com um instrumento largo demais:

```sql
GRANT ALL ON ALL TABLES   IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES ... GRANT ALL ON TABLES   TO anon, ...;
ALTER DEFAULT PRIVILEGES ... GRANT ALL ON ROUTINES TO anon, ...;
```

O `ALTER DEFAULT PRIVILEGES` é o que torna isto insidioso: **toda tabela e toda função criada depois nasce concedida a `anon`.** Cada `GRANT` cuidadoso escrito nas migrations seguintes estava concedendo o que já estava concedido, e cada `REVOKE ... FROM PUBLIC` não tocava em `anon` — `anon` é um role nomeado e não faz parte de `PUBLIC`.

Medido no banco antes da correção: **67 das 71 rotinas de `public` executáveis por `anon`, 37 delas `SECURITY DEFINER`** — ou seja, ignorando RLS.

### Por que só uma era explorável

Quase todas as funções de dinheiro conferem o tenant por dentro com `get_user_tenants()`, e para `anon` esse conjunto é **vazio** — então levantam exceção mesmo estando concedidas. A RLS cobriu as tabelas pelo mesmo motivo: as políticas são `TO authenticated`.

`post_financial_transaction` era a exceção: `SECURITY DEFINER`, recebe `p_tenant_id` **como parâmetro** e nunca perguntou quem estava chamando. A checagem de tenant morava em cada chamador; a função que efetivamente escreve no razão não tinha nenhuma.

> A lição não é "faltou uma checagem". É que **a defesa inteira dependia de um acidente feliz** — o fato de as outras funções precisarem consultar `get_user_tenants()` por outro motivo. Onde esse acidente não valeu, não havia nada.

### Fase 2b — correção ✅ implementada

Duas camadas, porque uma só já falhou aqui:

1. **`post_financial_transaction` exige papel e tenant.** Lista de **permitidos**, não de proibidos: `service_role` (webhook), `none` (conexão direta — `pg_cron` da emissão diária e migrations; verificado que o GUC `role` vale `'none'` nesse contexto) e `authenticated` **apenas no razão da própria empresa**. Quem não está nomeado não escreve. Um `IF role = 'anon' THEN recusa` fecharia o buraco de hoje e deixaria aberto o de amanhã.
2. **O grant sai de `anon`** nas 21 funções do domínio de dinheiro, e o `ALTER DEFAULT PRIVILEGES` deixa de conceder a `anon` daqui para a frente — este é o conserto da causa.

### Ressalva registrada — ✅ resolvida pela Fase 2c

A Fase 2b fechou o **domínio de dinheiro** e o default futuro, e deixou registrado que `anon` continuava com `EXECUTE` em funções de outros domínios (`add_to_queue`, `create_rental_with_schedule`, `check_user_email_conflict`, `list_platform_admins`, as de fila). O passo ficou em aberto porque varrer exigia saber o que os fluxos anteriores ao login legitimamente chamam.

**Esse levantamento foi feito e a varredura aconteceu na Fase 2c** (ver Problema 4): nenhuma RPC de `public` é chamada antes do login, e `anon` saiu do schema inteiro. `add_to_queue`, que gravava com HTTP 200 para o anônimo, foi um dos casos reais fechados ali.

---

## Problema 4 — a guarda que NULL desliga 🔴

Encontrado ao conferir se a Fase 2b tinha de fato fechado o que dizia ter fechado. **Não tinha** — e o caminho que faltava levou a algo pior.

### 4.1 Existiam DOIS caminhos até o `anon`, e a Fase 2b fechou um

A Fase 2b revogou `anon` de 21 funções de dinheiro e reportou isso. Ao reconferir, várias continuavam alcançáveis:

| Caminho | Origem | Fechado na 2b? |
|---|---|---|
| `GRANT ... TO anon` direto | `ALTER DEFAULT PRIVILEGES` de 2026-06-27 | ✅ |
| `EXECUTE` para **`PUBLIC`** | default do próprio PostgreSQL no `CREATE FUNCTION` | ❌ |

`anon` é membro de `PUBLIC`. No ACL isso aparece como `=X/postgres` — grantee vazio. `fn_pay_payable` tinha; `fn_provider_credentials`, que fez `REVOKE ALL ... FROM PUBLIC` na própria migration, não tinha — e por isso estava de fato fechada.

> É a mesma lição pela terceira vez: **`REVOKE ... FROM PUBLIC` e `REVOKE ... FROM anon` são coisas diferentes**, e precisar dos dois não é redundância.

### 4.2 Escalação de privilégio para administrador da plataforma

As três funções de administração da plataforma (de 2026-06-15) guardavam assim:

```sql
IF get_platform_role() <> 'owner' THEN
    RAISE EXCEPTION 'apenas owners podem ...' USING ERRCODE='42501';
END IF;
```

`get_platform_role()` é `SELECT role FROM platform_admins WHERE user_id = auth.uid()`. Para quem **não** é admin da plataforma — todo usuário normal, e o anônimo — devolve **NULL**.

E `NULL <> 'owner'` não é `TRUE`: é **NULL**. `IF NULL THEN` não executa.

**A guarda inteira era pulada exatamente para quem ela existe para barrar.**

Reproduzido ao vivo com um `operator` comum de tenant (`get_platform_role()` = NULL, `is_platform_admin()` = false):

```sql
SELECT add_platform_admin_by_email('outra-conta-minha@...', 'owner');
→ sucesso. A conta virou platform_admin OWNER.
```

Platform admin owner enxerga **todos os tenants**. Qualquer funcionário de qualquer locadora criava uma segunda conta e se promovia a administrador da plataforma inteira. Não exige nada exótico — basta ter login.

### O que segurou os outros caminhos foi acidente

- `remove_platform_admin` parou em *"a plataforma precisa de pelo menos um owner"* — regra de negócio, que só vale enquanto houver **um único** owner. Com dois, qualquer usuário remove qualquer um.
- Para o `anon`, `add_platform_admin_by_email` abortou no `platform_audit_logs.actor_id NOT NULL`, porque `auth.uid()` é NULL. **A trilha de auditoria defendeu por efeito colateral** — o `INSERT` em `platform_admins` já tinha sido aceito.

Duas defesas acidentais em dois achados diferentes. É o padrão que esta ADR existe para eliminar.

### Fase 2c — correção ✅ implementada

1. **`IS DISTINCT FROM`** nas três funções — o operador NULL-safe que o resto do schema já usa (`fn_provider_credentials`, `fn_assert_gateway_owner`). Somado no caminho: `SET search_path` nas três, que não tinham.
2. **`REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon`** — fecha o segundo caminho, para todos os domínios de uma vez, e não só para dinheiro.
3. **`ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON ROUTINES FROM PUBLIC`** — sem isto a próxima função nasce com `EXECUTE` para `PUBLIC` e o buraco se reabre sozinho, que é como este chegou até aqui.
4. **A migration se autoverifica**: falha se sobrar qualquer rotina alcançável por `anon`, ou se `authenticated` perder acesso a uma função crítica. Uma migration de permissão que não confere o resultado é uma intenção, não uma garantia — e a 2b provou isso ao revogar 21 e fechar menos que 21.

Verificado antes de revogar: **nenhuma** rotina depende do grant de `PUBLIC` para `authenticated` ou `service_role` (os dois têm grant explícito em todas), e **nenhuma** RPC de `public` é chamada antes do login. Verificado depois: `anon` recebe 42501 em tudo, usuário comum é barrado nas três funções de plataforma, e o **owner legítimo continua administrando** — guarda que barra todo mundo não serve.

---

## Decisão

### Princípios

1. **O elo causal é dado, não inferência.** Todo dinheiro que entra por gateway aponta para o evento que o causou, por coluna com FK — não por busca em JSONB.
2. **Nenhum registro afirma o que não aconteceu.** Se ninguém verificou, o registro diz isso em coluna própria (extensão do princípio de `signature_valid`, ADR 0030).
3. **Papel de sistema não se disfarça de pessoa.** A confirmação de gateway não inventa um `auth.users`; ela se identifica como `gateway:<provedor>` em campo próprio.
4. **O `GRANT` é a fronteira.** Capacidade que movimenta dinheiro não é concedida a `authenticated` porque a aplicação "só chama pelo caminho certo".
5. **A invariante que só existe em teste não protege produção.** Varredura de reconciliação vira view consultável.
6. **Grant se verifica no banco, nunca por leitura de migration.** As migrations diziam `GRANT SELECT ON gateway_events TO authenticated`; o banco tinha `INSERT, UPDATE, DELETE` também, vindos de um default de três meses antes. Toda afirmação sobre permissão neste ADR foi conferida com `has_function_privilege` e `information_schema`, e as recusas foram reproduzidas por HTTP.

### Fase 1 — o elo que faltava ✅ implementada

1. `payments.gateway_event_id` e `financial_transactions.source_event_id`, com FK para `gateway_events`. `fn_confirm_gateway_payment` recebe `p_gateway_event_id`; `applyPayment` passa o `eventId` que já tem em mãos.
2. `payments.received_by_system TEXT` — `'gateway:cora'`, `'gateway:mercadopago'`, `'gateway:infinitepay'`. Coluna própria em vez de um `auth.users` fictício, pelo Princípio 3.
3. `tenant_id` resolvido no `markFailed`, não só no `markProcessed`: sem isso a fila de replay continua invisível para quem agiria.
4. `gateway_events.accepted_without_verification BOOLEAN`, separado de `processing_error`.

### Fase 2 — fechar as portas ✅ implementada

| Achado | Correção | Custo |
|---|---|---|
| 2.3 Razão aceita `INSERT` | `REVOKE INSERT` | nenhum — a RPC é `SECURITY DEFINER` |
| 2.2 `reversed_at` livre | trava em `fn_protect_payment` | nenhum — `fn_reverse_payment` é `SECURITY DEFINER` |
| 2.1 Credencial para qualquer membro | `REVOKE EXECUTE FROM authenticated`; leitura passa pelo cliente admin | ajuste em `getOrCreateIntent` |
| 2.4 `payment_intents` escrevível | `REVOKE INSERT, UPDATE, DELETE`; escrita por RPC | ajuste em `getOrCreateIntent` |

### Fase 3 — tornar visível ✅ implementada (exceto o dreno)

5. **View `gateway_event_audit`** ✅ — evento → pagamento → cobrança → transação, com `signature_valid`, `accepted_without_verification` e o tempo de processamento. A classificação em cinco situações mora na view, não na tela: `confirmed`, `accepted_unverified`, `processed_no_money`, `pending`, `failed`.

   A ordem da classificação é decisão, não detalhe: **`accepted_unverified` ganha de `confirmed`**. Um recebimento aceito sem verificação é processado *e* precisa de olho humano; se `confirmed` viesse antes, a ressalva que a ADR 0033 decidiu registrar sumiria justamente da tela feita para mostrá-la.

6. **View `financial_reconciliation`** ✅ — uma linha por problema, vazio é saudável. As quatro verificações do `reconciliacao.spec.ts` mais duas novas: `payment_without_allocation` e `paid_intent_without_payment`, que são as formas de a corrente do gateway quebrar sem violar invariante nenhuma do banco.

   Provada por injeção: cada anomalia foi criada de propósito e a view a acusou. "Zero problemas" numa view que não detecta nada seria o pior resultado possível — é a mesma armadilha de vacuidade que o spec original já nomeava.

7. **Tela Configurações → Integrações → Diagnóstico** ✅ *parcial* — Owner/Admin, sub-rota no padrão de `configuracoes/usuarios`. Resumo, tabela de eventos com filtro "precisam de atenção", erros crus fora da tabela (espremê-los numa célula truncaria justamente o que explica a falha), e a reconciliação.

   **O botão de reprocessar NÃO foi entregue**, e a Questão 2 da ADR 0033 continua aberta. O motivo é estrutural: reprocessar exige rodar a verificação do provedor, que vive nas Edge Functions em Deno, e cada uma tem a sua (`fetchInvoice` na Cora, `fetchPayment` no MP, `checkPayment` na InfinitePay, esta última precisando de quatro campos do payload). Fazer o dreno em `apps/web` duplicaria lógica de dinheiro — exatamente o que `_shared/inbox.ts` existe para impedir.

   O caminho certo é extrair os três adaptadores para `_shared/` e criar uma função `gateway-replay` que despacha por provedor. É trabalho de tamanho próprio, sobre o caminho de dinheiro que acabou de ser validado em produção, e por isso não foi enfiado aqui. **A tela mostra o problema; ela ainda não o resolve** — e diz isso a quem olha, em vez de oferecer um botão que não faz o que promete.

### Fase 4 — vigilância ativa 🔜

8. `pg_cron` **já está no projeto** desde `20260815005737` (emissão de cobranças). Não é infraestrutura nova. Duas rotinas: drenar `idx_gateway_events_unprocessed` com backoff, e varrer a reconciliação diariamente.
9. Alerta para o que precisa de humano: evento não processado há mais de 1h; confirmação sem verificação; `signature_valid = false` em provedor que assina.

### Fase 5 — trilha confiável 🔜

10. `logAction` deixa de engolir a própria falha **nos caminhos de dinheiro**. Nos demais, tolerar continua aceitável — mas a diferença passa a ser explícita, em vez de um `catch` único para tudo.
11. `payment_confirmed` / `payment_reversed` ganham escritor: um trigger em `payments` popula `audit_logs`, o que também resolve o Deno não alcançar `apps/web`.
12. Teste E2E de **privilégio intra-tenant** — ✅ **primeira leva entregue** em `apps/web/tests/privilegio-no-caminho-do-dinheiro.spec.ts`: `anon` não lança no razão nem lê credencial, membro logado não escreve em `payment_intents` nem no razão, `reversed_at` direto é recusado. Falta a leva por PAPEL (o que um `viewer` consegue que um `owner` deveria poder), que exige fixtures de usuário com papéis distintos.

---

## Consequências

**Ganho.** "Por que este dinheiro entrou?" passa a ser um `JOIN`, não uma investigação. A confirmação sem verificação da ADR 0033 vira consulta booleana em vez de `LIKE` em texto livre. Quatro capacidades que não deveriam estar ao alcance do navegador saem de lá — e o razão deixa de aceitar escrita de quem não está logado.

**Verificação.** Nada aqui foi aceito por leitura de código. As permissões foram conferidas com `has_function_privilege` e `information_schema`; os dois exploits foram reproduzidos por HTTP e por SQL antes e depois da correção; a guarda interna do razão foi testada com o grant reconcedido de propósito, para provar que basta sozinha; e os caminhos legítimos (`service_role`, `pg_cron` com `role = 'none'`, usuário logado na própria empresa, owner de plataforma administrando) foram exercitados um a um. Suíte E2E completa em banco limpo: **257 passando, 0 falhas**.

E a lição de método, que custou o Problema 4: **verificar a própria correção é o que encontra o resto.** A Fase 2b reportou "21 funções revogadas" e estava certa quanto ao que fez — só não era o que bastava. Contar o que se fez não é medir o resultado.

**Custo.** `getOrCreateIntent` deixa de escrever `payment_intents` com o cliente do usuário e passa por RPC — a validação de tenant, que a RLS fazia, passa a ser explícita dentro da função. É exatamente a troca que o comentário em `actions.ts` desaconselhava, e continua sendo um argumento válido em geral: escolhemos pagá-la aqui porque `payment_intents` guarda a única ligação entre dinheiro e tentativa, e essa ligação não pode depender de nenhum membro se comportar bem.

**Não resolvido.** As duas questões em aberto da ADR 0033 continuam abertas: o destino do dinheiro que chega para cobrança cancelada (Questão 1) e o dreno da fila (Questão 2) — este último passa a ter endereço definido na Fase 3, item 7.

**Em aberto.** Restam as Fases 3 a 5 — visibilidade e vigilância. Nada de segurança ficou pendente desta varredura: `anon` está fora de `public`, as guardas de papel são NULL-safe, e a migration falha sozinha se qualquer uma das duas coisas regredir.

Duas miudezas anotadas, sem urgência: três policies (`billing_runs`, `fine_attachments`, `late_charge_policies`) declaram `{public}` em vez de `{authenticated}` — inofensivo hoje, porque o `USING` depende de `get_user_tenants()`/`current_customer_ids()`, vazios para o anônimo; e `payments` aceita `DELETE` de `authenticated`, na prática barrado pelo `ON DELETE RESTRICT` das alocações, que são imutáveis.

**Aceito.** A ADR 0033 permite confirmar sem verificar quando a credencial da Cora vence. Isto continua valendo; a mudança é que agora fica marcado em coluna própria e será alvo de alerta na Fase 4, em vez de depender de alguém abrir o log.
