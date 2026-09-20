'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from './AuthContext'
import { recomputeBalances, uid } from '@/lib/ledger'
import {
  bumpAttempts,
  clearQueue,
  clearRejected,
  clearSnapshot,
  dequeueOp,
  discardRejected,
  enqueueOp,
  loadSnapshot,
  readQueue,
  readRejected,
  rejectOp,
  saveSnapshot,
  type RejectedOp,
} from '@/lib/idb'
import {
  applyOp,
  buildAmendOp,
  buildCancelOp,
  buildExpenseOp,
  buildGroupOp,
  buildSettlementOp,
  envelope,
  type Op,
} from '@/lib/ops'
import { bucket, track } from '@/lib/analytics'
import { buildSeed } from '@/lib/seed'
import { getSupabase, supabaseEnabled } from '@/lib/supabase/client'
import {
  deleteMyAccount,
  exportMyData,
  fetchState,
  PermanentSyncError,
  pushOp,
  respondFriendRequest,
  searchProfiles,
  sendFriendRequest,
  sendFriendRequestTo,
  setUsername,
} from '@/lib/supabase/repo'
import type { AppState, Group, ID, ProfileSearchResult, SplitType, User } from '@/lib/types'

const MAX_ATTEMPTS = 6

/** Un retour d'onglet ne declenche pas un rechargement complet plus souvent. */
const REFRESH_TTL_MS = 30_000
/** Les evenements temps reel arrivent en rafale : on les regroupe. */
const REALTIME_DEBOUNCE_MS = 600
/** L'instantane local n'est pas reecrit a chaque frappe. */
const SNAPSHOT_DEBOUNCE_MS = 1_000

export interface NewExpenseInput {
  amount: number
  motive: string
  payerId: ID
  groupId: ID | null
  splitType: SplitType
  shares: Record<ID, number>
}

export interface NewSettlementInput {
  fromUser: ID
  toUser: ID
  amount: number
  note?: string
  method: 'cash' | 'transfer'
}

export interface Toast {
  id: string
  message: string
  tone: 'success' | 'info' | 'danger'
}

export type SyncStatus = 'demo' | 'idle' | 'syncing' | 'offline' | 'error'

