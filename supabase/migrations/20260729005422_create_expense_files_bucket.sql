-- Bucket público para notas fiscais e anexos de despesas.
-- Arquivos são referenciados por URL pública nos campos invoice_url/attachment_url.

INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-files', 'expense-files', true)
ON CONFLICT (id) DO NOTHING;

-- Permite que usuários autenticados leiam, insiram e deletem apenas
-- arquivos dentro do próprio tenant (pasta expenses/).
CREATE POLICY "Autenticados podem ler expense-files"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (bucket_id = 'expense-files');

CREATE POLICY "Autenticados podem inserir expense-files"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'expense-files');

CREATE POLICY "Autenticados podem deletar expense-files"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'expense-files');
