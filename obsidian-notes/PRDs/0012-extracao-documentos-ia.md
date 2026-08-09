---
status: aprovado
versão: 1.0
autor: Alan (com agente IA)
data: 2026-08-09
adr:
  - "[[decisions/0023-arquitetura-extracao-documentos-ia]]"
related:
  - "[[Telas/Clientes]]"
  - "[[Telas/Multas]]"
  - "[[PRDs/0002-cadastro-de-motos-documentacao-e-tco]]"
tags:
  - prd
  - extracao-documentos-ia
  - inteligencia-artificial
---

# PRD 0012 — Extração de Dados de Documentos via IA (CNH e Multa)

> 🟢 **Status: aprovado** em 2026-08-09. Extração automática de dados de documentos (CNH, notificação de multa) via IA para autopreencher os formulários de Cliente e de Multa, com arquitetura pensada para suportar novos tipos de documento no futuro. Próximo passo: `/spec-generator obsidian-notes/PRDs/0012-extracao-documentos-ia.md`.

---

## 1. Visão Geral

### 1.1 Contexto

Hoje, ao cadastrar um cliente ou lançar uma multa no GoMoto, o operador digita manualmente cada campo olhando o documento original — a CNH do cliente (foto ou PDF) ou a notificação de autuação de trânsito (PDF). Esse processo é repetitivo, lento e sujeito a erro de digitação (CPF trocado, data errada, número de AIT digitado errado), sem nenhum mecanismo de dupla checagem além da atenção do próprio operador.

O GoMoto está em evolução contínua, e a oportunidade aqui é dupla: reduzir o trabalho manual repetitivo de transcrição e, ao mesmo tempo, tornar o sistema mais moderno — aplicando extração de dados via IA a documentos que a locadora já recebe todo dia (CNH de cliente novo, notificações de multa) para preencher os formulários automaticamente.

Diferente de um recurso isolado, essa capacidade deve nascer pensada para crescer: hoje resolve CNH e multa, mas a locadora vai continuar recebendo outros tipos de documento (comprovante de residência, CRLV — que já tem um parser manual próprio, contratos, etc.), e a base construída agora deve permitir plugar novos tipos sem reescrever a fundação.

### 1.2 Resumo executivo

- Operador anexa um documento (CNH ou notificação de multa, em PDF ou foto) na tela de Cliente ou de Multa, e o sistema extrai os dados automaticamente via IA, preenchendo o formulário correspondente.
- Operador revisa os campos preenchidos antes de confirmar — a extração agiliza o preenchimento, mas não substitui a conferência humana.
- A capacidade é construída de forma extensível: adicionar suporte a um novo tipo de documento no futuro é uma extensão da base existente, não uma nova funcionalidade do zero.
- Elimina a transcrição manual campo a campo como etapa obrigatória do cadastro, reduzindo tempo gasto e erro de digitação.

### 1.3 Problema

> "Preciso digitar cada campo olhando o documento — é lento, e às vezes um erro de digitação (CPF, data, valor da multa) só aparece depois, quando já causou problema."

Esse retrabalho manual se repete a cada cliente novo e a cada multa lançada, sem ganhar eficiência com o volume — cada documento é transcrito do zero, e nada aprende ou acelera esse processo hoje.

---

## 2. Glossário

| Termo | Definição |
|---|---|
| **Documento** | Arquivo (PDF ou imagem) que o operador anexa para ser processado pela extração por IA. |
| **Tipo de Documento** | Categoria do documento (ex.: CNH, Notificação de Multa) que determina quais campos são extraídos e qual formulário do sistema recebe o autopreenchimento. Novos tipos podem ser adicionados no futuro sem alterar a base da funcionalidade. |
| **Extração** | Conjunto de valores de campo produzidos pela IA a partir de um Documento, apresentado ao operador para revisão antes de ser salvo — nunca gravado automaticamente sem confirmação. |
| **Nível de confiança** | Indicação, por campo extraído, de o quanto a IA está segura do valor lido no Documento original. Campos com confiança baixa são sinalizados ao operador para atenção redobrada na revisão. |

---

## 3. Objetivos e Escopo

### 3.1 Objetivos de negócio

