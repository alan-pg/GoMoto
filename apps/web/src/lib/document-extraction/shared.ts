import type { ExtractionDocumentType, ExtractionResult, CnhFields, FineNoticeFields } from '@gomoto/core'

export type RegistryFieldsOf<T extends ExtractionDocumentType> = T extends 'cnh' ? CnhFields : FineNoticeFields

export function summarize<T extends ExtractionDocumentType>(
  documentType: T,
  fields: RegistryFieldsOf<T>,
): ExtractionResult<RegistryFieldsOf<T>> {
  const values = Object.values(fields as Record<string, { value: unknown }>)
  return {
    documentType,
    fields,
    fieldsFound: values.filter((f) => f.value !== null && f.value !== undefined).length,
    fieldsTotal: values.length,
  }
}
