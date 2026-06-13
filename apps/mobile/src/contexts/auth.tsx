import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import * as Linking from 'expo-linking'

import { supabase } from '../lib/supabase'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  needsPasswordSetup: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  setPassword: (password: string) => Promise<{ error: string | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const NOT_A_CUSTOMER_ERROR = 'Esta conta não tem acesso ao app.'

async function isCustomer(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('customers')
    .select('id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle()
  return data !== null
}

// Magic link da invite vem como `gomoto://auth-callback#access_token=...&refresh_token=...&type=invite`.
// Em Expo Go o scheme é trocado para `exp://` — o handler tolera ambos extraindo só o fragmento.
async function consumeAuthCallback(url: string | null): Promise<void> {
  if (!url) return
  const hashIdx = url.indexOf('#')
  if (hashIdx === -1) return
  const params = new URLSearchParams(url.slice(hashIdx + 1))
  const accessToken = params.get('access_token')
  const refreshToken = params.get('refresh_token')
  if (!accessToken || !refreshToken) return
  await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (data.session && !(await isCustomer(data.session.user.id))) {
        await supabase.auth.signOut()
        setSession(null)
      } else {
        setSession(data.session)
      }
      setLoading(false)
    })

    Linking.getInitialURL().then(consumeAuthCallback)
    const linkingSub = Linking.addEventListener('url', (event) => {
      void consumeAuthCallback(event.url)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
      linkingSub.remove()
      sub.subscription.unsubscribe()
    }
  }, [])

  async function signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) return { error: error.message }

    if (data.user && !(await isCustomer(data.user.id))) {
      await supabase.auth.signOut()
      return { error: NOT_A_CUSTOMER_ERROR }
    }

    return { error: null }
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function setPassword(password: string) {
    const { error } = await supabase.auth.updateUser({
      password,
      data: { password_set: true },
    })
    if (error) return { error: error.message }
    // updateUser não emite SIGNED_IN; força refresh do session para o gate ver o flag novo.
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
    return { error: null }
  }

  const needsPasswordSetup =
    !!session && session.user.user_metadata?.password_set !== true

  return (
    <AuthContext.Provider
      value={{ session, loading, needsPasswordSetup, signIn, signOut, setPassword }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa ser usado dentro de <AuthProvider>')
  return ctx
}
