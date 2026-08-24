# Checklist de Testes Manuais — Módulo Financeiro

Roteiro para validar o financeiro inteiro clicando na tela, sem depender da
suíte automatizada. Cada caso tem **o que fazer** e **como saber que deu certo**.

Quando um caso disser "conferir no razão", a checagem é na tela de **DRE** ou
**Painel financeiro** — nenhum caso aqui exige abrir o banco.

---

## Como usar

- Marque `[x]` conforme for validando.
- **Um caso falhou?** Anote o número, o que apareceu e o que era esperado. Não
  siga adiante no mesmo bloco: casos posteriores costumam depender do anterior.
- Os blocos são **sequenciais dentro de si** e independentes entre si. Dá para
  parar no fim de qualquer bloco.
- Valores são sugestões. Se mudar, ajuste as conferências proporcionalmente.

### Dois atalhos que servem ao roteiro inteiro

**Antecipar a emissão.** O critério do job é `period_start <= hoje + lead_days`
— o INÍCIO do período, não o vencimento. O segundo parâmetro abre essa janela,
para não esperar dias entre um caso e outro:

```bash
# Emite tudo que começa nos próximos 7 dias
docker exec -i supabase_db_GoMoto psql -U postgres -d postgres \
  -c "SELECT fn_run_billing_emission('manual', 7);"
```

**Não rode a suíte automatizada no meio do roteiro.** Ela faz login com o mesmo
usuário do `.env.test` e **derruba a sua sessão no navegador**. Rode antes ou
depois, nunca durante.

### Preparação

- [x] **P1.** Banco limpo (`pnpm db:reset`) e login feito.
- [x] **P2.** Anote o valor de **Caixa** no Painel financeiro. Vários casos
      comparam contra este ponto de partida.
- [x] **P3.** Escolha uma moto disponível e um cliente. Use os mesmos em todo o
      roteiro — assim os relatórios por cliente e por veículo ficam legíveis.

---

## Bloco 1 — Abertura da locação

### 1.1 Criar locação semanal com caução e entrada

- [x] Em **Locações → Nova locação**, crie: ciclo **Semanal**, valor **R$ 350**,
      caução **R$ 500**, entrada **R$ 200**, início hoje, 3 meses.

**Verificar:**
- [x] A locação aparece em **Locações** com status ativo.
- [x] A moto sai da lista de disponíveis (tente abrir outra locação: ela não
      deve ser oferecida no seletor).
- [x] Em **Cobranças**, existem cobranças de **Caução R$ 500** e
      **Entrada R$ 200**.
- [x] Na aba **financeira** da locação, a seção **Cronograma contratado** lista
      todas as parcelas semanais de R$ 350 — a primeira pode ser menor (pro
      rata) — todas com situação **A emitir**.
- [x] Os três totais dessa seção batem: **Total contratado** = soma das parcelas,
      **Já emitido** = R$ 0,00 num contrato recém-aberto, **A emitir** = o total.

> **Cronograma ≠ Cobranças.** O cronograma é o que o contrato PREVÊ; a seção
> Cobranças mostra o que já virou documento. Num contrato novo só caução e
> entrada aparecem em Cobranças — as parcelas ainda não foram emitidas.

> **Por que importa:** caução e entrada parecem iguais e não são. Caução é
> dinheiro do cliente que volta; entrada é receita da empresa.

### 1.2 A caução não pode virar receita

- [x] Abra **DRE** no mês corrente.

**Verificar:**
- [x] A **Receita bruta** inclui os **R$ 200** da entrada.
- [x] A **Receita bruta NÃO inclui os R$ 500** da caução.

### 1.3 Emissão da parcela semanal

A emissão roda sozinha às 9h todo dia (pg_cron chamando
`fn_run_billing_emission`). Para não esperar, force pelo terminal:

