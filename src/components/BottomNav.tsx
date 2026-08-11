'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from './nav'
import { useApp } from '@/context/AppContext'
import { incomingRequests, pendingForMe } from '@/lib/ledger'

export default function BottomNav() {
  const pathname = usePathname()
  const { state } = useApp()
  // Demandes de pote + remboursements a confirmer : tout ce qui attend une action.
  const badge = incomingRequests(state).length + pendingForMe(state).length

  return (
    <nav className="glass-nav safe-bottom safe-x fixed inset-x-0 bottom-0 z-30 flex items-stretch lg:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className="relative flex h-16 flex-1 flex-col items-center justify-center gap-1"
          >
            {active && (
              <motion.span
                layoutId="bottomnav-active"
                transition={{ type: 'spring' as const, stiffness: 500, damping: 34 }}
                className="absolute inset-x-4 top-1.5 h-1 rounded-full bg-brand"
              />
            )}
            <span className="relative">
              <Icon
                size={19}
                className={clsx('transition-colors', active ? 'text-brand' : 'text-navy/45')}
              />
              {href === '/activite' && badge > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-bold text-white ring-2 ring-white/70">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            <span
              className={clsx(
                'text-[10px] font-semibold transition-colors',
                active ? 'text-brand' : 'text-navy/45'
              )}
            >
              {label}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
