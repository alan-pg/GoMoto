-- ---------------------------------------------------------------------------
-- O dia do negócio passa a ser o do TENANT, não um fuso cravado
-- ---------------------------------------------------------------------------
-- Sintoma que expôs isto: às 22h de 31/08 (BRT), com a receita toda emitida
-- naquele dia, a tela do DRE ficou EM BRANCO. O cabeçalho pedia "mar/26 a
-- ago/26" e a view respondia setembro.
--
-- Três relógios discordavam ao mesmo tempo:
--
--   fn_business_today()            → 31/08   (America/Sao_Paulo, cravado)
--   CURRENT_DATE / date_trunc(UTC) → 01/09   (income_statement)
--   new Date() do servidor Node    → 31/08   (BRT em dev, UTC na Vercel)
--
-- `charge_balances`, `fn_create_charge`, `issue_due_charges` e
-- `fn_realize_late_charge` já tinham migrado para `fn_business_today()`. Só
-- `income_statement` ficou agrupando por `occurred_at` em UTC — e é ela que
-- decide em que MÊS cada receita aparece.
--
-- O modo de falha muda conforme o ambiente, e o pior é o de produção:
--   • em dev (servidor em BRT): tela e view discordam → DRE em branco, falha
--     barulhenta;
--   • na Vercel (servidor em UTC): as duas concordam em UTC → DRE preenchido,
--     com toda emissão feita depois das 21h contada no mês seguinte. Número
--     plausível e errado, que ninguém percebe.
--
-- E o fuso não pode ser constante: locadora em Manaus (−04) ou em Fernando de
-- Noronha (−02) tem outro corte de dia. O fuso é do TENANT.
--
-- Desenho:
--   fn_business_date(ts, tz)  — IMMUTABLE, converte qualquer instante
--   fn_tenant_timezone(id)    — STABLE, lê o fuso do tenant
--   fn_business_today(id)     — STABLE, o "hoje" daquele tenant
--
-- Um lugar só sabe converter; um lugar só sabe o fuso de cada tenant. A versão
-- sem argumento de `fn_business_today()` é removida no fim: deixá-la viva
-- manteria um caminho que ignora o tenant, e é exatamente esse tipo de atalho
-- que produziu o defeito.

-- ---------------------------------------------------------------------------
-- 1. O fuso do tenant
-- ---------------------------------------------------------------------------

ALTER TABLE tenants
  ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- Fuso inválido vira erro na hora de gravar, não uma data errada meses depois.
ALTER TABLE tenants
  ADD CONSTRAINT tenants_timezone_valido
  CHECK (now() AT TIME ZONE timezone IS NOT NULL) NOT VALID;

ALTER TABLE tenants VALIDATE CONSTRAINT tenants_timezone_valido;

COMMENT ON COLUMN tenants.timezone IS
  'Fuso do negócio: define onde termina o dia para vencimento, atraso e competência. Nome IANA (America/Sao_Paulo, America/Manaus).';

-- ---------------------------------------------------------------------------
-- 2. Fora as views que dependem do relógio antigo
-- ---------------------------------------------------------------------------
-- Precisa vir antes de trocar a função: enquanto elas existirem, o Postgres
-- recusa remover `fn_business_today()`. São recriadas na seção 4.

DROP VIEW IF EXISTS customer_delinquency  CASCADE;
DROP VIEW IF EXISTS receivables_by_month  CASCADE;
DROP VIEW IF EXISTS receivables_summary   CASCADE;
DROP VIEW IF EXISTS charge_balances       CASCADE;

-- ---------------------------------------------------------------------------
-- 2. As três funções
-- ---------------------------------------------------------------------------

-- IMMUTABLE porque, dado o instante e o fuso, a data é sempre a mesma — é o que
-- permite usá-la em índice e em GROUP BY sem custo por linha.
CREATE OR REPLACE FUNCTION fn_business_date(p_at TIMESTAMPTZ, p_timezone TEXT)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_at AT TIME ZONE COALESCE(NULLIF(p_timezone, ''), 'America/Sao_Paulo'))::DATE;
$$;

