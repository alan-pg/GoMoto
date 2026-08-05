1. Objetivo

O módulo financeiro deve controlar todas as movimentações financeiras da empresa, permitindo gerenciar receitas, despesas, cobranças, pagamentos, créditos, reembolsos, cauções e demais operações financeiras.

O sistema deve manter rastreabilidade completa de todas as movimentações, permitindo visualizar o histórico financeiro por:

Empresa
Cliente
Locação
Veículo

O modelo financeiro deve ser flexível para suportar novas regras de negócio sem necessidade de alterações estruturais significativas.

2. Princípios do Modelo Financeiro

O módulo financeiro deverá ser baseado em um Livro Razão (Ledger).

Todo evento financeiro deverá gerar um lançamento financeiro.

Uma cobrança não representa uma receita, mas sim um documento que agrupa um ou mais lançamentos financeiros.

Esse modelo permite:

Cobranças compostas por diversos itens.
Pagamentos parciais.
Créditos e reembolsos.
Estornos.
Controle correto de cauções.
Relatórios consistentes.

Nenhum lançamento financeiro poderá ser excluído definitivamente. Caso exista erro, deverá ser realizado um estorno ou lançamento de ajuste.

3. Cobranças
Objetivo

Gerar cobranças para clientes referentes às obrigações financeiras da locação.

Tipos de cobrança

O sistema deverá permitir gerar cobranças provenientes de:

Locação
Manutenção
Multas
Outras despesas
Juros por atraso
Ajustes financeiros

Uma cobrança poderá conter um ou vários itens.

Exemplo:

Aluguel
Multa
Manutenção
Juros

Todos na mesma cobrança.

Periodicidade

A cobrança da locação poderá ser:

Semanal
Mensal

A geração deverá ocorrer automaticamente conforme configuração da locação.

Status

Cada cobrança deverá possuir um dos seguintes status:

Pendente
Parcialmente paga
Paga
Atrasada
Cancelada
Pagamento

O cliente poderá pagar:

Pelo aplicativo

Ou o administrador poderá:

Enviar a cobrança por outros meios.
Registrar manualmente um pagamento.

Ao registrar manualmente deverá ser informado:

Data
Valor recebido
Forma de pagamento
Observações (opcional)

Exemplos de forma de pagamento:

PIX
Dinheiro
Cartão
Transferência
Boleto
Outros
4. Juros por Atraso

As cobranças deverão permitir configuração de:

Multa fixa
Percentual de multa
Juros diários
Dias de carência
Valor mínimo

Os juros deverão ser calculados automaticamente quando houver atraso.

5. Caução (Depósito de Garantia)
Objetivo

Permitir registrar o valor pago como garantia da locação.

Regras

O valor do caução:

Não compõe faturamento.
Não gera lucro.
Não deve aparecer como receita operacional.
Deve ser registrado como passivo financeiro.

Ao término da locação poderá ocorrer:

Devolução integral
Devolução parcial
Retenção integral

Caso parte do caução seja utilizada para quitar despesas, deverá ser informado:

Valor utilizado
Motivo
Despesa relacionada

O saldo restante deverá ser devolvido ao cliente.

6. Manutenções

O sistema deverá registrar todas as manutenções realizadas nos veículos.

Cada manutenção deverá possuir:

Veículo
Locação (quando aplicável)
Data
Descrição
Valor total
Responsável pela execução
Responsabilidade financeira
Responsável pela execução
Empresa
Cliente
Responsabilidade financeira

A manutenção poderá ser:

100% Empresa
100% Cliente
Compartilhada

Quando compartilhada deverá ser informado:

Valor da empresa
Valor do cliente
Regras
Manutenção realizada pela empresa

Caso exista participação financeira do cliente:

O sistema deverá gerar automaticamente uma cobrança.

Manutenção realizada pelo cliente

Caso exista participação financeira da empresa:

O sistema deverá permitir:

Registrar o reembolso.
Gerar crédito para abatimento em cobranças futuras.

O administrador poderá escolher:

Reembolsar imediatamente.
Utilizar crédito financeiro.
7. Multas

O sistema deverá permitir registrar multas.

Cada multa deverá possuir:

Veículo
Locação (quando aplicável)
Data
Tipo
Descrição
Valor
Responsável financeiro

Responsabilidade:

Cliente
Empresa

Caso seja responsabilidade do cliente:

Gerar cobrança automaticamente.

Caso seja responsabilidade da empresa:

Registrar apenas como despesa.
8. Despesas

As despesas deverão ser organizadas em categorias específicas para facilitar o controle financeiro e a geração de relatórios.

8.1 Seguro

O sistema deverá permitir registrar todas as despesas relacionadas ao seguro do veículo.

Exemplos:

Contratação da apólice
Renovação
Endosso
Franquia
Outros custos relacionados ao seguro

Cada registro deverá possuir:

Veículo
Seguradora
Número da apólice (opcional)
Vigência
Data de pagamento
Valor
Observações

Essas despesas serão sempre de responsabilidade da empresa.

