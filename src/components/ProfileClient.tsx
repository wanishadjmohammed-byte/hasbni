'use client'

import { motion } from 'framer-motion'
import { CloudOff, Database, LogOut, RefreshCw, RotateCcw, Save, UserPlus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import Avatar from './Avatar'
import Modal from './Modal'
import PageHeader from './PageHeader'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { formatAmount, globalTotals, relationSummaries } from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'

export default function ProfileClient() {
  const { state, me, updateProfile, addFriend, resetDemo, toast, syncStatus, pendingSync, refresh } =
    useApp()
  const { mode, signOut } = useAuth()
  const router = useRouter()

  const [name, setName] = useState(me.name)
  const [phone, setPhone] = useState(me.phone ?? '')
  const [email, setEmail] = useState(me.email ?? '')
  const [avatar, setAvatar] = useState(me.avatar ?? '🙂')

  const [friendOpen, setFriendOpen] = useState(false)
  const [fName, setFName] = useState('')
  const [fPhone, setFPhone] = useState('')
  const [fAvatar, setFAvatar] = useState('🙂')

  const totals = globalTotals(state)
  const relations = relationSummaries(state)

  const advancedThisMonth = state.expenses
    .filter(
      (e) =>
        e.payerId === me.id &&
        !e.cancelled &&
        new Date(e.createdAt).getMonth() === new Date().getMonth()
    )
    .reduce((sum, e) => sum + e.amount, 0)

  const save = () => {
    updateProfile({ name, phone, email, avatar })
    toast('Profil mis a jour')
  }

  const logout = async () => {
    await signOut()
    router.replace('/login')
  }

  const submitFriend = () => {
    if (!fName.trim()) return
    addFriend(fName, fPhone, fAvatar)
    toast(`${fName.trim()} ajoute a tes potes`)
    setFriendOpen(false)
    setFName('')
    setFPhone('')
    setFAvatar('🙂')
  }

  return (
    <>
      <PageHeader
        title="Profil"
        subtitle="Ton compte et tes potes"
        action={
          <button
            onClick={() => setFriendOpen(true)}
            className="tap flex shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
          >
            <UserPlus size={16} /> Pote
          </button>
        }
      />

      <motion.div {...pageIn} className="space-y-4 p-6">
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <Avatar user={{ name, avatar, color: me.color }} size="xl" />
            <div className="min-w-0">
              <p className="text-lg font-bold text-navy">{name}</p>
              <p className="text-xs font-medium text-navy/45">{phone || email || 'Aucun contact'}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Nom</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Avatar (emoji)</label>
              <input
                type="text"
                value={avatar}
                maxLength={2}
                onChange={(e) => setAvatar(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Telephone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>

          <button
            onClick={save}
            className="mt-4 flex items-center gap-1.5 rounded-xl bg-brand tap px-4 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean"
          >
            <Save size={15} /> Enregistrer
          </button>
        </div>

        {/* Recap */}
        <motion.div
          variants={listParent}
          initial="hidden"
          animate="show"
          className="grid gap-3 sm:grid-cols-3"
        >
          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/50">Avance ce mois-ci</p>
            <p className="mt-1 text-xl font-bold text-navy">{formatAmount(advancedThisMonth)}</p>
          </motion.div>
          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/50">Relations actives</p>
            <p className="mt-1 text-xl font-bold text-navy">{relations.length}</p>
          </motion.div>
          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/50">En attente</p>
            <p className="mt-1 text-xl font-bold text-navy">{totals.pendingCount}</p>
          </motion.div>
        </motion.div>

        {/* Potes */}
        <div className="glass rounded-2xl p-4">
          <p className="mb-2 text-xs font-medium text-navy/50">Mes potes</p>
          <div className="space-y-2">
            {state.users
              .filter((u) => u.id !== me.id)
              .map((u) => (
                <Link
                  key={u.id}
                  href={`/relation/${u.id}`}
                  className="glass-sm flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white/55"
                >
                  <Avatar user={u} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy">{u.name}</p>
                    <p className="truncate text-[11px] font-medium text-navy/45">
                      {u.phone ?? 'sans numero'}
                    </p>
                  </div>
                </Link>
              ))}
          </div>
        </div>

        {/* Zone technique */}
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-navy/45" />
            <p className="text-xs font-medium text-navy/50">Donnees et synchronisation</p>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/60 px-2.5 py-1 text-[11px] font-bold text-navy/60">
              {mode === 'demo' ? 'Mode demonstration' : 'Supabase'}
            </span>
            <span className="flex items-center gap-1 rounded-full bg-white/60 px-2.5 py-1 text-[11px] font-bold text-navy/60">
              {syncStatus === 'offline' ? (
                <>
                  <CloudOff size={11} /> Hors ligne
                </>
              ) : syncStatus === 'syncing' ? (
                <>
                  <RefreshCw size={11} className="animate-spin" /> Synchronisation
                </>
              ) : syncStatus === 'error' ? (
                <>Erreur de synchro</>
              ) : (
                <>A jour</>
              )}
            </span>
            {pendingSync > 0 && (
              <span className="rounded-full bg-cream px-2.5 py-1 text-[11px] font-bold text-navy/60">
                {pendingSync} en file
              </span>
            )}
          </div>

          <p className="mt-2 text-xs font-medium text-navy/45">
            {mode === 'demo'
              ? 'Aucune variable Supabase detectee : les donnees restent sur cet appareil (IndexedDB).'
              : 'Les mouvements sont stockes dans Postgres avec RLS. Hors ligne, la saisie est mise en file locale puis rejouee.'}
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            {mode === 'supabase' && (
              <button
                onClick={() => {
                  void refresh()
                  toast('Actualisation…', 'info')
                }}
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <RefreshCw size={14} /> Actualiser
              </button>
            )}
            {mode === 'demo' && (
              <button
                onClick={() => {
                  resetDemo()
                  toast('Donnees de demo restaurees', 'info')
                }}
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <RotateCcw size={14} /> Reinitialiser la demo
              </button>
            )}
            {mode === 'supabase' ? (
              <button
                onClick={() => void logout()}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-navy/45 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <LogOut size={14} /> Se deconnecter
              </button>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-navy/45 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <LogOut size={14} /> Ecran de connexion
              </Link>
            )}
          </div>
        </div>
      </motion.div>

      <Modal
        open={friendOpen}
        onClose={() => setFriendOpen(false)}
        title="Ajouter un pote"
        subtitle="Par numero ou lien d'invitation"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => setFriendOpen(false)}
              className="rounded-xl border border-silver tap px-4 text-sm font-semibold text-navy/50 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Annuler
            </button>
            <button
              onClick={submitFriend}
              disabled={!fName.trim()}
              className="rounded-xl bg-brand tap px-5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-40"
            >
              Ajouter
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="w-20">
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Emoji</label>
              <input
                type="text"
                value={fAvatar}
                maxLength={2}
                onChange={(e) => setFAvatar(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium text-navy/50">Nom</label>
              <input
                type="text"
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="Souhil"
              />
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy/50">Telephone</label>
            <input
              type="tel"
              value={fPhone}
              onChange={(e) => setFPhone(e.target.value)}
              placeholder="+213 …"
            />
          </div>
        </div>
      </Modal>
    </>
  )
}
