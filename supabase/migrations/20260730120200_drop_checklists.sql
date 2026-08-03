-- ============================================================
-- Spec 0009 — Módulo de Vistoria
-- Migration 3: remoção de código morto (checklists) — isolada
-- das demais por ser destrutiva (DROP TABLE), sem referência em
-- apps/web/src ou packages/ (confirmado via grep).
-- ============================================================

DROP TABLE IF EXISTS checklists;
