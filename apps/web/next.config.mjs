const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const supabaseHttpOrigin = supabaseUrl ? new URL(supabaseUrl).origin : ''
const supabaseWsOrigin = supabaseHttpOrigin.replace(/^http/, 'ws')

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${supabaseHttpOrigin} https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://unpkg.com`,
  `connect-src 'self' ${supabaseHttpOrigin} ${supabaseWsOrigin}`,
  "frame-ancestors 'none'",
].join('; ')

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@gomoto/core'],
  // pdf-parse@2 usa pdfjs-dist@5 (ESM puro). O webpack do Next quebra ao tentar empacotar
  // — externalizamos para que o Node faça o require em runtime no route handler.
  experimental: {
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-XSS-Protection', value: '1; mode=block' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
}

export default nextConfig