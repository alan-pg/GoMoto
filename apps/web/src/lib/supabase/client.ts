/**
 * @file client.ts
 * @description Configuração e instanciação do cliente Supabase para uso no lado do cliente (Client-side).
 * Este módulo utiliza a biblioteca @supabase/ssr para criar uma conexão estável
 * entre o front-end da aplicação GoMoto e o backend as a Service (BaaS) do Supabase.
 */

import { createBrowserClient } from '@supabase/ssr';

/**
 * @function createClient
 * @description Inicializa uma instância única do cliente Supabase configurada especificamente
 * para o ambiente de execução do navegador (Browser).
 * 
 * @returns Uma instância funcional do SupabaseClient configurada com as variáveis de ambiente do projeto.
 */
export function createClient() {
  /**
   * O método createBrowserClient recupera automaticamente as chaves do ambiente configuradas
   * através das variáveis NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.
   * Essas variáveis devem estar presentes no arquivo .env.local para que a conexão funcione.
   */
  /**
   * Fallback de URL e key usados apenas durante o build estático do Next.js,
   * quando o .env.local ainda não foi configurado com os dados reais do Supabase.
   * Em produção, as variáveis de ambiente devem conter URLs válidas do Supabase.
   * A verificação usa uma regex simples para detectar se a URL configurada é um placeholder.
   */
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const rawKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  const isValidUrl = rawUrl.startsWith('https://') || rawUrl.startsWith('http://');
  const supabaseUrl = isValidUrl ? rawUrl : 'https://placeholder.supabase.co';
  const supabaseKey = (rawKey.startsWith('ey') || rawKey.startsWith('sb_')) ? rawKey : 'placeholder-anon-key';

  return createBrowserClient(supabaseUrl, supabaseKey);
}
