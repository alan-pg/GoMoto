/**
 * @file server.ts
 * @description Configuração e instanciação do cliente Supabase para execução no lado do servidor (Server-side).
 * Essencial para operações realizadas em Server Components, Server Actions e Route Handlers do Next.js.
 * Utiliza o @supabase/ssr para gerenciar a persistência da sessão via Cookies.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * @function createClient
 * @description Cria uma instância do cliente Supabase injetando o gerenciamento de cookies do Next.js.
 * Isso permite que o servidor leia e escreva tokens de autenticação diretamente no navegador do usuário.
 * 
 * @returns Uma instância do SupabaseClient configurada para operações no servidor.
 */
export async function createClient() {
  /**
   * @constant cookieStore
   * @description Acessa a API de cookies do cabeçalho da requisição atual do Next.js.
   * Usamos await para garantir compatibilidade com Next.js 15+ (onde cookies() é uma Promise).
   */
  const cookieStore = await cookies();

  /**
   * Fallback de URL e key usados apenas durante o build estático do Next.js,
   * quando o .env.local ainda não foi configurado com os dados reais do Supabase.
   * A verificação detecta se a variável contém um valor de placeholder (não uma URL real).
   */
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const isValidUrl = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
  const supabaseUrl = isValidUrl ? rawUrl : 'https://placeholder.supabase.co';
  const supabaseKey = (rawKey.startsWith('ey') || rawKey.startsWith('sb_')) ? rawKey : 'placeholder-anon-key';

  return createServerClient(
    supabaseUrl,
    supabaseKey,
    {
      cookies: {
        /**
         * @method getAll
         * @description Recupera todos os cookies disponíveis no cabeçalho da requisição.
         * @returns Lista completa de cookies.
         */
        getAll() {
          return cookieStore.getAll();
        },
        /**
         * @method setAll
         * @description Define novos cookies no navegador através da resposta do servidor.
         * @param cookiesToSet - Array de objetos contendo nome, valor e opções do cookie.
         */
        setAll(cookiesToSet) {
          try {
            /**
             * Itera sobre cada cookie fornecido pelo Supabase para gravação.
             * Nota: Em Server Components (RSC), o 'set' pode falhar se a resposta já tiver sido enviada.
             */
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            /**
             * Silencia erros de gravação em RSC, pois o gerenciamento de middleware cuidará
             * da atualização dos tokens quando necessário.
             */
          }
        },
      },
    }
  );
}
