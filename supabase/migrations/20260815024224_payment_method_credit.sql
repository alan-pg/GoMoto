-- ---------------------------------------------------------------------------
-- Crédito do cliente é forma de pagamento (Spec 0014 §5)
-- ---------------------------------------------------------------------------
-- Aplicar crédito abate a dívida, então tem de virar `payments` +
-- `payment_allocations` como qualquer outra quitação: é assim que
-- `charge_balances` calcula o que sobrou, e é a única forma de a cobrança
-- aparecer como paga. Sem um método próprio, `applyCustomerCredits` só
-- lançava no razão e o saldo devido ficava intacto na tela.
--
-- Vale como método porque o dinheiro já entrou antes — o crédito é passivo
-- nosso com o cliente. Não é entrada de caixa nova: a contrapartida no razão
-- debita `creditos_de_clientes`, não uma conta de caixa.

ALTER TYPE payment_method_type ADD VALUE IF NOT EXISTS 'credit';

COMMENT ON TYPE payment_method_type IS
  'Formas de quitação. `credit` não é entrada de caixa: baixa o passivo `creditos_de_clientes`.';
