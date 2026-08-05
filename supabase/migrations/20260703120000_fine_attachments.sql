-- ============================================================
-- fine_attachments — documentos vinculados a uma multa
-- ============================================================
-- Tipos de documento:
--   ait              → Auto de Infração de Trânsito (ticket original do agente)
--   nip              → Notificação de Imposição de Penalidade (dispara prazo de defesa)
--   payment_receipt  → Comprovante de pagamento (prova de quitação para contabilidade)
--   appeal           → Recurso / defesa prévia (contestação no prazo do NIP)
--   appeal_decision  → Decisão do recurso (deferido ou indeferido)
--   driver_indication → Indicação de condutor (exigida pelo DENATRAN/SENATRAN em 30 dias
--                        quando o veículo é da empresa — transfere os pontos para o condutor)
--   other            → Outros documentos de suporte
--
-- Path no bucket fine-documents: <tenant_id>/<fine_id>/<type>/<timestamp>.<ext>
-- ============================================================

CREATE TABLE IF NOT EXISTS fine_attachments (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    fine_id     UUID        NOT NULL REFERENCES fines(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL DEFAULT 'other'
                    CHECK (type IN (
                        'ait',
                        'nip',
                        'payment_receipt',
                        'appeal',
                        'appeal_decision',
                        'driver_indication',
                        'other'
                    )),
    label       VARCHAR(200),
    file_url    TEXT        NOT NULL,
    notes       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE fine_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fine_attachments: tenant isolation"
    ON fine_attachments
    USING (tenant_id IN (SELECT get_user_tenants()))
    WITH CHECK (tenant_id IN (SELECT get_user_tenants()));

-- trigger updated_at não se aplica (sem updated_at — imutável após upload)

-- ============================================================
-- Bucket: fine-documents
-- Privado — leitura via signed URL emitida server-side.
-- Path: <tenant_id>/<fine_id>/<type>/<timestamp>.<ext>
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'fine-documents',
    'fine-documents',
    false,
    10485760,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "fine-documents: leitura autenticada"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'fine-documents' AND auth.role() = 'authenticated');

CREATE POLICY "fine-documents: upload autenticado"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'fine-documents' AND auth.role() = 'authenticated');

CREATE POLICY "fine-documents: update autenticado"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'fine-documents' AND auth.role() = 'authenticated');

CREATE POLICY "fine-documents: delete autenticado"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'fine-documents' AND auth.role() = 'authenticated');
