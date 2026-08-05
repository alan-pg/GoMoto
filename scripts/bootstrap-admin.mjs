/**
 * Cria o primeiro platform_admin (owner) do GoMoto em producao.
 *
 * Uso:
 *   SUPABASE_URL=https://xxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service_role_key> \
 *   node scripts/bootstrap-admin.mjs <email> <senha>
 *
 * A service_role key fica em:
 *   Supabase Dashboard → Project Settings → API → service_role
 */

import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const [, , email, password] = process.argv

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}
if (!email || !password) {
  console.error('Uso: node scripts/bootstrap-admin.mjs <email> <senha>')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function run() {
  process.stdout.write(`1/2  Criando usuario no Auth (${email})... `)
  const { data, error: authError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (authError) throw new Error(authError.message)
  const userId = data.user.id
  console.log(`ok  (user_id: ${userId})`)

  process.stdout.write('2/2  Registrando como platform_admin owner... ')
  const { error: adminError } = await supabase
    .from('platform_admins')
    .insert({ user_id: userId, role: 'owner' })
  if (adminError) throw new Error(adminError.message)
  console.log('ok')

  console.log(`\nAdmin criado. Login: ${email}\n`)
}

run().catch(err => {
  console.error(`\nErro: ${err.message}\n`)
  process.exit(1)
})
