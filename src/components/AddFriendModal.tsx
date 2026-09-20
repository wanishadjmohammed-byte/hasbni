'use client'

import { Check, Clock3, Loader2, Search, UserPlus } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import Avatar from './Avatar'
import Modal from './Modal'
import { useApp } from '@/context/AppContext'
import { SEARCH_MIN_CHARS } from '@/lib/supabase/repo'
import type { ID, ProfileSearchResult } from '@/lib/types'

/**
 * Recherche de potes.
 *
 * Trois mesures pour qu'une frappe rapide ne devienne pas une rafale de
 * requetes :
 *
 *  - on n'appelle pas en dessous de trois caracteres ;
 *  - chaque frappe repousse l'appel de 300 ms (anti-rebond) ;
 *  - la requete precedente est ABANDONNEE quand une nouvelle part, sinon une
 *    reponse lente pourrait ecraser une reponse plus recente.
 *
 * Cote serveur, `search_profiles` cherche par prefixe sur index et plafonne a
 * dix lignes : le client ne telecharge jamais d'annuaire.
 */
const DEBOUNCE_MS = 300

const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())

export default function AddFriendModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { searchPotes, addFriendById, addFriend, toast } = useApp()

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ProfileSearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [sending, setSending] = useState<ID | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const controller = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults([])
      setError(null)
      setSearched(false)
    }
  }, [open])

  useEffect(() => {
    const needle = query.trim()
    if (needle.length < SEARCH_MIN_CHARS) {
      controller.current?.abort()
      setResults([])
      setBusy(false)
      setSearched(false)
      return
    }

    setBusy(true)
    const timer = window.setTimeout(async () => {
      controller.current?.abort()
      const next = new AbortController()
      controller.current = next
      try {
        const found = await searchPotes(needle, next.signal)
        if (next.signal.aborted) return
        setResults(found)
        setSearched(true)
        setError(null)
      } catch (e) {
        if (!next.signal.aborted) setError(e instanceof Error ? e.message : 'Recherche impossible')
      } finally {
        if (!next.signal.aborted) setBusy(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [query, searchPotes])

  useEffect(() => () => controller.current?.abort(), [])

  const send = useCallback(
    async (profileId: ID, name: string) => {
      setSending(profileId)
      setError(null)
      try {
        const result = await addFriendById(profileId)
        toast(
          result === 'accepted' ? `Vous etes potes avec ${name} !` : `Demande envoyee a ${name}`
        )
        // Le statut renvoye par la recherche devient obsolete : on le corrige
        // sur place plutot que de relancer une requete.
        setResults((prev) =>
          prev.map((r) =>
            r.profileId === profileId
              ? { ...r, relation: result === 'accepted' ? 'friend' : 'sent' }
              : r
          )
        )
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Envoi impossible')
      } finally {
        setSending(null)
      }
    },
    [addFriendById, toast]
  )

  const sendByEmail = useCallback(async () => {
    setSending('email')
    setError(null)
    try {
      const result = await addFriend(query)
      toast(result === 'accepted' ? 'Vous etes potes !' : 'Demande envoyee')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Envoi impossible')
    } finally {
      setSending(null)
    }
  }, [addFriend, query, toast, onClose])

  const tooShort = query.trim().length > 0 && query.trim().length < SEARCH_MIN_CHARS

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajouter un pote"
      subtitle="Cherche-le par son pseudo"
      footer={
        <div className="flex items-center justify-end">
          <button
            onClick={onClose}
            className="tap rounded-xl border border-silver px-4 text-sm font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy"
          >
            Fermer
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-navy/55"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="pseudo ou nom…"
            aria-label="Chercher un pote par pseudo ou nom"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="!pl-9"
          />
          {busy && (
            <Loader2
              size={15}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-brand"
            />
          )}
        </div>

        {error && (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-[11px] font-semibold text-red-600">
            {error}
          </p>
        )}

        {tooShort && (
          <p className="text-[11px] font-medium text-navy/60">
            Encore {SEARCH_MIN_CHARS - query.trim().length} caractere
            {SEARCH_MIN_CHARS - query.trim().length > 1 ? 's' : ''}…
          </p>
        )}

        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.profileId} className="glass-sm flex items-center gap-3 rounded-2xl p-3">
              <Avatar user={{ name: r.name, avatar: r.avatar, color: r.color }} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-navy">{r.name}</p>
                <p className="truncate text-[11px] font-medium text-navy/60">@{r.username}</p>
              </div>

              {r.relation === 'friend' ? (
                <span className="flex items-center gap-1 text-[11px] font-bold text-brand">
                  <Check size={13} /> Pote
                </span>
              ) : r.relation === 'sent' ? (
                <span className="flex items-center gap-1 text-[11px] font-semibold text-navy/60">
                  <Clock3 size={12} /> Envoyee
                </span>
              ) : r.relation === 'received' ? (
                <button
                  onClick={() => void send(r.profileId, r.name)}
                  disabled={sending === r.profileId}
                  className="tap rounded-xl bg-brand px-3 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:opacity-50"
                >
                  {sending === r.profileId ? <Loader2 size={14} className="animate-spin" /> : 'Accepter'}
                </button>
              ) : (
                <button
                  onClick={() => void send(r.profileId, r.name)}
                  disabled={sending === r.profileId}
                  aria-label={`Ajouter ${r.name}`}
                  className="tap flex items-center gap-1.5 rounded-xl bg-brand px-3 text-xs font-semibold text-white shadow-sm shadow-brand/25 transition-colors hover:bg-ocean disabled:opacity-50"
                >
                  {sending === r.profileId ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <>
                      <UserPlus size={13} /> Ajouter
                    </>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>

        {searched && results.length === 0 && !busy && (
          <div className="glass-sm rounded-2xl p-4 text-center">
            <p className="text-sm font-semibold text-navy">Personne a ce pseudo</p>
            <p className="mt-1 text-[11px] font-medium text-navy/60">
              Verifie l&apos;orthographe — la recherche part du debut du pseudo.
            </p>

            {/* Repli : si ce qui est tape ressemble a une adresse, on garde le
                chemin par email plutot que de renvoyer l'utilisateur dans le
                mur. */}
            {looksLikeEmail(query) && (
              <button
                onClick={() => void sendByEmail()}
                disabled={sending === 'email'}
                className="tap mt-3 rounded-xl border border-silver px-3 text-xs font-semibold text-navy/60 transition-colors hover:bg-white/50 hover:text-navy disabled:opacity-50"
              >
                {sending === 'email' ? 'Envoi…' : 'Envoyer plutot a cette adresse email'}
              </button>
            )}
          </div>
        )}

        <p className="text-[11px] font-medium text-navy/60">
          Ton pseudo est visible dans ta fiche Profil — partage-le pour qu&apos;on te trouve.
        </p>
      </div>
    </Modal>
  )
}
