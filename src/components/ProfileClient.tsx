'use client'

import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CloudOff,
  Database,
  Download,
  LogOut,
  RefreshCw,
  RotateCcw,
  Loader2,
  Save,
  Trash2,
  UserPlus,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import Avatar from './Avatar'
import ConfirmDialog from './ConfirmDialog'
import FriendRequests from './FriendRequests'
import Modal from './Modal'
import PageHeader from './PageHeader'
import { useApp } from '@/context/AppContext'
import { useAuth } from '@/context/AuthContext'
import { formatAmount, globalTotals, outgoingRequests, relationSummaries } from '@/lib/ledger'
import { cardHover, listItemY, listParent, pageIn } from '@/lib/motion'

/** Libelle lisible d'une operation refusee. */
function describeOp(kind: string): string {
  switch (kind) {
    case 'expense.create':
      return 'Ajout d’une depense'
    case 'expense.amend':
      return 'Correction d’une depense'
    case 'settlement.create':
      return 'Enregistrement d’un remboursement'
    case 'settlement.confirm':
      return 'Confirmation d’un remboursement'
    case 'movement.cancel':
      return 'Annulation d’un mouvement'
    case 'group.create':
      return 'Creation d’un groupe'
    case 'group.member.add':
      return 'Ajout d’un membre'
    case 'group.member.remove':
      return 'Retrait d’un membre'
    case 'group.update':
      return 'Modification d’un groupe'
    case 'profile.update':
      return 'Mise a jour du profil'
    default:
      return 'Operation'
  }
}