```bash
# Emite exatamente como o cron emitiria hoje
docker exec -i supabase_db_GoMoto psql -U postgres -d postgres \
  -c "SELECT fn_run_billing_emission('manual');"
```

- [x] Rode o comando acima.

**Verificar:**
- [x] A parcela aparece em **Cobranças** com o valor do cronograma.
- [x] Em **Cobranças**, o total "A receber" subiu exatamente pelo valor da
      parcela.
- [x] A linha do cronograma correspondente saiu de *agendada* para *emitida*.

### 1.4 Emitir duas vezes não duplica

- [x] Rode o **mesmo comando** de novo, sem que nova parcela tenha começado.

**Verificar:**
- [x] **Nenhuma cobrança nova** foi criada.
- [x] O total "A receber" não mudou.

---

## Bloco 2 — Recebimento

### 2.1 Pagamento total

- [x] Abra a cobrança da caução (R$ 500) → **Registrar pagamento**, valor cheio,
      forma **PIX**.

**Verificar:**
- [x] A cobrança passa a **Paga**, com "R$ 0,00 a pagar".
- [x] O pagamento aparece listado na própria cobrança, com data e forma.
- [x] No Painel financeiro, **Caixa** subiu R$ 500 em relação a **P2**.
- [x] Em **DRE**, a receita **não** subiu (caução é passivo).

### 2.2 Pagamento parcial

- [x] Na parcela semanal de R$ 350, registre pagamento de **R$ 150**.

**Verificar:**
- [ ] A cobrança continua **Em aberto**, mostrando **R$ 200,00 a pagar**.
- [ ] O valor de face segue R$ 350 — pagamento parcial não reduz o documento.
- [ ] Caixa subiu R$ 150.

### 2.3 Completar o pagamento

- [ ] Registre os **R$ 200** restantes.

**Verificar:**
- [ ] A cobrança passa a **Paga**.
- [ ] Aparecem **dois** pagamentos na cobrança, não um de R$ 350.

### 2.4 Não aceitar mais que o devido

- [ ] Em uma cobrança em aberto, tente registrar valor **maior** que o saldo.

**Verificar:**
- [ ] O campo mostra o saldo da cobrança e avisa quando o valor passa dele.
- [ ] O botão **Confirmar pagamento** fica desabilitado enquanto o valor exceder.
- [ ] Nada foi gravado: o saldo da cobrança não mudou, e o card **Recebido** e o
      **Caixa** continuam iguais.

> O aviso sugere o caminho para receber a mais de propósito: registrar o valor
> devido e conceder o excedente como **crédito** na ficha do cliente — lá o
> lançamento é feito, e o crédito fica utilizável.

---

## Bloco 3 — Custos da empresa

### 3.1 Despesa avulsa

- [ ] Em **Despesas → Nova despesa**, lance **R$ 300** de despesa operacional,
      sem rateio.

**Verificar:**
- [ ] O KPI **Em aberto** subiu R$ 300.
- [ ] **Caixa não mudou** — criar despesa não move dinheiro.
- [ ] Em **DRE**, o custo do mês subiu R$ 300.

### 3.2 Baixa da despesa

- [ ] Dê baixa na despesa de R$ 300.

**Verificar:**
- [ ] Ela sai de "Em aberto" e entra em **Pagas**.
- [ ] **Caixa caiu R$ 300**.
- [ ] O custo no DRE **não mudou** — o custo já era do lançamento, não do
      pagamento.

### 3.3 Manutenção executada pela empresa, sem rateio

- [ ] Em **Manutenção → Nova Manutenção → Já executada**: custo **R$ 400**,
      cliente paga **R$ 0**, executor **Empresa**.

**Verificar:**
- [ ] A manutenção aparece na aba **Concluídas mês**, com a coluna **Custo**
      preenchida com R$ 400 (não pode ficar "—").
- [ ] Em **Despesas**, existe uma conta de R$ 400 de origem manutenção.
- [ ] No ROI do veículo (**Painel financeiro → clicar na placa**), o custo do
      veículo subiu R$ 400.

