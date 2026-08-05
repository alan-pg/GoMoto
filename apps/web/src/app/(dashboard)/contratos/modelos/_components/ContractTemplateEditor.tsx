'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Placeholder from '@tiptap/extension-placeholder'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { useState, useRef, useEffect } from 'react'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Pilcrow, ChevronDown, Variable, Undo, Redo,
} from 'lucide-react'
import { TEMPLATE_VARIABLES, VARIABLE_CATEGORIES } from '@gomoto/core'
import {
  ContractDocument,
  ContractPage,
  ContractPaginatorPlugin,
  paginatorPluginKey,
  wrapContentInPage,
} from './contractPageExtension'

// ─── Extensão: destaca {{variáveis}} ──────────────────────────────────────────

const VARIABLE_RE = /\{\{[\w_]+\}\}/g
const variablePluginKey = new PluginKey('variableDecorator')

const VariableDecorator = Extension.create({
  name: 'variableDecorator',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: variablePluginKey,
        props: {
          decorations(state) {
            const decorations: Decoration[] = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              VARIABLE_RE.lastIndex = 0
              let match: RegExpExecArray | null
              while ((match = VARIABLE_RE.exec(node.text)) !== null) {
                decorations.push(
                  Decoration.inline(
                    pos + match.index,
                    pos + match.index + match[0].length,
                    { class: 'contract-variable' },
                  ),
                )
              }
            })
            return DecorationSet.create(state.doc, decorations)
          },
        },
      }),
    ]
  },
})

// ─── Barra de ferramentas ──────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active = false,
  disabled = false,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`h-8 w-8 flex items-center justify-center rounded transition-colors ${
        active
          ? 'bg-[#BAFF1A] text-[#121212]'
          : 'text-[#9e9e9e] hover:bg-[#323232] hover:text-[#f5f5f5]'
      } disabled:opacity-30 disabled:cursor-not-allowed`}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-5 bg-[#474747] mx-0.5" />
}

function VariablePickerDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [activeCategory, setActiveCategory] = useState<string>(VARIABLE_CATEGORIES[0])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  function insertVariable(key: string) {
    editor.chain().focus().insertContent(`{{${key}}}`).run()
    setOpen(false)
  }

  const byCategory = TEMPLATE_VARIABLES.filter(v => v.category === activeCategory)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`h-8 flex items-center gap-1.5 px-2.5 rounded text-[12px] font-medium transition-colors ${
          open
            ? 'bg-[#BAFF1A] text-[#121212]'
            : 'text-[#BAFF1A] border border-[#BAFF1A]/40 hover:bg-[#BAFF1A]/10'
        }`}
      >
        <Variable className="w-3.5 h-3.5" />
        Variável
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-9 right-0 z-50 w-80 bg-[#202020] border border-[#474747] rounded-xl shadow-xl overflow-hidden">
          {/* Categorias */}
          <div className="flex border-b border-[#323232] overflow-x-auto">
            {VARIABLE_CATEGORIES.map(cat => (
              <button
                key={cat}
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-2 text-[11px] font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? 'text-[#BAFF1A] border-b-2 border-[#BAFF1A]'
                    : 'text-[#9e9e9e] hover:text-[#f5f5f5]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Variáveis da categoria */}
          <div className="max-h-60 overflow-y-auto p-1">
            {byCategory.map(v => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                className="w-full flex items-start gap-3 px-3 py-2 rounded-lg hover:bg-[#323232] transition-colors text-left"
              >
                <code className="text-[11px] text-[#BAFF1A] font-mono bg-[#121212] border border-[#2a2a2a] rounded px-1.5 py-0.5 mt-0.5 shrink-0">
                  {`{{${v.key}}}`}
                </code>
                <span className="text-[12px] text-[#c7c7c7] leading-tight">{v.label}</span>
              </button>
            ))}
          </div>

          <div className="border-t border-[#323232] px-3 py-2">
            <p className="text-[11px] text-[#616161]">Clique para inserir no cursor</p>
          </div>
        </div>
      )}
    </div>
  )
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="flex items-center gap-0.5 flex-wrap px-3 py-2 border-b border-[#323232] bg-[#1a1a1a] rounded-t-xl">
      {/* Undo / Redo */}
      <ToolbarButton
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().undo()}
        title="Desfazer (Ctrl+Z)"
      >
        <Undo className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().redo()}
        title="Refazer (Ctrl+Y)"
      >
        <Redo className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      {/* Headings + paragraph */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor.isActive('heading', { level: 1 })}
        title="Título 1"
      >
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor.isActive('heading', { level: 2 })}
        title="Título 2"
      >
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor.isActive('heading', { level: 3 })}
        title="Título 3"
      >
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setParagraph().run()}
        active={editor.isActive('paragraph')}
        title="Parágrafo"
      >
        <Pilcrow className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      {/* Formatação inline */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Negrito (Ctrl+B)"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Itálico (Ctrl+I)"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive('underline')}
        title="Sublinhado (Ctrl+U)"
      >
        <UnderlineIcon className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title="Tachado"
      >
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      {/* Alinhamento */}
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        active={editor.isActive({ textAlign: 'left' })}
        title="Alinhar à esquerda"
      >
        <AlignLeft className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        active={editor.isActive({ textAlign: 'center' })}
        title="Centralizar"
      >
        <AlignCenter className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        active={editor.isActive({ textAlign: 'right' })}
        title="Alinhar à direita"
      >
        <AlignRight className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        active={editor.isActive({ textAlign: 'justify' })}
        title="Justificar"
      >
        <AlignJustify className="w-4 h-4" />
      </ToolbarButton>

      <Divider />

      {/* Listas */}
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Lista não ordenada"
      >
        <List className="w-4 h-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Lista numerada"
      >
        <ListOrdered className="w-4 h-4" />
      </ToolbarButton>

      {/* Variáveis — empurrado para a direita */}
      <div className="flex-1" />
      <VariablePickerDropdown editor={editor} />
    </div>
  )
}

