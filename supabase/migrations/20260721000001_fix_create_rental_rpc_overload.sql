-- Fix: DROP dos overloads antigos de create_rental_with_charges
-- O migration 20260719000010 adicionou p_late_charge_config via CREATE OR REPLACE,
-- que no PostgreSQL cria um NOVO overload quando a assinatura muda.
-- Resultado: múltiplos overloads ambíguos. Removemos todos exceto o canônico (12 params).

-- Overload 10 params (sem p_security_deposit)
DROP FUNCTION IF EXISTS create_rental_with_charges(
  UUID, UUID, UUID, TEXT, INTEGER, NUMERIC, DATE, DATE, BOOLEAN, JSONB
);

-- Overload 11 params (com p_security_deposit, sem p_late_charge_config)
DROP FUNCTION IF EXISTS create_rental_with_charges(
  UUID, UUID, UUID, TEXT, INTEGER, NUMERIC, DATE, DATE, BOOLEAN, JSONB, NUMERIC
);