### 3.4 Manutenção rateada, executada pela empresa

- [ ] Registre manutenção de **R$ 1.000**, cliente paga **R$ 300**, executor
      **Empresa**.

**Verificar:**
- [ ] Antes de salvar, o resumo mostra **Despesa da empresa R$ 700** e
      **Repassado ao cliente R$ 300**.
- [ ] Em **Despesas**, a linha mostra **Total R$ 1.000**, **Empresa R$ 700**,
      **Cliente R$ 300**.
- [ ] Em **Cobranças**, nasceu uma cobrança de repasse de **R$ 300** para o
      cliente.
- [ ] Em **DRE**, o custo subiu **R$ 1.000** e a **Recuperação de despesas**
      subiu **R$ 300**.

> **Por que importa:** repasse não é receita. Se os R$ 300 aparecerem em Receita
> bruta, o faturamento está inflado e a base de imposto também.

### 3.5 Manutenção executada pelo CLIENTE, rateada

- [ ] Registre manutenção de **R$ 100**, cliente paga **R$ 50**, executor
      **Cliente**.

**Verificar:**
- [ ] O resumo avisa que **gera crédito de R$ 50 a favor do cliente**.
- [ ] Em **Despesas**, a conta nasce **já quitada** — o cliente pagou a oficina,
      a empresa nunca deveu.
- [ ] **Caixa não mudou.**
- [ ] Na ficha do cliente, **Créditos disponíveis** subiu **R$ 50**.
- [ ] **NÃO** nasceu cobrança de repasse (quem deve é a empresa, não o cliente).

### 3.6 Manutenção 100% do cliente, executada por ele

- [ ] Registre manutenção de **R$ 80**, cliente paga **R$ 80**, executor
      **Cliente**.

**Verificar:**
- [ ] **Nenhum crédito** foi gerado — nada mudou de mão.
- [ ] **Nenhuma cobrança** de repasse foi criada.
- [ ] O custo aparece no veículo, mas o resultado da empresa não piora.

### 3.7 IPVA / licenciamento

- [ ] Na ficha do veículo, cadastre a obrigação anual e o valor (**R$ 1.200**).

**Verificar:**
- [ ] O veículo aparece com documentação **em atraso** ou **em aberto**,
      conforme o vencimento.
- [ ] Em **Despesas**, existe conta a pagar de R$ 1.200.
- [ ] Após dar baixa, o veículo passa a constar **em dia** — sem que você precise
      editar nada na obrigação.

### 3.8 Multa com responsável CLIENTE

- [ ] Em **Multas → Nova**, lance multa de **R$ 293,47** na placa, com
      responsável **Cliente**.

**Verificar:**
- [ ] Em **Despesas**, nasceu conta a pagar da multa.
- [ ] Em **Cobranças**, nasceu cobrança de repasse ao cliente da locação vigente
      **na data da infração**.
- [ ] O cliente cobrado é o correto para aquela data (não o atual, se mudou).

### 3.9 Trocar o responsável da multa para EMPRESA

- [ ] Edite a multa e mude o responsável para **Empresa**.

**Verificar:**
- [ ] A cobrança de repasse foi **cancelada**.
- [ ] O cliente deixou de ter aquele valor a pagar.
- [ ] O custo continua com a empresa no DRE.

---

## Bloco 4 — Crédito do cliente

### 4.1 Saldo exibido é o disponível, não o concedido

- [ ] Abra a ficha do cliente que recebeu o crédito de R$ 50 (caso 3.5).

**Verificar:**
- [ ] **Créditos disponíveis** mostra **R$ 50,00**.
- [ ] A contagem ao lado fala em *concedidos*, e é coerente com a lista abaixo.

### 4.2 Abater o crédito em cobrança

