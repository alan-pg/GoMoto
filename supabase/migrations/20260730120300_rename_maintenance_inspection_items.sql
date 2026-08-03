-- ============================================================
-- Spec 0009 — Módulo de Vistoria
-- Migration 4: resolve colisão de nome entre itens do catálogo de
-- manutenção e o novo módulo de Vistoria (Spec 0009 §11.2).
-- ============================================================

UPDATE maintenance_plan_items
SET name = CASE name
    WHEN 'Vistoria de entrega'  THEN 'Revisão de entrega'
    WHEN 'Vistoria periódica'   THEN 'Revisão periódica'
    WHEN 'Vistoria mensal'      THEN 'Revisão mensal'
    ELSE name
END
WHERE name IN ('Vistoria de entrega', 'Vistoria periódica', 'Vistoria mensal');
