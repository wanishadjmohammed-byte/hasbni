'use client'

import { motion } from 'framer-motion'
import { UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import Avatar from './Avatar'
import { useApp } from '@/context/AppContext'
import { relativeDate } from '@/lib/date'
import { incomingRequests } from '@/lib/ledger'
import { cardHover } from '@/lib/motion'

/**
 * Demandes de pote recues. Affiche a la fois dans Activite et dans Profil :
 * une demande ne doit jamais rester invisible.
 */
export default function FriendRequests({ title = 'Demandes de pote' }: { title?: string }) {
  const { state, respondToRequest, toast } = useApp()
  const [busy, setBusy] = useState<string | null>(null)

  const requests = incomingRequests(state)
  if (requests.length === 0) return null

  const answer = async (id: string, accept: boolean, name: string) => {
    setBusy(id)
    try {
      await respondToRequest(id, accept)
      toast(
        accept ? `${name} est maintenant ton pote` : 'Demande refusee',
        accept ? 'success' : 'info'
      )
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Erreur', 'danger')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-navy/50">{title}</p>
      {requests.map(({ request, user }) => (
        <motion.div key={request.id} {...cardHover} className="glass rounded-2xl p-4">
          <div className="flex items-center gap-3">
            <Avatar user={user} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-navy">
                {user.name} veut etre ton pote
              </p>
              <p className="truncate text-xs font-medium text-navy/45" suppressHydrationWarning>
                {user.email ?? 'compte Hasbni'} · {relativeDate(request.createdAt)}
              </p>
            </div>
            <button
              onClick={() => void answer(request.id, false, user.name)}
              disabled={busy === request.id}
              aria-label="Refuser"
              className="tap rounded-xl border border-silver px-3 text-xs font-semibold text-navy/45 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
            >
              <X size={15} />
            </button>
            <button
              onClick={() => void answer(request.id, true, user.name)}
              disabled={busy === request.id}
              className="tap gap-1.5 rounded-xl bg-brand px-3 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:opacity-40"
            >
              <UserPlus size={14} /> Accepter
            </button>
          </div>
        </motion.div>
      ))}
    </div>
  )
}