- [ ] Abra uma cobrança em aberto do cliente → **Aplicar crédito**.

**Verificar:**
- [ ] O modal já traz o saldo correto e o valor preenchido.
- [ ] Após aplicar, a cobrança mostra **valor de face inalterado** e
      **"a pagar" reduzido** pelo crédito.
- [ ] O abatimento aparece na lista de pagamentos como **Crédito do cliente**.
- [ ] **Caixa NÃO mudou** — crédito não é dinheiro entrando.
- [ ] O saldo de crédito do cliente foi a **R$ 0,00**.

### 4.3 Devolver crédito em dinheiro

- [ ] Gere um novo crédito (repita 3.5) e, na ficha do cliente, use
      **Devolver crédito** com **valor parcial**.

**Verificar:**
- [ ] O modal mostra o saldo disponível e recusa valor maior que ele.
- [ ] Após confirmar, **Caixa caiu** exatamente pelo valor devolvido.
- [ ] O saldo de crédito caiu pelo mesmo valor, e **o resto continua disponível**.
- [ ] **O custo da manutenção que originou o crédito continua no DRE e no ROI do
      veículo.** Devolver não é estornar.

### 4.4 Sem saldo, sem botão

- [ ] Devolva todo o saldo restante e recarregue a ficha.

**Verificar:**
- [ ] O botão **Devolver crédito** desaparece.
- [ ] **Créditos disponíveis** mostra R$ 0,00, mas a lista de créditos concedidos
      continua lá (é histórico).

---

## Bloco 5 — Correções

### 5.1 Estornar pagamento

- [ ] Em uma cobrança paga, estorne o pagamento.

**Verificar:**
- [ ] A cobrança volta a **Em aberto**, com o valor devido de volta.
- [ ] O pagamento **continua listado**, marcado como estornado — não some.
- [ ] **Caixa voltou** ao valor anterior ao pagamento.

### 5.2 Estornar abatimento por crédito

- [ ] Aplique um crédito e depois estorne esse abatimento.

**Verificar:**
- [ ] A cobrança volta a dever o valor.
- [ ] **O crédito volta para o saldo do cliente** — não evapora.

### 5.3 Cancelar cobrança

- [ ] Cancele uma cobrança **sem pagamento**.

**Verificar:**
- [ ] Ela sai de "A receber".
- [ ] Se era cobrança de receita, a **Receita bruta do DRE caiu** pelo valor.

### 5.4 Cobrança com pagamento não se cancela

- [ ] Tente cancelar uma cobrança que já recebeu pagamento.

**Verificar:**
- [ ] O sistema recusa e explica que é preciso estornar o pagamento antes.
- [ ] Nada mudou na cobrança.

### 5.5 Cancelar despesa rateada

- [ ] Cancele a despesa do caso 3.4 (R$ 1.000 com R$ 300 de repasse).

**Verificar:**
- [ ] O custo de R$ 1.000 **saiu do DRE**.
- [ ] A **cobrança de repasse de R$ 300 foi cancelada junto** — o cliente não
      pode continuar devendo por um custo que a empresa diz não ter tido.

### 5.6 Despesa paga pelo cliente não se cancela por ali

- [ ] Tente cancelar a despesa do caso 3.5 (executada pelo cliente).

**Verificar:**
- [ ] O sistema recusa e explica o caminho — acerto por crédito ou cobrança
      avulsa.

### 5.7 Baixa por inadimplência

- [ ] Em **Cobranças**, numa cobrança vencida e não paga, use o botão de
      **baixa por inadimplência** e informe o motivo.

**Verificar:**
- [ ] A cobrança sai de "A receber" e passa a constar como **Baixada**.
- [ ] No DRE aparece **Perda** pelo valor em aberto.
- [ ] A **receita original permanece** — a venda aconteceu; o que se reconhece é
      a perda. É isso que distingue baixa de cancelamento: cancelar apaga a
      receita, baixar reconhece que ela não será recebida.

