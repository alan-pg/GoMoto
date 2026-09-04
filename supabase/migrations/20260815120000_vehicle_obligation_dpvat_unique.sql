-- ---------------------------------------------------------------------------
-- DPVAT entra na unicidade anual da obrigação
-- ---------------------------------------------------------------------------
-- `vehicle_obligations_year_unique` cobria ipva, licensing e crv_issuance, mas
-- não dpvat — que é igualmente anual e por veículo. Sem a restrição, duas
-- gravações concorrentes do mesmo cadastro criavam duas obrigações de DPVAT do
-- mesmo ano, cada uma com sua conta a pagar: o custo aparecia dobrado no DRE.
--
-- Os tipos que ficam de fora (detran_fee, other, insurance) podem repetir
-- legitimamente dentro do mesmo ano, então o índice segue parcial.

DROP INDEX IF EXISTS vehicle_obligations_year_unique;

CREATE UNIQUE INDEX vehicle_obligations_year_unique
  ON vehicle_obligations (vehicle_id, type, reference_year)
  WHERE type IN ('ipva', 'licensing', 'crv_issuance', 'dpvat');

COMMENT ON INDEX vehicle_obligations_year_unique IS
  'Obrigação anual é uma por veículo/tipo/ano. Índice parcial: detran_fee e other podem repetir.';
