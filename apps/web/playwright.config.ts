import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'
import path from 'path'

// Carrega as variáveis de .env.local (URL e anon key do Supabase)
dotenv.config({ path: path.resolve(__dirname, '.env.local') })
// Carrega .env.test para credenciais do usuário de teste
dotenv.config({ path: path.resolve(__dirname, '.env.test'), override: false })

export default defineConfig({
  testDir: './tests',

  // Executa os testes sequencialmente para evitar conflitos de dados no banco
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: 0,

  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    // Projeto de setup: faz login e salva o estado de autenticação
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
    },

    // Projeto principal: roda todos os specs com autenticação já feita
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/.auth/user.json',
      },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
})
