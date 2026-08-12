-- ============================================================
-- PRD 0013 — campos adicionais da NA presentes nos documentos reais
-- analisados mas ainda não capturados: hora da infração, subcódigo da
-- infração (desdobramento), identificação completa dos órgãos, dados do
-- equipamento/agente, velocidade (multas de radar), RENAINF de origem
-- (reemissão), local estruturado (a frota opera em cidades diferentes) e
-- mensagem SENATRAN.
-- ============================================================

ALTER TABLE fines
    ADD COLUMN infraction_time              TIME,
    ADD COLUMN senatran_infraction_subcode   VARCHAR(10),
    ADD COLUMN issuing_agency_code           VARCHAR(20),
    ADD COLUMN competent_agency_code         VARCHAR(20),
    ADD COLUMN competent_agency_name         VARCHAR(200),
    ADD COLUMN measurement_instrument_id     VARCHAR(50),
    ADD COLUMN traffic_agent_id              VARCHAR(50),
    ADD COLUMN measured_speed                DECIMAL(6,2),
    ADD COLUMN considered_speed              DECIMAL(6,2),
    ADD COLUMN speed_limit                   DECIMAL(6,2),
    ADD COLUMN original_renainf_number       VARCHAR(30),
    ADD COLUMN infraction_municipality_code  VARCHAR(10),
    ADD COLUMN infraction_municipality_name  VARCHAR(100),
    ADD COLUMN infraction_state              VARCHAR(2),
    ADD COLUMN driver_document               VARCHAR(30),
    ADD COLUMN senatran_message              TEXT;