---

## Bloco 6 — Encargos por atraso

### 6.1 Encargo é projeção até ser realizado

- [ ] Deixe uma cobrança vencer e abra-a.

**Verificar:**
- [ ] A tela mostra o encargo **calculado**.
- [ ] O DRE **ainda não** tem receita de encargos.

### 6.2 Receber realiza o encargo

- [ ] Registre o pagamento da cobrança vencida, pelo valor que a tela oferece.

**Verificar:**
- [ ] O encargo vira **item da cobrança** e o total sobe.
- [ ] A cobrança fica **paga**, com saldo zero — nunca negativo.
- [ ] No DRE aparece **Receita de encargos**.
- [ ] O encargo aparece atribuído ao veículo correto no ROI.

> Não existe mais botão "Consolidar encargo". Ele recalculava o encargo do zero
> a cada clique — multa sobre o saldo já acrescido, juros de todos os dias desde
> o vencimento — e quatro cliques no mesmo dia levavam uma dívida de R$ 1.000
> para R$ 1.125. Receber é o que realiza o encargo, e sempre foi o caminho que
> importa.

### 6.3 A data do recebimento manda no encargo

- [ ] Numa cobrança vencida, abra **Registrar pagamento** e mude a **Data do
      recebimento** para alguns dias atrás.

**Verificar:**
- [ ] O valor sugerido **diminui** — menos dias de atraso, menos juros.
- [ ] Os **dias de atraso acompanham a data**, nos dois lugares em que aparecem:
      ao lado do vencimento, no cabeçalho, e na linha de juros.
- [ ] Data futura é recusada com mensagem.
- [ ] Registrando, o encargo lançado é o daquela data, não o de hoje.

> É o caso de receber o Pix na segunda e registrar na quarta. Antes o sistema
> mandava sempre a data de hoje, cobrando dias de juros que não correram.

### 6.3-b O modal é o mesmo nas duas telas

- [ ] Abra **Registrar pagamento** pela **lista** (/cobrancas, ícone $ na linha).
- [ ] Abra a mesma cobrança em **detalhe** e clique em **Registrar pagamento**.

**Verificar:**
- [ ] Os dois modais são idênticos: cabeçalho com número da cobrança, cliente,
      **vencimento** e dias de atraso; data do recebimento; valor; detalhamento
      de principal/multa/juros; forma de pagamento; observações.
- [ ] Nos dois, digitar valor **acima** do devido devolve o campo ao máximo e
      mostra o erro **dentro** do modal.
- [ ] Depois de receber, a tela de detalhe mostra **"Pago em"** com a data do
      recebimento — a mesma que aparece na tabela de Pagamentos abaixo.

> Eram dois modais separados que divergiram: um recusava valor acima do saldo, o
> outro deixava passar, e um mandava o erro para o topo da PÁGINA — atrás de si.
> "Pago em" exibia o VENCIMENTO com outro rótulo, e ainda um dia antes por causa
> de fuso: cobrança recebida em 21/08 aparecia paga em 20/07, antes de vencer.

### 6.4 Pagar com crédito não escapa do encargo

- [ ] Em cobrança vencida, aplique crédito.

**Verificar:**
- [ ] O encargo é realizado antes do abatimento — quem paga com crédito paga o
      mesmo que quem paga em dinheiro.

---

### 6.5 Configurar a política — Configurações → Encargo por atraso

- [ ] Como **Owner**, abra `/configuracoes`. A seção **Encargo por atraso** existe
      e mostra "Em vigor · versão N · desde DD/MM/AAAA" com multa, juros e carência.
- [ ] O campo de juros mostra a taxa **diária** derivada ("Equivale a 0,0333% ao dia").
- [ ] Como **Operator/Viewer**, a seção não aparece.

