-- ---------------------------------------------------------------------------
-- `fn_cancel_payable` — cancelar desfaz TUDO que o lançamento criou (ADR 0029)
-- ---------------------------------------------------------------------------
-- Manutenção registrada por engano precisa poder ser desfeita, e com ela a
-- despesa, a cobrança de repasse e o crédito do cliente.
--
-- Não existia caminho para o caso do cliente executor. `fn_create_payable` cria
-- o payable já `paid` quando quem pagou foi o cliente — a empresa nunca teve o
-- que pagar —, e o `cancelPayable` do TypeScript recusava qualquer payable
-- `paid`. Como `checkMaintenanceDeletable` só libera com o payable `cancelled`,
-- a manutenção ficava presa para sempre. A recusa ainda mandava "acerte em
-- Cobranças antes de excluir": "antes" não chegava nunca, e estorno de crédito
-- sequer existe como operação.
--
-- Por que no BANCO e não em passos soltos no TypeScript: a guarda do crédito
-- depende de SALDO DERIVADO (`customer_credit_balances`, soma de
-- `financial_entries`). Ler-decidir-escrever solto deixa dois operadores
-- desfazerem o mesmo crédito — a lição que já custou caro em
-- `fn_reverse_payment`, `fn_confirm_gateway_payment` e `fn_pay_payable`. Guarda
-- e escrita na mesma transação, sob trava.
--
-- Duas recusas, ambas quando dinheiro de TERCEIRO se moveu:
--
--   • cobrança de repasse já paga  — o cliente pagou por algo que não
--     aconteceu, e tem direito de volta. Estornar esse recebimento por dentro
--     de um cancelamento o esconderia: estorno é fato próprio, com motivo e
--     trilha próprios.
--   • crédito já usado ou devolvido — o cliente já se beneficiou.
--
-- Baixa de despesa é diferente e é estornada JUNTO: ali o caixa é próprio, e o
-- estorno apenas reconhece que a saída não devia ter sido lançada. Era o único
-- lançamento de dinheiro sem reversão no sistema.

-- ---------------------------------------------------------------------------
-- 1. Crédito cancelado precisa aparecer como cancelado
-- ---------------------------------------------------------------------------
-- O saldo é derivado do razão, então estornar as pernas já o zera. Mas a ficha
-- do cliente lista as CONCESSÕES ("o que foi concedido, não o que resta") ao
-- lado do saldo real: sem marcar a linha, um crédito desfeito seguiria ali com
-- cara de crédito vivo.

ALTER TABLE customer_credits
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancellation_reason TEXT;

COMMENT ON COLUMN customer_credits.cancelled_at IS
  'Concessão desfeita (ADR 0029). O saldo já é derivado do razão; esta coluna '
  'existe para a linha não aparecer como crédito vivo na ficha do cliente.';

