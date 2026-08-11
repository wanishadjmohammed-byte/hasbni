'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
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
                {subtitle && <p className="mt-0.5 text-xs font-medium text-navy/50">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Fermer"
                className="tap -mr-1.5 flex items-center justify-center rounded-xl text-navy/45 transition-colors hover:bg-white/50 hover:text-navy"
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
