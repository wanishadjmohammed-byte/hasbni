'use client'

import type { Session } from '@supabase/supabase-js'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { getSupabase, supabaseEnabled } from '@/lib/supabase/client'
import { fetchMyProfileId } from '@/lib/supabase/repo'
import type { ID } from '@/lib/types'

/** Resultat d'une inscription : soit on est connecte, soit il faut confirmer. */
export type SignUpResult = 'signed-in' | 'confirm-email'

interface AuthContextValue {
  /** `demo` : aucune variable Supabase, tout tourne en local. */
  mode: 'demo' | 'supabase'
  ready: boolean
  session: Session | null
  profileId: ID | null
  signedIn: boolean
  /** Connecte, mais aucun profil en base : schema non execute ou trigger absent. */
  profileMissing: boolean
  signUp: (name: string, email: string, password: string) => Promise<SignUpResult>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** Messages Supabase (anglais) traduits pour l'utilisateur. */
function translateError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email ou mot de passe incorrect.'
  if (m.includes('email not confirmed')) return 'Confirme ton email avant de te connecter.'
  if (m.includes('user already registered') || m.includes('already been registered')) {
    return 'Un compte existe deja avec cet email — connecte-toi.'
  }
  if (m.includes('password should be at least')) {
    return 'Le mot de passe doit faire au moins 6 caracteres.'
  }
  if (m.includes('unable to validate email') || m.includes('invalid email')) {
    return 'Adresse email invalide.'
  }
  // Quota d'envoi d'emails du projet Supabase (~2/heure sur le SMTP partage) :
  // ce n'est pas l'utilisateur qui insiste, c'est le projet qui est plafonne.
  if (m.includes('email rate limit') || m.includes('over_email_send_rate_limit')) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(
        '[Hasbni] Quota d’emails Supabase atteint. Pour creer des comptes sans email : ' +
          'Authentication > Sign In / Providers > Email > desactiver « Confirm email ».'
      )
    }
    return "Le service d'email est sature pour le moment. Reessaie dans une heure, ou demande a l'administrateur de desactiver la confirmation par email."
  }
  if (m.includes('rate limit') || m.includes('too many requests')) {
    return 'Trop de tentatives — reessaie dans un moment.'
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Pas de reseau — verifie ta connexion.'
  }
  return message
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profileId, setProfileId] = useState<ID | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)
  const [ready, setReady] = useState(!supabaseEnabled)

  useEffect(() => {
    const sb = getSupabase()
    if (!sb) return

    let active = true

    sb.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setReady(true)
    })

    const { data: sub } = sb.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setReady(true)
    })

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [])

  // Le profil est cree par trigger a l'inscription ; on le resout apres login.
  useEffect(() => {
    const sb = getSupabase()
    if (!sb || !session?.user) {
      setProfileId(null)
      setProfileMissing(false)
      return
    }
    let active = true

    const resolve = async (attempt = 0): Promise<void> => {
      try {
        const id = await fetchMyProfileId(sb, session.user.id)
        if (!active) return
        if (id) {
          setProfileId(id)
          setProfileMissing(false)
          return
        }
        // Juste apres l'inscription, le trigger peut ne pas avoir fini.
        if (attempt < 5) {
          setTimeout(() => void resolve(attempt + 1), 400 * (attempt + 1))
        } else {
          // Au-dela : le schema n'a probablement jamais ete execute.
          setProfileMissing(true)
        }
      } catch {
        if (!active) return
        setProfileId(null)
        if (attempt >= 5) setProfileMissing(true)
        else setTimeout(() => void resolve(attempt + 1), 400 * (attempt + 1))
      }
    }

    void resolve()
    return () => {
      active = false
    }
  }, [session])

  const signUp = useCallback(
    async (name: string, email: string, password: string): Promise<SignUpResult> => {
      const sb = getSupabase()
      if (!sb) return 'signed-in'

      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
        // Repris par le trigger `handle_new_user` pour nommer le profil.
        options: { data: { name: name.trim() } },
      })
      if (error) throw new Error(translateError(error.message))

      // Sans session, c'est que la confirmation par email est activee.
      return data.session ? 'signed-in' : 'confirm-email'
    },
    []
  )

  const signIn = useCallback(async (email: string, password: string) => {
    const sb = getSupabase()
    if (!sb) return
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password })
    if (error) throw new Error(translateError(error.message))
  }, [])

  const signOut = useCallback(async () => {
    const sb = getSupabase()
    if (!sb) return
    await sb.auth.signOut()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      mode: supabaseEnabled ? 'supabase' : 'demo',
      ready,
      session,
      profileId,
      signedIn: supabaseEnabled ? Boolean(session) : true,
      profileMissing,
      signUp,
      signIn,
      signOut,
    }),
    [ready, session, profileId, profileMissing, signUp, signIn, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth doit etre utilise dans <AuthProvider>')
  return ctx
}