**Alterar:**
- [ ] Mude a multa para 5%, deixe a vigência em hoje e salve.
- [ ] A confirmação aparece e o cabeçalho passa a mostrar a nova versão.
- [ ] Tente vigência **anterior a hoje**: a tela recusa explicando que política
      nova não retroage.

**Verificar o que NÃO pode mudar:**
- [ ] Uma cobrança **já vencida antes da alteração** continua com o mesmo valor
      devido. Abra o modal de recebimento dela antes e depois — multa e juros
      não podem se mexer.
- [ ] Uma cobrança **emitida depois**, com vencimento após a vigência nova, usa
      a nova multa.

```sql
-- Versões da política e qual cobrança usa qual
select v.version, v.effective_from, v.fee_type, v.fee_value, v.daily_interest_rate,
       count(c.id) as cobrancas
  from late_charge_policies v
  left join charges c on c.late_charge_policy_id = v.id
 group by v.id order by v.version;
```

> A política é do TENANT, não da locação. O campo por locação existiu, foi
> preenchido pelo operador e nunca chegou ao banco — `rentals` não tem essas
> colunas e a emissão sempre resolveu a política vigente. Foi removido.
>
> Quem escolhe a política é o **vencimento** da cobrança, não a data de emissão:
> `fn_create_charge` casa `effective_from <= due_date`. Agendar uma política
> para daqui a 15 dias já afeta a cobrança emitida hoje que vence daqui a 30.

## Bloco 7 — Encerramento da locação

### 7.1 Apuração antes de encerrar

- [ ] Abra **Locações → contrato → Encerrar**.

**Verificar:**
- [ ] A **Apuração financeira** mostra quatro linhas: cobranças em aberto, saldo
      de caução, **crédito do cliente** e cronograma a cancelar.
- [ ] Os valores batem com o que você vê em Cobranças e na ficha do cliente.

### 7.2 Encerrar com débito em aberto é barrado

- [ ] Com cobrança em aberto, tente encerrar sem marcar a confirmação.

**Verificar:**
- [ ] O sistema recusa e explica.
- [ ] Marcando a confirmação explícita, ele permite — e avisa que as cobranças
      continuam cobráveis.

### 7.3 Aviso de crédito pendente

- [ ] Encerre um contrato de cliente **com saldo de crédito**.

**Verificar:**
- [ ] Aparece aviso de que o cliente ficará credor, com link para a ficha.
- [ ] O aviso está **legível** (texto contrastando com o fundo).

### 7.4 Destino da caução — devolver

- [ ] Encerre escolhendo **Devolver tudo**.

**Verificar:**
- [ ] **Caixa caiu** pelo valor da caução.
- [ ] O saldo de caução do contrato foi a zero.
- [ ] A moto voltou para **disponível** e pode ser locada de novo.

### 7.5 Destino da caução — reter

- [ ] Em outro contrato, encerre escolhendo **Reter tudo**.

**Verificar:**
- [ ] **Caixa não mudou** — o dinheiro já estava com a empresa.
- [ ] A dívida do cliente foi abatida pelo valor retido.
- [ ] O saldo de caução foi a zero.

### 7.6 Cronograma futuro é cancelado

**Verificar (após qualquer encerramento):**
- [ ] Parcelas com período posterior ao encerramento **não** são mais emitidas.
- [ ] Parcelas já emitidas **continuam** existindo e cobráveis.

---

## Bloco 8 — Renovação e reajuste

### 8.1 Reajuste altera só o futuro

- [ ] Em **Locações → contrato → Reajustar**, mude o valor do ciclo.

**Verificar:**
- [ ] Parcelas **ainda não emitidas** passam a valer o novo valor.
- [ ] Parcelas **já emitidas** permanecem com o valor antigo.

### 8.2 Renovação estende o contrato

- [ ] Renove um contrato.

**Verificar:**
- [ ] A data de fim avançou.
- [ ] Novas parcelas apareceram no cronograma.
- [ ] Tentar renovar com data que **não estende** é recusado.

