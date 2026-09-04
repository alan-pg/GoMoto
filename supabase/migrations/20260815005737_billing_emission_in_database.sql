-- ---------------------------------------------------------------------------
-- Emissão de cobranças dentro do banco (pg_cron)
-- ---------------------------------------------------------------------------
-- Move o job de emissão do agendador da Vercel para o Postgres. Duas razões,
-- nesta ordem de importância:
--
-- 1. ATOMICIDADE. Até aqui a emissão eram DUAS transações: a RPC criava a
--    cobrança e marcava a linha do cronograma como `issued`, e o Route Handler
--    lançava no ledger numa segunda chamada. Falha entre as duas deixava a
--    cobrança existindo, visível na tela e pagável, sem NUNCA ter entrado em
--    contas a receber — e a execução seguinte não corrigia, porque a linha já
--    estava consumida. Aqui documento e lançamento são a mesma transação, e o
--    modo de falha deixa de ser expressável.
--
-- 2. Menos peças: sem segredo de ambiente, sem endpoint HTTP que cria
--    documento financeiro, sem depender da janela do agendador externo.
--
-- A tradução evento → contas continua sendo de @gomoto/core para os outros
-- eventos. Aqui ela não é replicada: as pernas saem mecanicamente dos itens da
-- própria cobrança, que já declaram a conta a creditar em
-- `charge_items.credit_account_code`. É soma por conta declarada, não regra
-- de negócio duplicada.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ---------------------------------------------------------------------------
-- Registro das execuções
-- ---------------------------------------------------------------------------
-- Sem isto, "não rodou" e "rodou e não havia nada a fazer" são indistinguíveis
-- — que é como um segredo de ambiente ausente derrubou o faturamento inteiro
-- em silêncio. Uma linha por tenant por execução, para o operador conseguir
-- ver "última emissão" na própria tela, sem sair do produto.

