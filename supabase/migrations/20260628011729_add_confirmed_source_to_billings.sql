-- Registra a origem da confirmação de pagamento (mp_webhook, manual, etc.).
-- NULL indica registros legados (anteriores a esta migration).
ALTER TABLE billings
  ADD COLUMN IF NOT EXISTS confirmed_source TEXT;
