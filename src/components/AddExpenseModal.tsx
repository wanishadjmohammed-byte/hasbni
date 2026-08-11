'use client'

import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import Avatar from './Avatar'
import Modal from './Modal'
import { useApp } from '@/context/AppContext'
import { formatAmount, groupMembersOf, round, splitEqual, splitTypeLabel, uid } from '@/lib/ledger'
import type { ID, SplitType } from '@/lib/types'

interface Item {
  id: string
  label: string
  price: string
  userId: ID | ''
}

export default function AddExpenseModal({
  open,
  onClose,
  presetParticipant,
  presetGroupId,
}: {
  open: boolean
  onClose: () => void
  presetParticipant?: ID
  presetGroupId?: ID
}) {
  const { state, me, addExpense, toast } = useApp()

  const [amount, setAmount] = useState('')
  const [motive, setMotive] = useState('')
  const [payerId, setPayerId] = useState<ID>(me.id)
  const [groupId, setGroupId] = useState<ID | ''>(presetGroupId ?? '')
  const [splitType, setSplitType] = useState<SplitType>('equal')
  const [participants, setParticipants] = useState<ID[]>(
    presetParticipant ? [me.id, presetParticipant] : [me.id]
  )
  const [custom, setCustom] = useState<Record<ID, string>>({})
  const [items, setItems] = useState<Item[]>([{ id: uid('it'), label: '', price: '', userId: '' }])

  useEffect(() => {
    if (!open) return
    setAmount('')
    setMotive('')
    setPayerId(me.id)
    setGroupId(presetGroupId ?? '')
    setSplitType('equal')
    setParticipants(presetParticipant ? [me.id, presetParticipant] : [me.id])
    setCustom({})
    setItems([{ id: uid('it'), label: '', price: '', userId: '' }])
  }, [open, me.id, presetParticipant, presetGroupId])

  const candidates = useMemo(() => {
    if (groupId) return groupMembersOf(state, groupId)
    return state.users
  }, [state, groupId])

  // Si on change de groupe, on ne garde que les participants encore membres.
  useEffect(() => {
    if (!groupId) return
    const ids = groupMembersOf(state, groupId).map((u) => u.id)
    setParticipants((prev) => {
      const next = prev.filter((p) => ids.includes(p))
      return next.includes(me.id) || !ids.includes(me.id) ? next : [me.id, ...next]
    })
  }, [groupId, state, me.id])

  const total = round(Number(amount) || 0)

  const shares = useMemo<Record<ID, number>>(() => {
    if (splitType === 'equal') return splitEqual(total, participants, payerId)
    if (splitType === 'custom') {
      const out: Record<ID, number> = {}
      for (const p of participants) out[p] = round(Number(custom[p]) || 0)
      return out
    }
    const out: Record<ID, number> = {}
    for (const it of items) {
      if (!it.userId) continue
      out[it.userId] = (out[it.userId] ?? 0) + round(Number(it.price) || 0)
    }
    return out
  }, [splitType, total, participants, payerId, custom, items])

  const assigned = Object.values(shares).reduce((s, v) => s + v, 0)
  const itemsTotal = items.reduce((s, it) => s + (round(Number(it.price) || 0)), 0)
  const effectiveTotal = splitType === 'items' ? itemsTotal : total
  const diff = round(effectiveTotal - assigned)

  const canSubmit =
    effectiveTotal > 0 &&
    Object.keys(shares).length > 0 &&
    (splitType === 'items' ? assigned > 0 : diff === 0) &&
    (splitType !== 'equal' || participants.length >= 2)

  const toggleParticipant = (id: ID) => {
    setParticipants((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const submit = () => {
    if (!canSubmit) return
    addExpense({
      amount: splitType === 'items' ? assigned : total,
      motive,
      payerId,
      groupId: groupId || null,
      splitType,
      shares,
    })
    toast('Depense ajoutee — les soldes sont a jour')
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter une depense"
      subtitle="Les dettes bilaterales sont generees automatiquement"
      size="lg"
      footer={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-navy/50">Reparti</p>
            <p className={clsx('text-sm font-bold', diff === 0 ? 'text-navy' : 'text-debit')}>
              {formatAmount(assigned)}
              {splitType !== 'items' && effectiveTotal > 0 && (
                <span className="text-navy/45"> / {formatAmount(effectiveTotal)}</span>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-silver px-4 py-2 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-brand px-5 py-2 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-40"
          >
            Valider
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy/50">Montant total (DA)</label>
            <input
              type="number"
              inputMode="numeric"
              value={splitType === 'items' ? (itemsTotal || '') : amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={splitType === 'items'}
              placeholder="3000"
              className="disabled:opacity-70"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy/50">Motif</label>
            <input
              type="text"
              value={motive}
              onChange={(e) => setMotive(e.target.value)}
              placeholder="Restau samedi"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy/50">Qui a paye</label>
            <select value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === me.id ? `${u.name} (moi)` : u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy/50">Groupe (optionnel)</label>
            <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              <option value="">Aucun groupe</option>
              {state.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.emoji} {g.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-navy/50">Mode de repartition</p>
          <div className="glass-sm flex gap-1 rounded-2xl p-1">
            {(['equal', 'custom', 'items'] as SplitType[]).map((t) => (
              <button
                key={t}
                onClick={() => setSplitType(t)}
                className={clsx(
                  'relative flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors',
                  splitType === t ? 'text-white' : 'text-navy/50 hover:text-navy'
                )}
              >
                {splitType === t && (
                  <motion.span
                    layoutId="split-tab"
                    transition={{ type: 'spring' as const, stiffness: 500, damping: 30 }}
                    className="absolute inset-0 rounded-xl bg-brand shadow-sm shadow-brand/25"
                  />
                )}
                <span className="relative z-10">{splitTypeLabel[t]}</span>
              </button>
            ))}
          </div>
        </div>

        <AnimatePresence mode="wait">
          {splitType === 'items' ? (
            <motion.div
              key="items"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-2"
            >
              <p className="text-xs font-medium text-navy/50">Qui a consomme quoi</p>
              {items.map((it, i) => (
                <div key={it.id} className="glass-sm flex items-center gap-2 rounded-2xl p-2">
                  <input
                    type="text"
                    value={it.label}
                    placeholder={`Item ${i + 1}`}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x))
                      )
                    }
                    className="flex-1"
                  />
                  <input
                    type="number"
                    inputMode="numeric"
                    value={it.price}
                    placeholder="DA"
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, price: e.target.value } : x))
                      )
                    }
                    className="w-24"
                  />
                  <select
                    value={it.userId}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, userId: e.target.value } : x))
                      )
                    }
                    className="w-32"
                  >
                    <option value="">Pour qui</option>
                    {candidates.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.id === me.id ? 'Moi' : u.name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => setItems((prev) => prev.filter((x) => x.id !== it.id))}
                    aria-label="Supprimer l'item"
                    className="rounded-lg p-2 text-navy/35 transition-colors hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setItems((prev) => [...prev, { id: uid('it'), label: '', price: '', userId: '' }])
                }
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <Plus size={14} /> Ajouter un item
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="participants"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="space-y-2"
            >
              <p className="text-xs font-medium text-navy/50">Participants</p>
              <div className="flex flex-wrap gap-2">
                {candidates.map((u) => {
                  const on = participants.includes(u.id)
                  return (
                    <button
                      key={u.id}
                      onClick={() => toggleParticipant(u.id)}
                      className={clsx(
                        'flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-xs font-semibold transition-colors',
                        on
                          ? 'border-brand/40 bg-brand/10 text-navy'
                          : 'border-silver text-navy/45 hover:bg-white/50 hover:text-navy'
                      )}
                    >
                      <Avatar user={u} size="sm" className="h-6 w-6 text-xs" />
                      {u.id === me.id ? 'Moi' : u.name}
                      {on && <Check size={13} className="text-brand" />}
                    </button>
                  )
                })}
              </div>

              {splitType === 'custom' && participants.length > 0 && (
                <div className="glass-sm mt-2 space-y-2 rounded-2xl p-3">
                  {participants.map((p) => {
                    const u = state.users.find((x) => x.id === p)!
                    return (
                      <div key={p} className="flex items-center gap-3">
                        <Avatar user={u} size="sm" />
                        <span className="flex-1 text-sm font-semibold text-navy">
                          {p === me.id ? 'Moi' : u.name}
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={custom[p] ?? ''}
                          placeholder="0"
                          onChange={(e) => setCustom((prev) => ({ ...prev, [p]: e.target.value }))}
                          className="w-28"
                        />
                      </div>
                    )
                  })}
                  {diff !== 0 && total > 0 && (
                    <p className="text-xs font-semibold text-debit">
                      {diff > 0
                        ? `Il reste ${formatAmount(diff)} a repartir`
                        : `${formatAmount(diff)} de trop`}
                    </p>
                  )}
                </div>
              )}

              {splitType === 'equal' && participants.length > 0 && total > 0 && (
                <div className="glass-sm mt-2 space-y-1.5 rounded-2xl p-3">
                  {participants.map((p) => {
                    const u = state.users.find((x) => x.id === p)!
                    return (
                      <div key={p} className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-navy">{p === me.id ? 'Moi' : u.name}</span>
                        <span className="font-semibold text-navy/60">
                          {formatAmount(shares[p] ?? 0)}
                        </span>
                      </div>
                    )
                  })}
                  <p className="pt-1 text-[11px] font-medium text-navy/45">
                    Le reste de l&apos;arrondi est attribue au payeur.
                  </p>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Modal>
  )
}
