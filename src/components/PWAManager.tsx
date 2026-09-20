'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CloudOff, Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '@/context/AppContext'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'hasbni.install.dismissed'
/** On ne redemande pas au serveur s'il y a du neuf plus souvent que ca. */
const UPDATE_CHECK_MS = 60 * 60 * 1000

export default function PWAManager() {
  const { syncStatus, pendingSync } = useApp()
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(true)
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null)
  const lastCheck = useRef(0)

  /**
   * Enregistrement et mise a jour du service worker.
   *
   * (Production uniquement : en dev, le cache des chunks Next entre en conflit
   * avec le rechargement a chaud.)
   *
   * Quatre choses sont necessaires pour qu'une PWA deja installee recoive une
   * mise a jour. Il en manquait quatre.
   *
   *  1. L'URL du script change a chaque deploiement (`?v=<build>`). Sinon le
   *     navigateur compare octet par octet un fichier souvent identique et
   *     conclut qu'il n'y a rien de neuf.
   *  2. `updateViaCache: 'none'` : sans ca, `sw.js` lui-meme peut etre servi
   *     depuis le cache HTTP pendant des heures.
   *  3. Un appel explicite a `update()` au retour au premier plan. Une PWA
   *     installee sur iPhone n'est jamais fermee, seulement suspendue : elle
   *     peut passer des semaines sans jamais verifier.
   *  4. Une invite. Meme installe, le nouveau service worker ATTEND que
   *     l'ancien soit libere — ce qui n'arrive quasiment jamais sur mobile.
   */
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return

    const build = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'
    let registration: ServiceWorkerRegistration | null = null

    const watch = (reg: ServiceWorkerRegistration) => {
      if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting)
      reg.addEventListener('updatefound', () => {
        const installing = reg.installing
        if (!installing) return
        installing.addEventListener('statechange', () => {
          // `controller` absent = toute premiere installation : rien a
          // proposer, l'utilisateur a deja la derniere version.
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            setWaiting(installing)
          }
        })
      })
    }

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register(`/sw.js?v=${build}`, {
          updateViaCache: 'none',
        })
        watch(registration)
      } catch {
        /* pas de service worker : l'app fonctionne, sans hors-ligne */
      }
    }

    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register)

    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastCheck.current < UPDATE_CHECK_MS) return
      lastCheck.current = Date.now()
      void registration?.update().catch(() => undefined)
    }
    document.addEventListener('visibilitychange', checkForUpdate)

    // Le nouveau service worker a pris la main : on recharge pour que la page
    // execute le code correspondant. Le verrou evite la boucle de rechargement.
    let reloading = false
    const onControllerChange = () => {
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      window.removeEventListener('load', register)
      document.removeEventListener('visibilitychange', checkForUpdate)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [])

  const applyUpdate = () => {
    waiting?.postMessage({ type: 'SKIP_WAITING' })
    setWaiting(null)
  }

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === '1')
    const onPrompt = (event: Event) => {
      event.preventDefault()
      setInstallEvent(event as InstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  const install = async () => {
    if (!installEvent) return
    await installEvent.prompt()
    await installEvent.userChoice
    setInstallEvent(null)
  }

  const hideInstall = () => {
    window.localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  const showBanner = Boolean(installEvent) && !dismissed
  const showStatus = syncStatus === 'offline' || syncStatus === 'syncing' || pendingSync > 0

  return (
    <>
      {/* Invite de mise a jour. Sur mobile, un nouveau service worker peut
          attendre indefiniment : l'app n'est jamais vraiment fermee. C'est
          donc a l'utilisateur de declencher la bascule — et ca lui evite
          surtout de devoir supprimer puis reinstaller le raccourci. */}
      <AnimatePresence>
        {waiting && (
          <motion.div
            initial={{ opacity: 0, y: -16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -16 }}
            className="safe-top fixed inset-x-0 top-0 z-[120] flex justify-center px-4"
          >
            <div className="glass flex w-full max-w-md items-center gap-3 rounded-2xl p-3 shadow-lg">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Sparkles size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-navy">Nouvelle version disponible</p>
                <p className="text-[11px] font-medium text-navy/60">
                  Tes donnees sont conservees.
                </p>
              </div>
              <button
                onClick={applyUpdate}
                className="tap shrink-0 rounded-xl bg-brand px-3 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
              >
                Mettre a jour
              </button>
              <button
                onClick={() => setWaiting(null)}
                aria-label="Plus tard"
                className="shrink-0 rounded-lg p-1.5 text-navy/55 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showStatus && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring' as const, stiffness: 420, damping: 30 }}
            style={{ top: 'calc(var(--safe-top) + 0.75rem)' }}
            className="fixed inset-x-0 z-[55] flex justify-center px-4 lg:left-56"
          >
            <div className="glass flex items-center gap-2 rounded-full px-4 py-2">
              {syncStatus === 'offline' ? (
                <CloudOff size={14} className="text-navy/55" />
              ) : (
                <RefreshCw
                  size={14}
                  className={syncStatus === 'syncing' ? 'animate-spin text-brand' : 'text-brand'}
                />
              )}
              <span className="text-xs font-semibold text-navy">
                {syncStatus === 'offline'
                  ? pendingSync > 0
                    ? `Hors ligne — ${pendingSync} a synchroniser`
                    : 'Hors ligne — saisie possible'
                  : pendingSync > 0
                    ? `Synchronisation de ${pendingSync} mouvement${pendingSync > 1 ? 's' : ''}…`
                    : 'Synchronisation…'}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showBanner && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ type: 'spring' as const, stiffness: 340, damping: 28 }}
            style={{ bottom: 'calc(var(--nav-height) + var(--safe-bottom) + 1rem)' }}
            className="fixed inset-x-4 z-[55] mx-auto max-w-sm lg:!bottom-6 lg:left-auto lg:right-6"
          >
            <div className="glass flex items-center gap-3 rounded-2xl p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Download size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-navy">Installer Hasbni</p>
                <p className="text-xs font-medium text-navy/60">
                  Acces hors ligne et ouverture en plein ecran.
                </p>
              </div>
              <button
                onClick={install}
                className="rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
              >
                Installer
              </button>
              <button
                onClick={hideInstall}
                aria-label="Plus tard"
                className="rounded-lg p-1.5 text-navy/55 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <X size={15} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
