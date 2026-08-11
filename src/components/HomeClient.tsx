'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Bell, Clock3, Plus, Search, Users } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import AddExpenseModal from './AddExpenseModal'
import Avatar from './Avatar'
import EmptyState from './EmptyState'
import PageHeader from './PageHeader'
import { useApp } from '@/context/AppContext'
import { relativeDate } from '@/lib/date'
import { formatAmount, globalTotals, pendingForMe, relationSummaries } from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'

type SortKey = 'recent' | 'amount' | 'name'

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: 'Recent' },
  { key: 'amount', label: 'Montant' },
  { key: 'name', label: 'Nom' },
]

export default function HomeClient() {
  const { state, me } = useApp()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('recent')
  const [expenseOpen, setExpenseOpen] = useState(false)

  const totals = globalTotals(state)
  const pending = pendingForMe(state)

  const relations = useMemo(() => {
    const list = relationSummaries(state).filter((r) =>
      r.user.name.toLowerCase().includes(query.trim().toLowerCase())
    )
    const sorted = [...list]
    if (sort === 'amount') sorted.sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    if (sort === 'name') sorted.sort((a, b) => a.user.name.localeCompare(b.user.name))
    return sorted
  }, [state, query, sort])

  return (
    <>
      <PageHeader
        title={`Salut ${me.name} 👋`}
        subtitle="Voici ou tu en es avec tes potes"
        action={
          <button
            onClick={() => setExpenseOpen(true)}
            className="tap hidden items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean sm:flex"
          >
            <Plus size={16} /> Depense
          </button>
        }
      />

      <motion.div {...pageIn} className="safe-x space-y-5 p-6">
        {/* Totaux globaux */}
        <motion.div variants={listParent} initial="hidden" animate="show" className="grid gap-3 sm:grid-cols-3">
          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-credit">
              <ArrowDownLeft size={15} />
              <p className="text-xs font-medium text-navy/50">On me doit</p>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-credit">{formatAmount(totals.owedToMe)}</p>
          </motion.div>

          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <div className="flex items-center gap-2 text-debit">
              <ArrowUpRight size={15} />
              <p className="text-xs font-medium text-navy/50">Je dois</p>
            </div>
            <p className="mt-1.5 text-2xl font-bold text-debit">{formatAmount(totals.iOwe)}</p>
          </motion.div>

          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/50">Balance nette</p>
            <p
              className={clsx(
                'mt-1.5 text-2xl font-bold',
                totals.net > 0 ? 'text-credit' : totals.net < 0 ? 'text-debit' : 'text-navy'
              )}
            >
              {totals.net > 0 ? '+' : totals.net < 0 ? '−' : ''}
              {formatAmount(totals.net)}
            </p>
          </motion.div>
        </motion.div>

        {/* A confirmer */}
        {pending.length > 0 && (
          <Link href="/activite" className="block">
            <motion.div {...cardHover} className="glass flex items-center gap-3 rounded-2xl p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand/10 text-brand">
                <Bell size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-navy">
                  {pending.length} remboursement{pending.length > 1 ? 's' : ''} a confirmer
                </p>
                <p className="text-xs font-medium text-navy/45">
                  Tant que tu ne confirmes pas, le solde ne bouge pas.
                </p>
              </div>
              <span className="rounded-full bg-brand px-2.5 py-1 text-xs font-bold text-white">
                {pending.length}
              </span>
            </motion.div>
          </Link>
        )}

        {/* Recherche + tri */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy/35"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Chercher un pote…"
              className="!pl-9"
            />
          </div>
          <div className="glass-sm flex gap-1 rounded-xl p-1">
            {SORTS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSort(s.key)}
                className={clsx(
                  'relative rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  sort === s.key ? 'text-white' : 'text-navy/50 hover:text-navy'
                )}
              >
                {sort === s.key && (
                  <motion.span
                    layoutId="sort-pill"
                    transition={{ type: 'spring' as const, stiffness: 500, damping: 30 }}
                    className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/25"
                  />
                )}
                <span className="relative z-10">{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Liste des potes */}
        {relations.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Aucun pote pour l'instant"
            description="Ajoute une depense ou cree un groupe pour commencer a suivre vos comptes."
            action={
              <button
                onClick={() => setExpenseOpen(true)}
                className="rounded-xl bg-brand tap px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
              >
                Ajouter une depense
              </button>
            }
          />
        ) : (
          <motion.div variants={listParent} initial="hidden" animate="show" className="space-y-2">
            {relations.map((r) => (
              <motion.div key={r.userId} variants={listItemY}>
                <Link href={`/relation/${r.userId}`}>
                  <motion.div {...cardHover} className="glass flex items-center gap-3 rounded-2xl p-4">
                    <Avatar user={r.user} size="lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-navy">{r.user.name}</p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs font-medium text-navy/45">
                        <span suppressHydrationWarning>{relativeDate(r.lastActivity)}</span>
                        <span className="h-1 w-1 rounded-full bg-navy/20" />
                        <span>
                          {r.movementCount} mouvement{r.movementCount > 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p
                        className={clsx(
                          'text-lg font-bold',
                          r.net > 0 ? 'text-credit' : r.net < 0 ? 'text-debit' : 'text-navy/45'
                        )}
                      >
                        {r.net > 0 ? '+' : r.net < 0 ? '−' : ''}
                        {formatAmount(r.net)}
                      </p>
                      {r.pending !== 0 ? (
                        <p className="flex items-center justify-end gap-1 text-[11px] font-semibold text-navy/45">
                          <Clock3 size={11} />
                          {r.pending > 0 ? '+' : '−'}
                          {formatAmount(r.pending)} en attente
                        </p>
                      ) : (
                        <p className="text-[11px] font-medium text-navy/40">
                          {r.net > 0 ? 'il me doit' : r.net < 0 ? 'je lui dois' : 'a jour'}
                        </p>
                      )}
                    </div>
                  </motion.div>
                </Link>
              </motion.div>
            ))}
          </motion.div>
        )}
      </motion.div>

      {/* FAB mobile — cale au-dessus de la barre de navigation */}
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={() => setExpenseOpen(true)}
        aria-label="Ajouter une depense"
        style={{ bottom: 'calc(var(--nav-height) + var(--safe-bottom) + 1rem)' }}
        className="fixed right-5 z-30 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-white shadow-lg shadow-brand/30 transition-colors hover:bg-ocean sm:hidden"
      >
        <Plus size={24} />
      </motion.button>

      <AddExpenseModal open={expenseOpen} onClose={() => setExpenseOpen(false)} />
    </>
  )
}
