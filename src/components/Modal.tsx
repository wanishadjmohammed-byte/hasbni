'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, type ReactNode } from 'react'
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

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
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
            className={`glass relative z-10 w-full ${maxWidth} max-h-[92vh] overflow-hidden rounded-t-3xl sm:rounded-2xl`}
          >
            <div className="flex items-start gap-3 border-b border-white/50 bg-white/20 px-5 py-4 backdrop-blur-sm">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-base font-bold text-navy">{title}</h2>
                {subtitle && <p className="mt-0.5 text-xs font-medium text-navy/50">{subtitle}</p>}
              </div>
              <button
                onClick={onClose}
                aria-label="Fermer"
                className="rounded-xl p-1.5 text-navy/45 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto px-5 py-4">{children}</div>

            {footer && (
              <div className="border-t border-white/50 bg-white/25 px-5 py-3.5 backdrop-blur-sm">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