COMMENT ON FUNCTION fn_business_date IS
  'Converte um instante para a DATA do negócio no fuso informado. Único lugar que sabe fazer essa conversão.';

CREATE OR REPLACE FUNCTION fn_tenant_timezone(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- SECURITY DEFINER: a resolução do dia não pode depender de o chamador ter
  -- permissão de ler `tenants`. O app do cliente consulta `charge_balances`, que
  -- precisa saber o fuso, e não lê a tabela de tenants.
  SELECT COALESCE(
    (SELECT timezone FROM tenants WHERE id = p_tenant_id),
    'America/Sao_Paulo'
  );
$$;

COMMENT ON FUNCTION fn_tenant_timezone IS
  'Fuso do tenant, com queda para America/Sao_Paulo. SECURITY DEFINER: a data do negócio não pode depender de quem lê.';

DROP FUNCTION IF EXISTS fn_business_today();

CREATE OR REPLACE FUNCTION fn_business_today(p_tenant_id UUID)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT fn_business_date(now(), fn_tenant_timezone(p_tenant_id));
$$;

COMMENT ON FUNCTION fn_business_today IS
  'Hoje no fuso do tenant. Não existe versão sem tenant de propósito: um "hoje" global foi o que colocou receita no mês errado.';

GRANT EXECUTE ON FUNCTION fn_business_date      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_tenant_timezone    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION fn_business_today     TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Views que decidem dia e mês
-- ---------------------------------------------------------------------------

CREATE VIEW charge_balances WITH (security_invoker = true) AS
SELECT c.id AS charge_id,
    c.tenant_id,
    c.customer_id,
    c.rental_id,
    c.charge_number,
        CASE
            WHEN c.status = ANY (ARRAY['cancelled'::charge_status, 'written_off'::charge_status]) THEN c.status
            WHEN (COALESCE(i.total, 0::numeric) - COALESCE(a.allocated, 0::numeric)) <= 0::numeric THEN 'paid'::charge_status
            ELSE 'open'::charge_status
        END AS status,
    c.issue_date,
    c.due_date,
    c.currency,
    COALESCE(i.total, 0::numeric) AS total_amount,
    COALESCE(a.allocated, 0::numeric) AS paid_amount,
    COALESCE(i.total, 0::numeric) - COALESCE(a.allocated, 0::numeric) AS open_amount,
    (c.status <> ALL (ARRAY['cancelled'::charge_status, 'written_off'::charge_status]))
      AND COALESCE(i.total, 0::numeric) > COALESCE(a.allocated, 0::numeric)
      AND c.due_date < fn_business_today(c.tenant_id) AS is_overdue,
    GREATEST(0, fn_business_today(c.tenant_id) - c.due_date) AS days_overdue,
    c.late_charge_policy_id
   FROM charges c
     LEFT JOIN LATERAL ( SELECT sum(ci.amount) AS total
           FROM charge_items ci
          WHERE ci.charge_id = c.id) i ON true
     LEFT JOIN LATERAL ( SELECT sum(pa.amount) AS allocated
           FROM payment_allocations pa
             JOIN payments p ON p.id = pa.payment_id
          WHERE pa.charge_id = c.id AND p.reversed_at IS NULL) a ON true;

CREATE VIEW customer_delinquency WITH (security_invoker = true) AS
SELECT tenant_id,
    customer_id,
    count(*) AS overdue_count,
    max(days_overdue) AS max_days_overdue,
    sum(open_amount) AS overdue_amount,
    min(due_date) AS oldest_due_date
   FROM charge_balances
  WHERE is_overdue
  GROUP BY tenant_id, customer_id;

-- ---------------------------------------------------------------------------
-- 4. O DRE passa a competir pelo mês do NEGÓCIO
-- ---------------------------------------------------------------------------
-- Era `date_trunc('month', t.occurred_at)` — mês em UTC. A data do fato que
-- alimenta a resolução da política contábil também muda: `occurred_at::date`
-- tinha o mesmo desvio.

DROP VIEW IF EXISTS income_statement;

CREATE VIEW income_statement WITH (security_invoker = true) AS
SELECT e.tenant_id,
    date_trunc('month', fn_business_date(t.occurred_at, fn_tenant_timezone(e.tenant_id)))::date AS period,
    r.report_line_code,
    COALESCE(rl.name, r.report_line_code) AS report_line_name,
    COALESCE(rl.sort_order, 999) AS sort_order,
    r.in_tax_base,
    - sum(e.amount_signed) AS amount
   FROM financial_entries e
     JOIN financial_transactions t ON t.id = e.transaction_id
     JOIN financial_accounts a ON a.code = e.account_code
     CROSS JOIN LATERAL fn_resolve_report_line(
       e.tenant_id, e.account_code,
       fn_business_date(t.occurred_at, fn_tenant_timezone(e.tenant_id))
     ) r(report_line_code, in_tax_base)
     LEFT JOIN report_lines rl ON rl.code = r.report_line_code
  WHERE a.kind = ANY (ARRAY['revenue'::account_kind, 'expense'::account_kind, 'reimbursement'::account_kind])
  GROUP BY e.tenant_id,
           date_trunc('month', fn_business_date(t.occurred_at, fn_tenant_timezone(e.tenant_id))),
           r.report_line_code, rl.name, rl.sort_order, r.in_tax_base;

COMMENT ON VIEW income_statement IS
  'DRE por competência, no fuso do TENANT. Agrupava por occurred_at em UTC: emissão feita depois das 21h caía no mês seguinte, e na virada do mês a receita mudava de exercício.';

GRANT SELECT ON charge_balances, customer_delinquency, income_statement TO authenticated;
GRANT ALL    ON charge_balances, customer_delinquency, income_statement TO service_role;

-- Recriadas sem alteração: caíram no CASCADE de `charge_balances`. Elas já
-- agrupam por `due_date`, que é DATE — não tem fuso e não muda aqui.

CREATE VIEW receivables_summary WITH (security_invoker = true) AS
SELECT tenant_id,
    count(*) FILTER (WHERE status = 'open'::charge_status AND open_amount > 0::numeric) AS open_count,
    COALESCE(sum(open_amount) FILTER (WHERE status = 'open'::charge_status AND open_amount > 0::numeric), 0::numeric) AS open_total,
    count(*) FILTER (WHERE is_overdue) AS overdue_count,
    COALESCE(sum(open_amount) FILTER (WHERE is_overdue), 0::numeric) AS overdue_total,
    count(DISTINCT customer_id) FILTER (WHERE is_overdue) AS overdue_customers
   FROM charge_balances
  GROUP BY tenant_id;

CREATE VIEW receivables_by_month WITH (security_invoker = true) AS
 WITH deposit_flag AS (
         SELECT ci.charge_id,
            bool_and(ci.credit_account_code = 'caucoes_a_devolver'::text) AS is_deposit
           FROM charge_items ci
          GROUP BY ci.charge_id
        )
 SELECT b.tenant_id,
    date_trunc('month'::text, b.due_date::timestamp with time zone)::date AS month,
    count(*) AS charge_count,
    COALESCE(sum(b.total_amount), 0::numeric) AS issued_total,
    COALESCE(sum(b.paid_amount), 0::numeric) AS paid_total,
    COALESCE(sum(b.open_amount) FILTER (WHERE b.status = 'open'::charge_status AND NOT b.is_overdue), 0::numeric) AS pending_total,
    COALESCE(sum(b.open_amount) FILTER (WHERE b.is_overdue), 0::numeric) AS overdue_total,
    count(*) FILTER (WHERE b.status = 'paid'::charge_status) AS paid_count,
    count(*) FILTER (WHERE b.status = 'open'::charge_status AND NOT b.is_overdue) AS pending_count,
    count(*) FILTER (WHERE b.is_overdue) AS overdue_count,
    COALESCE(sum(b.total_amount) FILTER (WHERE d.is_deposit), 0::numeric) AS deposit_issued,
    COALESCE(sum(b.paid_amount) FILTER (WHERE d.is_deposit), 0::numeric) AS deposit_paid
   FROM charge_balances b
     LEFT JOIN deposit_flag d ON d.charge_id = b.charge_id
  WHERE b.status <> 'cancelled'::charge_status
  GROUP BY b.tenant_id, (date_trunc('month'::text, b.due_date::timestamp with time zone));

GRANT SELECT ON receivables_summary, receivables_by_month TO authenticated;
GRANT ALL    ON receivables_summary, receivables_by_month TO service_role;

-- ---------------------------------------------------------------------------
-- 5. As funções que chamavam a versão sem tenant
-- ---------------------------------------------------------------------------
-- Recriadas sem outra mudança: só a troca de `fn_business_today()` por
-- `fn_business_today(p_tenant_id)`. Todas já recebiam o tenant.

CREATE OR REPLACE FUNCTION public.fn_create_charge(p_tenant_id uuid, p_charge jsonb, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total     NUMERIC(14,2);
  v_vehicle   UUID;
  v_number    BIGINT;
  v_policy    UUID;
  v_charge    UUID;
  v_rental    UUID := NULLIF(p_charge->>'rental_id', '')::UUID;
  v_customer  UUID := (p_charge->>'customer_id')::UUID;
  v_source_id UUID := NULLIF(p_charge->>'source_id', '')::UUID;
  v_entries   JSONB;
  v_tx        UUID;
BEGIN
  SELECT SUM((i->>'amount')::NUMERIC) INTO v_total
    FROM jsonb_array_elements(p_items) i;

  IF v_total IS NULL OR v_total <= 0 THEN
    RAISE EXCEPTION 'Cobrança precisa ter valor maior que zero';
  END IF;

  -- Sem veículo no lançamento a cobrança some do resultado por veículo. Item
  -- que traz o seu manda; a locação é o piso.
  SELECT (i->>'vehicle_id')::UUID INTO v_vehicle
    FROM jsonb_array_elements(p_items) i
   WHERE NULLIF(i->>'vehicle_id', '') IS NOT NULL
   LIMIT 1;

  IF v_vehicle IS NULL AND v_rental IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle
      FROM rentals WHERE id = v_rental AND tenant_id = p_tenant_id;
  END IF;

  v_number := fn_next_charge_number(p_tenant_id);

  -- Data de EMISSÃO, não de vencimento: encargo é cláusula do documento, e
  -- vale a que estava em vigor quando ele saiu.
  v_policy := fn_late_charge_policy_at(
    p_tenant_id,
    COALESCE(NULLIF(p_charge->>'issue_date', '')::DATE, fn_business_today(p_tenant_id))
  );

  INSERT INTO charges (
    tenant_id, customer_id, rental_id, charge_number,
    source_module, source_id, due_date, issue_date,
    late_charge_policy_id, created_by
  )
  VALUES (
    p_tenant_id, v_customer, v_rental, v_number,
    p_charge->>'source_module', v_source_id,
    (p_charge->>'due_date')::DATE,
    COALESCE(NULLIF(p_charge->>'issue_date', '')::DATE, fn_business_today(p_tenant_id)),
    v_policy, NULLIF(p_charge->>'created_by', '')::UUID
  )
  RETURNING id INTO v_charge;

  -- Origem vem do DOCUMENTO: uma cobrança cobra uma coisa só, e deixar o item
  -- declarar a sua permitiria divergir do documento que o contém.
  INSERT INTO charge_items (
    tenant_id, charge_id, description, credit_account_code,
    quantity, unit_amount, amount, source_module, source_id, vehicle_id
  )
  SELECT
    p_tenant_id, v_charge, i->>'description', i->>'credit_account_code',
    COALESCE((i->>'quantity')::NUMERIC, 1),
    (i->>'unit_amount')::NUMERIC,
    (i->>'amount')::NUMERIC,
    p_charge->>'source_module', v_source_id,
    COALESCE(NULLIF(i->>'vehicle_id', '')::UUID, v_vehicle)
  FROM jsonb_array_elements(p_items) i;

  -- Um documento emitido é UM fato: uma transação, com o débito do total em
  -- contas a receber e um crédito por natureza econômica. A versão anterior
  -- abria uma transação por conta creditada, fragmentando o mesmo fato.
  v_entries := jsonb_build_array(
    jsonb_build_object(
      'account_code', 'contas_a_receber',
      'direction',    'debit',
      'amount',       v_total,
      'customer_id',  v_customer,
      'rental_id',    v_rental,
      'charge_id',    v_charge,
      'vehicle_id',   v_vehicle
    )
  );

  SELECT v_entries || COALESCE(jsonb_agg(
    jsonb_build_object(
      'account_code', conta,
      'direction',    'credit',
      'amount',       valor,
      'customer_id',  v_customer,
      'rental_id',    v_rental,
      'charge_id',    v_charge,
      'vehicle_id',   v_vehicle
    )
  ), '[]'::jsonb)
  INTO v_entries
  FROM (
    SELECT i->>'credit_account_code' AS conta,
           ROUND(SUM((i->>'amount')::NUMERIC), 2) AS valor
      FROM jsonb_array_elements(p_items) i
     GROUP BY 1
  ) agrupado;

  v_tx := post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'charge_issued',
      'description',   'Cobrança #' || v_number,
      'source_module', p_charge->>'source_module',
      'source_id',     v_source_id,
      'created_by',    NULLIF(p_charge->>'created_by', '')::UUID
    ),
    v_entries
  );

  RETURN jsonb_build_object(
    'charge_id',      v_charge,
    'charge_number',  v_number,
    'total_amount',   v_total,
    'transaction_id', v_tx
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_create_late_charge_policy(p_tenant_id uuid, p_fee_type late_fee_type, p_fee_value numeric, p_daily_interest_rate numeric, p_grace_period_days smallint, p_min_amount numeric, p_effective_from date, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_version INT;
  v_id      UUID;
BEGIN
  PERFORM 1 FROM tenants WHERE id = p_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TENANT_NOT_FOUND';
  END IF;

  -- `fn_business_today(p_tenant_id)`, não `CURRENT_DATE`: a data que o operador vê na tela.
  IF p_effective_from < fn_business_today(p_tenant_id) THEN
    RAISE EXCEPTION 'EFFECTIVE_FROM_IN_PAST';
  END IF;

  SELECT COALESCE(MAX(version), 0) + 1 INTO v_version
    FROM late_charge_policies
   WHERE tenant_id = p_tenant_id;

  INSERT INTO late_charge_policies (
    tenant_id, version, effective_from, fee_type, fee_value,
    daily_interest_rate, grace_period_days, min_amount, created_by
  ) VALUES (
    p_tenant_id, v_version, p_effective_from, p_fee_type, p_fee_value,
    p_daily_interest_rate, p_grace_period_days, p_min_amount, p_created_by
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$

;

CREATE OR REPLACE FUNCTION public.fn_realize_late_charge(p_tenant_id uuid, p_charge_id uuid, p_amount numeric, p_created_by uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_customer UUID;
  v_rental   UUID;
  v_vehicle  UUID;
  v_number   BIGINT;
  v_dias     INT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RETURN; END IF;

  SELECT customer_id, rental_id, charge_number,
         GREATEST(0, fn_business_today(p_tenant_id) - due_date)
    INTO v_customer, v_rental, v_number, v_dias
    FROM charges
   WHERE id = p_charge_id AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CHARGE_NOT_FOUND';
  END IF;

  -- Mesma resolução do TS: veículo do item, senão o da locação. Sem a dimensão
  -- o encargo some do resultado da moto, que agrega por `vehicle_id`.
  SELECT vehicle_id INTO v_vehicle
    FROM charge_items
   WHERE charge_id = p_charge_id AND vehicle_id IS NOT NULL
   LIMIT 1;

  IF v_vehicle IS NULL AND v_rental IS NOT NULL THEN
    SELECT vehicle_id INTO v_vehicle
      FROM rentals WHERE id = v_rental AND tenant_id = p_tenant_id;
  END IF;

  INSERT INTO charge_items (
    tenant_id, charge_id, description, credit_account_code,
    quantity, unit_amount, amount, vehicle_id, source_module, source_id
  ) VALUES (
    p_tenant_id, p_charge_id,
    'Encargo por atraso (' || v_dias || ' dias)',
    'receita_encargos_atraso',
    1, p_amount, p_amount, v_vehicle, 'late_charge', p_charge_id
  );

  PERFORM post_financial_transaction(
    p_tenant_id,
    jsonb_build_object(
      'event_type',    'late_charge_realized',
      'description',   'Encargo realizado — cobrança #' || v_number,
      'source_module', 'late_charge',
      'source_id',     p_charge_id,
      'created_by',    p_created_by
    ),
    jsonb_build_array(
      jsonb_build_object('account_code','contas_a_receber','direction','debit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', v_rental, 'vehicle_id', v_vehicle,
                         'charge_id', p_charge_id),
      jsonb_build_object('account_code','receita_encargos_atraso','direction','credit',
                         'amount', p_amount, 'customer_id', v_customer,
                         'rental_id', v_rental, 'vehicle_id', v_vehicle,
                         'charge_id', p_charge_id)
    )
  );
END;
$function$

;

CREATE OR REPLACE FUNCTION public.issue_due_charges(p_tenant_id uuid, p_lead_days integer DEFAULT 0)
 RETURNS TABLE(schedule_id uuid, charge_id uuid, charge_number bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row      RECORD;
  v_charge   UUID;
  v_number   BIGINT;
BEGIN
  -- A resolução saiu daqui para dentro do laço (ver o INSERT abaixo): emitir em
  -- lote não torna as cobranças o mesmo documento, e uma virada de política no
  -- meio da execução deixaria metade do lote com a regra errada.

  FOR v_row IN
    SELECT s.*, r.customer_id, r.vehicle_id
      FROM rental_billing_schedules s
      JOIN rentals r ON r.id = s.rental_id
     WHERE s.tenant_id = p_tenant_id
       AND s.status    = 'scheduled'
       AND s.period_start <= fn_business_today(p_tenant_id) + p_lead_days
       AND r.status    = 'active'
     ORDER BY s.due_date
     FOR UPDATE OF s
  LOOP
    v_number := fn_next_charge_number(p_tenant_id);

    INSERT INTO charges (
      tenant_id, customer_id, rental_id, charge_number,
      due_date, late_charge_policy_id, source_module, source_id
    )
    VALUES (
      p_tenant_id, v_row.customer_id, v_row.rental_id, v_number,
      v_row.due_date, fn_late_charge_policy_at(p_tenant_id, fn_business_today(p_tenant_id)),
      'rental', v_row.id
    )
    RETURNING id INTO v_charge;

    INSERT INTO charge_items (
      tenant_id, charge_id, description, credit_account_code,
      unit_amount, amount, source_module, source_id, vehicle_id
    )
    VALUES (
      p_tenant_id, v_charge,
      'Locação ' || to_char(v_row.period_start, 'DD/MM/YYYY') ||
        ' a ' || to_char(v_row.period_end, 'DD/MM/YYYY'),
      'receita_locacao',
      v_row.amount, v_row.amount,
      'rental', v_row.id, v_row.vehicle_id
    );

    UPDATE rental_billing_schedules
       SET status = 'issued', updated_at = now()
     WHERE id = v_row.id;

    schedule_id   := v_row.id;
    charge_id     := v_charge;
    charge_number := v_number;
    RETURN NEXT;
  END LOOP;
END;
$function$

;