---

## Bloco 9 — Pagamento pelo app do cliente (Pix)

> Requer conta de gateway configurada. Se não houver, o esperado é a mensagem de
> "pagamento online não configurado" — isso também é um caso válido.

### 9.1 Gerar o QR

- [ ] No app do cliente, abra uma cobrança em aberto e gere o Pix.

**Verificar:**
- [ ] O valor do QR é o **valor devido** — considerando crédito já aplicado e
      encargo já realizado, não o valor de face.

### 9.2 Dois toques no botão

- [ ] Toque para gerar o QR duas vezes seguidas.

**Verificar:**
- [ ] **Nenhum erro** aparece para o cliente.
- [ ] O **mesmo QR** é devolvido — não são gerados dois.

### 9.3 Pagar em ATRASO pelo app

- [ ] Deixe uma cobrança vencer, gere o Pix pelo app e pague o valor mostrado.

**Verificar:**
- [ ] A cobrança fica **paga**, com **saldo zero** — nunca negativo.
- [ ] O total da cobrança cresceu pelo encargo: ele virou item, não sumiu.
- [ ] No DRE aparece **Receita de encargos** pelo valor cobrado.
- [ ] No ROI da moto, o encargo entra no resultado dela.

> Este era o defeito: o QR cobrava principal + encargo, o cliente pagava, e a
> cobrança — que só devia o principal — ficava com saldo NEGATIVO, com o encargo
> nunca virando receita.

### 9.4 Confirmação do pagamento

- [ ] Pague o Pix.

**Verificar:**
- [ ] A cobrança fica **Paga**, com o pagamento listado.
- [ ] **Caixa subiu** pelo valor.
- [ ] O resultado é idêntico ao de uma baixa manual — mesma forma, mesmo efeito.

### 9.5 Cobrança de outro cliente

- [ ] Tente abrir/pagar pelo app uma cobrança que não é do cliente logado.

**Verificar:**
- [ ] O sistema recusa. Nenhum QR é gerado.

---

## Bloco 10 — Relatórios gerenciais

### 10.1 DRE

- [ ] Abra **Financeiro → DRE** no mês em que você fez os testes.

**Verificar:**
- [ ] **Receita bruta** = soma das cobranças de receita emitidas (aluguel +
      entrada + encargos realizados). **Sem caução, sem repasse.**
- [ ] **Recuperação de despesas** = soma dos repasses cobrados.
- [ ] **Custos operacionais** = soma das despesas lançadas, pelo valor **cheio**.
- [ ] **Perdas** = baixas por inadimplência.
- [ ] Cancelamentos e estornos **não aparecem** como valores; eles reduzem as
      linhas correspondentes.

### 10.2 Painel financeiro

**Verificar:**
- [ ] **A receber** = soma dos saldos em aberto das cobranças.
- [ ] **Vencido** conta apenas cobranças com vencimento passado e saldo > 0.
- [ ] **Recebido** = soma dos pagamentos não estornados.
- [ ] Os totais batem com o que a tela de Cobranças mostra.

### 10.3 Resultado por veículo (ROI)

- [ ] Abra o ROI da moto usada nos testes.

**Verificar:**
- [ ] **Receita** = parcelas daquela locação + repasses recuperados.
- [ ] **Custos** = manutenções e multas do veículo, pelo valor cheio.
- [ ] Valor de compra e de venda aparecem, quando cadastrados.
- [ ] Uma moto **sem nenhum lançamento** ainda aparece no relatório (não some).

### 10.4 Resultado por cliente

**Verificar:**
- [ ] **Receita** do cliente = o que ele foi cobrado de aluguel e encargos.
- [ ] **Custo absorvido** = o que a empresa comeu depois do repasse (bruto menos
      repassado), e a tela mostra as duas parcelas.

### 10.5 Documentação da frota

