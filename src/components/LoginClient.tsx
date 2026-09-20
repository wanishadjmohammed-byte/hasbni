'use client'

import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Check, Eye, EyeOff, Loader2, MailCheck, X } from 'lucide-react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getSupabase } from '@/lib/supabase/client'
import { isUsernameAvailable } from '@/lib/supabase/repo'
import { listItemY, listParent, pageIn } from '@/lib/motion'

type Tab = 'signin' | 'signup'

export default function LoginClient() {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Redirection apres connexion : sert au parcours d'invitation.
  const next = searchParams.get('next') || '/'
  const { mode, signedIn, signIn, signUp } = useAuth()

  const [tab, setTab] = useState<Tab>('signin')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  /** null = pas encore verifie. */
  const [available, setAvailable] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)

  useEffect(() => {
    if (signedIn && mode === 'supabase') router.replace(next)
  }, [signedIn, mode, router, next])

  const usernameOk = /^[a-z0-9_.]{3,20}$/.test(username)
  const controller = useRef<AbortController | null>(null)

  /**
   * Disponibilite verifiee pendant la frappe.
   *
   * Anti-rebond de 400 ms et abandon de la requete precedente : sinon chaque
   * caractere part en requete, et une reponse lente peut ecraser une plus
   * recente — afficher « libre » pour un pseudo deja pris.
   *
   * Cote serveur c'est un `exists` sur l'index unique qui ne renvoie qu'un
   * booleen : l'appel le moins cher possible.
   */
  useEffect(() => {
    if (tab !== 'signup' || !usernameOk || mode === 'demo') {
      controller.current?.abort()
      setAvailable(null)
      setChecking(false)
      return
    }

    setChecking(true)
    const timer = window.setTimeout(async () => {
      controller.current?.abort()
      const next = new AbortController()
      controller.current = next
      const sb = getSupabase()
      if (!sb) return
      try {
        const free = await isUsernameAvailable(sb, username, next.signal)
        if (!next.signal.aborted) setAvailable(free)
      } catch {
        if (!next.signal.aborted) setAvailable(null)
      } finally {
        if (!next.signal.aborted) setChecking(false)
      }
    }, 400)

    return () => window.clearTimeout(timer)
  }, [username, usernameOk, tab, mode])

  useEffect(() => () => controller.current?.abort(), [])

  const valid =
    mode === 'demo' ||
    (email.trim().length > 3 &&
      password.length >= 6 &&
      (tab === 'signin' || (name.trim().length > 0 && usernameOk && available === true)))

  const submit = async () => {
    setError(null)

    // Mode demonstration : pas de backend, on entre directement.
    if (mode === 'demo') {
      router.push(next)
      return
    }
    if (!valid || busy) return

    setBusy(true)
    try {
      if (tab === 'signup') {
        const result = await signUp(name, email, password, username)
        if (result === 'confirm-email') {
          setConfirmSent(true)
          return
        }
      } else {
        await signIn(email, password)
      }
      router.replace(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue')
    } finally {
      setBusy(false)
    }
  }

  const switchTab = (target: Tab) => {
    setTab(target)
    setError(null)
    setConfirmSent(false)
    setAvailable(null)
  }

  if (confirmSent) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <motion.div {...pageIn} className="glass w-full max-w-sm rounded-2xl p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <MailCheck size={22} />
          </div>
          <h1 className="text-lg font-bold text-navy">Verifie tes emails</h1>
          <p className="mt-1 text-xs font-medium text-navy/60">
            On a envoye un lien de confirmation a <span className="font-semibold">{email}</span>.
            Clique dessus, puis reviens te connecter.
          </p>
          <button
            onClick={() => {
              setConfirmSent(false)
              setTab('signin')
            }}
            className="mt-4 w-full rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
          >
            Retour a la connexion
          </button>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <motion.div {...pageIn} className="glass w-full max-w-sm rounded-2xl p-6">
        <motion.div variants={listParent} initial="hidden" animate="show">
          <motion.div variants={listItemY} className="mb-6 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-white shadow-sm shadow-brand/25">
              ح
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-navy">Hasbni</h1>
            <p className="mt-1 text-xs font-medium text-navy/60">
              Qui doit quoi, sans prise de tete.
            </p>
          </motion.div>

          <motion.div variants={listItemY} className="glass-sm mb-4 flex gap-1 rounded-xl p-1">
            {(
              [
                ['signin', 'Connexion'],
                ['signup', 'Inscription'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => switchTab(key)}
                className={clsx(
                  'relative flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors',
                  tab === key ? 'text-white' : 'text-navy/60 hover:text-navy'
                )}
              >
                {tab === key && (
                  <motion.span
                    layoutId="login-tab"
                    transition={{ type: 'spring' as const, stiffness: 500, damping: 30 }}
                    className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/25"
                  />
                )}
                <span className="relative z-10">{label}</span>
              </button>
            ))}
          </motion.div>

          <div className="space-y-3">
            <AnimatePresence initial={false}>
              {tab === 'signup' && (
                <motion.div
                  key="name"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <label className="mb-1.5 block text-xs font-medium text-navy/60">
                    Ton prenom
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Wanis"
                    autoComplete="given-name"
                  />

                  <label
                    htmlFor="signup-username"
                    className="mb-1.5 mt-3 block text-xs font-medium text-navy/60"
                  >
                    Ton pseudo
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-navy/55">
                      @
                    </span>
                    <input
                      id="signup-username"
                      type="text"
                      value={username}
                      maxLength={20}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoComplete="username"
                      // Le serveur n'accepte que ce jeu de caracteres : on
                      // l'applique a la frappe plutot que de refuser apres coup.
                      onChange={(e) =>
                        setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))
                      }
                      placeholder="youba"
                      className="!pl-7 !pr-9"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2">
                      {checking ? (
                        <Loader2 size={15} className="animate-spin text-brand" />
                      ) : available === true ? (
                        <Check size={15} className="text-credit" />
                      ) : available === false ? (
                        <X size={15} className="text-debit" />
                      ) : null}
                    </span>
                  </div>
                  <p
                    className={clsx(
                      'mt-1 text-[11px] font-medium',
                      available === false ? 'text-debit' : 'text-navy/60'
                    )}
                    aria-live="polite"
                  >
                    {username.length === 0
                      ? "C'est par la que tes potes te trouveront."
                      : !usernameOk
                        ? '3 a 20 caracteres : lettres, chiffres, point ou tiret bas.'
                        : checking
                          ? 'Verification…'
                          : available === false
                            ? 'Deja pris — essaie autre chose.'
                            : available === true
                              ? 'Libre !'
                              : ''}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={listItemY}>
              <label className="mb-1.5 block text-xs font-medium text-navy/60">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="toi@exemple.dz"
                autoComplete="email"
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </motion.div>

            <motion.div variants={listItemY}>
              <label className="mb-1.5 block text-xs font-medium text-navy/60">
                Mot de passe
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="6 caracteres minimum"
                  autoComplete={tab === 'signup' ? 'new-password' : 'current-password'}
                  className="!pr-10"
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  aria-label={showPassword ? 'Masquer' : 'Afficher'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-navy/55 transition-colors hover:bg-white/50 hover:text-navy"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </motion.div>
          </div>

          {error && (
            <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-500">
              {error}
            </p>
          )}

          <motion.button
            variants={listItemY}
            whileTap={{ scale: 0.98 }}
            onClick={() => void submit()}
            disabled={busy || !valid}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <>
                {mode === 'demo' ? 'Entrer' : tab === 'signin' ? 'Se connecter' : 'Creer mon compte'}
                <ArrowRight size={16} />
              </>
            )}
          </motion.button>

          <motion.p
            variants={listItemY}
            className="mt-4 text-center text-[11px] font-medium text-navy/60"
          >
            {mode === 'demo' ? (
              'Mode demonstration — aucune donnee n’est envoyee.'
            ) : tab === 'signin' ? (
              <>
                Pas encore de compte ?{' '}
                <button onClick={() => switchTab('signup')} className="font-semibold text-brand">
                  Inscris-toi
                </button>
              </>
            ) : (
              <>
                Deja inscrit ?{' '}
                <button onClick={() => switchTab('signin')} className="font-semibold text-brand">
                  Connecte-toi
                </button>
              </>
            )}
          </motion.p>
        </motion.div>
      </motion.div>
    </div>
  )
}
