-- ---------------------------------------------------------------------------
-- O app do cliente mostrava a cobrança CHEIA depois de ela ter sido paga
-- ---------------------------------------------------------------------------
-- Sintoma: cobrança #2 da Ana Silva, R$ 102,69 emitidos com R$ 100,00 já
-- abatidos por crédito. O cockpit web mostrava R$ 2,76 a pagar; o app do
-- cliente, R$ 105,45.
--
-- Causa: `charge_balances` é `security_invoker = true` e deriva `paid_amount`
-- somando `payment_allocations`. Essa tabela tinha APENAS a policy
-- `tenant_isolation_payment_allocations` — nenhuma policy de cliente, ao
-- contrário de `charges`, `charge_items` e `payments`, que todas ganharam a sua
-- `customer_read_own_*`. Para a sessão do cliente o LATERAL não devolvia linha
-- nenhuma, `allocated` virava 0, e a view respondia `open_amount = total_amount`.
--
-- O erro então se multiplicava: `calculateAmountDue` recebia o principal errado
-- e calculava o encargo sobre ele. Sobre R$ 102,69 o encargo dá R$ 2,76
-- (2% de multa + 0,99% ao mês por 21 dias), e o devido exibido virava
-- R$ 105,45 — coincidentemente o mesmo "2,76" que o web mostrava como TOTAL,
-- o que torna a divergência ainda mais fácil de ler como acerto.
--
-- Não era só esta cobrança: toda cobrança parcial ou totalmente paga aparecia
-- cheia no app, com encargo sobre o valor cheio. Uma cobrança 100% quitada
-- continuava listada como em aberto, porque o filtro do app
-- (`status = 'open' AND open_amount > 0`) roda sobre os mesmos números errados.
--
-- O cliente não pagou a mais porque a criação da intent de pagamento roda com
-- service role e recalcula do lado do servidor (`/api/charges/[id]/payment-intent`,
-- que já documenta ter ido para service role porque "a RLS bloqueia as leituras
-- necessárias"). Ou seja: a tela anunciava R$ 105,45 e o Pix saía com R$ 2,76.
--
-- A correção é dar ao cliente a mesma leitura que ele já tem das outras três
-- tabelas — as alocações das SUAS cobranças, e só delas.

CREATE POLICY customer_read_own_payment_allocations ON payment_allocations
  FOR SELECT TO authenticated
  USING (
    charge_id IN (
      SELECT id FROM charges WHERE customer_id IN (SELECT current_customer_ids())
    )
  );

COMMENT ON POLICY customer_read_own_payment_allocations ON payment_allocations IS
  'O saldo que o app do cliente exibe sai de charge_balances, que soma payment_allocations sob security_invoker: sem esta leitura o abatimento some e a cobrança aparece cheia.';