**Verificar:**
- [ ] Motos com IPVA vencido aparecem como **fora de dia**.
- [ ] Marcar uma obrigação como **isenta** tira a moto da lista de pendências.
- [ ] A isenção **sobrevive ao recarregar** a página.

---

## Bloco 11 — Alienação do veículo

### 11.1 Registrar venda

- [ ] No ROI de uma moto **disponível**, registre alienação.

**Verificar:**
- [ ] O resultado do ativo é **valor de venda − valor de compra**.
- [ ] A moto **desaparece do seletor de nova locação**.
- [ ] O botão de alienar some (não dá para vender duas vezes).

### 11.2 Moto locada não se vende

- [ ] Tente alienar uma moto com contrato ativo.

**Verificar:**
- [ ] O sistema recusa, dizendo para encerrar o contrato antes.
- [ ] Nada foi gravado.

---

## Bloco 12 — Isolamento entre empresas

> Exige acesso a duas empresas (tenants). Se você opera uma só, pule.

### 12.1 Dados não vazam

- [ ] Logado na empresa A, confira Cobranças, Despesas, Clientes, Veículos e DRE.

**Verificar:**
- [ ] Nenhum dado da empresa B aparece em nenhuma tela.
- [ ] Os totais do Painel refletem só a empresa A.

---

## Bloco 13 — Regressões conhecidas

Casos que já falharam em produção ou em teste. Vale reconferir a cada release.

### 13.1 Dois cliques na baixa de despesa

- [ ] Em uma despesa em aberto, clique em **dar baixa** duas vezes rapidamente.

**Verificar:**
- [ ] O caixa caiu **uma única vez** pelo valor da despesa.
- [ ] Não há dois pagamentos para a mesma conta.

### 13.2 Excluir manutenção que virou dinheiro

- [ ] Tente excluir a manutenção do caso 3.4 (com custo lançado).

**Verificar:**
- [ ] O sistema **recusa** e diz para cancelar a despesa antes.
- [ ] Depois de cancelar a despesa, a exclusão passa.

### 13.3 Rateio no atalho "Já executada"

- [ ] Registre manutenção pelo atalho com rateio (custo 120, cliente 40,
      executor Cliente).

**Verificar:**
- [ ] O crédito gerado é de **R$ 80** (a parte da empresa), não de R$ 120.

### 13.4 Coluna de custo na lista de manutenção

**Verificar:**
- [ ] Manutenções com custo lançado mostram o valor na coluna **Custo** — nunca
      "—" para todas.

### 13.5 Saldo de crédito na ficha

- [ ] Conceda R$ 100 de crédito e aplique R$ 60 em uma cobrança.

**Verificar:**
- [ ] A ficha mostra **R$ 40,00** em Créditos disponíveis, não R$ 100,00.

### 13.6 Emissão relatando o que emitiu

- [ ] Rode a emissão com parcelas pendentes e confira o registro da execução:

```bash
docker exec -i supabase_db_GoMoto psql -U postgres -d postgres \
  -c "SELECT triggered_by, charges_issued, error, finished_at
        FROM billing_runs ORDER BY started_at DESC LIMIT 3;"
```

**Verificar:**
- [ ] `charges_issued` bate com o número de cobranças que apareceram na tela.
- [ ] `error` está vazio e `finished_at` preenchido — execução que começou e não
      terminou é o sintoma que `billing_runs` existe para tornar visível.

---

## Encerramento do roteiro

Ao final, com tudo verde:

- [ ] O **razão fecha**: no DRE, receitas menos custos menos perdas resulta no
      número que o Painel mostra como resultado.
- [ ] **Nenhum saldo ficou órfão**: nenhum cliente com crédito de contrato
      encerrado, nenhuma caução de contrato encerrado.
- [ ] **Nenhuma cobrança sem origem**: toda cobrança em aberto tem locação,
      manutenção, multa ou lançamento avulso identificável.
