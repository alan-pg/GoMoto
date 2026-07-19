-- Módulo Financeiro (Spec 0008) — Passo 12: triggers de negócio financeiro
--
-- trg_billings_delinquency: atualiza delinquency_status do cliente quando
--   o status de uma cobrança muda (ADR 0014). Falha silenciosa para não
--   bloquear a transação principal.
--
-- trg_billings_auto_credit: aplica crédito automático quando configurado
--   pelo tenant. Falha silenciosa.

-- ============================================================
-- fn_recalculate_delinquency
-- ============================================================
CREATE OR REPLACE FUNCTION fn_recalculate_delinquency()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_tenant_id       UUID := COALESCE(NEW.tenant_id, OLD.tenant_id);
  v_customer_id     UUID := COALESCE(NEW.customer_id, OLD.customer_id);
  v_thresholds      JSONB;
  v_overdue_count   INTEGER;
  v_max_days        INTEGER;
  v_new_status      delinquency_level;
BEGIN
  -- Bloqueio manual nunca é sobrescrito pelo trigger (ADR 0014)
  IF (SELECT delinquency_status FROM customers WHERE id = v_customer_id) = 'blocked' THEN
    RETURN NEW;
  END IF;

  SELECT value::jsonb INTO v_thresholds
    FROM settings
   WHERE tenant_id = v_tenant_id AND key = 'delinquency_thresholds';

  SELECT
    COUNT(*),
    COALESCE(MAX(CURRENT_DATE - due_date), 0)
  INTO v_overdue_count, v_max_days
  FROM billings
  WHERE tenant_id   = v_tenant_id
    AND customer_id = v_customer_id
    AND status      = 'overdue';

  v_new_status := 'current';

  IF v_overdue_count > 0 THEN
    v_new_status := 'late';

    IF v_overdue_count >= COALESCE((v_thresholds->>'delinquent_count')::int, 3)
    OR v_max_days      >= COALESCE((v_thresholds->>'delinquent_days')::int, 30) THEN
      v_new_status := 'delinquent';
    END IF;

    IF (v_thresholds->>'auto_block')::boolean = true
       AND (
         v_overdue_count >= COALESCE((v_thresholds->>'blocked_count')::int, 5)
         OR v_max_days   >= COALESCE((v_thresholds->>'blocked_days')::int, 60)
       ) THEN
      v_new_status := 'blocked';
    END IF;
  END IF;

  UPDATE customers
    SET delinquency_status = v_new_status
  WHERE id = v_customer_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[financial-trigger] delinquency customer_id=% error=%', v_customer_id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_billings_delinquency
  AFTER INSERT OR UPDATE OF status ON billings
  FOR EACH ROW EXECUTE FUNCTION fn_recalculate_delinquency();

-- ============================================================
-- fn_auto_apply_credit
-- ============================================================
CREATE OR REPLACE FUNCTION fn_auto_apply_credit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_auto_apply BOOLEAN;
  v_credit     RECORD;
  v_apply_amt  NUMERIC(10,2);
BEGIN
  SELECT (value::jsonb->>'enabled')::boolean INTO v_auto_apply
    FROM settings
   WHERE tenant_id = NEW.tenant_id AND key = 'auto_apply_credit';

  IF NOT COALESCE(v_auto_apply, false) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_credit
    FROM customer_credits
   WHERE tenant_id       = NEW.tenant_id
     AND customer_id     = NEW.customer_id
     AND available_balance > 0
   ORDER BY created_at ASC
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_apply_amt := LEAST(v_credit.available_balance, NEW.original_amount);

  INSERT INTO credit_applications (
    tenant_id, credit_id, billing_id, amount, applied_by, is_auto
  ) VALUES (
    NEW.tenant_id, v_credit.id, NEW.id, v_apply_amt, NULL, true
  );

  UPDATE customer_credits
    SET available_balance = available_balance - v_apply_amt
  WHERE id = v_credit.id;

  UPDATE billings
    SET credit_applied = v_apply_amt
  WHERE id = NEW.id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[financial-trigger] auto_credit billing_id=% error=%', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_billings_auto_credit
  AFTER INSERT ON billings
  FOR EACH ROW EXECUTE FUNCTION fn_auto_apply_credit();