// ─── Componente principal ──────────────────────────────────────────────────────

interface ContractTemplateEditorProps {
  initialContent?: Record<string, unknown> | null
  onChange?: (content: Record<string, unknown>) => void
  editable?: boolean
  className?: string
}

export function ContractTemplateEditor({
  initialContent,
  onChange,
  editable = true,
  className = '',
}: ContractTemplateEditorProps) {
  const editor = useEditor({
    extensions: [
      // Substituímos o Document do StarterKit pelo ContractDocument que espera page+
      StarterKit.configure({ document: false }),
      ContractDocument,
      ContractPage,
      Underline,
      TextStyle,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Placeholder.configure({ placeholder: 'Comece a redigir o contrato aqui...' }),
      VariableDecorator,
      // Plugin de paginação automática — adicionado por último
      Extension.create({
        name: 'paginatorWrapper',
        addProseMirrorPlugins: () => [ContractPaginatorPlugin],
      }),
    ],
    content: wrapContentInPage(initialContent ?? null) ?? undefined,
    editable,
    immediatelyRender: false,
    onUpdate({ editor, transaction }) {
      // Ignora transações do paginador (meta via PluginKey) para não disparar save desnecessário
      if (transaction.getMeta(paginatorPluginKey)) return
      onChange?.(editor.getJSON() as Record<string, unknown>)
    },
  })

  if (!editor) return null

  return (
    <div className={`flex flex-col rounded-xl border border-[#323232] overflow-hidden ${className}`}>
      {editable && <EditorToolbar editor={editor} />}

      {/* Canvas: fundo cinza (mesa) — cada .contract-page é uma folha branca */}
      <div className="contract-editor-canvas flex-1 min-h-0 overflow-y-auto" style={{ background: '#c8cdd6', padding: '32px 0' }}>
        <EditorContent editor={editor} />
      </div>
    </div>
  )
}

// Re-export para uso externo
export { Extension } from '@tiptap/core'
export { ContractDocument, ContractPage } from './contractPageExtension'
