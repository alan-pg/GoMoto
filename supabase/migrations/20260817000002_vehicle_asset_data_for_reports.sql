-- ---------------------------------------------------------------------------
-- Compra e venda do veículo: um fato, uma coluna, uma superfície de relatório
-- ---------------------------------------------------------------------------
-- Havia DUAS colunas para o valor de aquisição:
--
--   `acquisition_amount`  — o que o cadastro do veículo grava ("Valor pago").
--   `acquisition_value`   — o que as telas financeiras leem.
--
-- Ninguém escrevia na segunda, exceto um botão isolado na tela de ROI. No banco
-- local: 20 veículos com `acquisition_amount` preenchido, ZERO com
-- `acquisition_value`. O operador informava o valor pago e o relatório respondia
-- "Aquisição —", e o painel de ROI da tela financeira, que filtra
-- `.not('acquisition_value','is',null)`, vinha sempre vazio.
--
-- Fica `acquisition_amount`: é onde o dado está e é o nome que o schema de
-- domínio em @gomoto/core já usa, alinhado com `amount` no resto do financeiro.
--
-- Decisão do Alan (2026-08-17): compra e venda NÃO entram no razão. São dados
-- de relatório — não há lançamento de ativo, nem depreciação. O razão continua
-- registrando só o que é operação (receita, custo, repasse).

UPDATE vehicles
   SET acquisition_amount = acquisition_value
 WHERE acquisition_amount IS NULL
   AND acquisition_value IS NOT NULL;

ALTER TABLE vehicles DROP COLUMN IF EXISTS acquisition_value;

COMMENT ON COLUMN vehicles.acquisition_amount IS
  'Valor pago na aquisição. Dado de relatório — não gera lançamento no razão.';
COMMENT ON COLUMN vehicles.sale_value IS
  'Valor da alienação. Dado de relatório — não gera lançamento no razão.';

-- ---------------------------------------------------------------------------
-- Superfície de relatório do ativo
-- ---------------------------------------------------------------------------
-- `vehicle_financial_position` só enxerga veículo COM lançamento: uma moto
-- comprada e ainda não locada não aparece nela. Para responder "quanto custou,
-- quanto rendeu, por quanto saiu" é preciso partir de `vehicles` e trazer o
-- resultado por LEFT JOIN — senão o relatório omite justamente o ativo parado,
-- que é o que dói no caixa.
CREATE OR REPLACE VIEW vehicle_asset_position AS
SELECT
  v.tenant_id,
  v.id                          AS vehicle_id,
  v.license_plate,
  v.make,
  v.model,
  v.purchase_date,
  v.acquisition_amount,
  v.sold_at,
  v.sale_value,
  (v.sold_at IS NOT NULL)       AS is_sold,
  COALESCE(p.operating_revenue, 0) AS operating_revenue,
  COALESCE(p.gross_costs, 0)       AS gross_costs,
  COALESCE(p.reimbursed, 0)        AS reimbursed,
  COALESCE(p.net_result, 0)        AS net_result,
  -- Resultado do ATIVO: o que a operação deixou, mais o que a venda trouxe,
  -- menos o que a compra custou. Sem valor de aquisição não há resposta —
  -- NULL diz isso, enquanto zero mentiria dizendo que a moto foi de graça.
  CASE
    WHEN v.acquisition_amount IS NULL THEN NULL
    ELSE COALESCE(p.net_result, 0) + COALESCE(v.sale_value, 0) - v.acquisition_amount
  END AS asset_result
FROM vehicles v
LEFT JOIN vehicle_financial_position p
       ON p.vehicle_id = v.id AND p.tenant_id = v.tenant_id;

COMMENT ON VIEW vehicle_asset_position IS
  'Compra, venda e resultado operacional por veículo, incluindo os que ainda não têm lançamento. Base dos relatórios de frota.';

GRANT SELECT ON vehicle_asset_position TO authenticated;
