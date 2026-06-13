import type { Session } from '@supabase/supabase-js'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

import { supabase } from '../lib/supabase'

type AuthContextValue = {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
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

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
    })

    return () => {
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

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth precisa ser usado dentro de <AuthProvider>')
  return ctx
}
