-- Remove tabela incomes: dados avulsos sobrepostos a billings/payments (sem FKs)
-- Receita do dashboard migrada para payments.paid_at como fonte de verdade única.

drop table if exists public.incomes;
