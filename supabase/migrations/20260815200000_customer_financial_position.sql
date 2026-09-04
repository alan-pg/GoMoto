-- ---------------------------------------------------------------------------
-- Resultado por cliente
-- ---------------------------------------------------------------------------
-- Havia visão por veículo (`vehicle_financial_position`) e por locação
-- (`rental_financial_result`), mas nenhuma por CLIENTE — e a pergunta "quanto
-- este cliente rendeu e quanto custou" é a que decide renovação, reajuste e
-- limite de crédito. Os dados já estavam lá: todo lançamento carrega
-- `customer_id`. Faltava materializar.
--
-- A distinção que essa view precisa fazer certo, e que uma soma ingênua erra:
--
--   `attributed_cost`  — o custo BRUTO que passou por este cliente. Numa
--                        despesa rateada, é o valor cheio, porque o lançamento
--                        de custo carrega o cliente inteiro.
--   `reimbursed`       — quanto disso foi recuperado dele.
--   `absorbed_cost`    — o que a empresa comeu: bruto menos recuperado. É este
--                        o número que responde "este cliente dá lucro?".
--
-- Somar `attributed_cost` entre clientes NÃO dá o custo da empresa: despesa sem
-- cliente fica de fora, e rateio aparece cheio em um só. Para o total da
-- empresa existe o DRE.

CREATE VIEW customer_financial_position
WITH (security_invoker = true)
AS
SELECT
  e.tenant_id,
  e.customer_id,

  -- Receita própria (aluguel, encargo) — o que o cliente gerou de fato.
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind = 'revenue'), 0)        AS revenue,

  -- Custo bruto que passou por ele, incluindo a parte da empresa no rateio.
  COALESCE(SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0)         AS attributed_cost,

  -- Quanto desse custo voltou via repasse.
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind = 'reimbursement'), 0)  AS reimbursed,

  -- O que a empresa absorveu: bruto menos recuperado.
  --
  -- Despesa é débito, então chega POSITIVA em `amount_signed`; repasse é
  -- crédito e chega negativo. Somar os dois já é subtrair o recuperado do
  -- bruto — inverter o sinal do repasse aqui somaria, e o custo absorvido
  -- apareceria maior que o bruto.
  COALESCE(SUM(e.amount_signed) FILTER (WHERE a.kind IN ('expense', 'reimbursement')), 0) AS absorbed_cost,

  -- Resultado: receita + recuperação − custo bruto.
  COALESCE(-SUM(e.amount_signed) FILTER (WHERE a.kind IN ('revenue', 'reimbursement')), 0)
    - COALESCE(SUM(e.amount_signed) FILTER (WHERE a.kind = 'expense'), 0)     AS net_result,

  -- Perda reconhecida por inadimplência deste cliente.
  COALESCE(SUM(e.amount_signed) FILTER (WHERE a.code = 'perda_inadimplencia'), 0) AS bad_debt,

  -- Quebra do custo por natureza, espelhando a visão por veículo.
  COALESCE(SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_manutencao'), 0)  AS maintenance_cost,
  COALESCE(SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_multa'), 0)       AS fines_cost,
  COALESCE(SUM(e.amount_signed) FILTER (WHERE a.code = 'despesa_operacional'), 0) AS operational_cost

FROM financial_entries e
JOIN financial_accounts a ON a.code = e.account_code
WHERE e.customer_id IS NOT NULL
GROUP BY e.tenant_id, e.customer_id;

COMMENT ON VIEW customer_financial_position IS
  'Resultado por cliente. `attributed_cost` é o custo BRUTO que passou por ele; `absorbed_cost` é o que a empresa comeu depois do repasse. Somar entre clientes não dá o custo da empresa — para isso existe o DRE.';

GRANT SELECT ON customer_financial_position TO authenticated, service_role;
