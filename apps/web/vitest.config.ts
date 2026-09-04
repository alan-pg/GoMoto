import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // apps/web/tests/**  são specs Playwright (@playwright/test), não Vitest —
    // manter os dois runners isolados por diretório.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
})
