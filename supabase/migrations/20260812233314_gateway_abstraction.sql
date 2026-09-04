-- Spec 0014 / ADR 0024 — Redesenho do sistema financeiro
-- Migration 12/17: camada de gateway agnóstica de provedor.
--
-- Hoje o Mercado Pago está no schema, não na configuração: billing_pix carrega
-- mp_payment_id como coluna própria, e payment_connections tem mp_user_id mais
-- UNIQUE(tenant_id) — um tenant não consegue ter dois provedores. Trocar ou
-- somar gateway é mudança de schema.
--
-- Resolve F-13 e F-14. Mercado Pago passa a ser a primeira implementação da
-- interface PaymentProvider em @gomoto/core, não o formato das tabelas.
--
-- O drop das tabelas antigas acontece aqui, junto com quem as substitui, em vez
-- de na migration 15 como a Spec previa: agrupar substituto e substituído na
-- mesma migration deixa a mudança legível de uma vez só.

DROP TABLE IF EXISTS billing_pix         CASCADE;
DROP TABLE IF EXISTS payment_connections CASCADE;

-- ---------------------------------------------------------------------------
-- Conta do provedor
-- ---------------------------------------------------------------------------

CREATE TABLE payment_provider_accounts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL,
  external_account_id TEXT NOT NULL,

  -- Formato específico do provedor. Oportunidade de cifrar com pgcrypto,
  -- já habilitado no projeto — hoje access_token fica em texto puro.
  credentials   JSONB NOT NULL,

  is_default    BOOLEAN NOT NULL DEFAULT false,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Não mais UNIQUE(tenant_id): vários provedores por tenant.
  UNIQUE (tenant_id, provider, external_account_id)
);

COMMENT ON TABLE payment_provider_accounts IS
  'Spec 0014: credenciais de gateway. Substitui payment_connections; provider vira dado, não schema.';

CREATE UNIQUE INDEX idx_provider_accounts_one_default
  ON payment_provider_accounts (tenant_id) WHERE is_default;

CREATE INDEX idx_provider_accounts_lookup
  ON payment_provider_accounts (provider, external_account_id) WHERE active;

CREATE TRIGGER trg_payment_provider_accounts_updated_at
  BEFORE UPDATE ON payment_provider_accounts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------------
-- Tentativa de pagamento
-- ---------------------------------------------------------------------------

CREATE TABLE payment_intents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_id     UUID NOT NULL REFERENCES charges(id) ON DELETE RESTRICT,

  provider      TEXT NOT NULL,
  provider_account_id UUID NOT NULL REFERENCES payment_provider_accounts(id) ON DELETE RESTRICT,
  method        TEXT NOT NULL,
  provider_intent_id TEXT,

  amount        NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','paid','expired','failed','refunded','cancelled')),
  expires_at    TIMESTAMPTZ,

  -- qr_code, linha digitável, url — o que o provedor devolver.
  payload       JSONB,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (provider, provider_intent_id)
);

COMMENT ON TABLE payment_intents IS
  'Spec 0014: tentativa de pagamento no gateway. Substitui billing_pix, sem coluna específica de provedor.';

-- Uma tentativa pendente por cobrança: evita dois QR ativos para a mesma dívida.
CREATE UNIQUE INDEX idx_payment_intents_one_pending_per_charge
  ON payment_intents (charge_id) WHERE status = 'pending';

CREATE INDEX idx_payment_intents_charge ON payment_intents (charge_id);
CREATE INDEX idx_payment_intents_tenant ON payment_intents (tenant_id, status);

CREATE TRIGGER trg_payment_intents_updated_at
  BEFORE UPDATE ON payment_intents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- FK pendente da migration 09
ALTER TABLE payments
  ADD CONSTRAINT payments_payment_intent_id_fkey
  FOREIGN KEY (payment_intent_id) REFERENCES payment_intents(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Inbox de webhook
-- ---------------------------------------------------------------------------
-- Hoje o webhook não persiste nada: não há replay, não há auditoria do que o
-- provedor mandou, e a idempotência depende do efeito colateral
-- `.neq('status','paid')`. Refund e chargeback são descartados com HTTP 200.

CREATE TABLE gateway_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- nullable: o tenant só é conhecido depois de resolver a conta do provedor
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,

  provider          TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL,
  signature_valid   BOOLEAN NOT NULL,

  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at      TIMESTAMPTZ,
  processing_error  TEXT,
  attempts          SMALLINT NOT NULL DEFAULT 0,

  -- Idempotência como propriedade do banco, não como efeito colateral.
  UNIQUE (provider, provider_event_id)
);

COMMENT ON TABLE gateway_events IS
  'Spec 0014: inbox de webhook. Persistido ANTES de processar — habilita replay, auditoria e tratamento de refund/chargeback (F-14).';

-- Fila de reprocessamento: eventos recebidos e ainda não processados.
CREATE INDEX idx_gateway_events_unprocessed
  ON gateway_events (received_at) WHERE processed_at IS NULL;

CREATE INDEX idx_gateway_events_tenant ON gateway_events (tenant_id, received_at DESC);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE payment_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_intents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_events            ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_payment_provider_accounts ON payment_provider_accounts
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY tenant_isolation_payment_intents ON payment_intents
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

CREATE POLICY tenant_isolation_gateway_events ON gateway_events
  TO authenticated
  USING      (tenant_id IN (SELECT get_user_tenants()))
  WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- Cliente vê a própria tentativa de pagamento (QR code no app).
CREATE POLICY customer_read_own_payment_intents ON payment_intents
  FOR SELECT TO authenticated
  USING (charge_id IN (
    SELECT c.id FROM charges c WHERE c.customer_id IN (SELECT current_customer_ids())
  ));

-- credentials nunca vai para o cliente: só service_role lê a tabela de contas.
REVOKE ALL ON TABLE payment_provider_accounts FROM authenticated;
GRANT SELECT (id, tenant_id, provider, external_account_id, is_default, active)
  ON TABLE payment_provider_accounts TO authenticated;
GRANT ALL ON TABLE payment_provider_accounts TO service_role;

GRANT ALL ON TABLE payment_intents TO authenticated;
GRANT ALL ON TABLE payment_intents TO service_role;

-- Webhook roda com service_role; o app não escreve no inbox.
GRANT SELECT ON TABLE gateway_events TO authenticated;
GRANT ALL    ON TABLE gateway_events TO service_role;