interface AppContextValue {
  state: AppState
  me: User
  ready: boolean
  online: boolean
  syncStatus: SyncStatus
  pendingSync: number
  addExpense: (input: NewExpenseInput) => void
  /** Correction d'une depense existante — cf. `amend_expense` cote SQL. */
  amendExpense: (expenseId: ID, input: NewExpenseInput) => void
  addSettlement: (input: NewSettlementInput) => void
  confirmSettlement: (id: ID) => void
  /** Annulation par mouvement inverse — jamais de suppression physique (CDC 3). */
  cancelMovement: (kind: 'expense' | 'settlement', id: ID) => void
  /** Demande de pote par email. Leve une erreur lisible si l'email est inconnu. */
  addFriend: (email: string) => Promise<'sent' | 'accepted'>
  /** Recherche par debut de pseudo ou de nom — bornee a dix resultats. */
  searchPotes: (query: string, signal?: AbortSignal) => Promise<ProfileSearchResult[]>
  /** Demande de pote a partir d'un resultat de recherche. */
  addFriendById: (profileId: ID) => Promise<'sent' | 'accepted'>
  /** Choix du pseudo public. */
  changeUsername: (username: string) => Promise<string>
  respondToRequest: (requestId: ID, accept: boolean) => Promise<void>
  createGroup: (name: string, emoji: string, memberIds: ID[]) => Group
  /** N'importe quel membre du groupe peut en ajouter d'autres. */
  addGroupMember: (groupId: ID, userId: ID) => void
  /** Le chef retire qui il veut ; chacun peut se retirer lui-meme. */
  removeGroupMember: (groupId: ID, userId: ID) => void
  updateGroup: (groupId: ID, name: string, emoji: string) => void
  /** Reserve au createur. Les depenses sont detachees, jamais supprimees. */
  deleteGroup: (groupId: ID) => void
  /** `email` est exclu : c'est un miroir du compte (audit SEC-3). */
  updateProfile: (patch: Partial<Pick<User, 'name' | 'phone' | 'avatar'>>) => void
  /** Saisies refusees definitivement par le serveur, gardees en local. */
  rejectedOps: RejectedOp[]
  discardRejectedOp: (opId: string) => Promise<void>
  discardAllRejected: () => Promise<void>
  deleteAccount: () => Promise<void>
  exportData: () => Promise<unknown>
  refresh: (opts?: { force?: boolean }) => Promise<void>
  resetDemo: () => void
  toast: (message: string, tone?: Toast['tone']) => void
  toasts: Toast[]
  dismissToast: (id: string) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const EMPTY_STATE: AppState = {
  currentUserId: '',
  users: [],
  groups: [],
  groupMembers: [],
  expenses: [],
  expenseShares: [],
  settlements: [],
  ledger: [],
  friendRequests: [],
  friendships: [],
  balances: [],
}

export function AppProvider({ children }: { children: ReactNode }) {
  const { mode, profileId, signedIn } = useAuth()
  const demo = mode === 'demo'

  const [state, setState] = useState<AppState>(() => (demo ? buildSeed() : EMPTY_STATE))
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(true)
  const [pendingSync, setPendingSync] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [syncError, setSyncError] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [rejected, setRejected] = useState<RejectedOp[]>([])

  const flushing = useRef(false)
  const refreshing = useRef(false)
  const lastRefreshAt = useRef(0)
  const realtimeTimer = useRef<number | null>(null)

  const toast = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = uid('toast')
    setToasts((t) => [...t, { id, message, tone }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  // ── Reseau ───────────────────────────────────────────────────────────────
  useEffect(() => {
    setOnline(navigator.onLine)
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])

  // Changement de compte sur le meme appareil : la file et l'instantane du
  // compte precedent n'ont plus aucun sens ici — les rejouer sous une autre
  // identite provoquerait des refus de la RLS.
  useEffect(() => {
    if (demo || !profileId) return
    const KEY = 'hasbni.lastProfile'
    const previous = window.localStorage.getItem(KEY)
    if (previous && previous !== profileId) {
      void clearQueue()
      void clearSnapshot()
      setPendingSync(0)
    }
    window.localStorage.setItem(KEY, profileId)
  }, [demo, profileId])

  // ── Hydratation : instantane IndexedDB d'abord, reseau ensuite ───────────
  useEffect(() => {
    let active = true
    loadSnapshot().then((snapshot) => {
      if (!active) return
      if (snapshot && (demo || snapshot.currentUserId === profileId)) {
        // Un instantane ecrit avant l'arrivee des soldes serveur n'a pas le
        // champ `balances` : on le reconstruit depuis le grand livre garde.
        setState(snapshot.balances ? snapshot : { ...snapshot, balances: recomputeBalances(snapshot) })
      }
      if (demo) setReady(true)
    })
    readQueue().then((q) => active && setPendingSync(q.length))
    readRejected().then((r) => active && setRejected(r))
    return () => {
      active = false
    }
  }, [demo, profileId])

  /**
   * Rechargement complet du perimetre.
   *
   * `force` court-circuite la fenetre de fraicheur : on l'utilise au montage,
   * apres une synchro et sur evenement temps reel. Les simples retours
   * d'onglet, eux, passent par la garde — `visibilitychange` et `focus` se
   * declenchent tous les deux au meme moment sur desktop et rechargeaient donc
   * tout en double (audit SCL-6).
   */
  const refresh = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const sb = getSupabase()
      if (!sb || !profileId) return
      if (refreshing.current) return
      if (!force && Date.now() - lastRefreshAt.current < REFRESH_TTL_MS) return

      refreshing.current = true
      try {
        const next = await fetchState(sb, profileId)
        setState(next)
        setSyncError(false)
        lastRefreshAt.current = Date.now()
      } catch {
        // Hors ligne ou serveur injoignable : on garde l'instantane local.
        setSyncError(true)
      } finally {
        refreshing.current = false
        setReady(true)
      }
    },
    [profileId]
  )

  useEffect(() => {
    if (demo || !profileId) return
    void refresh({ force: true })
  }, [demo, profileId, refresh])

  // Retour au premier plan : on resynchronise, au cas ou le temps reel aurait
  // manque un evenement pendant que l'app etait fermee ou en arriere-plan.
  useEffect(() => {
    if (demo || !profileId) return
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [demo, profileId, refresh])

  // ── Persistance de l'instantane ──────────────────────────────────────────
  // Serialiser tout l'etat a chaque changement faisait ramer les appareils
  // modestes : on attend que ca se calme (audit SCL-7).
  useEffect(() => {
    if (!ready) return
    const timer = window.setTimeout(() => void saveSnapshot(state), SNAPSHOT_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [state, ready])

  // ── File de synchronisation ──────────────────────────────────────────────
  const flush = useCallback(async () => {
    if (demo || flushing.current) return
    const sb = getSupabase()
    if (!sb || !profileId || !navigator.onLine) return

    flushing.current = true
    setSyncing(true)
    let dirty = false

    try {
      const queue = await readQueue()
      for (const item of queue) {
        try {
          await pushOp(sb, profileId, item.op)
          await dequeueOp(item.opId)
          dirty = true
        } catch (error) {
          if (error instanceof PermanentSyncError || item.attempts + 1 >= MAX_ATTEMPTS) {
            // Inutile d'insister. L'operation n'est plus jetee : elle part dans
            // la corbeille locale, d'ou l'utilisateur peut la revoir, la
            // rejouer ou la supprimer (audit CRD-4).
            const detail =
              error instanceof Error ? error.message : 'Operation refusee par le serveur'
            track('sync_op_failed', { op_kind: item.op.kind, attempts: item.attempts + 1 })
            await rejectOp(item, detail)
            await dequeueOp(item.opId)
            setRejected(await readRejected())
            toast('Une saisie n’a pas pu etre enregistree — voir Profil', 'danger')
            dirty = true
          } else {
            await bumpAttempts(item)
            setSyncError(true)
            break
          }
        }
      }
      setPendingSync((await readQueue()).length)
      if (dirty) await refresh({ force: true })
    } finally {
      flushing.current = false
      setSyncing(false)
    }
  }, [demo, profileId, refresh, toast])

  useEffect(() => {
    if (demo || !profileId) return
    void flush()
    const onOnline = () => void flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [demo, profileId, flush])

  // Le service worker reveille la file apres un Background Sync.
  useEffect(() => {
    if (demo || !('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'hasbni-sync') void flush()
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [demo, flush])

  // ── Temps reel : les soldes suivent les mouvements des autres ────────────
  //
  // Chaque evenement declenchait un rechargement complet. Une depense de
  // groupe a dix ecrit dix lignes de grand livre, donc dix evenements, donc
  // dix rechargements complets — sur chacun des dix clients connectes. On
  // regroupe desormais la rafale en un seul rechargement (audit SCL-2).
  useEffect(() => {
    const sb = getSupabase()
    if (demo || !sb || !profileId) return

    const scheduleRefresh = () => {
      if (realtimeTimer.current !== null) window.clearTimeout(realtimeTimer.current)
      realtimeTimer.current = window.setTimeout(() => {
        realtimeTimer.current = null
        void refresh({ force: true })
      }, REALTIME_DEBOUNCE_MS)
    }

    const channel = sb
      .channel('hasbni-ledger')
      // `expenses` n'est volontairement plus ecoute : toute depense produit
      // deja des lignes de grand livre, l'abonnement faisait doublon.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, scheduleRefresh)
      .subscribe((status) => {
        // Sans repli, un canal tombe laissait l'app muette sans rien dire.
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncError(true)
      })

    return () => {
      if (realtimeTimer.current !== null) window.clearTimeout(realtimeTimer.current)
      void sb.removeChannel(channel)
    }
  }, [demo, profileId, refresh])

  // ── Mutations ────────────────────────────────────────────────────────────
  const dispatch = useCallback(
    (op: Op) => {
      setState((prev) => applyOp(prev, op))
      if (demo) return
      const item = envelope(op)
      void enqueueOp(item).then(async () => {
        setPendingSync((await readQueue()).length)
        if (navigator.onLine) {
          void flush()
        } else {
          // Background Sync : la file part toute seule au retour du reseau.
          try {
            const reg = await navigator.serviceWorker?.ready
            await (
              reg as ServiceWorkerRegistration & { sync?: { register: (t: string) => Promise<void> } }
            )?.sync?.register('hasbni-sync')
          } catch {
            /* API indisponible : le listener `online` prendra le relais */
          }
        }
      })
    },
    [demo, flush]
  )

  const currentId = state.currentUserId

  const addExpense = useCallback(
    (input: NewExpenseInput) => {
      dispatch(buildExpenseOp({ ...input, createdBy: currentId }))
      track('expense_created', {
        split_type: input.splitType,
        participants_count: Object.keys(input.shares).length,
        amount_bucket: bucket(input.amount),
        from_group: Boolean(input.groupId),
        i_paid: input.payerId === currentId,
      })
    },
    [dispatch, currentId]
  )

  /**
   * Correction. Le choix produit est qu'une depense soit confirmee d'emblee,
   * sans accord du debiteur ; la contrepartie est qu'elle reste corrigeable.
   * Cote serveur, la correction solde l'ancienne position par des ecritures
   * d'ajustement puis en regenere des neuves : le grand livre ne peut donc pas
   * diverger de ce qu'affiche l'ecran.
   */
  const amendExpense = useCallback(
    (expenseId: ID, input: NewExpenseInput) => {
      setState((prev) => {
        const previous = prev.expenses.find((e) => e.id === expenseId)
        if (!previous) return prev
        const op = buildAmendOp(previous, input)
        track('expense_amended', {
          amount_bucket: bucket(input.amount),
          participants_count: Object.keys(input.shares).length,
        })
        if (!demo) {
          const item = envelope(op)
          void enqueueOp(item).then(async () => {
            setPendingSync((await readQueue()).length)
            if (navigator.onLine) void flush()
          })
        }
        return applyOp(prev, op)
      })
    },
    [demo, flush]
  )

  const addSettlement = useCallback(
    (input: NewSettlementInput) => {
      dispatch(buildSettlementOp(input))
      track('settlement_created', {
        method: input.method,
        amount_bucket: bucket(input.amount),
        direction: input.fromUser === currentId ? 'sent' : 'received',
      })
    },
    [dispatch, currentId]
  )

  const confirmSettlement = useCallback(
    (id: ID) => {
      dispatch({ kind: 'settlement.confirm', id, confirmedAt: new Date().toISOString() })
      track('settlement_confirmed')
    },
    [dispatch]
  )

  const cancelMovement = useCallback(
    (kind: 'expense' | 'settlement', id: ID) => {
      setState((prev) => {
        const op = buildCancelOp(prev, kind, id)
        track(kind === 'expense' ? 'expense_cancelled' : 'settlement_cancelled')
        if (!demo) {
          const item = envelope(op)
          void enqueueOp(item).then(async () => {
            setPendingSync((await readQueue()).length)
            if (navigator.onLine) void flush()
          })
        }
        return applyOp(prev, op)
      })
    },
    [demo, flush]
  )

  const addFriend = useCallback(
    async (email: string) => {
      const sb = getSupabase()
      if (!sb || demo) {
        throw new Error('Les demandes de pote necessitent un compte Supabase')
      }
      const result = await sendFriendRequest(sb, email)
      track('friend_request_sent', { outcome: result })
      await refresh({ force: true })
      return result
    },
    [demo, refresh]
  )

  const searchPotes = useCallback(
    async (query: string, signal?: AbortSignal) => {
      const sb = getSupabase()
      if (!sb || demo) return []
      return searchProfiles(sb, query, signal)
    },
    [demo]
  )

  const addFriendById = useCallback(
    async (profileId: ID) => {
      const sb = getSupabase()
      if (!sb || demo) {
        throw new Error('Les demandes de pote necessitent un compte Supabase')
      }
      const result = await sendFriendRequestTo(sb, profileId)
      track('friend_request_sent', { outcome: result, via: 'search' })
      await refresh({ force: true })
      return result
    },
    [demo, refresh]
  )

  const changeUsername = useCallback(
    async (username: string) => {
      const sb = getSupabase()
      if (!sb || demo) throw new Error('Indisponible en mode demonstration')
      const saved = await setUsername(sb, username)
      // On applique le changement localement AVANT de rafraichir : si le
      // reseau flanche entre les deux, le pseudo reste affiche au lieu de
      // sembler ne jamais avoir ete enregistre.
      setState((prev) => ({
        ...prev,
        users: prev.users.map((u) =>
          u.id === prev.currentUserId ? { ...u, username: saved } : u
        ),
      }))
      await refresh({ force: true })
      return saved
    },
    [demo, refresh]
  )

  const respondToRequest = useCallback(
    async (requestId: ID, accept: boolean) => {
      const sb = getSupabase()
      if (!sb || demo) return
      await respondFriendRequest(sb, requestId, accept)
      track('friend_request_answered', { accepted: accept })
      await refresh({ force: true })
    },
    [demo, refresh]
  )

  const createGroup = useCallback(
    (name: string, emoji: string, memberIds: ID[]) => {
      const op = buildGroupOp(name, emoji, memberIds, currentId)
      dispatch(op)
      track('group_created', { members_count: memberIds.length + 1 })
      return (op as Extract<Op, { kind: 'group.create' }>).group
    },
    [dispatch, currentId]
  )

  const addGroupMember = useCallback(
    (groupId: ID, userId: ID) => dispatch({ kind: 'group.member.add', groupId, userId }),
    [dispatch]
  )

  const removeGroupMember = useCallback(
    (groupId: ID, userId: ID) => dispatch({ kind: 'group.member.remove', groupId, userId }),
    [dispatch]
  )

  const updateGroup = useCallback(
    (groupId: ID, name: string, emoji: string) =>
      dispatch({ kind: 'group.update', groupId, name, emoji }),
    [dispatch]
  )

  const deleteGroup = useCallback(
    (groupId: ID) => dispatch({ kind: 'group.delete', groupId }),
    [dispatch]
  )

  const discardRejectedOp = useCallback(async (opId: string) => {
    await discardRejected(opId)
    setRejected(await readRejected())
  }, [])

  const discardAllRejected = useCallback(async () => {
    await clearRejected()
    setRejected([])
  }, [])

  const deleteAccount = useCallback(async () => {
    const sb = getSupabase()
    if (!sb || demo) throw new Error('Indisponible en mode demonstration')
    await deleteMyAccount(sb)
    await clearQueue()
    await clearSnapshot()
    await clearRejected()
    await sb.auth.signOut()
  }, [demo])

  const exportData = useCallback(async () => {
    const sb = getSupabase()
    if (!sb || demo) return state
    return exportMyData(sb)
  }, [demo, state])

  const updateProfile = useCallback(
    (patch: Partial<User>) => dispatch({ kind: 'profile.update', id: currentId, patch }),
    [dispatch, currentId]
  )

  const resetDemo = useCallback(() => {
    if (!demo) return
    setState(buildSeed())
  }, [demo])

  const me = useMemo(
    () =>
      state.users.find((u) => u.id === state.currentUserId) ??
      state.users[0] ?? { id: '', name: 'Moi', avatar: '🙂' },
    [state]
  )

  const syncStatus: SyncStatus = demo
    ? 'demo'
    : !online
      ? 'offline'
      : syncing
        ? 'syncing'
        : syncError
          ? 'error'
          : 'idle'

  const value = useMemo<AppContextValue>(
    () => ({
      state,
      me,
      ready: demo ? ready : ready && Boolean(profileId) && signedIn,
      online,
      syncStatus,
      pendingSync,
      addExpense,
      amendExpense,
      addSettlement,
      confirmSettlement,
      cancelMovement,
      addFriend,
      searchPotes,
      addFriendById,
      changeUsername,
      respondToRequest,
      createGroup,
      addGroupMember,
      removeGroupMember,
      updateGroup,
      deleteGroup,
      updateProfile,
      rejectedOps: rejected,
      discardRejectedOp,
      discardAllRejected,
      deleteAccount,
      exportData,
      refresh,
      resetDemo,
      toast,
      toasts,
      dismissToast,
    }),
    [
      state,
      me,
      demo,
      ready,
      profileId,
      signedIn,
      online,
      syncStatus,
      pendingSync,
      addExpense,
      amendExpense,
      addSettlement,
      confirmSettlement,
      cancelMovement,
      addFriend,
      searchPotes,
      addFriendById,
      changeUsername,
      respondToRequest,
      createGroup,
      addGroupMember,
      removeGroupMember,
      updateGroup,
      deleteGroup,
      updateProfile,
      rejected,
      discardRejectedOp,
      discardAllRejected,
      deleteAccount,
      exportData,
      refresh,
      resetDemo,
      toast,
      toasts,
      dismissToast,
    ]
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp doit etre utilise dans <AppProvider>')
  return ctx
}

export { supabaseEnabled }
