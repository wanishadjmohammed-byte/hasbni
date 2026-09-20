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
  Pencil,
  Plus,
  Receipt,
  Undo2,
} from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import AddExpenseModal from './AddExpenseModal'
import Avatar from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import EmptyState from './EmptyState'
import PageHeader from './PageHeader'
import SettlementModal from './SettlementModal'
import { useApp } from '@/context/AppContext'
import { daysSince, relativeDate } from '@/lib/date'
import { balanceOf, formatAmount, relationMovements } from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'
import type { ID, Movement } from '@/lib/types'

export default function RelationClient({ userId }: { userId: ID }) {
  const { state, me, confirmSettlement, cancelMovement, toast } = useApp()
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [settleOpen, setSettleOpen] = useState(false)
  const [editing, setEditing] = useState<ID | null>(null)
  const [confirming, setConfirming] = useState<Movement | null>(null)
  const [cancelling, setCancelling] = useState<Movement | null>(null)

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
              className="rounded-xl bg-brand tap px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
            >
              Retour a l&apos;accueil
            </Link>
          }
        />
      </div>
    )
  }

  const { net, projected } = balanceOf(state, other.id)
  const movements = relationMovements(state, other.id)

  /**
   * Seuls l'auteur et le payeur peuvent corriger — c'est ce que verifie aussi
   * `amend_expense` cote SQL.
   */
  const canEdit = (m: Movement) => {
    if (m.kind !== 'expense') return false
    const exp = state.expenses.find((e) => e.id === m.id)
    return Boolean(exp && !exp.cancelled && (exp.createdBy === me.id || exp.payerId === me.id))
  }

  const reminder = () => {
    const days = movements[0] ? daysSince(movements[0].createdAt) : 0
    const text =
      net > 0
        ? `Salut ${other.name} 👋 petit rappel Hasbni : il reste ${formatAmount(net)} entre nous${days > 0 ? ` (ca fait ${days} j)` : ''}. Rani nestenak 🙂`
        : `Salut ${other.name} 👋 je te dois ${formatAmount(net)}, je te rends ca vite inchallah.`
    // Sans numero, WhatsApp ouvre son selecteur de contacts et oblige a
    // retrouver la personne a la main (audit UX-9).
    const digits = (other.phone ?? '').replace(/[^\d]/g, '')
    const to = digits.length >= 9 ? digits : ''
    window.open(
      `https://wa.me/${to}?text=${encodeURIComponent(text)}`,
      '_blank',
      'noopener,noreferrer'
    )
    toast('Message de rappel pret sur WhatsApp', 'info')
  }

  return (
    <>
      <PageHeader
        leading={
          <Link
            href="/"
            aria-label="Retour"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-navy/60 transition-colors hover:bg-white/50 hover:text-navy lg:hidden"
          >
            <ArrowLeft size={20} />
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
            className="hidden items-center gap-1.5 rounded-xl border border-silver px-3 py-2.5 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy sm:flex"
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
                          <p className="mt-0.5 text-xs font-medium text-navy/60">
                            {isExpense
                              ? `${payer?.id === me.id ? 'Tu as' : `${payer?.name} a`} paye ${formatAmount(m.totalAmount ?? 0)} pour ${m.participantsCount} pers.`
                              : `${m.payerId === me.id ? 'Tu as rendu' : `${payer?.name} t'a rendu`} ${formatAmount(m.amount)} en ${m.method === 'transfer' ? 'virement' : 'especes'}`}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span
                              className="text-[11px] font-medium text-navy/60"
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

                      {/* Cette barre d'actions etait conditionnee a
                          `awaitingMe || status === 'pending'`. Une depense
                          naissant « confirmee », le bouton Annuler n'y
                          apparaissait JAMAIS : une faute de frappe etait
                          definitive (audit CRD-1). Elle est desormais
                          toujours offerte, et la correction avec (CRD-3). */}
                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/50 pt-3">
                        {m.awaitingMe ? (
                          <button
                            onClick={() => setConfirming(m)}
                            className="flex items-center gap-1.5 rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
                          >
                            <Check size={13} /> Confirmer la reception
                          </button>
                        ) : m.status === 'pending' ? (
                          <p className="text-[11px] font-medium text-navy/60">
                            En attente de confirmation de {other.name}
                          </p>
                        ) : null}

                        {canEdit(m) && (
                          <button
                            onClick={() => setEditing(m.id)}
                            className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/60 hover:text-navy"
                          >
                            <Pencil size={13} /> Corriger
                          </button>
                        )}

                        <button
                          onClick={() => setCancelling(m)}
                          className="ml-auto flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-navy/60 transition-colors hover:bg-red-50 hover:text-red-600"
                        >
                          <Undo2 size={13} /> Annuler
                        </button>
                      </div>
                    </motion.div>
                  </motion.div>
                )
              })}
            </motion.div>
          </div>
        )}
      </motion.div>

      {/* Solde net sticky — toujours au-dessus de la barre de navigation */}
      <div className="above-nav fixed inset-x-0 z-20 px-4 pb-3 lg:left-56 lg:px-6 lg:pb-6">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring' as const, stiffness: 420, damping: 30 }}
          className="glass mx-auto flex max-w-2xl items-center gap-3 rounded-2xl p-4"
        >
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-navy/60">Solde net</p>
            <p
              className={clsx(
                'text-xl font-bold',
                net > 0 ? 'text-credit' : net < 0 ? 'text-debit' : 'text-navy'
              )}
            >
              {net > 0 ? '+' : net < 0 ? '−' : ''}
              {formatAmount(net)}
              <span className="ml-2 text-xs font-semibold text-navy/60">
                {net > 0 ? `${other.name} te doit` : net < 0 ? `tu dois a ${other.name}` : 'a jour'}
              </span>
            </p>
            {projected !== net && (
              <p className="mt-0.5 flex items-center gap-1 text-[11px] font-semibold text-navy/60">
                <Clock3 size={11} /> Previsionnel {projected > 0 ? '+' : '−'}
                {formatAmount(projected)} avec les mouvements en attente
              </p>
            )}
          </div>
          <button
            onClick={reminder}
            aria-label="Envoyer un rappel"
            className="rounded-xl border border-silver p-2.5 text-navy/60 transition-colors hover:bg-white/50 hover:text-navy sm:hidden"
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
      <AddExpenseModal
        open={editing !== null}
        onClose={() => setEditing(null)}
        expenseId={editing ?? undefined}
      />
      <SettlementModal open={settleOpen} onClose={() => setSettleOpen(false)} otherId={other.id} />

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        onConfirm={() => {
          if (!confirming) return
          confirmSettlement(confirming.id)
          toast('Remboursement confirme')
        }}
        title="Confirmer la reception"
        message={
          confirming
            ? `Tu confirmes avoir recu ${formatAmount(confirming.amount)} de ${other.name} ? Le solde sera reduit d'autant, et c'est definitif.`
            : ''
        }
        confirmLabel="Oui, j'ai recu"
      />

      <ConfirmDialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        onConfirm={() => {
          if (!cancelling) return
          cancelMovement(cancelling.kind, cancelling.id)
          toast(`« ${cancelling.label} » annule — le solde est revenu en arriere`, 'danger')
        }}
        title="Annuler ce mouvement"
        message={
          cancelling
            ? `« ${cancelling.label} » (${formatAmount(cancelling.amount)}) sera annule par une ecriture inverse. L'historique garde la trace des deux lignes.`
            : ''
        }
        confirmLabel="Annuler le mouvement"
        tone="danger"
      />
    </>
  )
}
