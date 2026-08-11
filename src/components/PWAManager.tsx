'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CloudOff, Download, RefreshCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useApp } from '@/context/AppContext'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'hasbni.install.dismissed'

export default function PWAManager() {
  const { syncStatus, pendingSync } = useApp()
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(true)

  // Enregistrement du service worker (production uniquement : en dev, le cache
  // des chunks Next entre en conflit avec le rechargement a chaud).
  useEffect(() => {
    if (!('serviceWorker' in navigator) || process.env.NODE_ENV !== 'production') return
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register)
    return () => window.removeEventListener('load', register)
  }, [])

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
                <p className="text-xs font-medium text-navy/45">
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
                className="rounded-lg p-1.5 text-navy/35 transition-colors hover:bg-white/50 hover:text-navy"
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
