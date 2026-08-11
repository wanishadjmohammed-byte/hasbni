'use client'

import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { getSupabase, supabaseEnabled } from '@/lib/supabase/client'
import { pageIn } from '@/lib/motion'

type Status = 'loading' | 'need-auth' | 'claiming' | 'done' | 'error'

export default function InviteClient({ token }: { token: string }) {
  const router = useRouter()
  const { ready, signedIn, session } = useAuth()

  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)

  const claim = useCallback(async () => {
    const sb = getSupabase()
    if (!sb) return
    setStatus('claiming')
    // `claim_profile` rattache le profil fantome au compte connecte.
    const { error: rpcError } = await sb.rpc('claim_profile' as never, { token } as never)
    if (rpcError) {
      setError(rpcError.message)
      setStatus('error')
      return
    }
    setStatus('done')
    // Rechargement complet : le profil courant vient de changer d'identifiant.
    setTimeout(() => window.location.replace('/'), 1200)
  }, [token])

  useEffect(() => {
    if (!supabaseEnabled) {
      setError('Les invitations necessitent la configuration Supabase.')
      setStatus('error')
      return
    }
    if (!ready) return
    if (!signedIn || !session) {
      setStatus('need-auth')
      return
    }
    void claim()
  }, [ready, signedIn, session, claim])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <motion.div {...pageIn} className="glass w-full max-w-sm rounded-2xl p-6 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl font-bold text-white shadow-sm shadow-brand/25">
          ح
        </div>

        {(status === 'loading' || status === 'claiming') && (
          <>
            <h1 className="text-lg font-bold text-navy">Invitation Hasbni</h1>
            <p className="mt-2 flex items-center justify-center gap-2 text-xs font-medium text-navy/45">
              <Loader2 size={14} className="animate-spin text-brand" />
              {status === 'claiming' ? 'Rattachement de ton compte…' : 'Verification du lien…'}
            </p>
          </>
        )}

        {status === 'need-auth' && (
          <>
            <h1 className="text-lg font-bold text-navy">Un pote t&apos;a invite</h1>
            <p className="mt-1 text-xs font-medium text-navy/45">
              Connecte-toi ou cree ton compte : tu recuperas directement l&apos;historique de vos
              depenses.
            </p>
            <button
              onClick={() => router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`)}
              className="tap mt-4 w-full rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
            >
              Continuer <ArrowRight size={16} className="ml-1.5" />
            </button>
          </>
        )}

        {status === 'done' && (
          <>
            <div className="mx-auto mt-2 flex h-10 w-10 items-center justify-center rounded-full bg-brand/10 text-brand">
              <CheckCircle2 size={20} />
            </div>
            <h1 className="mt-2 text-lg font-bold text-navy">C&apos;est bon !</h1>
            <p className="mt-1 text-xs font-medium text-navy/45">
              Vos comptes sont relies. Redirection…
            </p>
          </>
        )}

        {status === 'error' && (
          <>
            <div className="mx-auto mt-2 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500">
              <XCircle size={20} />
            </div>
            <h1 className="mt-2 text-lg font-bold text-navy">Invitation refusee</h1>
            <p className="mt-1 text-xs font-medium text-navy/45">{error}</p>
            <button
              onClick={() => router.replace('/')}
              className="tap mt-4 w-full rounded-xl border border-silver px-4 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Retour a l&apos;accueil
            </button>
          </>
        )}
      </motion.div>
    </div>
  )
}
