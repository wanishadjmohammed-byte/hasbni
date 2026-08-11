'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, XCircle } from 'lucide-react'
import { useApp } from '@/context/AppContext'

const icons = {
  success: CheckCircle2,
  info: Info,
  danger: XCircle,
}

const tones = {
  success: 'text-brand',
  info: 'text-navy/60',
  danger: 'text-red-500',
}

export default function Toasts() {
  const { toasts, dismissToast } = useApp()

  return (
    <div
      style={{ bottom: 'calc(var(--nav-height) + var(--safe-bottom) + 1rem)' }}
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 lg:!bottom-6 lg:left-56"
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icons[t.tone]
          return (
            <motion.button
              key={t.id}
              layout
              initial={{ opacity: 0, y: 16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ type: 'spring' as const, stiffness: 420, damping: 30 }}
              onClick={() => dismissToast(t.id)}
              className="glass pointer-events-auto flex items-center gap-2.5 rounded-2xl px-4 py-3 text-left"
            >
              <Icon size={17} className={tones[t.tone]} />
              <span className="text-sm font-semibold text-navy">{t.message}</span>
            </motion.button>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
