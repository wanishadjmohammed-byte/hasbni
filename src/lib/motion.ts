import type { Variants } from 'framer-motion'

export const EASE = [0.25, 0.46, 0.45, 0.94] as const

/** Entree de page. */
export const pageIn = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.32, ease: EASE },
}

/** Hover des cartes. */
export const cardHover = {
  whileHover: { y: -4, scale: 1.015 },
  transition: { type: 'spring' as const, stiffness: 500, damping: 28 },
}

/** Modale. */
export const modalIn = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { type: 'spring' as const, stiffness: 340, damping: 28 },
}

export const backdropIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.18 },
}

/** Listes en cascade. */
export const listParent: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
}

export const listItemY: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 420, damping: 30 },
  },
}

export const listItemX: Variants = {
  hidden: { opacity: 0, x: -12 },
  show: {
    opacity: 1,
    x: 0,
    transition: { type: 'spring' as const, stiffness: 420, damping: 30 },
  },
}