- Reduzir o tempo e o erro de digitação no cadastro de cliente e no lançamento de multa, usando extração de dados por IA a partir do documento original.
- Consolidar uma base extensível de extração de documentos que sirva de fundação para novos tipos de documento no futuro, sem retrabalho de arquitetura a cada tipo novo.

### 3.2 Objetivos do usuário

- O operador anexa o documento (CNH ou notificação de multa) e revisa/confirma os campos já preenchidos, em vez de digitar cada um do zero.

### 3.3 Métricas de sucesso / KPIs

- % de cadastros de cliente e lançamentos de multa feitos via extração por IA, em vez de digitação manual do zero.
- Taxa de campos extraídos que o operador aceita sem precisar corrigir, por tipo de documento.

> Sem meta numérica bloqueante no V1 — decisão explícita (ver Seção 12). As métricas servem para observar e embasar metas futuras.

### 3.4 Incluído em V1

- Upload de documento (PDF ou imagem) na tela de Cliente para extrair dados da CNH e autopreencher o formulário.
- Upload de documento na tela de Multa para extrair dados da notificação de autuação e autopreencher o formulário.
- Revisão obrigatória dos campos extraídos antes de salvar, com sinalização dos campos de baixa confiança.
- Arquitetura extensível: suportar um novo tipo de documento no futuro é configurar um novo conjunto de campos/regras, não reescrever a capacidade de extração em si.
- Anexação do documento original ao registro de Cliente e ao registro de Multa após a extração — comportamento específico desses dois tipos de documento (tipos futuros podem optar por não guardar o arquivo).
- Cross-reference automático: quando a multa extraída traz uma placa, o sistema tenta casar com um veículo já cadastrado.
- Processamento de um documento por vez.
- 2 telas existentes mudam (Clientes, Multas); nenhuma tela nova.

### 3.5 Não Incluído / Não-objetivos (V1)

- Cliente final enviar documentos pelo app mobile — adiado; V1 é só operador no web.
- Extrair outros tipos de documento além de CNH e multa — fora de escopo agora; a arquitetura nasce pronta para isso, mas nenhum tipo novo é entregue nesta V1.
- Processar múltiplos documentos de uma vez (ex.: PDF com várias multas juntas) — fora de escopo; um documento por vez.
- Sistema aprender/melhorar automaticamente com base nas correções feitas pelo operador — sem caso de uso definido ainda.

---

## 4. Stakeholders

> Dono único: Alan. Sem stakeholders externos.

---

## 5. Personas e User Stories

### 5.1 Personas

| Persona | Como interage | Frequência | Nível técnico |
|---|---|---|---|
| **Operador** | Anexa o documento (CNH ou notificação de multa) na tela de Cliente ou Multa; revisa e confirma os campos extraídos antes de salvar | Eventual (a cada cliente novo cadastrado / multa lançada) | Médio |

### 5.2 User Stories

- **US-001** — Como Operador, quero anexar a CNH do cliente ao cadastrar um cliente, para que os campos do formulário sejam preenchidos automaticamente e eu só precise revisar antes de salvar.
- **US-002** — Como Operador, quero anexar a notificação de multa ao lançar uma multa, para que os campos do formulário sejam preenchidos automaticamente e eu só precise revisar antes de salvar.
- **US-003** — Como Operador, quero que campos extraídos com baixa confiança sejam sinalizados claramente, para saber quais preciso conferir com mais atenção antes de confirmar.

> Persona única no V1 — sem cenário multi-persona.

---

## 6. Fluxos Funcionais

### 6.1 Fluxo principal

**Fluxo A — Extração de CNH (tela de Cliente)**

```
1. Operador abre a tela de Cliente (novo cadastro ou edição) e escolhe anexar a CNH.
2. Operador seleciona o arquivo (PDF ou foto) do dispositivo.
3. Sistema envia o documento para extração e exibe estado de carregamento.
4. Sistema retorna os campos extraídos e preenche o formulário automaticamente,
   indicando quais campos vieram da extração e sinalizando os de confiança baixa.
5. Operador revisa os campos (corrige o que quiser, inclusive os de confiança baixa)
   e confirma.
6. Operador salva o cadastro normalmente — a CNH original fica anexada ao registro
   do cliente.
```