export default function ProfileClient() {
  const {
    state,
    me,
    updateProfile,
    addFriend,
    resetDemo,
    toast,
    syncStatus,
    pendingSync,
    refresh,
    rejectedOps,
    discardRejectedOp,
    discardAllRejected,
    deleteAccount,
    exportData,
  } = useApp()
  const { mode, signOut } = useAuth()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [name, setName] = useState(me.name)
  const [phone, setPhone] = useState(me.phone ?? '')
  const [avatar, setAvatar] = useState(me.avatar ?? '🙂')

  const [friendOpen, setFriendOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [fEmail, setFEmail] = useState('')
  const [fBusy, setFBusy] = useState(false)
  const [fError, setFError] = useState<string | null>(null)

  useEffect(() => {
    if (searchParams.get('ajouter-pote')) setFriendOpen(true)
  }, [searchParams])

  const totals = globalTotals(state)
  const sentRequests = outgoingRequests(state)
  const relations = relationSummaries(state)

  const now = new Date()
  const advancedThisMonth = state.expenses
    .filter((e) => {
      if (e.payerId !== me.id || e.cancelled) return false
      const d = new Date(e.createdAt)
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
    })
    .reduce((sum, e) => sum + e.amount, 0)

  const save = () => {
    // `email` n'est volontairement pas modifiable : il reflete le compte, et
    // sert de cle pour les demandes de pote (audit SEC-3).
    updateProfile({ name, phone, avatar })
    toast('Profil mis a jour')
  }

  const download = async () => {
    try {
      const data = await exportData()
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `hasbni-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('Export telecharge')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export impossible', 'danger')
    }
  }

  const removeAccount = async () => {
    try {
      await deleteAccount()
      router.replace('/login')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Suppression impossible', 'danger')
    }
  }

  const logout = async () => {
    await signOut()
    router.replace('/login')
  }

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fEmail.trim())

  const submitFriend = async () => {
    if (!emailValid || fBusy) return
    setFBusy(true)
    setFError(null)
    try {
      const result = await addFriend(fEmail)
      toast(
        result === 'accepted'
          ? 'Vous etes potes !'
          : 'Demande envoyee — il doit l’accepter dans l’app'
      )
      setFriendOpen(false)
      setFEmail('')
    } catch (e) {
      setFError(e instanceof Error ? e.message : 'Erreur inconnue')
    } finally {
      setFBusy(false)
    }
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
        <FriendRequests />

        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <Avatar user={{ name, avatar, color: me.color }} size="xl" />
            <div className="min-w-0">
              <p className="text-lg font-bold text-navy">{name}</p>
              <p className="text-xs font-medium text-navy/60">{phone || me.email || 'Aucun contact'}</p>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/60">Nom</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/60">Avatar (emoji)</label>
              <input
                type="text"
                value={avatar}
                maxLength={2}
                onChange={(e) => setAvatar(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-navy/60">Telephone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label htmlFor="profile-email" className="mb-1.5 block text-xs font-medium text-navy/60">
                Email
              </label>
              <input
                id="profile-email"
                type="email"
                value={me.email ?? ''}
                readOnly
                aria-describedby="profile-email-help"
                className="cursor-not-allowed opacity-70"
              />
              <p id="profile-email-help" className="mt-1 text-[11px] font-medium text-navy/60">
                C&apos;est l&apos;adresse de ton compte, et celle par laquelle tes potes
                t&apos;ajoutent. Elle ne se modifie pas ici.
              </p>
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
            <p className="text-xs font-medium text-navy/60">Avance ce mois-ci</p>
            <p className="mt-1 text-xl font-bold text-navy">{formatAmount(advancedThisMonth)}</p>
          </motion.div>
          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/60">Relations actives</p>
            <p className="mt-1 text-xl font-bold text-navy">{relations.length}</p>
          </motion.div>
          <motion.div variants={listItemY} {...cardHover} className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/60">En attente</p>
            <p className="mt-1 text-xl font-bold text-navy">{totals.pendingCount}</p>
          </motion.div>
        </motion.div>

        {/* Potes */}
        <div className="glass rounded-2xl p-4">
          <p className="mb-2 text-xs font-medium text-navy/60">Mes potes</p>
          <div className="space-y-2">
            {relations
              .map((r) => r.user)
              .map((u) => (
                <Link
                  key={u.id}
                  href={`/relation/${u.id}`}
                  className="glass-sm flex items-center gap-3 rounded-2xl p-3 transition-colors hover:bg-white/55"
                >
                  <Avatar user={u} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy">{u.name}</p>
                    <p className="truncate text-[11px] font-medium text-navy/60">
                      {u.phone ?? 'sans numero'}
                    </p>
                  </div>
                </Link>
              ))}
          </div>
        </div>

        {/* Saisies refusees par le serveur.
            Avant, une operation refusee definitivement etait supprimee de la
            file et remplacee par un toast : l'utilisateur avait vu
            « enregistre », puis sa saisie disparaissait sans laisser de trace
            (audit CRD-4). */}
        {rejectedOps.length > 0 && (
          <div className="glass rounded-2xl border border-red-200 p-4">
            <div className="flex items-center gap-2">
              <AlertTriangle size={15} className="text-red-600" />
              <p className="text-sm font-bold text-navy">
                {rejectedOps.length} saisie{rejectedOps.length > 1 ? 's' : ''} non enregistree
                {rejectedOps.length > 1 ? 's' : ''}
              </p>
            </div>
            <p className="mt-1 text-xs font-medium text-navy/60">
              Le serveur les a refusees. Elles ne sont pas dans tes comptes.
            </p>
            <div className="mt-3 space-y-2">
              {rejectedOps.map((r) => (
                <div key={r.opId} className="glass-sm rounded-xl p-3">
                  <p className="text-xs font-bold text-navy">{describeOp(r.op.kind)}</p>
                  <p className="mt-0.5 text-[11px] font-medium text-red-600">{r.reason}</p>
                  <button
                    onClick={() => void discardRejectedOp(r.opId)}
                    className="mt-2 text-[11px] font-semibold text-navy/60 underline underline-offset-2 hover:text-navy"
                  >
                    Retirer de la liste
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => void discardAllRejected()}
              className="mt-3 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Tout retirer
            </button>
          </div>
        )}

        {/* Zone technique */}
        <div className="glass rounded-2xl p-4">
          <div className="flex items-center gap-2">
            <Database size={14} className="text-navy/60" />
            <p className="text-xs font-medium text-navy/60">Donnees et synchronisation</p>
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

          <p className="mt-2 text-xs font-medium text-navy/60">
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
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
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
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <RotateCcw size={14} /> Reinitialiser la demo
              </button>
            )}
            {mode === 'supabase' ? (
              <button
                onClick={() => void logout()}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <LogOut size={14} /> Se deconnecter
              </button>
            ) : (
              <Link
                href="/login"
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-red-50 hover:text-red-500"
              >
                <LogOut size={14} /> Ecran de connexion
              </Link>
            )}
          </div>
        </div>
        {/* Compte et donnees (audit OPS-5) */}
        {mode === 'supabase' && (
          <div className="glass rounded-2xl p-4">
            <p className="text-xs font-medium text-navy/60">Mon compte</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={() => void download()}
                className="flex items-center gap-1.5 rounded-xl border border-silver px-3 py-2 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
              >
                <Download size={14} /> Exporter mes donnees
              </button>
              <button
                onClick={() => setDeleteOpen(true)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50"
              >
                <Trash2 size={14} /> Supprimer mon compte
              </button>
            </div>
          </div>
        )}
      </motion.div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={() => void removeAccount()}
        title="Supprimer mon compte"
        message="Ton profil est anonymise et ton acces supprime. Les mouvements deja partages restent dans l'historique de tes potes — sans quoi leurs soldes deviendraient faux. Cette action est definitive."
        confirmLabel="Supprimer definitivement"
        tone="danger"
      />

      <Modal
        open={friendOpen}
        onClose={() => {
          setFriendOpen(false)
          setFError(null)
        }}
        title="Ajouter un pote"
        subtitle="Il recevra une demande dans l'app"
        footer={
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={() => {
                setFriendOpen(false)
                setFError(null)
              }}
              className="tap rounded-xl border border-silver px-4 text-sm font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
            >
              Annuler
            </button>
            <button
              onClick={() => void submitFriend()}
              disabled={!emailValid || fBusy}
              className="tap rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:cursor-not-allowed disabled:opacity-40"
            >
              {fBusy ? <Loader2 size={16} className="animate-spin" /> : 'Envoyer'}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-navy/60">
              Email de ton pote
            </label>
            <input
              type="email"
              value={fEmail}
              onChange={(e) => {
                setFEmail(e.target.value)
                setFError(null)
              }}
              placeholder="souhil@exemple.dz"
              autoCapitalize="none"
              onKeyDown={(e) => e.key === 'Enter' && void submitFriend()}
            />
          </div>

          {fError && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-500">
              {fError}
            </p>
          )}

          <p className="text-[11px] font-medium text-navy/60">
            Il doit deja avoir un compte Hasbni avec cet email.
          </p>

          {sentRequests.length > 0 && (
            <div className="glass-sm rounded-2xl p-3">
              <p className="mb-2 text-xs font-medium text-navy/60">Demandes envoyees</p>
              <div className="space-y-2">
                {sentRequests.map(({ request, user }) => (
                  <div key={request.id} className="flex items-center gap-2.5">
                    <Avatar user={user} size="sm" />
                    <span className="flex-1 truncate text-sm font-semibold text-navy">
                      {user.name}
                    </span>
                    <span className="text-[11px] font-semibold text-navy/60">en attente</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </>
  )
}
