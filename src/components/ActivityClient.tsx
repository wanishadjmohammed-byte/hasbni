'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import { Activity, Banknote, Check, Clock3, Landmark, Receipt, UserPlus, X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import Avatar from './Avatar'
import EmptyState from './EmptyState'
import PageHeader from './PageHeader'
import { useApp } from '@/context/AppContext'
import { relativeDate } from '@/lib/date'
import {
  allMovements,
  formatAmount,
  incomingRequests,
  pendingForMe,
  userById,
} from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'

type Filter = 'all' | 'pending' | 'expenses' | 'settlements'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'Tout' },
  { key: 'pending', label: 'En attente' },
  { key: 'expenses', label: 'Depenses' },
  { key: 'settlements', label: 'Remboursements' },
]

export default function ActivityClient() {
  const { state, me, confirmSettlement, respondToRequest, toast } = useApp()
  const [filter, setFilter] = useState<Filter>('all')
  const [busyRequest, setBusyRequest] = useState<string | null>(null)

  const pending = pendingForMe(state)
  const requests = incomingRequests(state)

  const answer = async (id: string, accept: boolean, name: string) => {
    setBusyRequest(id)
    try {
      await respondToRequest(id, accept)
      toast(accept ? `${name} est maintenant ton pote` : 'Demande refusee', accept ? 'success' : 'info')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'danger')
    } finally {
      setBusyRequest(null)
    }
  }
  const movements = allMovements(state).filter((m) => {
    if (filter === 'pending') return m.status === 'pending'
    if (filter === 'expenses') return m.kind === 'expense'
    if (filter === 'settlements') return m.kind === 'settlement'
    return true
  })

  return (
    <>
      <PageHeader title="Activite" subtitle="Tous les mouvements, tous potes confondus" />

      <motion.div {...pageIn} className="space-y-4 p-6">
        {/* Demandes de pote */}
        {requests.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-navy/50">Demandes de pote</p>
            {requests.map(({ request, user }) => (
              <motion.div key={request.id} {...cardHover} className="glass rounded-2xl p-4">
                <div className="flex items-center gap-3">
                  <Avatar user={user} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-navy">
                      {user.name} veut etre ton pote
                    </p>
                    <p className="truncate text-xs font-medium text-navy/45">
                      {user.email ?? 'compte Hasbni'}
                    </p>
                  </div>
                  <button
                    onClick={() => void answer(request.id, false, user.name)}
                    disabled={busyRequest === request.id}
                    aria-label="Refuser"
                    className="tap rounded-xl border border-silver px-3 text-xs font-semibold text-navy/45 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                  >
                    <X size={15} />
                  </button>
                  <button
                    onClick={() => void answer(request.id, true, user.name)}
                    disabled={busyRequest === request.id}
                    className="tap gap-1.5 rounded-xl bg-brand px-3 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:opacity-40"
                  >
                    <UserPlus size={14} /> Accepter
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* A confirmer */}
        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-navy/50">A confirmer</p>
            {pending.map((m) => {
              const from = userById(state, m.payerId)
              if (!from) return null
              return (
                <motion.div key={m.id} {...cardHover} className="glass rounded-2xl p-4">
                  <div className="flex items-center gap-3">
                    <Avatar user={from} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-navy">
                        {from.name} dit t&apos;avoir rendu {formatAmount(m.amount)}
                      </p>
                      <p className="text-xs font-medium text-navy/45" suppressHydrationWarning>
                        {m.label} · {relativeDate(m.createdAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        confirmSettlement(m.id)
                        toast('Remboursement confirme')
                      }}
                      className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
                    >
                      <Check size={14} /> Confirmer
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}

        {/* Filtres */}
        <div className="glass-sm flex w-full gap-1 overflow-x-auto rounded-xl p-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={clsx(
                'relative shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                filter === f.key ? 'text-white' : 'text-navy/50 hover:text-navy'
              )}
            >
              {filter === f.key && (
                <motion.span
                  layoutId="activity-filter"
                  transition={{ type: 'spring' as const, stiffness: 500, damping: 30 }}
                  className="absolute inset-0 rounded-lg bg-brand shadow-sm shadow-brand/25"
                />
              )}
              <span className="relative z-10">{f.label}</span>
            </button>
          ))}
        </div>

        {movements.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Rien a afficher"
            description="Les depenses et remboursements apparaitront ici des le premier mouvement."
          />
        ) : (
          <motion.div variants={listParent} initial="hidden" animate="show" className="space-y-2">
            {movements.map((m) => {
              const Icon =
                m.kind === 'expense' ? Receipt : m.method === 'transfer' ? Landmark : Banknote
              return (
                <motion.div key={`${m.kind}-${m.id}-${m.otherUser.id}`} variants={listItemY}>
                  <Link href={`/relation/${m.otherUser.id}`}>
                    <motion.div {...cardHover} className="glass flex items-center gap-3 rounded-2xl p-4">
                      <div
                        className={clsx(
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                          m.kind === 'expense' ? 'bg-white/60 text-navy/55' : 'bg-brand/10 text-brand'
                        )}
                      >
                        <Icon size={16} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-navy">{m.label}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs font-medium text-navy/45">
                          <span>avec {m.otherUser.name}</span>
                          <span className="h-1 w-1 rounded-full bg-navy/20" />
                          <span suppressHydrationWarning>{relativeDate(m.createdAt)}</span>
                          {m.status === 'pending' && (
                            <span className="flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold text-navy/60">
                              <Clock3 size={10} /> En attente
                            </span>
                          )}
                        </div>
                      </div>
                      <p
                        className={clsx(
                          'text-base font-bold',
                          m.delta > 0 ? 'text-credit' : 'text-debit',
                          m.status === 'pending' && 'opacity-55'
                        )}
                      >
                        {m.delta > 0 ? '+' : '−'}
                        {formatAmount(m.delta)}
                      </p>
                    </motion.div>
                  </Link>
                </motion.div>
              )
            })}
          </motion.div>
        )}
      </motion.div>
    </>
  )
}