**Fluxo B — Extração de Multa (tela de Multa)**

```
1. Operador abre a tela de nova Multa e escolhe anexar a notificação de autuação.
2. Operador seleciona o arquivo (PDF).
3. Sistema envia o documento para extração e exibe estado de carregamento.
4. Sistema retorna os campos extraídos (placa, valor, data, número do AIT, etc.)
   e preenche o formulário, sinalizando os campos de confiança baixa.
5. Sistema tenta casar a placa extraída com um veículo já cadastrado: se encontrar,
   pré-seleciona o veículo; se não encontrar, deixa o campo de veículo em aberto
   para seleção manual.
6. Operador revisa os campos (corrige o que quiser) e confirma.
7. Operador salva a multa — o documento original fica anexado ao registro.
```

### 6.2 Fluxos alternativos

- Operador opta por não anexar documento algum e preenche o formulário manualmente, como hoje — a extração é um atalho opcional, nunca obrigatório.
- Operador anexa um documento mas descarta a extração (ex.: resultado ruim) e volta a preencher manualmente, sem perder o restante do formulário já digitado.
- Placa extraída da multa não corresponde a nenhum veículo cadastrado — operador seleciona o veículo manualmente, sem bloquear o restante do preenchimento.

### 6.3 Fluxos de erro

- Falha de comunicação com o serviço de IA ou timeout na extração — sistema exibe mensagem amigável e oferece tentar novamente ou preencher manualmente. Nenhum dado já digitado no formulário é perdido.
- Documento não corresponde ao tipo esperado (ex.: operador anexa a foto errada) ou está ilegível/baixa qualidade — extração retorna poucos ou nenhum campo; sistema informa quantos campos foram identificados e o operador segue com preenchimento manual para o restante.
- Campo extraído com confiança baixa não é corrigido pelo operador — sistema permite salvar mesmo assim (sinalização é aviso, não bloqueio).

---

## 7. Requisitos Funcionais

- **RF-001** — Operador pode anexar um documento (PDF ou imagem) na tela de Cliente para acionar a extração de dados de CNH.
- **RF-002** — Operador pode anexar um documento (PDF) na tela de Multa para acionar a extração de dados de notificação de autuação.
- **RF-003** — Sistema extrai os campos correspondentes ao tipo de documento anexado e preenche automaticamente os campos correspondentes no formulário.
- **RF-004** — Sistema indica visualmente quais campos do formulário foram preenchidos pela extração e sinaliza os que vieram com confiança baixa.
- **RF-005** — Sistema informa quantos campos foram extraídos com sucesso em relação ao total esperado para o tipo de documento.
- **RF-006** — Operador pode editar qualquer campo preenchido pela extração antes de salvar, incluindo os sinalizados como confiança baixa.
- **RF-007** — Sistema permite salvar o formulário mesmo havendo campos extraídos com confiança baixa não corrigidos pelo operador.
- **RF-008** — Ao extrair uma notificação de multa, sistema tenta casar a placa extraída com um veículo já cadastrado; se encontrar correspondência, pré-seleciona o veículo no formulário; se não encontrar, deixa o campo de veículo disponível para seleção manual.
- **RF-009** — Se a extração falhar ou exceder o tempo de espera, sistema exibe mensagem amigável e oferece as opções de tentar novamente ou preencher o formulário manualmente.
- **RF-010** — Para documentos do tipo CNH e Multa, sistema anexa o arquivo original ao registro de Cliente ou de Multa correspondente, após confirmação do operador.
- **RF-011** — Operador pode preencher o formulário de Cliente ou Multa manualmente, sem anexar nenhum documento, a qualquer momento.

---

## 8. Requisitos Não Funcionais

