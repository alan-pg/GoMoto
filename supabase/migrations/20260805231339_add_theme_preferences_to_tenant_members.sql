-- ADR 0019 — Sistema multi-tema no cockpit web.
-- Preferência de aparência por operador: qual das 4 direções de marca e qual
-- modo de cor. Vive em tenant_members (não em tabela nova) porque já é a
-- linha (tenant_id, user_id) com RLS habilitada — ver ADR 0019 §2.

ALTER TABLE tenant_members
  ADD COLUMN theme_brand VARCHAR(24) NOT NULL DEFAULT 'frota-confiavel'
    CHECK (theme_brand IN ('frota-confiavel', 'estrada', 'sinalizacao', 'classico')),
  ADD COLUMN color_mode VARCHAR(6) NOT NULL DEFAULT 'system'
    CHECK (color_mode IN ('system', 'light', 'dark'));
