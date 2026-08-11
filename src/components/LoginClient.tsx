'use client'

import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Eye, EyeOff, Loader2, MailCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { listItemY, listParent, pageIn } from '@/lib/motion'

type Tab = 'signin' | 'signup'

export default function LoginClient() {
  const router = useRouter()
  const { mode, signedIn, signIn, signUp } = useAuth()

  const [tab, setTab] = useState<Tab>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)

  useEffect(() => {
    if (signedIn && mode === 'supabase') router.replace('/')
  }, [signedIn, mode, router])

  const valid =
    mode === 'demo' ||
    (email.trim().length > 3 &&
      password.length >= 6 &&
      (tab === 'signin' || name.trim().length > 0))

  const submit = async () => {
    setError(null)

    // Mode demonstration : pas de backend, on entre directement.
    if (mode === 'demo') {
      router.push('/')
      return
    }
    if (!valid || busy) return

    setBusy(true)
    try {
      if (tab === 'signup') {
        const result = await signUp(name, email, password)
        if (result === 'confirm-email') {
          setConfirmSent(true)
          return
        }
      } else {
        await signIn(email, password)
      }
      router.replace('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Une erreur est survenue')
    } finally {
      setBusy(false)
    }
  }

  const switchTab = (next: Tab) => {
    setTab(next)
    setError(null)
    setConfirmSent(false)
  }

  if (confirmSent) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <motion.div {...pageIn} className="glass w-full max-w-sm rounded-2xl p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
            <MailCheck size={22} />
          </div>
          <h1 className="text-lg font-bold text-navy">Verifie tes emails</h1>
          <p className="mt-1 text-xs font-medium text-navy/45">
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
            <p className="mt-1 text-xs font-medium text-navy/50">
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
                  tab === key ? 'text-white' : 'text-navy/50 hover:text-navy'
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
                  <label className="mb-1.5 block text-xs font-medium text-navy/50">
                    Ton prenom
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Wanis"
                    autoComplete="given-name"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div variants={listItemY}>
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Email</label>
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
              <label className="mb-1.5 block text-xs font-medium text-navy/50">
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
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-navy/35 transition-colors hover:bg-white/50 hover:text-navy"
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
            className="mt-4 text-center text-[11px] font-medium text-navy/40"
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
