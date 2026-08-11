'use client'

import { AlertTriangle, Loader2 } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import Background from './Background'
import BottomNav from './BottomNav'
import PWAManager from './PWAManager'
import Sidebar from './Sidebar'
import Toasts from './Toasts'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'

/** Ecrans plein ecran, sans navigation. */
const BARE_ROUTES = ['/login', '/offline', '/invite']

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { mode, ready: authReady, signedIn, profileMissing, signOut } = useAuth()
  const { ready: dataReady } = useApp()

  const bare = BARE_ROUTES.some((r) => pathname.startsWith(r))

  // Avec Supabase configure, tout l'espace applicatif exige une session.
  useEffect(() => {
    if (mode === 'demo' || !authReady || bare) return
    if (!signedIn) router.replace('/login')
  }, [mode, authReady, signedIn, bare, router])

  if (bare) {
    return (
      <>
        <Background />
        <main className="relative z-10 min-h-screen">{children}</main>
      </>
    )
  }

  const blocked = mode === 'supabase' && (!authReady || !signedIn || !dataReady)

  return (
    <>
      <Background />
      <Sidebar />
      <BottomNav />
      <Toasts />
      <PWAManager />
      <main className="pad-nav relative z-10 min-h-screen lg:pl-56">
        {/* `safe-x` vit sur ce conteneur sans padding propre : il ajoute les
            encoches sans ecraser ni le px-* des enfants, ni le lg:pl-56. */}
        <div className="safe-x">
          {profileMissing ? (
            <div className="flex min-h-screen items-center justify-center p-6">
              <div className="glass w-full max-w-sm rounded-2xl p-6 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cream text-navy/60">
                  <AlertTriangle size={22} />
                </div>
                <p className="text-sm font-bold text-navy">Profil introuvable</p>
                <p className="mt-1 text-xs font-medium text-navy/45">
                  Ton compte existe, mais aucune ligne dans <code>profiles</code>. Le fichier
                  <code> supabase/schema.sql</code> a-t-il bien ete execute dans l&apos;editeur
                  SQL ?
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => window.location.reload()}
                    className="tap flex-1 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
                  >
                    Reessayer
                  </button>
                  <button
                    onClick={() => void signOut()}
                    className="tap rounded-xl border border-silver px-4 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
                  >
                    Deconnexion
                  </button>
                </div>
              </div>
            </div>
          ) : blocked ? (
            <div className="flex min-h-screen items-center justify-center">
              <div className="glass flex items-center gap-3 rounded-2xl px-5 py-4">
                <Loader2 size={18} className="animate-spin text-brand" />
                <span className="text-sm font-semibold text-navy">Chargement de tes comptes…</span>
              </div>
            </div>
          ) : (
            children
          )}
        </div>
      </main>
    </>
  )
}
