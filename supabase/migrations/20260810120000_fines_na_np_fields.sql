-- ============================================================
-- PRD 0013 / Spec 0013 — campos oficiais da NA (Notificação de Autuação)
-- e da NP (Notificação de Penalidade) em fines.
-- ============================================================

ALTER TABLE fines
    ADD COLUMN renainf_number                  VARCHAR(30),
    ADD COLUMN notification_date                DATE,
    ADD COLUMN prior_defense_deadline            DATE,
    ADD COLUMN driver_identification_deadline    DATE,
    ADD COLUMN appeal_deadline                   DATE,
    ADD COLUMN discounted_payment_deadline       DATE,
    ADD COLUMN senatran_infraction_code          VARCHAR(20),
    ADD COLUMN issuing_agency_name               VARCHAR(200),
    ADD COLUMN driver_name                       VARCHAR(200),
    ADD COLUMN driver_cnh                        VARCHAR(20),
    ADD COLUMN driver_cpf                        VARCHAR(20);

-- RN-001: RENAINF identifica a mesma multa em NA e NP — não pode repetir no
-- tenant. Índice parcial (só quando informado) porque nem toda multa tem
-- RENAINF (RN-002: multa de área privada não passa pelo sistema nacional).
CREATE UNIQUE INDEX idx_fines_tenant_renainf
    ON fines (tenant_id, renainf_number)
    WHERE renainf_number IS NOT NULL;