- **RNF-001** — Sistema aguarda até 15 segundos pela resposta da extração antes de considerar falha e oferecer nova tentativa ou preenchimento manual.
- **RNF-002** — Indisponibilidade do serviço de extração nunca impede o cadastro de cliente ou o lançamento de multa — o preenchimento manual continua disponível a qualquer momento.
- **RNF-003** — Sistema aceita documentos nos formatos PDF, JPG, PNG e WEBP, com até 10MB por arquivo.
- **RNF-004** — Sistema informa ao operador, de forma visível, que o conteúdo do documento anexado é processado por um serviço de IA de terceiro.
- **RNF-005** — Sistema utiliza o provedor de IA em uma configuração que não reaproveita os documentos e dados pessoais enviados para treinar modelos do provedor, sempre que essa garantia estiver contratualmente disponível.
- **RNF-006** — Sistema não retém o documento enviado além do necessário para o fluxo de extração e para o anexo ao registro correspondente (CNH/Multa) — nenhuma cópia adicional é criada fora desse escopo.

> RNF descreve qualidade percebida pelo usuário ou negócio. Mecanismos técnicos (onde a chamada roda, cache, logs) ficam na Spec.

---

## 9. Regras de Negócio

- **RN-001** — Extração de dados por IA nunca grava informações diretamente no cadastro sem revisão e confirmação explícita do operador.
- **RN-002** — Confiança baixa em um campo extraído nunca bloqueia o salvamento do formulário; é sempre uma sinalização, nunca uma trava.
- **RN-003** — A extração é sempre opcional: o cadastro de cliente e o lançamento de multa podem ser concluídos inteiramente por preenchimento manual, sem depender do serviço de IA.
- **RN-004** — O documento anexado para extração de CNH ou de Multa permanece vinculado ao registro correspondente (cliente ou multa) após salvo, servindo como fonte de consulta futura.
- **RN-005** — Adicionar suporte a um novo tipo de documento não exige alterar o comportamento de extração já entregue para os tipos existentes (CNH, Multa).
- **RN-006** — Placa extraída de uma multa que corresponde a um veículo já cadastrado é associada automaticamente; ausência de correspondência nunca impede o lançamento da multa.
- **RN-007** — Dados de um documento enviado para extração são usados exclusivamente para preencher o formulário correspondente àquele documento — não são reaproveitados para nenhum outro propósito dentro do sistema.

---

## 10. Critérios de Aceite

### CA-001 (vincula RF-001)
- **Dado** que o operador está na tela de cadastro de Cliente
- **Quando** ele seleciona a opção de anexar CNH e escolhe um arquivo PDF ou imagem
- **Então** o sistema aceita o arquivo e inicia o processo de extração

### CA-002 (vincula RF-002)
- **Dado** que o operador está na tela de nova Multa
- **Quando** ele seleciona a opção de anexar a notificação de autuação e escolhe um arquivo PDF
- **Então** o sistema aceita o arquivo e inicia o processo de extração

### CA-003 (vincula RF-003)
- **Dado** que o operador anexou uma CNH legível
- **Quando** a extração é concluída com sucesso
- **Então** os campos correspondentes do formulário de Cliente aparecem preenchidos com os valores extraídos

### CA-004 (vincula RF-004)
- **Dado** que a extração identificou um campo com baixa confiança (ex.: um número borrado no documento)
- **Quando** o formulário é preenchido automaticamente
- **Então** esse campo aparece visualmente sinalizado como de confiança baixa, diferente dos demais

### CA-005 (vincula RF-005)
- **Dado** que a extração foi concluída
- **Quando** o operador visualiza o resultado
- **Então** o sistema exibe quantos campos foram extraídos com sucesso em relação ao total esperado para aquele tipo de documento (ex.: "8 de 12 campos identificados")

### CA-006 (vincula RF-006)
- **Dado** que um campo foi preenchido pela extração, incluindo um de confiança baixa
- **Quando** o operador edita o valor desse campo
- **Então** o novo valor digitado substitui o valor extraído e é o que será salvo

### CA-007 (vincula RF-007)
- **Dado** que o formulário tem ao menos um campo extraído com confiança baixa não corrigido
- **Quando** o operador clica em salvar
- **Então** o sistema salva o cadastro normalmente, sem bloquear ou exigir confirmação adicional

### CA-008 (vincula RF-008)
- **Dado** que a extração de uma multa identificou uma placa que corresponde a um veículo já cadastrado
- **Quando** o formulário de Multa é preenchido
- **Então** o campo de veículo já aparece pré-selecionado com o veículo correspondente

