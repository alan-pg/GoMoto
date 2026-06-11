export async function validateDocxFile(file: File): Promise<{ valid: boolean; error?: string }> {
  if (file.size > 10 * 1024 * 1024) {
    return { valid: false, error: 'Arquivo muito grande. Máximo permitido: 10MB.' }
  }

  // Verify magic bytes: DOCX/ZIP starts with PK (0x50 0x4B 0x03 0x04)
  const buffer = await file.slice(0, 4).arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4B) {
    return { valid: false, error: 'Arquivo inválido. Apenas arquivos .docx são permitidos.' }
  }

  return { valid: true }
}

export async function validateImageFile(file: File): Promise<{ valid: boolean; error?: string }> {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
  if (!allowedTypes.includes(file.type)) {
    return { valid: false, error: 'Tipo de arquivo não permitido. Use JPG, PNG ou WebP.' }
  }

  if (file.size > 5 * 1024 * 1024) {
    return { valid: false, error: 'Imagem muito grande. Máximo permitido: 5MB.' }
  }

  // Verify magic bytes
  const buffer = await file.slice(0, 4).arrayBuffer()
  const bytes = new Uint8Array(buffer)

  const isJpeg = bytes[0] === 0xFF && bytes[1] === 0xD8
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47
  const isWebp = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46

  if (!isJpeg && !isPng && !isWebp) {
    return { valid: false, error: 'Conteúdo do arquivo não corresponde ao tipo declarado.' }
  }

  return { valid: true }
}

export async function validatePdfFile(file: File): Promise<{ valid: boolean; error?: string }> {
  if (file.size > 20 * 1024 * 1024) {
    return { valid: false, error: 'PDF muito grande. Máximo permitido: 20MB.' }
  }

  // Verify magic bytes: PDF starts with %PDF (0x25 0x50 0x44 0x46)
  const buffer = await file.slice(0, 4).arrayBuffer()
  const bytes = new Uint8Array(buffer)
  if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    return { valid: false, error: 'Arquivo inválido. Apenas PDFs são permitidos.' }
  }

  return { valid: true }
}

export function safeFileName(originalName: string): string {
  const ext = originalName.split('.').pop()?.toLowerCase() ?? 'bin'
  return `${crypto.randomUUID()}.${ext}`
}
