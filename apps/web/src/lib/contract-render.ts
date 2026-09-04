import { generateHTML } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import { ContractDocument, ContractPage, wrapContentInPage } from '@/app/(dashboard)/contratos/modelos/_components/contractPageExtension'

// Mesmo conjunto de extensões do editor — necessário para serializar page nodes corretamente
const EXTENSIONS = [
  StarterKit.configure({ document: false }),
  ContractDocument,
  ContractPage,
  Underline,
  TextStyle,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
]

/** Converte o conteúdo Tiptap (JSON) de um modelo de contrato em HTML — usado tanto no preview de modelos quanto na geração de contrato de uma locação real. */
export function renderContractTemplateHtml(content: Record<string, unknown> | null): string | null {
  const normalizedContent = wrapContentInPage(content)
  if (!normalizedContent) return null
  return generateHTML(normalizedContent as Parameters<typeof generateHTML>[0], EXTENSIONS)
}
