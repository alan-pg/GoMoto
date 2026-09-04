-- ---------------------------------------------------------------------------
-- Alocação não pode passar do que a cobrança deve
-- ---------------------------------------------------------------------------
-- `fn_assert_allocation_within_payment` já garante que as alocações não somam
-- mais que o PAGAMENTO. Faltava o outro lado: nada impedia alocar mais do que a
-- COBRANÇA vale.
--
-- O caminho real era fração de centavo. O campo de recebimento aceitava
-- 446,836 numa cobrança de R$ 446,83 — `type="number"` com `step="0.01"` só é
-- validado em submit de formulário nativo, que a tela não usa. O valor chegava
-- inteiro no banco, `NUMERIC(14,2)` arredondava para 446,84, e a cobrança
-- ficava com `open_amount = -0,01`: paga a mais, sem ninguém ter recusado nada.
-- Reproduzido antes de escrever esta migration.
--
-- A tela agora corta na digitação e arredonda no envio. Isso é a primeira
-- porta, não a fechadura: a recusa tem de estar onde a linha é escrita, senão
-- vale só para quem passa pela tela. Mesma lição de `fn_pay_payable` e
-- `fn_settle_customer_credit`.
--
-- Pagamento estornado não conta — é o mesmo critério de `charge_balances`,
-- senão estornar e receber de novo esbarraria no próprio histórico.

CREATE OR REPLACE FUNCTION fn_assert_allocation_within_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_total NUMERIC(14,2);
  v_alloc NUMERIC(14,2);
BEGIN
  SELECT COALESCE(SUM(amount), 0) INTO v_total
    FROM charge_items WHERE charge_id = NEW.charge_id;

  SELECT COALESCE(SUM(pa.amount), 0) INTO v_alloc
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
   WHERE pa.charge_id = NEW.charge_id
     AND p.reversed_at IS NULL;

  IF v_alloc > v_total THEN
    RAISE EXCEPTION
      'Alocações da cobrança % somam % e excedem o valor devido (%).',
      NEW.charge_id, v_alloc, v_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

-- CONSTRAINT TRIGGER DEFERRABLE: o encargo por atraso é realizado como item
-- novo na MESMA transação do recebimento, e a ordem entre inserir o item e
-- inserir a alocação não é garantida em todos os caminhos. Adiando para o
-- commit, a conta é conferida quando os dois lados já existem.
DROP TRIGGER IF EXISTS trg_allocation_within_charge ON payment_allocations;
CREATE CONSTRAINT TRIGGER trg_allocation_within_charge
  AFTER INSERT ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_assert_allocation_within_charge();

COMMENT ON FUNCTION fn_assert_allocation_within_charge IS
  'Impede que a soma alocada a uma cobrança ultrapasse o valor dos seus itens — o que deixaria open_amount negativo.';
