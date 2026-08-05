-- Adiciona segundo telefone e separa contato de emergência em nome + telefone
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS phone2                    VARCHAR(20),
  ADD COLUMN IF NOT EXISTS emergency_contact_name    VARCHAR(200),
  ADD COLUMN IF NOT EXISTS emergency_contact_phone   VARCHAR(20);
