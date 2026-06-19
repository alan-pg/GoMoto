/**
 * @file route.ts
 * @description POST /api/crlv/parse — recebe um PDF do CRLV-e via multipart/form-data
 * (campo `file`), extrai o texto com pdf-parse e devolve os campos identificados
 * pelo parser puro em `@gomoto/core`.
 *
 * Runtime nodejs (não Edge): pdf-parse usa APIs de Buffer/Node.
 * Não persiste nada — o caller decide se sobe o PDF ao bucket via outro fluxo.
 */

import { NextResponse } from 'next/server'
import { parseCRLVText, crlvSuccessRate } from '@gomoto/core'
// pdf-parse@2.x expõe a classe PDFParse (fork style); não há default export.
import { PDFParse } from 'pdf-parse'

export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB — alinhado ao limite do bucket vehicle-documents

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ error: 'multipart/form-data esperado' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'campo "file" obrigatório' }, { status: 400 })
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'arquivo vazio' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'arquivo maior que 10 MB' }, { status: 413 })
  }

  // pdf-parse aceita Buffer. Conversão direta — em Node 18+ File já tem arrayBuffer().
  const buffer = Buffer.from(await file.arrayBuffer())

  let text: string
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer), verbosity: -1 })
    const result = await parser.getText()
    text = result.text ?? ''
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido'
    return NextResponse.json(
      { error: `falha ao extrair texto do PDF: ${message}` },
      { status: 422 },
    )
  }

  const fields = parseCRLVText(text)
  const stats = crlvSuccessRate(fields)

  return NextResponse.json({ fields, stats })
}
