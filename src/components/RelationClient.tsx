'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import {
  ArrowLeft,
  Banknote,
  Check,
  Clock3,
  HandCoins,
  Landmark,
  MessageCircle,
  Plus,
  Receipt,
  Undo2,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import AddExpenseModal from './AddExpenseModal'
import Avatar from './Avatar'
import EmptyState from './EmptyState'
import PageHeader from './PageHeader'
import SettlementModal from './SettlementModal'
import { useApp } from '@/context/AppContext'
import { daysSince, relativeDate } from '@/lib/date'
import { formatAmount, relationBalance, relationMovements } from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'
import type { ID } from '@/lib/types'

export default function RelationClient({ userId }: { userId: ID }) {
  const { state, me, confirmSettlement, cancelMovement, toast } = useApp()
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)

  const other = state.users.find((u) => u.id === userId)

  if (!other) {
    return (
      <div className="p-6">
        <EmptyState
          icon={Receipt}
          title="Pote introuvable"
          description="Cette relation n'existe pas ou a ete supprimee."
          action={
            <Link
              href="/"
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
            >
              Retour a l&apos;accueil
            </Link>
          }
        />
      </div>
    )
  }

  const net = relationBalance(state.ledger, me.id, other.id)
  const projected = relationBalance(state.ledger, me.id, other.id, { includePending: true })
  const movements = relationMovements(state, other.id)

  const reminder = () => {
    const days = movements[0] ? daysSince(movements[0].createdAt) : 0
    const text =
      net > 0
        ? `Salut ${other.name} 👋 petit rappel Hasbni : il reste ${formatAmount(net)} entre nous${days > 0 ? ` (ca fait ${days} j)` : ''}. Rani nestenak 🙂`
        : `Salut ${other.name} 👋 je te dois ${formatAmount(net)}, je te rends ca vite inchallah.`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
    toast('Message de rappel pret sur WhatsApp', 'info')
  }

  return (
    <>
      <PageHeader
        leading={
          <Link
            href="/"
            aria-label="Retour"
            className="rounded-xl p-2 text-navy/45 transition-colors hover:bg-white/50 hover:text-navy lg:hidden"
          >
            <ArrowLeft size={18} />
          </Link>
        }
        title={
          <span className="flex items-center gap-2.5">
            <Avatar user={other} size="md" />
            {other.name}
          </span>
        }
        subtitle={`${movements.length} mouvement${movements.length > 1 ? 's' : ''} · ${other.phone ?? 'sans numero'}`}
        action={
          <button
            onClick={reminder}
            className="hidden items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy sm:flex"
          >
            <MessageCircle size={14} /> Rappel
          </button>
        }
      />

      <motion.div {...pageIn} className="space-y-4 p-6 pb-40">
        {/* Actions rapides */}
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            {...cardHover}
            onClick={() => setExpenseOpen(true)}
            className="flex items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
          >
            <Plus size={16} /> Depense
          </motion.button>
          <motion.button
            {...cardHover}
            onClick={() => setSettleOpen(true)}
            className="glass flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-navy transition-colors hover:bg-white/60"
          >
            <HandCoins size={16} className="text-brand" /> Rembourser
          </motion.button>
        </div>

        {/* Timeline */}
        {movements.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title="Rien entre vous pour l'instant"
            description="Ajoutez une depense partagee et la tracabilite demarre ici."
          />
        ) : (
          <div className="relative pl-10">
            <div className="timeline-rail" />
            <motion.div variants={listParent} initial="hidden" animate="show" className="space-y-2.5">
              {movements.map((m) => {
                const isExpense = m.kind === 'expense'
                const payer = state.users.find((u) => u.id === m.payerId)
                const Icon = isExpense ? Receipt : m.method === 'transfer' ? Landmark : Banknote
                return (
                  <motion.div key={`${m.kind}-${m.id}`} variants={listItemY} className="relative">
                    <span
                      className={clsx(
                        'absolute -left-10 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/70 shadow-sm',
                        isExpense ? 'bg-white/70 text-navy/60' : 'bg-brand/12 text-brand'
                      )}
                    >
                      <Icon size={15} />
                    </span>

                    <motion.div {...cardHover} className="glass rounded-2xl p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold text-navy">{m.label}</p>
                          <p className="mt-0.5 text-xs font-medium text-navy/45">
                            {isExpense
                              ? `${payer?.id === me.id ? 'Tu as' : `${payer?.name} a`} paye ${formatAmount(m.totalAmount ?? 0)} pour ${m.participantsCount} pers.`
                              : `${m.payerId === me.id ? 'Tu as rendu' : `${payer?.name} t'a rendu`} ${formatAmount(m.amount)} en ${m.method === 'transfer' ? 'virement' : 'especes'}`}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className="text-[11px] font-medium text-navy/40"
                              suppressHydrationWarning
                            >
                              {relativeDate(m.createdAt)}
                            </span>
                            {m.status === 'pending' && (
                              <span className="flex items-center gap-1 rounded-full bg-cream px-2 py-0.5 text-[10px] font-bold text-navy/60">
                                <Clock3 size={10} /> En attente
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="text-right">
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
                        </div>
                      </div>

                      {(m.awaitingMe || m.status === 'pending') && (
                        <div className="mt-3 flex items-center gap-2 border-t border-white/50 pt-3">
                          {m.awaitingMe ? (
                            <button
                              onClick={() => {
                                confirmSettlement(m.id)
                                toast('Remboursement confirme')
                              }}
                              className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
                            >
                              <Check size={13} /> Confirmer la reception
                            </button>
                          ) : (
                            <p className="text-[11px] font-medium text-navy/45">
                              En attente de confirmation de {other.name}
                            </p>
                          )}
                          <button
                            onClick={() => {
                              cancelMovement(m.kind, m.id)
                              toast('Mouvement annule par ecriture inverse', 'danger')
                            }}
                            className="ml-auto flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-navy/45 transition-colors hover:bg-red-50 hover:text-red-500"
                          >
                            <Undo2 size={13} /> Annuler
                          </button>
                        </div>
                      )}
                    </motion.div>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        )}
      </motion.div>

      {/* Solde net sticky */}
      <div className="fixed inset-x-0 bottom-16 z-20 px-4 pb-3 lg:bottom-0 lg:left-56 lg:px-6 lg:pb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring' as const, stiffness: 420, damping: 30 }}
          className="glass mx-auto flex max-w-2xl items-center gap-3 rounded-2xl p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-navy/50">Solde net</p>
            <p
              className={clsx(
                'text-xl font-bold',
                net > 0 ? 'text-credit' : net < 0 ? 'text-debit' : 'text-navy'
              )}
            >
              {net > 0 ? '+' : net < 0 ? '−' : ''}
              {formatAmount(net)}
              <span className="ml-2 text-xs font-semibold text-navy/45">
                {net > 0 ? `${other.name} te doit` : net < 0 ? `tu dois a ${other.name}` : 'a jour'}
              </span>
            </p>
            {projected !== net && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-navy/45">
                <Clock3 size={11} /> Previsionnel {projected > 0 ? '+' : '−'}
                {formatAmount(projected)} avec les mouvements en attente
              </p>
            )}
          </div>
          <button
            onClick={reminder}
            aria-label="Envoyer un rappel"
            className="rounded-xl border border-silver p-2.5 text-navy/50 transition-colors hover:bg-white/50 hover:text-navy sm:hidden"
          >
            <MessageCircle size={16} />
          </button>
        </motion.div>
      </div>

      <AddExpenseModal
        open={expenseOpen}
        onClose={() => setExpenseOpen(false)}
        presetParticipant={other.id}
      />
      <SettlementModal open={settleOpen} onClose={() => setSettleOpen(false)} otherId={other.id} />
    </>
  )
}
