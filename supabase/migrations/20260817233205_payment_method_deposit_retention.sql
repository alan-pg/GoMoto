-- ---------------------------------------------------------------------------
-- Retenção de caução é uma forma de quitação, e precisa aparecer como tal
-- ---------------------------------------------------------------------------
-- Reter parte da caução para cobrir dívida do cliente lançava no razão
-- (`caucoes_a_devolver` contra `contas_a_receber`) e parava aí. Mas
-- `charge_balances` é `itens − ALOCAÇÕES`, não o razão: sem o par
-- pagamento+alocação a cobrança seguia integralmente em aberto.
--
-- Ao vivo: caução de R$ 500 com R$ 400 retidos contra R$ 893,47 em aberto. O
-- razão passou a dizer 493,47; a tela de cobranças continuou dizendo 893,47.
-- A empresa fica com o dinheiro e o sistema cobra de novo.
--
-- É o mesmo defeito que `applyCustomerCredits` já havia corrigido no caminho do
-- crédito — e que motivou o valor `credit` neste enum. A caução ficou de fora.
-- `deposit_retention` segue o mesmo precedente em vez de se disfarçar de
-- 'other', que apareceria como "Outro" na tela e esconderia a origem do
-- dinheiro de quem for conferir o extrato do cliente depois.

ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'deposit_retention';