8.2 Documentação

O sistema deverá permitir registrar despesas relacionadas à documentação do veículo.

Exemplos:

IPVA
Licenciamento
Emplacamento
Transferência
Vistorias
Taxas do DETRAN
Outras taxas obrigatórias

Cada registro deverá possuir:

Veículo
Tipo de documento
Competência
Data de vencimento
Data de pagamento
Valor
Observações

Essas despesas serão sempre de responsabilidade da empresa.

8.3 Outras Despesas

O sistema deverá permitir registrar despesas que não pertençam às categorias anteriores.

Exemplos:

Guincho
Lavagem
Combustível
Estacionamento
Pedágio
Higienização
Acessórios
Outras

Cada registro deverá possuir:

Categoria
Descrição
Valor
Data
Veículo (opcional)
Locação (opcional)
Responsável financeiro

Responsabilidade:

Empresa
Cliente
Compartilhada

Caso exista valor devido pelo cliente:

O sistema deverá gerar automaticamente a cobrança correspondente.
9. Créditos do Cliente

O sistema deverá controlar créditos financeiros do cliente.

Exemplos:

Reembolso de manutenção
Estorno
Crédito manual
Ajustes financeiros

Sempre que existir crédito disponível o sistema deverá permitir:

Abatimento automático na próxima cobrança.
Abatimento manual pelo administrador.

Todo crédito deverá possuir histórico.

10. Lançamentos Financeiros

Todo evento financeiro deverá gerar um lançamento financeiro.

Cada lançamento deverá possuir:

Tipo
Categoria
Origem
Data
Valor
Cliente
Veículo
Locação
Documento relacionado
Status
Usuário responsável
Observações

Tipos de lançamento:

Receita
Despesa
Passivo
Crédito
Reembolso
Estorno
Ajuste financeiro
11. Relatórios
Financeiro Geral

Permitir visualizar:

Receitas
Despesas
Lucro
Prejuízo
Fluxo de caixa
Contas a receber
Contas pagas
Contas em aberto
Inadimplência
Financeiro por Locação

Visualizar:

Valor total cobrado
Valor recebido
Valor pendente
Caução
Manutenções
Multas
Despesas
Créditos
Reembolsos
Lucro da locação
Financeiro por Cliente

Visualizar:

Histórico de cobranças
Histórico de pagamentos
Créditos
Reembolsos
Cauções
Multas
Manutenções
Valores em aberto
Histórico de inadimplência
Financeiro por Veículo

O sistema deverá registrar todo o ciclo financeiro do veículo.

Receitas
Total recebido com locações
Despesas
Valor de compra
Seguro
Documentação
Manutenções
Multas
Outras despesas
Encerramento
Valor de venda
Total investido
Total recebido
Resultado financeiro
Lucro líquido do veículo durante todo o ciclo de vida
12. Histórico Financeiro do Veículo

Cada veículo deverá possuir um histórico financeiro completo desde sua aquisição até sua venda.

O histórico deverá conter:

Aquisição
Valor de compra
Data de compra
Fornecedor
Operação

Receitas:

Todas as locações

Despesas:

Seguro
Documentação
Manutenções
Multas
Outras despesas
Alienação
Valor de venda
Data da venda

O sistema deverá calcular automaticamente:

Total investido
Total faturado
Total de despesas
Lucro líquido
Retorno sobre o investimento (ROI)
13. Requisitos de Auditoria

Todas as operações financeiras deverão possuir rastreabilidade.

Cada alteração deverá registrar:

Data e hora
Usuário responsável
Operação realizada
Valor anterior
Valor novo
Motivo da alteração (quando aplicável)

Nenhum registro financeiro poderá ser excluído fisicamente.

14. Recomendações de Arquitetura

Para garantir escalabilidade, flexibilidade e consistência, recomenda-se que o módulo financeiro seja implementado utilizando os seguintes conceitos:

Entidades principais
Lançamento Financeiro (Ledger): representa qualquer movimentação financeira (receita, despesa, passivo, crédito, reembolso, estorno etc.).
Cobrança: documento que consolida um ou mais lançamentos financeiros destinados ao cliente.
Pagamento: registra a quitação total ou parcial de uma cobrança, permitindo múltiplos pagamentos e diferentes formas de pagamento.
Crédito do Cliente: saldo financeiro disponível para abatimento em cobranças futuras.
Caução: tratado como um passivo financeiro, separado das receitas operacionais.
Centro de Custo/Categoria Financeira: classificação dos lançamentos (locação, manutenção, seguro, documentação, multa, combustível, guincho etc.), permitindo expansão sem alterações estruturais.
Benefícios
Suporte a pagamentos parciais e múltiplos meios de pagamento.
Cobranças compostas por diferentes tipos de itens.
Controle correto de cauções e créditos.
Rastreabilidade completa de todas as movimentações.
Relatórios consistentes por empresa, cliente, locação e veículo.
Facilidade para adicionar novos tipos de despesas, receitas ou cobranças no futuro sem refatorações significativas.