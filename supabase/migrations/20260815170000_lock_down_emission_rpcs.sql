-- ---------------------------------------------------------------------------
-- Emissão de cobrança deixa de ser chamável pelo cliente
-- ---------------------------------------------------------------------------
-- `issue_due_charges` emite o DOCUMENTO e só. Quem lança no razão é
-- `fn_issue_charges_for_tenant`, que a envolve e faz as duas coisas na mesma
-- transação. As duas estavam com EXECUTE para `anon` e `authenticated`.
--
-- Chamar a de dentro sozinha produz exatamente o estado que a ADR 0024 existe
-- para impedir: cobrança emitida que nunca vira lançamento. Ela some do DRE,
-- some de `contas_a_receber` e mesmo assim aparece na tela de cobranças — um
-- relatório que não bate com a operação, sem nada acusando.
--
-- Ninguém legítimo precisa desses grants: a emissão roda por `pg_cron` dentro
-- do banco, e o disparo manual passa por `/api/cron/issue-charges`, que exige
-- `CRON_SECRET` e usa `service_role`.

REVOKE EXECUTE ON FUNCTION issue_due_charges(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION issue_due_charges(UUID, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION fn_issue_charges_for_tenant(UUID, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_issue_charges_for_tenant(UUID, INT) TO service_role;

REVOKE EXECUTE ON FUNCTION fn_run_billing_emission(TEXT, INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION fn_run_billing_emission(TEXT, INT) TO service_role;

COMMENT ON FUNCTION issue_due_charges IS
  'Passo interno: emite o documento, NÃO lança no razão. Use fn_issue_charges_for_tenant, que faz as duas coisas atomicamente.';
