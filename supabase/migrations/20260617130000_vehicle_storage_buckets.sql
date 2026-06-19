-- ============================================================
-- PRD 0002 — F2: buckets de anexos do veículo
-- ============================================================
-- vehicle-documents          → CRV / CRLV / recibos de transferência
-- vehicle-obligation-receipts → comprovantes de IPVA / licenciamento / DPVAT
--
-- Privados (público=false): leitura precisa de signed URL emitido pelo
-- cliente autenticado. Aceitam PDF e imagens comuns, limite 10MB.
--
-- O isolamento por tenant é responsabilidade da convenção de path
-- (`<tenant_id>/<motorcycle_id>/<arquivo>`) — RLS granular por owner
-- entra junto com signed URL flow quando o PRD de alertas escalar
-- multi-cliente.
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
    (
        'vehicle-documents',
        'vehicle-documents',
        false,
        10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    ),
    (
        'vehicle-obligation-receipts',
        'vehicle-obligation-receipts',
        false,
        10485760,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    )
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- Policies — usuário autenticado pode ler/escrever; signed URL
-- continua o caminho recomendado para leitura no client.
-- ============================================================
CREATE POLICY "vehicle-documents: leitura autenticada"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'vehicle-documents' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-documents: upload autenticado"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'vehicle-documents' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-documents: update autenticado"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'vehicle-documents' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-documents: delete autenticada"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'vehicle-documents' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-obligation-receipts: leitura autenticada"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'vehicle-obligation-receipts' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-obligation-receipts: upload autenticado"
    ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'vehicle-obligation-receipts' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-obligation-receipts: update autenticado"
    ON storage.objects FOR UPDATE
    USING (bucket_id = 'vehicle-obligation-receipts' AND auth.role() = 'authenticated');

CREATE POLICY "vehicle-obligation-receipts: delete autenticada"
    ON storage.objects FOR DELETE
    USING (bucket_id = 'vehicle-obligation-receipts' AND auth.role() = 'authenticated');
