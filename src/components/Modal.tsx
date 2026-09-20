'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { backdropIn, modalIn } from '@/lib/motion'

export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  // `<main>` porte un `z-10` : il cree un contexte d'empilement dont un enfant
  // ne peut jamais sortir, meme en z-50. On rend donc la modale dans <body>.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const panel = useRef<HTMLDivElement | null>(null)
  const restoreFocus = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return

    // Le focus restait derriere la modale : au clavier on continuait a
    // parcourir la page en dessous (audit UX-7).
    restoreFocus.current = document.activeElement as HTMLElement | null
    const focusables = () =>
      Array.from(
        panel.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((el) => el.offsetParent !== null)

    const timer = window.setTimeout(() => focusables()[0]?.focus(), 50)

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusables()
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
      restoreFocus.current?.focus?.()
    }
  }, [open, onClose])

  const maxWidth = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : 'max-w-md'

  if (!mounted) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            {...backdropIn}
            onClick={onClose}
            className="absolute inset-0 bg-navy/25 backdrop-blur-[3px]"
          />
          <motion.div
            {...modalIn}
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            /* `dvh` suit la hauteur reelle du viewport quand la barre d'URL
               mobile se retracte — `vh` deborderait sous l'ecran. */
            className={`glass relative z-10 flex w-full ${maxWidth} max-h-[90dvh] flex-col overflow-hidden rounded-t-3xl sm:max-h-[85dvh] sm:rounded-2xl`}
          >
            {/* Poignee : repere visuel de feuille glissante sur mobile */}
            <div className="flex justify-center pt-2 sm:hidden">
              <span className="h-1 w-9 rounded-full bg-navy/15" />
            </div>

            <div className="flex items-start gap-3 border-b border-white/50 bg-white/20 px-5 py-3.5 backdrop-blur-sm sm:py-4">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-navy">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs font-medium text-navy/60">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Fermer"
                className="tap -mr-1.5 flex items-center justify-center rounded-xl text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

            {footer && (
              <div className="safe-bottom-plus border-t border-white/50 bg-white/25 px-5 pt-3.5 backdrop-blur-sm">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  )
}
