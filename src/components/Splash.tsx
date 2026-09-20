'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useState } from 'react'

/**
 * Ecran de demarrage.
 *
 * Il remplace le bandeau « Chargement de tes comptes… », qui apparaissait au
 * milieu d'une page vide et donnait l'impression d'une app qui rame plutot que
 * d'une app qui s'ouvre.
 *
 * Deux details qui font la difference entre un splash et un bug visuel :
 *
 *  - une DUREE MINIMALE. Sans elle, un demarrage rapide produit un
 *    clignotement — pire que pas de splash du tout. On garde l'ecran au moins
 *    le temps que l'animation d'entree se termine.
 *  - une SORTIE animee. Disparaitre d'un coup casse la continuite ; on fond
 *    vers l'app en laissant le logo monter legerement.
 *
 * `prefers-reduced-motion` desactive tout : le splash reste, immobile.
 */
const MIN_VISIBLE_MS = 900

export default function Splash({ show }: { show: boolean }) {
  const reduced = useReducedMotion()
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), MIN_VISIBLE_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const visible = show || !elapsed

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="splash"
          initial={{ opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
          transition={{ duration: reduced ? 0.15 : 0.45, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #E9FFF4 0%, #A9FBD7 45%, #E4EEE8 100%)',
          }}
          aria-hidden="true"
        >
          {/* Halo derriere le logo : reprend les blobs du fond de l'app, en
              plus concentre, pour que l'entree dans l'app soit continue. */}
          {!reduced && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.75, scale: 1 }}
              transition={{ duration: 1.1, ease: 'easeOut' }}
              className="pointer-events-none absolute h-[420px] w-[420px] rounded-full"
              style={{
                background: 'radial-gradient(circle, #A9FBD7 0%, rgba(233,255,244,0) 70%)',
                filter: 'blur(20px)',
              }}
            />
          )}

          <motion.div
            initial={reduced ? false : { scale: 0.7, opacity: 0, y: 8 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
            className="relative flex h-20 w-20 items-center justify-center rounded-[26px] bg-brand text-4xl font-bold text-white shadow-xl shadow-brand/30"
          >
            ح
          </motion.div>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.22, ease: 'easeOut' }}
            className="relative mt-5 text-center"
          >
            <p className="text-2xl font-bold tracking-tight text-navy">Hasbni</p>
            <p className="mt-1 text-sm font-semibold text-navy/60" lang="ar" dir="rtl">
              حسبني
            </p>
          </motion.div>

          {/* Barre indeterminee : elle dit « ca travaille » sans promettre une
              progression qu'on ne sait pas mesurer. */}
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className="relative mt-9 h-[3px] w-28 overflow-hidden rounded-full bg-navy/10"
          >
            {!reduced && (
              <motion.span
                className="absolute inset-y-0 w-1/2 rounded-full bg-brand"
                animate={{ x: ['-100%', '200%'] }}
                transition={{ duration: 1.25, repeat: Infinity, ease: 'easeInOut' }}
              />
            )}
          </motion.div>

          <motion.p
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.7 }}
            className="absolute bottom-10 text-xs font-medium text-navy/60"
          >
            Qui doit quoi, sans prise de tete.
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
