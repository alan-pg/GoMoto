-- Spec 0006 — Backfill: histórico de status e foto principal para motos existentes

-- Histórico inicial para motos existentes (previousStatus=null = cadastro original)
INSERT INTO vehicle_status_history
  (motorcycle_id, tenant_id, previous_status, new_status, changed_by, created_at)
SELECT id, tenant_id, NULL, status, NULL, created_at
FROM motorcycles;

-- Foto principal a partir de photo_url existente (photo_url mantido como campo depreciado)
INSERT INTO vehicle_photos (motorcycle_id, tenant_id, slot, url)
SELECT id, tenant_id, 'principal', photo_url
FROM motorcycles
WHERE photo_url IS NOT NULL
ON CONFLICT (motorcycle_id, slot) DO NOTHING;