CREATE TABLE billing_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Agrupa a mesma execução entre tenants.
  run_id         UUID NOT NULL,
  triggered_by   TEXT NOT NULL DEFAULT 'cron' CHECK (triggered_by IN ('cron', 'manual')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  charges_issued INT NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_billing_runs_tenant_started ON billing_runs (tenant_id, started_at DESC);

ALTER TABLE billing_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billing_runs ON billing_runs
  FOR ALL USING (tenant_id IN (SELECT get_user_tenants()));

CREATE TRIGGER update_billing_runs_updated_at
  BEFORE UPDATE ON billing_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE billing_runs IS
  'Execuções do job de emissão. Existe para tornar visível a AUSÊNCIA de execução.';

-- ---------------------------------------------------------------------------
-- Emissão de um tenant: documento + lançamento na MESMA transação
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_issue_charges_for_tenant(
  p_tenant_id UUID,
  p_lead_days INT DEFAULT 0
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row      RECORD;
  v_issued   INT := 0;
  v_entries  JSONB;
  v_total    NUMERIC;
BEGIN
  FOR v_row IN
    SELECT schedule_id, charge_id, charge_number
      FROM issue_due_charges(p_tenant_id, p_lead_days)
  LOOP
    -- Débito único em contas a receber; um crédito por conta declarada nos
    -- itens. Se a cobrança misturar naturezas, cada uma vira sua perna.
    SELECT
      COALESCE(sum(ci.amount), 0),
      jsonb_agg(
        jsonb_build_object(
          'account_code', ci.credit_account_code,
          'direction',    'credit',
          'amount',       ci.total,
          'customer_id',  c.customer_id,
          'rental_id',    c.rental_id,
          'charge_id',    c.id,
          'vehicle_id',   ci.vehicle_id
        )
      )
      INTO v_total, v_entries
      FROM charges c
      JOIN (
        SELECT charge_id, credit_account_code,
               sum(amount) AS total, sum(amount) AS amount,
               (array_agg(vehicle_id) FILTER (WHERE vehicle_id IS NOT NULL))[1] AS vehicle_id
          FROM charge_items
         WHERE charge_id = v_row.charge_id
         GROUP BY charge_id, credit_account_code
      ) ci ON ci.charge_id = c.id
     WHERE c.id = v_row.charge_id
     GROUP BY c.id, c.customer_id, c.rental_id;

    IF v_total IS NULL OR v_total <= 0 THEN
      CONTINUE;
    END IF;

    v_entries := v_entries || jsonb_build_array(
      jsonb_build_object(
        'account_code', 'contas_a_receber',
        'direction',    'debit',
        'amount',       v_total,
        'customer_id',  (SELECT customer_id FROM charges WHERE id = v_row.charge_id),
        'rental_id',    (SELECT rental_id   FROM charges WHERE id = v_row.charge_id),
        'charge_id',    v_row.charge_id,
        'vehicle_id',   (SELECT vehicle_id FROM charge_items
                          WHERE charge_id = v_row.charge_id AND vehicle_id IS NOT NULL LIMIT 1)
      )
    );

    PERFORM post_financial_transaction(
      p_tenant_id,
      jsonb_build_object(
        'event_type',    'charge_issued',
        'description',   'Emissão automática — cobrança #' || v_row.charge_number,
        'source_module', 'rental',
        'source_id',     (SELECT rental_id FROM charges WHERE id = v_row.charge_id)
      ),
      v_entries
    );

    v_issued := v_issued + 1;
  END LOOP;

  RETURN v_issued;
END;
$$;

COMMENT ON FUNCTION fn_issue_charges_for_tenant IS
  'Emite as cobranças devidas do tenant E as lança no ledger, na mesma transação.';

-- ---------------------------------------------------------------------------
-- Execução completa: todos os tenants ativos
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_run_billing_emission(
  p_triggered_by TEXT DEFAULT 'cron',
  p_lead_days    INT  DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id UUID := gen_random_uuid();
  v_tenant UUID;
  v_log_id UUID;
  v_count  INT;
BEGIN
  -- Tenant ativo é o que não tem data de suspensão. Não existe coluna
  -- booleana `suspended`: a versão anterior filtrava por ela e o job falhava
  -- na primeira linha, sem emitir nada para ninguém.
  FOR v_tenant IN
    SELECT id FROM tenants WHERE suspended_at IS NULL ORDER BY id
  LOOP
    INSERT INTO billing_runs (tenant_id, run_id, triggered_by)
    VALUES (v_tenant, v_run_id, p_triggered_by)
    RETURNING id INTO v_log_id;

    BEGIN
      v_count := fn_issue_charges_for_tenant(v_tenant, p_lead_days);

      UPDATE billing_runs
         SET charges_issued = v_count, finished_at = now()
       WHERE id = v_log_id;
    EXCEPTION WHEN OTHERS THEN
      -- Falha de um tenant não impede os demais, mas NÃO é engolida: fica
      -- registrada com a mensagem. Foi `EXCEPTION WHEN OTHERS` silencioso que
      -- deixou o crédito automático quebrado sem ninguém saber (F-06).
      UPDATE billing_runs
         SET error = SQLERRM, finished_at = now()
       WHERE id = v_log_id;
    END;
  END LOOP;

  RETURN v_run_id;
END;
$$;

COMMENT ON FUNCTION fn_run_billing_emission IS
  'Execução do faturamento. Isola falha por tenant e registra cada uma em billing_runs.';

-- ---------------------------------------------------------------------------
-- Agendamento
-- ---------------------------------------------------------------------------
-- O banco roda em UTC: 09:00 UTC = 06:00 em Brasília. Escrever '0 6 * * *'
-- aqui emitiria às 3h da manhã.

SELECT cron.unschedule('billing-emission')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-emission');

SELECT cron.schedule(
  'billing-emission',
  '0 9 * * *',
  $cron$ SELECT fn_run_billing_emission('cron'); $cron$
);
