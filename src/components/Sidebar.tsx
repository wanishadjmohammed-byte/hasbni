'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Avatar from './Avatar'
import { NAV_ITEMS } from './nav'
import { useApp } from '@/context/AppContext'
import { formatAmount, globalTotals } from '@/lib/ledger'

export default function Sidebar() {
  const pathname = usePathname()
  const { state, me } = useApp()
  const totals = globalTotals(state)

  return (
    <aside className="glass-sidebar fixed inset-y-0 left-0 z-30 hidden w-56 flex-col lg:flex">
      <div className="px-5 pb-4 pt-6">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-base font-bold text-white shadow-sm shadow-brand/25">
            ح
          </div>
          <div className="leading-tight">
            <p className="text-base font-bold tracking-tight text-navy">Hasbni</p>
            <p className="text-[10px] font-medium text-navy/45">حسبني</p>
          </div>
        </Link>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors',
                active ? 'text-white' : 'text-navy/55 hover:bg-white/50 hover:text-navy'
              )}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  transition={{ type: 'spring' as const, stiffness: 500, damping: 34 }}
                  className="absolute inset-0 rounded-xl bg-brand shadow-sm shadow-brand/25"
                />
              )}
              <Icon size={17} className="relative z-10" />
              <span className="relative z-10">{label}</span>
            </Link>
          )
        })}
      </nav>

      <div className="mt-auto space-y-3 p-3">
        <div className="glass-sm rounded-2xl p-3">
          <p className="text-xs font-medium text-navy/50">Balance nette</p>
          <p
            className={clsx(
              'mt-1 text-lg font-bold',
              totals.net > 0 ? 'text-credit' : totals.net < 0 ? 'text-debit' : 'text-navy'
            )}
          >
            {totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}
            {formatAmount(totals.net)}
          </p>
          <div className="mt-2 space-y-0.5 text-[11px] font-medium text-navy/45">
            <p>On me doit {formatAmount(totals.owedToMe)}</p>
            <p>Je dois {formatAmount(totals.iOwe)}</p>
          </div>
        </div>

        <Link
          href="/profil"
          className="flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors hover:bg-white/50"
        >
          <Avatar user={me} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-navy">{me.name}</p>
            <p className="truncate text-[11px] text-navy/45">Mon compte</p>
          </div>
        </Link>
      </div>
    </aside>
  )
}
