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
  return `Você está analisando uma Notificação de Autuação (NA) de trânsito brasileira, em PDF —
o documento com o título "NOTIFICAÇÃO DE AUTUAÇÃO" (não a Notificação de Penalidade, que é um
documento posterior e diferente). Extraia os seguintes campos exatamente como aparecem no
documento:
- license_plate: placa do veículo autuado
- description: descrição da infração cometida
- infraction_date: data em que a infração ocorreu, no formato ISO YYYY-MM-DD
- amount: valor da multa em reais, como número (ex.: 293.47)
- ait_number: número do Auto de Infração de Trânsito (AIT)
- infraction_location: local onde a infração ocorreu (endereço/via)
- renainf_number: número RENAINF (Registro Nacional de Infrações de Trânsito)
- notification_date: data da notificação da autuação, no formato ISO YYYY-MM-DD
- prior_defense_deadline: data limite para interposição de defesa prévia, no formato ISO YYYY-MM-DD
- driver_identification_deadline: data limite para identificação do condutor infrator, no formato ISO YYYY-MM-DD
- senatran_infraction_code: código oficial da infração (campo "código da infração", numérico,
  ex.: "7455" — não confundir com o artigo do CTB)
- senatran_infraction_subcode: campo "desdobramento" — número curto que acompanha o código da infração (ex.: "0", "8", "2")
- issuing_agency_name: nome do órgão autuador por extenso (ex.: "PREF. DE RJ RIO DE JANEIRO")
- issuing_agency_code: código numérico do órgão autuador (campo "código do órgão autuador")
- competent_agency_code: código numérico do órgão competente (campo "código do órgão competente" — pode ser igual ao do órgão autuador)
- competent_agency_name: nome do órgão competente por extenso
- driver_name: nome do condutor, se já identificado no documento (ignore se o campo disser "Não disponível")
- driver_cnh: número da CNH do condutor, se já identificado (ignore se "Não disponível")
- driver_cpf: CPF do condutor, se já identificado (ignore se "Não disponível" ou mascarado)
- driver_document: outro documento do condutor além da CNH, campo "DOC" (ignore se "Não disponível")
- infraction_time: hora em que a infração ocorreu, no formato HH:MM (campo "HORA", ao lado da data da infração)
- measurement_instrument_id: número do equipamento ou instrumento de aferição (radar), quando houver
- traffic_agent_id: identificação/matrícula do agente ou autoridade de trânsito
- measured_speed: velocidade medida em km/h, como número, quando a infração for de excesso de velocidade (campo "medição realizada")
- considered_speed: velocidade considerada em km/h, como número, já com a margem de tolerância aplicada (campo "valor considerado")
- speed_limit: limite de velocidade da via em km/h, como número (campo "limite regulamentado")
- original_renainf_number: número RENAINF da multa original, quando esta notificação for uma reemissão (ignore se "Não se aplica")
- infraction_municipality_code: código do município onde ocorreu a infração
- infraction_municipality_name: nome do município onde ocorreu a infração
- infraction_state: UF (sigla de 2 letras) onde ocorreu a infração
- senatran_message: texto do campo "MENSAGEM SENATRAN", quando não estiver vazio

Para cada campo, informe também o nível de confiança ("high" ou "low") — use "low" quando o
texto estiver borrado, cortado, ambíguo ou você não tiver certeza da leitura. Se o campo não
aparecer no documento, estiver marcado como "Não disponível" ou não puder ser lido, retorne
"value": null. Não invente valores. Não copie texto de outra parte do documento que não
corresponda ao campo.`
}
