-- ---------------------------------------------------------------------------
-- Um intent de pagamento só pode virar UM pagamento
-- ---------------------------------------------------------------------------
-- O webhook do gateway confirma um recebimento em quatro chamadas separadas:
-- insere em `payments`, insere a alocação, lança no razão e marca o intent como
-- `paid`. Não há transação envolvendo as quatro — cada uma é uma requisição
-- HTTP ao PostgREST.
--
-- Falha no meio (rede, timeout, indisponibilidade) e o estado fica partido: o
-- pagamento existe, a alocação não, e o intent continua `pending`. O provedor
-- reenvia a notificação — ou um operador reprocessa o inbox — e o guarda de
-- idempotência do código não pega, porque ele pergunta pelo status do intent,
-- que nunca chegou a `paid`. Resultado: SEGUNDO pagamento para o mesmo
-- dinheiro, segunda alocação, segundo recebimento no razão. O cliente é
-- creditado duas vezes e o caixa registra dinheiro que não entrou.
--
-- A idempotência não pode morar no código que pode ser interrompido no meio.
-- Aqui ela vira propriedade do banco: a segunda inserção bate no índice único e
-- falha com 23505, que o webhook lê como "esta confirmação já foi processada".
--
-- Índice parcial porque baixa manual não tem intent: `payment_intent_id` é nulo
-- na maioria das linhas, e nulos não colidem entre si de todo modo.
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_per_intent
    ON payments (payment_intent_id)
 WHERE payment_intent_id IS NOT NULL;

-- O índice não-único que existia só servia para busca; o único cobre os dois
-- usos e deixar ambos é manutenção duplicada no mesmo caminho de escrita.
DROP INDEX IF EXISTS idx_payments_intent;
