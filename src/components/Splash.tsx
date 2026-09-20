'use client'

import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import Image from 'next/image'
import { useEffect, useState } from 'react'

/**
 * Ecran de demarrage.
 *
 * Le logo EST une piece : un disque a bord marque, avec des pieces d'or
 * dedans. On l'a donc fait atterrir comme une piece — une rotation sur l'axe
 * vertical, en perspective, qui s'arrete de face. Aucune librairie 3D : des
 * transformations CSS, que le compositeur du navigateur gere sur le GPU. Le
 * cout est nul et la sensation tient.
 *
 * Deux details qui separent un splash d'un bug visuel :
 *
 *  - une DUREE MINIMALE. Sans elle, un demarrage rapide produit un
 *    clignotement, pire que pas de splash du tout.
 *  - une SORTIE animee. Disparaitre d'un coup casse la continuite.
 *
 * `prefers-reduced-motion` coupe tout mouvement : le splash reste, immobile.
 */
const MIN_VISIBLE_MS = 1400

/** Les pieces partent de derriere le logo et montent en tournant. */
const COINS = [
  { left: '18%', delay: 0.25, size: 26, drift: -14, duration: 2.6 },
  { left: '30%', delay: 0.75, size: 18, drift: 10, duration: 3.1 },
  { left: '48%', delay: 0.1, size: 22, drift: -6, duration: 2.9 },
  { left: '66%', delay: 0.55, size: 30, drift: 16, duration: 2.7 },
  { left: '80%', delay: 0.95, size: 20, drift: -10, duration: 3.3 },
]

function Coin({
  left,
  delay,
  size,
  drift,
  duration,
}: {
  left: string
  delay: number
  size: number
  drift: number
  duration: number
}) {
  return (
    <motion.span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-[38%]"
      style={{ left, width: size, height: size, transformStyle: 'preserve-3d' }}
      initial={{ opacity: 0, y: 0, x: 0 }}
      animate={{ opacity: [0, 1, 1, 0], y: [-10, -190], x: [0, drift] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeOut', times: [0, 0.15, 0.7, 1] }}
    >
      <motion.span
        className="block h-full w-full rounded-full"
        style={{
          // Le degre oblique simule la lumiere rasante sur la tranche ;
          // combine a la rotation, l'oeil lit un volume.
          background:
            'linear-gradient(145deg, #FFE08A 0%, #F5B62C 45%, #C9860E 75%, #FFD976 100%)',
          boxShadow: '0 2px 6px rgba(11,58,43,0.28), inset 0 0 0 1.5px rgba(255,255,255,0.45)',
          transformStyle: 'preserve-3d',
        }}
        animate={{ rotateY: [0, 360] }}
        transition={{ duration: duration * 0.45, delay, repeat: Infinity, ease: 'linear' }}
      />
    </motion.span>
  )
}

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
          exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 1.05 }}
          transition={{ duration: reduced ? 0.15 : 0.5, ease: [0.4, 0, 0.2, 1] }}
          className="fixed inset-0 z-[200] flex flex-col items-center justify-center overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #E9FFF4 0%, #A9FBD7 45%, #E4EEE8 100%)',
            perspective: 900,
          }}
          aria-hidden="true"
        >
          {/* Halo : reprend les blobs du fond de l'app, en plus concentre, pour
              que l'entree dans l'app soit continue. */}
          {!reduced && (
            <motion.div
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 0.8, scale: 1 }}
              transition={{ duration: 1.2, ease: 'easeOut' }}
              className="pointer-events-none absolute h-[440px] w-[440px] rounded-full"
              style={{
                background: 'radial-gradient(circle, #A9FBD7 0%, rgba(233,255,244,0) 70%)',
                filter: 'blur(24px)',
              }}
            />
          )}

          {!reduced && COINS.map((c) => <Coin key={c.left} {...c} />)}

          {/* Le logo tombe de face apres un demi-tour, puis respire. */}
          <motion.div
            className="relative"
            style={{ transformStyle: 'preserve-3d' }}
            initial={reduced ? false : { rotateY: -180, scale: 0.55, opacity: 0, y: -26 }}
            animate={{ rotateY: 0, scale: 1, opacity: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 90, damping: 14, mass: 0.9 }}
          >
            <motion.div
              style={{ transformStyle: 'preserve-3d' }}
              animate={
                reduced
                  ? undefined
                  : { rotateY: [0, 7, 0, -7, 0], rotateX: [0, -4, 0, 4, 0], y: [0, -7, 0] }
              }
              transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
            >
              <Image
                src="/icon-512.png"
                alt=""
                width={148}
                height={148}
                priority
                className="h-[148px] w-[148px] rounded-full"
                style={{ filter: 'drop-shadow(0 18px 28px rgba(11,58,43,0.30))' }}
              />
            </motion.div>
          </motion.div>

          <motion.div
            initial={reduced ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.55, ease: 'easeOut' }}
            className="relative mt-6 text-center"
          >
            <p className="text-2xl font-bold tracking-tight text-navy">Hasbni</p>
            <p className="mt-0.5 text-sm font-semibold text-navy/60" lang="ar" dir="rtl">
              حسبني
            </p>
          </motion.div>

          {/* Barre indeterminee : elle dit « ca travaille » sans promettre une
              progression qu'on ne sait pas mesurer. */}
          <motion.div
            initial={reduced ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.85 }}
            className="relative mt-8 h-[3px] w-28 overflow-hidden rounded-full bg-navy/10"
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
            transition={{ duration: 0.4, delay: 1 }}
            className="absolute bottom-10 text-xs font-medium text-navy/60"
          >
            Qui doit quoi, sans prise de tete.
          </motion.p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
