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
import { uid } from '@/lib/ledger'
import {
  bumpAttempts,
  dequeueOp,
  enqueueOp,
  loadSnapshot,
  readQueue,
  saveSnapshot,
} from '@/lib/idb'
import {
  applyOp,
  buildCancelOp,
  buildExpenseOp,
  buildGroupOp,
  buildSettlementOp,
  envelope,
  type Op,
} from '@/lib/ops'
import { buildSeed } from '@/lib/seed'
import { getSupabase, supabaseEnabled } from '@/lib/supabase/client'
import {
  fetchState,
  PermanentSyncError,
  pushOp,
  respondFriendRequest,
  sendFriendRequest,
} from '@/lib/supabase/repo'
import type { AppState, Group, ID, SplitType, User } from '@/lib/types'

const MAX_ATTEMPTS = 6

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
  addSettlement: (input: NewSettlementInput) => void
  confirmSettlement: (id: ID) => void
  /** Annulation par mouvement inverse — jamais de suppression physique (CDC 3). */
  cancelMovement: (kind: 'expense' | 'settlement', id: ID) => void
  /** Demande de pote par email. Leve une erreur lisible si l'email est inconnu. */
  addFriend: (email: string) => Promise<'sent' | 'accepted'>
  respondToRequest: (requestId: ID, accept: boolean) => Promise<void>
  createGroup: (name: string, emoji: string, memberIds: ID[]) => Group
  updateProfile: (patch: Partial<Pick<User, 'name' | 'phone' | 'email' | 'avatar'>>) => void
  refresh: () => Promise<void>
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

  const flushing = useRef(false)

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

  // ── Hydratation : instantane IndexedDB d'abord, reseau ensuite ───────────
  useEffect(() => {
    let active = true
    loadSnapshot().then((snapshot) => {
      if (!active) return
      if (snapshot && (demo || snapshot.currentUserId === profileId)) setState(snapshot)
      if (demo) setReady(true)
    })
    readQueue().then((q) => active && setPendingSync(q.length))
    return () => {
      active = false
    }
  }, [demo, profileId])

  const refresh = useCallback(async () => {
    const sb = getSupabase()
    if (!sb || !profileId) return
    try {
      const next = await fetchState(sb, profileId)
      setState(next)
      setSyncError(false)
    } catch {
      // Hors ligne ou serveur injoignable : on garde l'instantane local.
      setSyncError(true)
    } finally {
      setReady(true)
    }
  }, [profileId])

  useEffect(() => {
    if (demo || !profileId) return
    void refresh()
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
  useEffect(() => {
    if (!ready) return
    void saveSnapshot(state)
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
            // Inutile d'insister : on retire l'operation et on previent.
            await dequeueOp(item.opId)
            const detail = error instanceof Error ? error.message : ''
            toast(detail ? `Refuse par le serveur : ${detail}` : 'Operation non synchronisee', 'danger')
            dirty = true
          } else {
            await bumpAttempts(item)
            setSyncError(true)
            break
          }
        }
      }
      setPendingSync((await readQueue()).length)
      if (dirty) await refresh()
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
  useEffect(() => {
    const sb = getSupabase()
    if (demo || !sb || !profileId) return

    const channel = sb
      .channel('hasbni-ledger')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ledger_entries' }, () =>
        void refresh()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () =>
        void refresh()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friend_requests' }, () =>
        void refresh()
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'friendships' }, () =>
        void refresh()
      )
      .subscribe()

    return () => {
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
    },
    [dispatch, currentId]
  )

  const addSettlement = useCallback(
    (input: NewSettlementInput) => dispatch(buildSettlementOp(input)),
    [dispatch]
  )

  const confirmSettlement = useCallback(
    (id: ID) =>
      dispatch({ kind: 'settlement.confirm', id, confirmedAt: new Date().toISOString() }),
    [dispatch]
  )

  const cancelMovement = useCallback(
    (kind: 'expense' | 'settlement', id: ID) => {
      setState((prev) => {
        const op = buildCancelOp(prev, kind, id)
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
      await refresh()
      return result
    },
    [demo, refresh]
  )

  const respondToRequest = useCallback(
    async (requestId: ID, accept: boolean) => {
      const sb = getSupabase()
      if (!sb || demo) return
      await respondFriendRequest(sb, requestId, accept)
      await refresh()
    },
    [demo, refresh]
  )

  const createGroup = useCallback(
    (name: string, emoji: string, memberIds: ID[]) => {
      const op = buildGroupOp(name, emoji, memberIds, currentId)
      dispatch(op)
      return (op as Extract<Op, { kind: 'group.create' }>).group
    },
    [dispatch, currentId]
  )

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
      addSettlement,
      confirmSettlement,
      cancelMovement,
      addFriend,
      respondToRequest,
      createGroup,
      updateProfile,
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
      addSettlement,
      confirmSettlement,
      cancelMovement,
      addFriend,
      respondToRequest,
      createGroup,
      updateProfile,
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
