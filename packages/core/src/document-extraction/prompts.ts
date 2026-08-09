/**
 * Prompts de extração por tipo de documento (packages/core/src/document-extraction/registry.ts).
 * Texto final é detalhe de implementação, iterável sem mudar o contrato/schema (Spec 0012 §11.2).
 */

export function buildCnhPrompt(): string {
  return `Você está analisando uma Carteira Nacional de Habilitação (CNH) brasileira, em PDF ou foto.
Extraia os seguintes campos exatamente como aparecem no documento:
- name: nome completo do condutor
- cpf: CPF (apenas os dígitos, sem pontuação)
- rg: número do RG (ou documento de identidade equivalente)
- birth_date: data de nascimento, no formato ISO YYYY-MM-DD
- drivers_license: número de registro da CNH
- drivers_license_category: categoria da habilitação (ex.: A, B, AB)
- drivers_license_validity: data de validade da CNH, no formato ISO YYYY-MM-DD

Para cada campo, informe também o nível de confiança ("high" ou "low") — use "low" quando o
texto estiver borrado, cortado, ambíguo ou você não tiver certeza da leitura. Se o campo não
aparecer no documento ou não puder ser lido, retorne "value": null.
Não invente valores. Não copie texto de outra parte do documento que não corresponda ao campo.`
}

export function buildFineNoticePrompt(): string {
  return `Você está analisando uma notificação de autuação de trânsito (multa) brasileira, em PDF.
Extraia os seguintes campos exatamente como aparecem no documento:
- license_plate: placa do veículo autuado
- description: descrição da infração cometida
- infraction_date: data em que a infração ocorreu, no formato ISO YYYY-MM-DD
- due_date: data de vencimento para pagamento ou recurso, no formato ISO YYYY-MM-DD
- amount: valor da multa em reais, como número (ex.: 293.47)
- ait_number: número do Auto de Infração de Trânsito (AIT)
- infraction_location: local onde a infração ocorreu (endereço/via)

Para cada campo, informe também o nível de confiança ("high" ou "low") — use "low" quando o
texto estiver borrado, cortado, ambíguo ou você não tiver certeza da leitura. Se o campo não
aparecer no documento ou não puder ser lido, retorne "value": null.
Não invente valores. Não copie texto de outra parte do documento que não corresponda ao campo.`
}
