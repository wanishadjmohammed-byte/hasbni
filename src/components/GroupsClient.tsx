'use client'

import clsx from 'clsx'
import { motion } from 'framer-motion'
import { ArrowRight, Plus, Sparkles, UsersRound, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import AddExpenseModal from './AddExpenseModal'
import Avatar from './Avatar'
import EmptyState from './EmptyState'
import Modal from './Modal'
import PageHeader from './PageHeader'
import { useApp } from '@/context/AppContext'
import {
  formatAmount,
  groupMembersOf,
  relationBalance,
  simplifyGroup,
  userById,
} from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'
import type { ID } from '@/lib/types'

export default function GroupsClient() {
  const { state, me, createGroup, toast } = useApp()
  const [openGroup, setOpenGroup] = useState<ID | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [simplifyOpen, setSimplifyOpen] = useState<ID | null>(null)
  const [expenseGroup, setExpenseGroup] = useState<ID | null>(null)

  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('👥')
  const [members, setMembers] = useState<ID[]>([])

  const group = state.groups.find((g) => g.id === openGroup) ?? null
  const simplifyTarget = state.groups.find((g) => g.id === simplifyOpen) ?? null
  const transfers = useMemo(
    () => (simplifyTarget ? simplifyGroup(state, simplifyTarget.id) : []),
    [state, simplifyTarget]
  )

  const submitGroup = () => {
    if (!name.trim()) return
    createGroup(name, emoji, members)
    toast('Groupe cree')
    setCreateOpen(false)
    setName('')
    setEmoji('👥')
    setMembers([])
  }

  return (
    <>
      <PageHeader
        title="Groupes"
        subtitle="Un carnet de contacts pour repartir vite — le calcul reste bilateral"
        action={
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
          >
            <Plus size={16} /> Groupe
          </button>
        }
      />

      <motion.div {...pageIn} className="p-6">
        {state.groups.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title="Aucun groupe"
            description="Cree un groupe (Les potes, Coloc…) pour repartir une depense en deux taps."
          />
        ) : (
          <motion.div
            variants={listParent}
            initial="hidden"
            animate="show"
            className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            {state.groups.map((g) => {
              const gm = groupMembersOf(state, g.id)
              const myNet = gm
                .filter((u) => u.id !== me.id)
                .reduce((sum, u) => sum + relationBalance(state.ledger, me.id, u.id), 0)
              return (
                <motion.button
                  key={g.id}
                  variants={listItemY}
                  {...cardHover}
                  onClick={() => setOpenGroup(g.id)}
                  className="glass rounded-2xl p-4 text-left"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/60 text-xl">
                      {g.emoji}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-navy">{g.name}</p>
                      <p className="text-xs font-medium text-navy/45">
                        {gm.length} membre{gm.length > 1 ? 's' : ''}
                      </p>
                    </div>
                    <ArrowRight size={16} className="mt-1 text-navy/30" />
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-white/50 pt-3">
                    <div className="flex -space-x-2">
                      {gm.slice(0, 5).map((u) => (
                        <Avatar key={u.id} user={u} size="sm" className="ring-2 ring-white/70" />
                      ))}
                    </div>
                    <p
                      className={clsx(
                        'text-sm font-bold',
                        myNet > 0 ? 'text-credit' : myNet < 0 ? 'text-debit' : 'text-navy/45'
                      )}
                    >
                      {myNet > 0 ? '+' : myNet < 0 ? '−' : ''}
                      {formatAmount(myNet)}
                    </p>
                  </div>
                </motion.button>
              )
            })}
          </motion.div>
        )}
      </motion.div>

      {/* Detail groupe */}
      <Modal
        open={!!group}
        onClose={() => setOpenGroup(null)}
        title={group ? `${group.emoji} ${group.name}` : ''}
        subtitle={group ? `Cree par ${userById(state, group.ownerId)?.name ?? '—'}` : undefined}
        footer={
          group && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setSimplifyOpen(group.id)
                  setOpenGroup(null)
                }}
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <Wand2 size={15} /> Simplifier
              </button>
              <button
                onClick={() => {
                  setExpenseGroup(group.id)
                  setOpenGroup(null)
                }}
                className="ml-auto flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
              >
                <Plus size={15} /> Depense
              </button>
            </div>
          )
        }
      >
        {group && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-navy/50">Membres et soldes avec toi</p>
            {groupMembersOf(state, group.id).map((u) => {
              const net = u.id === me.id ? 0 : relationBalance(state.ledger, me.id, u.id)
              return (
                <div key={u.id} className="glass-sm flex items-center gap-3 rounded-2xl p-3">
                  <Avatar user={u} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy">
                      {u.id === me.id ? 'Moi' : u.name}
                    </p>
                    <p className="text-[11px] font-medium text-navy/45">
                      {u.id === me.id
                        ? 'ton compte'
                        : net > 0
                          ? 'il te doit'
                          : net < 0
                            ? 'tu lui dois'
                            : 'a jour'}
                    </p>
                  </div>
                  {u.id !== me.id && (
                    <>
                      <p
                        className={clsx(
                          'text-sm font-bold',
                          net > 0 ? 'text-credit' : net < 0 ? 'text-debit' : 'text-navy/45'
                        )}
                      >
                        {net > 0 ? '+' : net < 0 ? '−' : ''}
                        {formatAmount(net)}
                      </p>
                      <Link
                        href={`/relation/${u.id}`}
                        onClick={() => setOpenGroup(null)}
                        aria-label={`Ouvrir la relation avec ${u.name}`}
                        className="rounded-lg p-1.5 text-navy/35 transition-colors hover:bg-white/60 hover:text-navy"
                      >
                        <ArrowRight size={15} />
                      </Link>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Modal>

      {/* Simplification */}
      <Modal
        open={!!simplifyTarget}
        onClose={() => setSimplifyOpen(null)}
        title="Simplifier les dettes"
        subtitle={simplifyTarget ? `Groupe ${simplifyTarget.name} — suggestion reversible` : undefined}
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setSimplifyOpen(null)}
              className="rounded-xl border border-silver px-4 py-2 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Fermer
            </button>
            <button
              onClick={() => {
                toast('Suggestion notee — rien n’a ete applique', 'info')
                setSimplifyOpen(null)
              }}
              className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
            >
              Garder en note
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          <div className="glass-sm flex items-start gap-2.5 rounded-2xl p-3">
            <Sparkles size={15} className="mt-0.5 shrink-0 text-brand" />
            <p className="text-xs font-medium text-navy/60">
              Par defaut les dettes restent simples : chacun doit a celui qui a avance. Voici le
              minimum de transferts pour solder le groupe.
            </p>
          </div>
          {transfers.length === 0 ? (
            <p className="py-6 text-center text-sm font-semibold text-navy/45">
              Tout est deja equilibre dans ce groupe.
            </p>
          ) : (
            transfers.map((t, i) => (
              <div key={i} className="glass-sm flex items-center gap-2 rounded-2xl p-3">
                <span className="text-sm font-semibold text-navy">
                  {t.from === me.id ? 'Moi' : userById(state, t.from)?.name}
                </span>
                <ArrowRight size={15} className="text-brand" />
                <span className="text-sm font-semibold text-navy">
                  {t.to === me.id ? 'Moi' : userById(state, t.to)?.name}
                </span>
                <span className="ml-auto text-sm font-bold text-navy">{formatAmount(t.amount)}</span>
              </div>
            ))
          )}
        </div>
      </Modal>

      {/* Creation de groupe */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nouveau groupe"
        subtitle="Un groupe sert de contexte, pas de caisse commune"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setCreateOpen(false)}
              className="rounded-xl border border-silver px-4 py-2 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Annuler
            </button>
            <button
              onClick={submitGroup}
              disabled={!name.trim()}
              className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-40"
            >
              Creer
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex gap-3">
            <div className="w-20">
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Emoji</label>
              <input type="text" value={emoji} onChange={(e) => setEmoji(e.target.value)} maxLength={2} />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Nom du groupe</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Les potes"
              />
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-xs font-medium text-navy/50">Membres</p>
            <div className="flex flex-wrap gap-2">
              {state.users
                .filter((u) => u.id !== me.id)
                .map((u) => {
                  const on = members.includes(u.id)
                  return (
                    <button
                      key={u.id}
                      onClick={() =>
                        setMembers((prev) =>
                          prev.includes(u.id) ? prev.filter((x) => x !== u.id) : [...prev, u.id]
                        )
                      }
                      className={clsx(
                        'flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-xs font-semibold transition-colors',
                        on
                          ? 'border-brand/40 bg-brand/10 text-navy'
                          : 'border-silver text-navy/45 hover:bg-white/50 hover:text-navy'
                      )}
                    >
                      <Avatar user={u} size="sm" className="h-6 w-6 text-xs" />
                      {u.name}
                    </button>
                  )
                })}
            </div>
          </div>
        </div>
      </Modal>

      <AddExpenseModal
        open={!!expenseGroup}
        onClose={() => setExpenseGroup(null)}
        presetGroupId={expenseGroup ?? undefined}
      />
    </>
  )
}