-- ---------------------------------------------------------------------------
-- 2. O cancelamento em uma transação
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_cancel_payable(
  p_tenant_id  UUID,
  p_payable_id UUID,
  p_reason     TEXT,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_p          RECORD;
  v_origem     UUID;
  v_charge     RECORD;
  v_credit     RECORD;
  v_saldo      NUMERIC;
  v_tx         RECORD;
  v_legs       JSONB;
  v_item       RECORD;
  v_veiculo    UUID;
  v_cancelada  UUID := NULL;
  v_estornadas INT := 0;
BEGIN
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'CANCEL_REASON_REQUIRED';
  END IF;

  -- A trava é o ponto da função: sem ela o status lido aqui pode não ser o que
  -- a escrita seguinte encontra.
  SELECT id, description, amount, status, expense_account_code, customer_id,
         vehicle_id, rental_id, source_module, source_id
    INTO v_p
    FROM payables
   WHERE id = p_payable_id AND tenant_id = p_tenant_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYABLE_NOT_FOUND';
  END IF;
  IF v_p.status = 'cancelled' THEN
    RAISE EXCEPTION 'PAYABLE_ALREADY_CANCELLED';
  END IF;

  -- ── Cobrança de repasse ─────────────────────────────────────────────────
  -- A origem é COALESCE(source_id, id): despesa avulsa não tem registro de
  -- origem e usa o próprio id. Enquanto isto exigia `source_id`, o
  -- cancelamento pulava a busca no caso mais comum e a cobrança sobrevivia.
  v_origem := COALESCE(v_p.source_id, p_payable_id);

  SELECT c.id, c.charge_number, c.customer_id, c.rental_id,
         COALESCE(b.paid_amount, 0) AS paid_amount
    INTO v_charge
    FROM charges c
    LEFT JOIN charge_balances b ON b.charge_id = c.id
   WHERE c.tenant_id     = p_tenant_id
     AND c.source_module = v_p.source_module
     AND c.source_id     = v_origem
     AND c.status <> 'cancelled'
   FOR UPDATE OF c;

  IF FOUND THEN
    IF v_charge.paid_amount > 0 THEN
      RAISE EXCEPTION 'CHARGE_HAS_PAYMENT: cobrança #% com % recebido',
        v_charge.charge_number, v_charge.paid_amount;
    END IF;

    UPDATE charges
       SET status = 'cancelled', cancellation_reason = p_reason
     WHERE id = v_charge.id AND tenant_id = p_tenant_id;

    -- Inverso exato de `charge_issued`, agrupado por conta creditada na
    -- emissão. As dimensões precisam ser as MESMAS: sem o veículo o estorno
    -- fica fora de `vehicle_financial_position` enquanto a emissão continua
    -- dentro, e a moto aparece recuperando um valor que foi cancelado.
    SELECT vehicle_id INTO v_veiculo
      FROM charge_items
     WHERE charge_id = v_charge.id AND vehicle_id IS NOT NULL
     LIMIT 1;

    FOR v_item IN
      SELECT credit_account_code, SUM(amount) AS amount
        FROM charge_items
       WHERE charge_id = v_charge.id
       GROUP BY credit_account_code
    LOOP
      PERFORM post_financial_transaction(
        p_tenant_id,
        jsonb_build_object(
          'event_type',    'charge_issuance_reversed',
          'description',   'Cancelamento da cobrança #' || v_charge.charge_number || ' — ' || p_reason,
          'source_module', 'charge',
          'source_id',     v_charge.id,
          'created_by',    p_created_by
        ),
        jsonb_build_array(
          jsonb_build_object('account_code', v_item.credit_account_code, 'direction', 'debit',
                             'amount', v_item.amount, 'customer_id', v_charge.customer_id,
                             'rental_id', v_charge.rental_id, 'vehicle_id', v_veiculo,
                             'charge_id', v_charge.id),
          jsonb_build_object('account_code', 'contas_a_receber', 'direction', 'credit',
                             'amount', v_item.amount, 'customer_id', v_charge.customer_id,
                             'rental_id', v_charge.rental_id, 'vehicle_id', v_veiculo,
                             'charge_id', v_charge.id)
        )
      );
    END LOOP;

    v_cancelada := v_charge.id;
  END IF;

  -- ── Crédito do cliente ──────────────────────────────────────────────────
  SELECT id, customer_id, amount
    INTO v_credit
    FROM customer_credits
   WHERE tenant_id = p_tenant_id
     AND payable_id = p_payable_id
     AND cancelled_at IS NULL;

  IF FOUND THEN
    -- Trava o CLIENTE: o saldo é derivado e não tem linha para travar. Mesmo
    -- recurso que `fn_apply_customer_credit` usa.
    PERFORM 1 FROM customers
     WHERE id = v_credit.customer_id AND tenant_id = p_tenant_id
     FOR UPDATE;

    SELECT COALESCE(balance, 0) INTO v_saldo
      FROM customer_credit_balances
     WHERE tenant_id = p_tenant_id AND customer_id = v_credit.customer_id;

    IF COALESCE(v_saldo, 0) < v_credit.amount THEN
      RAISE EXCEPTION 'CREDIT_ALREADY_USED: concedido %, saldo %',
        v_credit.amount, COALESCE(v_saldo, 0);
    END IF;

    UPDATE customer_credits
       SET cancelled_at = now(), cancellation_reason = p_reason
     WHERE id = v_credit.id;
  END IF;

  -- ── O razão ─────────────────────────────────────────────────────────────
  -- Toda transação deste payable que ainda não foi estornada: a criação
  -- (`payable_created` ou `credit_granted`) e a baixa (`payable_paid`). O
  -- vínculo é `financial_entries.payable_id`, que as três carregam — e que a
  -- emissão da cobrança de repasse NÃO carrega, por isso ela não entra aqui.
  FOR v_tx IN
    SELECT DISTINCT ft.id, ft.created_at
      FROM financial_transactions ft
      JOIN financial_entries e ON e.transaction_id = ft.id
     WHERE ft.tenant_id = p_tenant_id
       AND e.payable_id = p_payable_id
       AND NOT EXISTS (
             SELECT 1 FROM financial_transactions r
              WHERE r.reverses_transaction_id = ft.id)
     ORDER BY ft.created_at
  LOOP
    SELECT jsonb_agg(
             jsonb_build_object(
               'account_code', e.account_code,
               'direction',    CASE e.direction WHEN 'debit' THEN 'credit' ELSE 'debit' END,
               'amount',       e.amount,
               'customer_id',  e.customer_id,
               'vehicle_id',   e.vehicle_id,
               'rental_id',    e.rental_id,
               'charge_id',    e.charge_id,
               'payable_id',   e.payable_id
             ) ORDER BY e.id)
      INTO v_legs
      FROM financial_entries e
     WHERE e.transaction_id = v_tx.id;

    IF v_legs IS NULL OR jsonb_array_length(v_legs) < 2 THEN
      RAISE EXCEPTION 'REVERSAL_SOURCE_UNBALANCED: transação % sem pernas', v_tx.id;
    END IF;

    PERFORM post_financial_transaction(
      p_tenant_id,
      jsonb_build_object(
        'event_type',              'payable_cancelled',
        'description',             'Cancelamento — ' || v_p.description || ' — ' || p_reason,
        'source_module',           'payable',
        'source_id',               p_payable_id,
        'reverses_transaction_id', v_tx.id,
        'created_by',              p_created_by
      ),
      v_legs
    );

    v_estornadas := v_estornadas + 1;
  END LOOP;

  -- `paid_at` sai junto: o CHECK `payables_paid_has_date` exige
  -- `status = 'paid'` ⟺ `paid_at IS NOT NULL`, e manter a data diria que a
  -- despesa segue paga depois de a baixa ter sido estornada acima.
  UPDATE payables
     SET status = 'cancelled', paid_at = NULL
   WHERE id = p_payable_id AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object(
    'payable_id',           p_payable_id,
    'cancelled_charge_id',  v_cancelada,
    'cancelled_credit_id',  CASE WHEN v_credit.id IS NOT NULL THEN v_credit.id END,
    'reversed_transactions', v_estornadas
  );
END;
$$;

GRANT EXECUTE ON FUNCTION fn_cancel_payable TO authenticated, service_role;
