-- ---------------------------------------------------------------------------
-- `charge_balances.late_charge_amount` — quanto do total já é encargo
-- ---------------------------------------------------------------------------
-- ADR 0028. O encargo por atraso é grandeza CORRENTE sobre o principal; o que
-- já foi realizado é uma parcela dela virada `charge_items`, não uma dívida
-- nova. Sem separar as duas coisas, `open_amount` mistura principal e encargo,
-- e a apuração seguinte cobra multa de novo e juros sobre juros.
--
-- Acontecia por qualquer porta que devolvesse a cobrança para `open` com o item
-- de encargo dentro: estorno de pagamento (`fn_reverse_payment` inverte as
-- pernas do PAGAMENTO — a transação `late_charge_realized` é outra e continua
-- de pé, corretamente) ou, sem estorno nenhum, pagamento parcial.
--
-- A coluna vive aqui, e não na conta de quem chama, porque os três consumidores
-- de `calculateAmountDue` — cockpit, Route Handler do mobile e intent do
-- gateway — já leem esta linha. Mandar cada um somar os itens por conta própria
-- é reconstruir o F-05, que é a razão de a função existir.
--
-- `CREATE OR REPLACE` acrescenta no fim: nenhuma coluna existente muda de nome,
-- tipo ou posição, então as views que dependem desta continuam válidas.

CREATE OR REPLACE VIEW charge_balances WITH (security_invoker = true) AS
SELECT c.id AS charge_id,
    c.tenant_id,
    c.customer_id,
    c.rental_id,
    c.charge_number,
        CASE
            WHEN c.status = ANY (ARRAY['cancelled'::charge_status, 'written_off'::charge_status]) THEN c.status
            WHEN (COALESCE(i.total, 0::numeric) - COALESCE(a.allocated, 0::numeric)) <= 0::numeric THEN 'paid'::charge_status
            ELSE 'open'::charge_status
        END AS status,
    c.issue_date,
    c.due_date,
    c.currency,
    COALESCE(i.total, 0::numeric) AS total_amount,
    COALESCE(a.allocated, 0::numeric) AS paid_amount,
    COALESCE(i.total, 0::numeric) - COALESCE(a.allocated, 0::numeric) AS open_amount,
    (c.status <> ALL (ARRAY['cancelled'::charge_status, 'written_off'::charge_status]))
      AND COALESCE(i.total, 0::numeric) > COALESCE(a.allocated, 0::numeric)
      AND c.due_date < fn_business_today(c.tenant_id) AS is_overdue,
    GREATEST(0, fn_business_today(c.tenant_id) - c.due_date) AS days_overdue,
    c.late_charge_policy_id,
    -- Soma de TUDO que já virou encargo nesta cobrança, pago ou não. É o que a
    -- apuração corrente desconta de si mesma para não cobrar duas vezes.
    COALESCE(l.late_charge, 0::numeric) AS late_charge_amount
   FROM charges c
     LEFT JOIN LATERAL ( SELECT sum(ci.amount) AS total
           FROM charge_items ci
          WHERE ci.charge_id = c.id) i ON true
     LEFT JOIN LATERAL ( SELECT sum(pa.amount) AS allocated
           FROM payment_allocations pa
             JOIN payments p ON p.id = pa.payment_id
          WHERE pa.charge_id = c.id AND p.reversed_at IS NULL) a ON true
     LEFT JOIN LATERAL ( SELECT sum(ci.amount) AS late_charge
           FROM charge_items ci
          WHERE ci.charge_id = c.id
            AND ci.source_module = 'late_charge') l ON true;
