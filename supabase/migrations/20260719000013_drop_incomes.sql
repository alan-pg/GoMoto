-- Módulo Financeiro (Spec 0008) — Passo 13: remove tabela incomes
-- Substituída por payments (ADR 0013). Sistema pré-produção: sem dados a migrar.
-- A rota /entradas e o hook useIncomes serão removidos no PR-D (UI).

DROP TABLE IF EXISTS incomes;
