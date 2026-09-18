'use client'

import { AlertTriangle } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'
import { reportError } from '@/lib/report'

/** Erreur de rendu dans l'espace applicatif : on garde la navigation. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportError(error, { boundary: 'app' })
  }, [error])

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-2xl p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cream text-navy/70">
          <AlertTriangle size={22} />
        </div>
        <p className="text-sm font-bold text-navy">Cet ecran n&apos;a pas pu s&apos;afficher</p>
        <p className="mt-1 text-xs font-medium text-navy/60">
          Rien n&apos;est perdu : tes mouvements sont enregistres. Reessaie, ou reviens a
          l&apos;accueil.
        </p>
        {error.digest && (
          <p className="mt-2 text-[11px] font-medium text-navy/50">Code : {error.digest}</p>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={reset}
            className="tap flex-1 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
          >
            Reessayer
          </button>
          <Link
            href="/"
            className="tap flex items-center rounded-xl border border-silver px-4 text-sm font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
          >
            Accueil
          </Link>
        </div>
      </div>
    </div>
  )
}
