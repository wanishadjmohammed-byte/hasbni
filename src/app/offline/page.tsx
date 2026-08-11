import { CloudOff } from 'lucide-react'
import Link from 'next/link'

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-2xl p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
          <CloudOff size={22} />
        </div>
        <h1 className="text-lg font-bold text-navy">Pas de reseau</h1>
        <p className="mt-1 text-xs font-medium text-navy/45">
          Cette page n&apos;est pas encore en cache. Tes ecrans deja ouverts restent accessibles, et
          les depenses saisies hors ligne partiront des le retour du reseau.
        </p>
        <Link
          href="/"
          className="mt-4 inline-flex rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
        >
          Retour a l&apos;accueil
        </Link>
      </div>
    </div>
  )
}
