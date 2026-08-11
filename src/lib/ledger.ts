import type {
  AppState,
  Expense,
  ExpenseShare,
  ID,
  LedgerEntry,
  Movement,
  RelationSummary,
  Settlement,
  SplitType,
  User,
} from './types'

export const CURRENCY = 'DA'

/** Arrondi a l'unite (CDC 3 — devise DA, arrondi a l'unite). */
export const round = (n: number) => Math.round(n)

export function formatAmount(n: number): string {
  return `${round(Math.abs(n)).toLocaleString('fr-FR').replace(/ | /g, ' ')} ${CURRENCY}`
}

export function formatSigned(n: number): string {
  const v = round(n)
  if (v === 0) return `0 ${CURRENCY}`
  return `${v > 0 ? '+' : '−'}${formatAmount(v)}`
}

/**
 * Identifiants generes cote client : ce sont de vrais UUID v4, directement
 * utilisables comme cle primaire Postgres (les inserts restent idempotents
 * quand la file de synchronisation rejoue une operation).
 */
export function uid(_prefix = 'id'): string {
  void _prefix
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * Repartition egale avec reste attribue au payeur (CDC 3 — repartition avec reste).
 * `participants` inclut le payeur s'il a consomme.
 */
export function splitEqual(amount: number, participants: ID[], payerId: ID): Record<ID, number> {
  const total = round(amount)
  const n = participants.length
  const out: Record<ID, number> = {}
  if (n === 0) return out
  const base = Math.floor(total / n)
  const remainder = total - base * n
  for (const p of participants) out[p] = base
  // Le reste va au payeur s'il participe, sinon au premier participant.
  const remainderTarget = participants.includes(payerId) ? payerId : participants[0]
  out[remainderTarget] += remainder
  return out
}

/**
 * Genere les entrees de grand livre bilaterales d'une depense.
 * Chaque participant (hors payeur) doit sa part au payeur.
 */
export function ledgerFromExpense(expense: Expense, shares: ExpenseShare[]): LedgerEntry[] {
  return shares
    .filter((s) => s.userId !== expense.payerId && round(s.shareAmount) > 0)
    .map((s) => ({
      id: uid('led'),
      userA: s.userId,
      userB: expense.payerId,
      amount: round(s.shareAmount),
      refType: 'expense' as const,
      refId: expense.id,
      status: expense.status,
      createdAt: expense.createdAt,
      label: expense.motive,
    }))
}

/** Un remboursement de X → Y reduit ce que X doit a Y : entree inverse. */
export function ledgerFromSettlement(settlement: Settlement): LedgerEntry[] {
  return [
    {
      id: uid('led'),
      userA: settlement.toUser,
      userB: settlement.fromUser,
      amount: round(settlement.amount),
      refType: 'settlement',
      refId: settlement.id,
      status: settlement.status,
      createdAt: settlement.createdAt,
      label: settlement.note || 'Remboursement',
    },
  ]
}

/**
 * Solde net d'une relation du point de vue de `me`.
 * > 0 : l'autre me doit ; < 0 : je lui dois (CDC 3 — signe).
 */
export function relationBalance(
  ledger: LedgerEntry[],
  me: ID,
  other: ID,
  opts: { includePending?: boolean } = {}
): number {
  let net = 0
  for (const e of ledger) {
    if (!opts.includePending && e.status !== 'confirmed') continue
    if (e.userA === other && e.userB === me) net += e.amount // il me doit
    else if (e.userA === me && e.userB === other) net -= e.amount // je lui dois
  }
  return round(net)
}

/** Identifiants des potes acceptes. */
export function friendIds(state: AppState): ID[] {
  const me = state.currentUserId
  return state.friendships
    .map((f) => (f.userLow === me ? f.userHigh : f.userHigh === me ? f.userLow : null))
    .filter((id): id is ID => Boolean(id))
}

/** Demandes de pote recues en attente de reponse. */
export function incomingRequests(state: AppState) {
  const me = state.currentUserId
  return state.friendRequests
    .filter((r) => r.toUser === me && r.status === 'pending')
    .map((r) => ({ request: r, user: state.users.find((u) => u.id === r.fromUser) }))
    .filter((x): x is { request: (typeof state.friendRequests)[number]; user: User } =>
      Boolean(x.user)
    )
}

/** Demandes envoyees, toujours sans reponse. */
export function outgoingRequests(state: AppState) {
  const me = state.currentUserId
  return state.friendRequests
    .filter((r) => r.fromUser === me && r.status === 'pending')
    .map((r) => ({ request: r, user: state.users.find((u) => u.id === r.toUser) }))
    .filter((x): x is { request: (typeof state.friendRequests)[number]; user: User } =>
      Boolean(x.user)
    )
}

/**
 * Toutes les relations de l'utilisateur courant, triees par activite recente.
 * Un pote accepte apparait meme sans aucun mouvement (solde a zero).
 */
export function relationSummaries(state: AppState): RelationSummary[] {
  const me = state.currentUserId
  const byUser = new Map<ID, { entries: LedgerEntry[] }>()

  for (const id of friendIds(state)) byUser.set(id, { entries: [] })

  for (const e of state.ledger) {
    const other = e.userA === me ? e.userB : e.userB === me ? e.userA : null
    if (!other) continue
    if (!byUser.has(other)) byUser.set(other, { entries: [] })
    byUser.get(other)!.entries.push(e)
  }

  const out: RelationSummary[] = []
  for (const [userId, { entries }] of byUser) {
    const user = state.users.find((u) => u.id === userId)
    if (!user) continue
    const net = relationBalance(entries, me, userId)
    const projected = relationBalance(entries, me, userId, { includePending: true })
    const lastActivity = entries.reduce(
      (acc, e) => (e.createdAt > acc ? e.createdAt : acc),
      entries[0]?.createdAt ?? ''
    )
    out.push({
      userId,
      user,
      net,
      pending: round(projected - net),
      lastActivity,
      movementCount: new Set(entries.map((e) => e.refId)).size,
    })
  }
  return out.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
}

export interface GlobalTotals {
  owedToMe: number
  iOwe: number
  net: number
  pendingCount: number
}

export function globalTotals(state: AppState): GlobalTotals {
  const rels = relationSummaries(state)
  const owedToMe = rels.reduce((s, r) => s + (r.net > 0 ? r.net : 0), 0)
  const iOwe = rels.reduce((s, r) => s + (r.net < 0 ? -r.net : 0), 0)
  return {
    owedToMe: round(owedToMe),
    iOwe: round(iOwe),
    net: round(owedToMe - iOwe),
    pendingCount: pendingForMe(state).length,
  }
}

/** Mouvements en attente que l'utilisateur courant doit confirmer. */
export function pendingForMe(state: AppState): Movement[] {
  const me = state.currentUserId
  return state.settlements
    .filter((s) => s.status === 'pending' && !s.cancelled && s.toUser === me)
    .map((s) => settlementToMovement(s, state, s.fromUser))
}

function settlementToMovement(s: Settlement, state: AppState, counterpartId: ID): Movement {
  const me = state.currentUserId
  // Un remboursement de `me` vers l'autre augmente le solde (il me doit moins / je dois moins).
  const delta = s.fromUser === me ? s.amount : -s.amount
  return {
    id: s.id,
    kind: 'settlement',
    createdAt: s.createdAt,
    status: s.status,
    label: s.note || 'Remboursement',
    delta: round(delta),
    amount: round(s.amount),
    payerId: s.fromUser,
    counterpartId,
    method: s.method,
    cancelled: s.cancelled,
    awaitingMe: s.status === 'pending' && s.toUser === me && !s.cancelled,
  }
}

/** Timeline anti-chronologique d'une relation (CDC 2.3). */
export function relationMovements(state: AppState, otherId: ID): Movement[] {
  const me = state.currentUserId
  const movements: Movement[] = []

  for (const exp of state.expenses) {
    if (exp.cancelled) continue
    const shares = state.expenseShares.filter((s) => s.expenseId === exp.id)
    const involvesMe = exp.payerId === me || shares.some((s) => s.userId === me)
    const involvesOther = exp.payerId === otherId || shares.some((s) => s.userId === otherId)
    if (!involvesMe || !involvesOther) continue

    let delta = 0
    if (exp.payerId === me) {
      delta = shares.find((s) => s.userId === otherId)?.shareAmount ?? 0 // il me doit sa part
    } else if (exp.payerId === otherId) {
      delta = -(shares.find((s) => s.userId === me)?.shareAmount ?? 0) // je lui dois ma part
    }
    if (round(delta) === 0) continue

    movements.push({
      id: exp.id,
      kind: 'expense',
      createdAt: exp.createdAt,
      status: exp.status,
      label: exp.motive,
      delta: round(delta),
      amount: Math.abs(round(delta)),
      payerId: exp.payerId,
      counterpartId: otherId,
      totalAmount: exp.amount,
      participantsCount: shares.length,
      awaitingMe: false,
    })
  }

  for (const s of state.settlements) {
    if (s.cancelled) continue
    const pair = (s.fromUser === me && s.toUser === otherId) || (s.fromUser === otherId && s.toUser === me)
    if (!pair) continue
    movements.push(settlementToMovement(s, state, otherId))
  }

  return movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Toutes les activites recentes de l'utilisateur courant, tous potes confondus. */
export function allMovements(state: AppState): (Movement & { otherUser: User })[] {
  const me = state.currentUserId
  const others = state.users.filter((u) => u.id !== me)
  const seen = new Set<string>()
  const out: (Movement & { otherUser: User })[] = []
  for (const other of others) {
    for (const m of relationMovements(state, other.id)) {
      const key = `${m.id}:${other.id}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ ...m, otherUser: other })
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Simplification des dettes d'un groupe (CDC 2.7) : minimise le nombre de transferts.
 * Retourne la liste des transferts suggeres, sans rien appliquer.
 */
export interface SimplifiedTransfer {
  from: ID
  to: ID
  amount: number
}

export function simplifyGroup(state: AppState, groupId: ID): SimplifiedTransfer[] {
  const memberIds = state.groupMembers.filter((m) => m.groupId === groupId).map((m) => m.userId)
  const set = new Set(memberIds)

  const positions = new Map<ID, number>()
  for (const id of memberIds) positions.set(id, 0)
  for (const e of state.ledger) {
    if (e.status !== 'confirmed') continue
    if (!set.has(e.userA) || !set.has(e.userB)) continue
    positions.set(e.userA, (positions.get(e.userA) ?? 0) - e.amount)
    positions.set(e.userB, (positions.get(e.userB) ?? 0) + e.amount)
  }

  const debtors = [...positions.entries()].filter(([, v]) => v < -0.5).map(([id, v]) => ({ id, v: -v }))
  const creditors = [...positions.entries()].filter(([, v]) => v > 0.5).map(([id, v]) => ({ id, v }))
  debtors.sort((a, b) => b.v - a.v)
  creditors.sort((a, b) => b.v - a.v)

  const transfers: SimplifiedTransfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v)
    if (amount > 0.5) transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: round(amount) })
    debtors[i].v -= amount
    creditors[j].v -= amount
    if (debtors[i].v <= 0.5) i++
    if (creditors[j].v <= 0.5) j++
  }
  return transfers
}

export function userById(state: AppState, id: ID): User | undefined {
  return state.users.find((u) => u.id === id)
}

export function groupMembersOf(state: AppState, groupId: ID): User[] {
  const ids = state.groupMembers.filter((m) => m.groupId === groupId).map((m) => m.userId)
  return state.users.filter((u) => ids.includes(u.id))
}

export const splitTypeLabel: Record<SplitType, string> = {
  equal: 'Egale',
  custom: 'Parts personnalisees',
  items: 'Qui a consomme quoi',
}
