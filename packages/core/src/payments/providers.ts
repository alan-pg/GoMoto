/**
 * Catálogo de gateways de pagamento (ADR 0030).
 *
 * Isto é a metade PURA do contrato de provedor: o que a tela precisa saber para
 * se desenhar, o que a validação precisa saber para recusar entrada, e o que o
 * app mobile precisa saber para pedir o método certo. Sem I/O, então serve os
 * três sem arrastar `fetch` para lugar nenhum.
 *
 * A outra metade — `connect`, `refresh`, `createIntent` — faz I/O e vive em
 * `apps/web/src/lib/payment`. Separar não é cerimônia: é o que permite a tela
 * listar "Cora — conexão por certificado, ainda não conectado" sem que o bundle
 * do cliente carregue o cliente HTTP do Cora.
 *
 * Somar um gateway começa aqui: uma entrada no catálogo. O banco não precisa
 * mudar — `payment_provider_accounts.provider` é texto com CHECK de formato,
 * não lista fechada.
 */

import { z } from 'zod'

/**
 * Meio de pagamento que um gateway sabe GERAR.
 *
 * Distinto de `PaymentMethod` (em `rules/rentals`), que é como o dinheiro
 * chegou — e inclui `cash`, `credit`, `deposit_retention`, coisas que nenhum
 * gateway emite. São conceitos diferentes e os nomes precisam dizer isso.
 *
 * Espelha o CHECK de `payment_intents.method`. Antes disto, `method` era string
 * livre: a rota aceitava `boleto`, o provedor ignorava e gerava PIX, e a
 * confirmação gravava `pix` no razão. Três pontos concordando em silêncio sobre
 * uma coisa que ninguém tinha pedido.
 */
export const GatewayMethodSchema = z.enum(['pix', 'boleto', 'credit_card', 'payment_link'])
export type GatewayMethod = z.infer<typeof GatewayMethodSchema>

/**
 * Como o tenant entrega a credencial ao GoMoto.
 *
 * - `oauth` — redireciona, autoriza, volta com código (Mercado Pago).
 * - `api_key` — cola uma chave num formulário (Asaas, Pagar.me).
 * - `certificate` — chave + certificado mTLS (Cora).
 *
 * Os três valores existem desde já porque a tela decide o que renderizar a
 * partir daqui. Só o caminho `oauth` está implementado — é o do único provedor
 * que existe. O ramo de cada outro entra junto com o provedor que o usa, não
 * antes: formulário sem provedor por trás é a mesma tela que aceita e descarta
 * que este ADR foi escrito para corrigir.
 */
export const ProviderConnectionModeSchema = z.enum(['oauth', 'api_key', 'certificate'])
export type ProviderConnectionMode = z.infer<typeof ProviderConnectionModeSchema>

export type PaymentProviderDescriptor = {
  /** Slug estável. É o que fica gravado em `payment_provider_accounts.provider`. */
  id: string
  /** Nome que o usuário lê. */
  label: string
  /** Uma linha explicando o que o tenant ganha ao conectar. */
  description: string
  connectionMode: ProviderConnectionMode
  /** Meios que ESTE provedor sabe gerar. Validado antes de criar a tentativa. */
  methods: GatewayMethod[]
  /**
   * `false` enquanto a implementação não existe. A tela mostra o provedor como
   * "em breve" em vez de escondê-lo: o tenant vê para onde a integração vai, e
   * ninguém clica num botão que não faz nada.
   */
  available: boolean
}

/**
 * Formato do slug, igual ao CHECK do banco
 * (`payment_provider_accounts_provider_slug`).
 */
export const ProviderIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,31}$/, 'Identificador de provedor inválido')

export const PAYMENT_PROVIDERS: PaymentProviderDescriptor[] = [
  {
    id: 'mercadopago',
    label: 'Mercado Pago',
    description: 'Cobrança Pix com QR code no app do cliente. Conexão pela sua conta Mercado Pago.',
    connectionMode: 'oauth',
    methods: ['pix'],
    available: true,
  },
  {
    id: 'cora',
    label: 'Cora',
    description: 'Conta PJ com Pix e boleto. Você autoriza o GoMoto entrando na sua conta Cora.',
    // Modalidade PARCERIA: OAuth2 authorization_code, sem certificado. O mTLS
    // da Cora é da "Integração Direta", modalidade em que a empresa gerencia a
    // própria conta — não é a nossa. Isto foi corrigido depois de ler a doc:
    // o ADR 0030 tinha registrado 'certificate' por suposição.
    connectionMode: 'oauth',
    methods: ['pix'],
    available: true,
  },
]

export function findPaymentProvider(id: string): PaymentProviderDescriptor | null {
  return PAYMENT_PROVIDERS.find((p) => p.id === id) ?? null
}

/**
 * Descritor de um provedor que já pode ser conectado.
 *
 * Separado de `findPaymentProvider` de propósito: a tela precisa listar o que
 * ainda não está pronto, mas nenhuma escrita pode aceitar um provedor sem
 * implementação por trás.
 */
export function requireAvailableProvider(id: string): PaymentProviderDescriptor {
  const descriptor = findPaymentProvider(id)
  if (!descriptor) throw new Error(`Provedor de pagamento desconhecido: ${id}`)
  if (!descriptor.available) throw new Error(`Provedor ${descriptor.label} ainda não está disponível`)
  return descriptor
}

/** O provedor sabe gerar este meio de pagamento? */
export function supportsMethod(descriptor: PaymentProviderDescriptor, method: string): method is GatewayMethod {
  return (descriptor.methods as string[]).includes(method)
}

/**
 * Uma conta conectada, do ponto de vista de quem lê a tela.
 *
 * `secret_id` não está aqui e nunca estará: a credencial mora no Vault e só sai
 * por `fn_provider_credentials`, server-side. `account_label` está, porque é
 * como o usuário reconhece QUAL conta é aquela — e-mail no Mercado Pago, CNPJ
 * na Cora.
 */
export const ProviderAccountSchema = z.object({
  id: z.string().uuid(),
  provider: ProviderIdSchema,
  external_account_id: z.string(),
  account_label: z.string().nullable(),
  is_default: z.boolean(),
  active: z.boolean(),
})
export type ProviderAccount = z.infer<typeof ProviderAccountSchema>