### CA-009 (vincula RF-008 — borda)
- **Dado** que a placa extraída não corresponde a nenhum veículo cadastrado
- **Quando** o formulário de Multa é preenchido
- **Então** o campo de veículo permanece vazio para seleção manual, sem bloquear o restante do preenchimento

### CA-010 (vincula RF-009)
- **Dado** que o operador anexou um documento para extração
- **Quando** o serviço de IA não responde em até 15 segundos ou retorna erro
- **Então** o sistema exibe uma mensagem amigável com as opções de tentar novamente ou preencher manualmente

### CA-011 (vincula RF-010)
- **Dado** que o operador confirmou e salvou um cadastro de Cliente ou uma Multa criada a partir de extração
- **Quando** o registro é salvo
- **Então** o documento original (CNH ou notificação de multa) fica disponível como anexo desse registro

### CA-012 (vincula RF-011)
- **Dado** que o operador está na tela de Cliente ou de Multa
- **Quando** ele opta por não anexar nenhum documento
- **Então** ele consegue preencher e salvar o formulário inteiramente à mão, como funciona hoje

---

## 11. Dependências e Riscos

### 11.1 Dependências

- Depende de um provedor externo de IA (serviço de extração de documentos) — introduz uma dependência de sistema externo que não existia no produto até hoje.
- Reaproveita conceitos já modelados no [[PRDs/0002-cadastro-de-motos-documentacao-e-tco|PRD 0002]] (parser de CRLV) como referência de UX para importação assistida de documento.
- Depende das telas de [[Telas/Clientes|Clientes]] e [[Telas/Multas|Multas]] já existentes — a feature estende esses formulários, não cria telas novas.
- Será criada **ADR** em `obsidian-notes/decisions/` sobre a arquitetura da extração por IA — especificamente onde a chamada ao provedor externo roda e como a extensibilidade a novos tipos de documento é modelada. (Sinalizado aqui; conteúdo técnico decidido na Spec/ADR, não neste PRD.)

### 11.2 Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|---|---|---|---|
| Provedor de IA fica indisponível, muda comportamento ou preço sem aviso | Média | Médio | Preenchimento manual continua sempre disponível (RNF-002); nenhuma operação do sistema depende exclusivamente da extração |
| Dados pessoais sensíveis (CPF, foto, CNH) são enviados a um provedor terceiro | Alta | Alto | RN-007, RNF-004, RNF-005 e RNF-006 estabelecem transparência, minimização de uso e não retenção como princípios básicos já neste V1 |
| Operador perde confiança na extração por baixa taxa de acerto e volta a digitar tudo manualmente | Média | Médio | Sinalização clara de confiança por campo (RF-004) + métrica de adoção (§3.3) revela o problema cedo |
| Custo por chamada ao provedor de IA cresce de forma descontrolada com o volume de uso | Baixa/Média | Médio | Fora do escopo de produto desta feature — registrar como ponto de atenção para a Spec (limites de uso, monitoramento de custo) |

---

## 12. Questões Abertas + Aprovação Final

### 12.1 Questões Abertas

Nenhuma questão aberta — pronto para spec.

> Privacidade/LGPD: resolvida com o mínimo necessário neste PRD (RNF-004, RNF-005, RNF-006, RN-007). Uma política formal mais ampla, se necessária, fica fora do escopo desta feature.
> Metas numéricas de adoção/acerto (§3.3): mantidas sem meta bloqueante no V1, por decisão explícita do stakeholder.

### 12.2 Checklist de validação

- [x] Sem ambiguidades abertas (§12.1 vazia ou explicitamente adiada)
- [x] Todos os RFs têm ao menos 1 CA correspondente
- [x] Todos os CAs apontam para um RF ou RN
- [x] Personas identificadas e cada uma com ≥1 US
- [x] Fluxos principais, alternativos e de erro documentados
- [x] Dependências e riscos mapeados
- [x] Frontmatter completo (sem campos pendentes de preenchimento)
- [x] PRD descreve produto (problema, valor, regra de domínio, critério observável) — sem detalhes de implementação técnica (SQL, paths, pacotes, libs)

**Aprovado por:** Alan em 2026-08-09
