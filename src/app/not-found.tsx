import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="glass w-full max-w-sm rounded-2xl p-6 text-center">
        <p className="text-3xl font-bold text-navy">404</p>
        <p className="mt-2 text-sm font-bold text-navy">Cette page n&apos;existe pas</p>
        <p className="mt-1 text-xs font-medium text-navy/60">
          Le lien est peut-etre perime, ou la relation a ete supprimee.
        </p>
        <Link
          href="/"
          className="tap mt-4 inline-flex items-center rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
        >
          Retour a l&apos;accueil
        </Link>
      </div>
    </div>
  )
}
