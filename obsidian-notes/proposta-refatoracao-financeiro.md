Regras de Negócio Financeiras
1. Locação

A locação é a principal origem de receita da empresa.

Regras
Uma locação pode ser cobrada semanalmente ou mensalmente.
O sistema deve gerar automaticamente as cobranças conforme a periodicidade definida.
O sistema deve permitir reajustar o valor da locação durante a vigência do contrato, preservando o histórico dos valores praticados.
O sistema deve registrar pagamentos totais e parciais das cobranças.
2. Cobranças

Toda obrigação financeira do cliente deve ser representada por uma cobrança.

Uma cobrança pode ser originada por:

Locação
Manutenção
Multa
Despesa
Caução
Ajuste financeiro

Cada cobrança deve possuir:

Cliente
Origem
Referência
Valor
Data de vencimento
Situação
Aberta
Parcialmente paga
Paga
Cancelada
3. Manutenções

Toda manutenção deve ser registrada.

Dados
Veículo
Data
Tipo de manutenção
Preventiva
Corretiva
Executor
Empresa
Cliente
Valor
Responsabilidade financeira
Responsabilidade financeira

Pode ser:

100% Empresa
100% Cliente
Compartilhada

Quando compartilhada deverá informar quanto pertence a cada parte.

Regras Financeiras
Empresa executa

Empresa executa a manutenção.

Se existir participação financeira do cliente:

→ gerar cobrança.

Cliente executa

Cliente executa a manutenção.

Se existir participação financeira da empresa:

→ gerar crédito para o cliente.

Esse crédito poderá ser utilizado para abatimento de cobranças futuras.

Empresa paga tudo

Registrar apenas como despesa.

Cliente paga tudo

Nenhuma movimentação financeira para a empresa além do registro histórico.

4. Manutenção Preventiva

O sistema deverá permitir cadastrar planos de manutenção preventiva.

Exemplos:

Troca de óleo
Revisão
Correia
Pneus

Quando uma manutenção preventiva for executada:

registrar seu custo;
atualizar o custo operacional do veículo;
permitir sua análise nos relatórios financeiros.
5. Multas

Toda multa deve possuir um responsável financeiro.

Responsável:

Empresa
Cliente

Se for do cliente:

→ gerar cobrança.

Se for da empresa:

→ registrar como despesa.

6. Despesas

O sistema deverá registrar despesas diversas.

Exemplos:

Guincho
Seguro
Documentação
Lavagem
Licenciamento
Combustível
Taxas

Cada despesa poderá ser:

responsabilidade da empresa;
responsabilidade do cliente.

Caso seja do cliente:

→ gerar cobrança.

Caso seja da empresa:

→ registrar como despesa.

7. Caução

O sistema deverá registrar o recebimento da caução.

No encerramento da locação poderá:

devolver integralmente;
devolver parcialmente;
utilizar parcialmente;
utilizar totalmente.

Caso a caução seja insuficiente:

→ gerar cobrança complementar.

Toda utilização da caução deverá possuir justificativa e manter histórico.

8. Crédito do Cliente

O sistema deverá controlar créditos financeiros do cliente.

Origens:

Reembolso de manutenção
Ajustes financeiros
Estornos
Devoluções

Os créditos poderão ser utilizados automaticamente ou manualmente para reduzir cobranças futuras.

O sistema deverá controlar:

valor original;
saldo disponível;
saldo utilizado;
data de geração;
origem.
9. Renegociação Financeira

O sistema deverá permitir renegociar cobranças.

Uma renegociação poderá:

alterar vencimento;
aplicar desconto;
aplicar juros;
aplicar multa por atraso;
parcelar uma cobrança.

Toda renegociação deverá manter histórico para auditoria.

10. Controle de Inadimplência

O sistema deverá calcular automaticamente a situação financeira do cliente.

Situações:

Adimplente
Em atraso
Inadimplente
Bloqueado

As regras de classificação deverão ser configuráveis.

Exemplo:

mais de 30 dias de atraso;
mais de 2 cobranças vencidas.

Clientes bloqueados não poderão iniciar novas locações.

11. Encerramento Financeiro da Locação

Uma locação somente poderá ser encerrada após a apuração financeira.

O sistema deverá verificar:

cobranças pendentes;
multas;
despesas;
manutenções;
créditos;
saldo da caução.

Após a apuração deverá:

devolver saldo da caução;
utilizar a caução para quitar débitos;
gerar cobrança complementar quando necessário;
registrar o resultado financeiro da locação.
12. Centro de Custos

Todo lançamento financeiro poderá ser associado a um centro de custo.

Exemplos:

Operacional
Manutenção
Administrativo
Comercial
Documentação

Isso permitirá análises financeiras por área da empresa.

13. Controle de Documentação

O sistema deverá controlar documentos que geram obrigações financeiras.

Exemplos:

Seguro
IPVA
Licenciamento
Vistorias

Para cada documento deverá registrar:

vencimento;
valor;
pagamento;
responsável pelo pagamento.

Esses custos deverão compor os indicadores financeiros do veículo.

14. Indicadores Financeiros

O sistema deverá gerar indicadores para:

Empresa
Receita
Despesa
Lucro
Prejuízo
Fluxo de caixa
Veículo
Receita acumulada
Custos de manutenção
Custos administrativos
Custos de documentação
Custos operacionais
Lucro líquido
ROI
Custo acumulado durante todo o ciclo de vida
Locação
Receita
Despesas
Lucro
Margem
Cliente
Valor pago
Valor em aberto
Créditos
Histórico financeiro
Índice de inadimplência
15. Arquitetura Financeira (Regra Fundamental)

Esta considero a regra mais importante do sistema, pois organiza todas as demais.

Todo fato que gere impacto financeiro deve ser registrado como um Evento Financeiro.

Exemplos de eventos:

Geração de cobrança da locação.
Recebimento de pagamento.
Registro de despesa.
Registro de manutenção.
Registro de multa.
Recebimento de caução.
Utilização da caução.
Devolução da caução.
Geração de crédito ao cliente.
Aplicação de crédito.
Renegociação de cobrança.
Cancelamento de cobrança.
Estorno de pagamento.

Cada evento financeiro deve produzir uma ou mais movimentações financeiras rastreáveis, permitindo reconstruir toda a história financeira da empresa, de um veículo, de uma locação ou de um cliente por meio de um único modelo de dados. Essa abordagem simplifica auditorias, evita inconsistências e torna o sistema preparado para evoluir com novas funcionalidades sem alterar a base financeira.