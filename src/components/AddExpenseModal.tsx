'use client'

import clsx from 'clsx'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Plus, Search, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import Avatar from './Avatar'
import Modal from './Modal'
import { useApp } from '@/context/AppContext'
import {
  formatAmount,
  friendIds,
  groupMembersOf,
  relationSummaries,
  round,
  splitEqual,
  splitTypeLabel,
  uid,
} from '@/lib/ledger'
import type { ID, SplitType, User } from '@/lib/types'

/** Borne alignee sur la contrainte SQL `expenses_amount_bounds`. */
const MAX_AMOUNT = 100_000_000
const MAX_MOTIVE = 120
/** Au-dela, la liste de participants devient une liste a chercher. */
const SEARCH_THRESHOLD = 8

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
  expenseId,
}: {
  open: boolean
  onClose: () => void
  presetParticipant?: ID
  presetGroupId?: ID
  /** Renseigne : on corrige une depense existante au lieu d'en creer une. */
  expenseId?: ID
}) {
  const { state, me, addExpense, amendExpense, toast } = useApp()

  const editing = useMemo(
    () => (expenseId ? state.expenses.find((e) => e.id === expenseId) : undefined),
    [expenseId, state.expenses]
  )

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
  const [query, setQuery] = useState('')

  /**
   * Le formulaire ne se reinitialise qu'a l'OUVERTURE.
   *
   * Les dependances de cet effet incluent des tranches de `state` : sans ce
   * garde-fou, un rafraichissement temps reel survenant pendant la saisie
   * effacait ce que l'utilisateur etait en train de taper.
   */
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }
    if (wasOpen.current) return
    wasOpen.current = true
    setQuery('')

    if (editing) {
      const shares = state.expenseShares.filter((s) => s.expenseId === editing.id)
      setAmount(String(editing.amount))
      setMotive(editing.motive)
      setPayerId(editing.payerId)
      setGroupId(editing.groupId ?? '')
      // On repart en mode « parts personnalisees » : c'est le seul mode qui
      // sait representer fidelement n'importe quelle repartition existante.
      setSplitType(editing.splitType === 'items' ? 'custom' : editing.splitType)
      setParticipants(shares.map((s) => s.userId))
      setCustom(Object.fromEntries(shares.map((s) => [s.userId, String(s.shareAmount)])))
      setItems([{ id: uid('it'), label: '', price: '', userId: '' }])
      return
    }

    setAmount('')
    setMotive('')
    setPayerId(me.id)
    setGroupId(presetGroupId ?? '')
    setSplitType('equal')
    setParticipants(presetParticipant ? [me.id, presetParticipant] : [me.id])
    setCustom({})
    setItems([{ id: uid('it'), label: '', price: '', userId: '' }])
  }, [open, me.id, presetParticipant, presetGroupId, editing, state.expenseShares])

  /**
   * Candidats : uniquement mes potes, ou les membres du groupe choisi.
   *
   * Avant, la liste etait `state.users` — soit TOUS les profils que la RLS
   * laisse voir, y compris de simples co-membres d'un groupe. Non trie, non
   * cherchable, sans limite. Le serveur refuse desormais une part attribuee a
   * quelqu'un hors de ce perimetre (audit SEC-2), l'interface doit donc
   * proposer exactement ce qu'il accepte.
   */
  const candidates = useMemo<User[]>(() => {
    const pool = groupId
      ? groupMembersOf(state, groupId)
      : (() => {
          const ids = new Set([me.id, ...friendIds(state)])
          return state.users.filter((u) => ids.has(u.id))
        })()

    // Les potes vus recemment d'abord : c'est presque toujours eux qu'on cherche.
    const recency = new Map(relationSummaries(state).map((r) => [r.userId, r.lastActivity]))
    return [...pool].sort((a, b) => {
      if (a.id === me.id) return -1
      if (b.id === me.id) return 1
      const ra = recency.get(a.id) ?? ''
      const rb = recency.get(b.id) ?? ''
      if (ra !== rb) return rb.localeCompare(ra)
      return a.name.localeCompare(b.name)
    })
  }, [state, groupId, me.id])

  const byId = useMemo(() => new Map(state.users.map((u) => [u.id, u])), [state.users])

  const visibleCandidates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((u) => u.name.toLowerCase().includes(q))
  }, [candidates, query])

  // Si on change de groupe, on ne garde que les participants encore membres.
  useEffect(() => {
    if (!groupId) return
    const ids = new Set(groupMembersOf(state, groupId).map((u) => u.id))
    setParticipants((prev) => {
      const next = prev.filter((p) => ids.has(p))
      return next.includes(me.id) || !ids.has(me.id) ? next : [me.id, ...next]
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
  /**
   * En mode « items » le montant total reste saisi par l'utilisateur : c'est le
   * ticket. On lui montre ce qui n'est pas encore attribue au lieu de rogner
   * silencieusement la depense sur la somme des items (audit UX-8).
   */
  const diff = round(total - assigned)

  const amountError =
    total > MAX_AMOUNT ? `Maximum ${formatAmount(MAX_AMOUNT)}` : total < 0 ? 'Montant invalide' : null

  const canSubmit =
    total > 0 &&
    total <= MAX_AMOUNT &&
    Object.keys(shares).length > 0 &&
    diff === 0 &&
    (splitType !== 'equal' || participants.length >= 2)

  const toggleParticipant = (id: ID) => {
    setParticipants((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  const submit = () => {
    if (!canSubmit) return
    const input = {
      amount: total,
      motive,
      payerId,
      groupId: groupId || null,
      splitType,
      shares,
    }
    if (editing) {
      amendExpense(editing.id, input)
      toast('Depense corrigee — les soldes sont a jour')
    } else {
      addExpense(input)
      toast('Depense ajoutee — les soldes sont a jour')
    }
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Corriger la depense' : 'Ajouter une depense'}
      subtitle={
        editing
          ? 'La correction est repercutee sur les soldes des deux cotes'
          : 'Les dettes bilaterales sont generees automatiquement'
      }
      size="lg"
      footer={
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-navy/60">Reparti</p>
            <p className={clsx('text-sm font-bold', diff === 0 ? 'text-navy' : 'text-debit')}>
              {formatAmount(assigned)}
              {total > 0 && <span className="text-navy/60"> / {formatAmount(total)}</span>}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-silver tap px-4 text-sm font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
          >
            Annuler
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded-xl bg-brand tap px-5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-40"
          >
            {editing ? 'Enregistrer' : 'Valider'}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="expense-amount" className="mb-1.5 block text-xs font-medium text-navy/60">
              Montant total (DA)
            </label>
            <input
              id="expense-amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_AMOUNT}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="3000"
              aria-invalid={Boolean(amountError)}
            />
            {amountError && (
              <p className="mt-1 text-[11px] font-semibold text-debit">{amountError}</p>
            )}
          </div>
          <div>
            <label htmlFor="expense-motive" className="mb-1.5 block text-xs font-medium text-navy/60">
              Motif
            </label>
            <input
              id="expense-motive"
              type="text"
              maxLength={MAX_MOTIVE}
              value={motive}
              onChange={(e) => setMotive(e.target.value)}
              placeholder="Restau samedi"
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="expense-payer" className="mb-1.5 block text-xs font-medium text-navy/60">
              Qui a paye
            </label>
            <select id="expense-payer" value={payerId} onChange={(e) => setPayerId(e.target.value)}>
              {candidates.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.id === me.id ? `${u.name} (moi)` : u.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="expense-group" className="mb-1.5 block text-xs font-medium text-navy/60">
              Groupe (optionnel)
            </label>
            <select id="expense-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
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
          <p className="mb-1.5 text-xs font-medium text-navy/60">Mode de repartition</p>
          <div className="glass-sm flex gap-1 rounded-2xl p-1">
            {(['equal', 'custom', 'items'] as SplitType[]).map((t) => (
              <button
                key={t}
                onClick={() => setSplitType(t)}
                className={clsx(
                  'relative flex-1 rounded-xl px-3 py-2 text-xs font-semibold transition-colors',
                  splitType === t ? 'text-white' : 'text-navy/60 hover:text-navy'
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
              <p className="text-xs font-medium text-navy/60">Qui a consomme quoi</p>
              {items.map((it, i) => (
                <div key={it.id} className="glass-sm flex items-center gap-2 rounded-2xl p-2">
                  <input
                    type="text"
                    value={it.label}
                    placeholder={`Item ${i + 1}`}
                    aria-label={`Libelle de l'item ${i + 1}`}
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
                    aria-label={`Prix de l'item ${i + 1}`}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((x) => (x.id === it.id ? { ...x, price: e.target.value } : x))
                      )
                    }
                    className="w-24"
                  />
                  <select
                    value={it.userId}
                    aria-label={`Beneficiaire de l'item ${i + 1}`}
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
                    aria-label={`Supprimer l'item ${i + 1}`}
                    className="rounded-lg p-2 text-navy/45 transition-colors hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <button
                onClick={() =>
                  setItems((prev) => [...prev, { id: uid('it'), label: '', price: '', userId: '' }])
                }
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <Plus size={14} /> Ajouter un item
              </button>

              {/* Recapitulatif par personne : sans lui, impossible de verifier
                  la repartition avant de valider. */}
              {assigned > 0 && (
                <div className="glass-sm mt-2 space-y-1.5 rounded-2xl p-3">
                  {Object.entries(shares).map(([id, value]) => (
                    <div key={id} className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-navy">
                        {id === me.id ? 'Moi' : (byId.get(id)?.name ?? 'Pote')}
                      </span>
                      <span className="font-semibold text-navy/70">{formatAmount(value)}</span>
                    </div>
                  ))}
                </div>
              )}

              {total > 0 && diff !== 0 && (
                <p className="text-xs font-semibold text-debit">
                  {diff > 0
                    ? `Il reste ${formatAmount(diff)} non attribues`
                    : `${formatAmount(diff)} de trop par rapport au montant total`}
                </p>
              )}
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
              <p className="text-xs font-medium text-navy/60">Participants</p>

              {candidates.length > SEARCH_THRESHOLD && (
                <div className="relative">
                  <Search
                    size={14}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy/45"
                  />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Chercher un pote…"
                    aria-label="Chercher un participant"
                    className="!pl-9"
                  />
                </div>
              )}

              {candidates.length === 0 ? (
                <p className="rounded-xl bg-cream px-3 py-2 text-[11px] font-semibold text-navy/70">
                  Ajoute d&apos;abord un pote depuis l&apos;onglet Profil.
                </p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {visibleCandidates.map((u) => {
                    const on = participants.includes(u.id)
                    return (
                      <button
                        key={u.id}
                        onClick={() => toggleParticipant(u.id)}
                        aria-pressed={on}
                        className={clsx(
                          'flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3 text-xs font-semibold transition-colors',
                          on
                            ? 'border-brand/40 bg-brand/10 text-navy'
                            : 'border-silver text-navy/60 hover:bg-white/50 hover:text-navy'
                        )}
                      >
                        <Avatar user={u} size="sm" className="h-6 w-6 text-xs" />
                        {u.id === me.id ? 'Moi' : u.name}
                        {on && <Check size={13} className="text-brand" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {splitType === 'custom' && participants.length > 0 && (
                <div className="glass-sm mt-2 space-y-2 rounded-2xl p-3">
                  {participants.map((p) => {
                    // Un participant dont le profil n'est pas charge ne doit pas
                    // faire tomber l'ecran : l'ancienne version utilisait une
                    // assertion non nulle ici (audit UX-4).
                    const u = byId.get(p)
                    return (
                      <div key={p} className="flex items-center gap-3">
                        <Avatar user={u ?? { id: p, name: 'Pote', avatar: '🙂' }} size="sm" />
                        <span className="flex-1 text-sm font-semibold text-navy">
                          {p === me.id ? 'Moi' : (u?.name ?? 'Pote')}
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          value={custom[p] ?? ''}
                          placeholder="0"
                          aria-label={`Part de ${u?.name ?? 'ce pote'}`}
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
                    const u = byId.get(p)
                    return (
                      <div key={p} className="flex items-center justify-between text-sm">
                        <span className="font-semibold text-navy">
                          {p === me.id ? 'Moi' : (u?.name ?? 'Pote')}
                        </span>
                        <span className="font-semibold text-navy/70">
                          {formatAmount(shares[p] ?? 0)}
                        </span>
                      </div>
                    )
                  })}
                  <p className="pt-1 text-[11px] font-medium text-navy/60">
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
