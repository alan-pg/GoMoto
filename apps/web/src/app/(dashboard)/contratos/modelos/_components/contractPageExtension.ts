/**
 * Paginação automática para o editor de contratos.
 *
 * Esquema: doc → page+ → block+
 *
 * ContractPaginatorPlugin mede a altura real de cada bloco via DOM após cada
 * mudança e redistribui os blocos entre páginas em uma única transação sem
 * entrar no histórico de undo.
 */

import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Fragment } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as PmNode } from '@tiptap/pm/model'

/** Altura útil de conteúdo por página A4 a 96 dpi, descontados os 96 px de padding (48+48). */
export const PAGE_CONTENT_HEIGHT_PX = 1002

/** Chave do plugin — usada tanto para PluginKey quanto nas meta das transações. */
export const paginatorPluginKey = new PluginKey<boolean>('contract-paginator')

/** String exportada para o editor verificar o meta nas transações via onUpdate. */
export const PAGINATOR_META_KEY = 'contract-paginator'

// ─── Custom Document (substitui o 'doc' do StarterKit) ────────────────────────

export const ContractDocument = Node.create({
  name: 'doc',
  topNode: true,
  content: 'page+',
})

// ─── Page node ────────────────────────────────────────────────────────────────

export const ContractPage = Node.create({
  name: 'page',
  content: 'block+',

  parseHTML() {
    return [{ tag: 'div[data-type="page"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page',
        class: 'contract-page',
      }),
      0,
    ]
  },
})

// ─── Migração de conteúdo legado ───────────────────────────────────────────────

/**
 * Envolve conteúdo salvo no formato antigo (doc → block*) em um page node.
 * Templates já no novo formato (doc → page+) são retornados sem alteração.
 */
export function wrapContentInPage(
  content: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!content) return null
  const doc = content as { type: string; content?: unknown[] }
  if (!doc.content?.length) return content
  const first = doc.content[0] as { type: string }
  if (first?.type === 'page') return content
  return { ...content, content: [{ type: 'page', content: doc.content }] }
}

// ─── Paginator plugin ─────────────────────────────────────────────────────────

/**
 * Após cada mudança de documento:
 * 1. Mede o offsetHeight de cada bloco via DOM.
 * 2. Redistribui os blocos em páginas sem ultrapassar PAGE_CONTENT_HEIGHT_PX.
 * 3. Despacha uma única transação (sem histórico) se o layout mudou.
 */
export const ContractPaginatorPlugin = new Plugin<boolean>({
  key: paginatorPluginKey,

  // Estado do plugin: true se a última transação foi do paginador
  state: {
    init: () => false,
    apply(tr) {
      return tr.getMeta(paginatorPluginKey) === true
    },
  },

  view(view: EditorView) {
    let scheduled: number | null = null

    function paginate() {

      scheduled = null
      const { state } = view
      const { doc, schema } = state
      const pageType = schema.nodes.page
      if (!pageType) return

      // Coleta todos os blocos de todas as páginas com suas alturas medidas
      const blocks: { node: PmNode; height: number }[] = []

      doc.forEach((pageNode, pageOffset) => {
        if (pageNode.type !== pageType) return
        pageNode.forEach((block, blockOffset) => {
          const pos = pageOffset + 1 + blockOffset
          const dom = view.nodeDOM(pos) as HTMLElement | null
          blocks.push({ node: block, height: dom?.offsetHeight ?? 24 })
        })
      })

      if (!blocks.length) return

      // Redistribui em páginas respeitando a altura máxima
      const pages: PmNode[][] = [[]]
      let cumH = 0
      for (const { node, height } of blocks) {
        if (cumH > 0 && cumH + height > PAGE_CONTENT_HEIGHT_PX) {
          pages.push([])
          cumH = 0
        }
        pages[pages.length - 1].push(node)
        cumH += height
      }

      const newPageNodes = pages
        .filter((p) => p.length > 0)
        .map((p) => pageType.create(null, Fragment.from(p)))

      // Compara com o layout atual — pula se não mudou
      if (newPageNodes.length === doc.childCount) {
        let same = true
        let i = 0
        doc.forEach((p) => {
          if (!p.eq(newPageNodes[i++])) same = false
        })
        if (same) return
      }

      // Despacha transação única sem afetar histórico de undo
      const { selection } = state
      const tr = state.tr.replaceWith(0, doc.nodeSize - 2, Fragment.from(newPageNodes))
      tr.setMeta(paginatorPluginKey, true)
      tr.setMeta('addToHistory', false)

      // Tenta preservar posição do cursor
      try {
        tr.setSelection(selection.map(tr.doc, tr.mapping))
      } catch {
        // Fallback silencioso — o ProseMirror coloca o cursor em posição segura
      }

      view.dispatch(tr)
    }

    // Executa uma vez no mount para redistribuir conteúdo pré-carregado (tela de edição)
    scheduled = requestAnimationFrame(paginate)

    return {
      update(v, prev) {
        // Ignora transações do próprio paginador (via estado do plugin) para evitar loop
        if (paginatorPluginKey.getState(v.state)) return
        if (v.state.doc !== prev.doc) {
          if (scheduled !== null) cancelAnimationFrame(scheduled)
          scheduled = requestAnimationFrame(paginate)
        }
      },
      destroy() {
        if (scheduled !== null) cancelAnimationFrame(scheduled)
      },
    }
  },
})
