'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS } from './nav'

export default function BottomNav() {
  const pathname = usePathname()

  return (
    <nav className="glass-nav fixed inset-x-0 bottom-0 z-30 flex h-16 items-stretch lg:hidden">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className="relative flex flex-1 flex-col items-center justify-center gap-1"
          >
            {active && (
              <motion.span
                layoutId="bottomnav-active"
                transition={{ type: 'spring' as const, stiffness: 500, damping: 34 }}
                className="absolute inset-x-4 top-1.5 h-1 rounded-full bg-brand"
              />
            )}
            <Icon
              size={19}
              className={clsx('transition-colors', active ? 'text-brand' : 'text-navy/45')}
            />
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
