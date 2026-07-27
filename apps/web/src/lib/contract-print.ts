const PRINT_STYLE = `
  @page { size: A4; margin: 2cm 2.5cm; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.7; color: #1a1a1a; }
  /* page nodes: reset visual — o @page cuida das margens na impressão */
  [data-type="page"] { margin: 0; padding: 0; min-height: unset; background: none; }
  h1 { font-size: 16pt; font-weight: 700; margin: 1em 0 0.5em; }
  h2 { font-size: 13pt; font-weight: 700; margin: 1em 0 0.5em; }
  h3 { font-size: 11pt; font-weight: 600; margin: 1em 0 0.4em; }
  p  { margin: 0 0 0.75em; }
  ul { list-style: disc;    padding-left: 1.5em; margin: 0.5em 0; }
  ol { list-style: decimal; padding-left: 1.5em; margin: 0.5em 0; }
  [style*="text-align: center"]  { text-align: center; }
  [style*="text-align: right"]   { text-align: right; }
  [style*="text-align: justify"] { text-align: justify; }
`

/** Abre um documento HTML numa nova aba, para visualização — sem disparar o diálogo de impressão. Mesmo estilo de `printHtmlDocument`, mas só pra "ver", não "baixar". */
export function openHtmlDocument(html: string, title: string): void {
  const win = window.open('', '_blank')
  if (!win) throw new Error('Não foi possível abrir a aba de visualização (bloqueador de pop-up?)')
  win.document.open()
  win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>${PRINT_STYLE}</style>
  </head><body>${html}</body></html>`)
  win.document.close()
}

/** Abre o diálogo de impressão do navegador para um documento HTML — via iframe oculto, sem navegar a página atual. Usado tanto no preview de modelos quanto na geração de contrato de uma locação real. */
export async function printHtmlDocument(html: string, title: string): Promise<void> {
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, {
    position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0',
  })
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) throw new Error('Falha ao preparar impressão')

  doc.open()
  doc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
    <style>${PRINT_STYLE}</style>
  </head><body>${html}</body></html>`)
  doc.close()

  const win = iframe.contentWindow
  if (!win) throw new Error('Janela de impressão não encontrada')

  const cleanup = () => {
    try { document.body.removeChild(iframe) } catch { /* já removido */ }
  }
  win.addEventListener('afterprint', cleanup, { once: true })
  setTimeout(cleanup, 60_000)
  await new Promise(r => setTimeout(r, 200))
  win.focus()
  win.print()
}
