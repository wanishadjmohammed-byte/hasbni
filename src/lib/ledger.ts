import type {
  AppState,
  Expense,
  ExpenseShare,
  ID,
  LedgerEntry,
  Movement,
  RelationBalance,
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

/**
 * Recalcule tous les soldes a partir du grand livre complet.
 * Reservee au mode demonstration et aux tests : en mode Supabase les soldes
 * viennent de la vue `relation_balances`, parce que le grand livre charge
 * n'est qu'une fenetre recente.
 */
export function recomputeBalances(state: AppState): RelationBalance[] {
  return applyEntriesToBalances([], state.currentUserId, state.ledger)
}

/**
 * Applique un lot d'ecritures aux soldes. C'est ce qui garde la saisie
 * optimiste : le reducteur ajoute les ecritures au grand livre local ET leur
 * delta ici, sans attendre le serveur.
 */
export function applyEntriesToBalances(
  balances: RelationBalance[],
  me: ID,
  added: LedgerEntry[],
  removed: LedgerEntry[] = []
): RelationBalance[] {
  // `balances` peut manquer : un instantane IndexedDB ecrit par une version
  // anterieure survit a la montee de version de la base.
  const map = new Map<ID, RelationBalance>((balances ?? []).map((b) => [b.otherId, { ...b }]))
  // Deux registres distincts : une correction retire puis reajoute les memes
  // references, et ne doit pas faire baisser le compteur de mouvements.
  const refsOut = new Map<ID, Set<ID>>()
  const refsIn = new Map<ID, Set<ID>>()

  const touch = (e: LedgerEntry, sign: 1 | -1) => {
    const other = e.userA === me ? e.userB : e.userB === me ? e.userA : null
    if (!other) return
    // `userB` est le crediteur : si c'est moi, l'autre me doit.
    const delta = (e.userB === me ? e.amount : -e.amount) * sign
    const row = map.get(other) ?? {
      otherId: other,
      net: 0,
      projected: 0,
      lastActivity: e.createdAt,
      movementCount: 0,
    }
    row.projected += delta
    if (e.status === 'confirmed') row.net += delta
    if (e.createdAt > row.lastActivity) row.lastActivity = e.createdAt

    // Compte des mouvements : approximation locale, le serveur fait foi au
    // prochain rafraichissement.
    const registry = sign === 1 ? refsIn : refsOut
    let refs = registry.get(other)
    if (!refs) {
      refs = new Set()
      registry.set(other, refs)
    }
    if (!refs.has(e.refId)) {
      refs.add(e.refId)
      row.movementCount = Math.max(0, row.movementCount + sign)
    }

    map.set(other, row)
  }

  for (const e of removed) touch(e, -1)
  for (const e of added) touch(e, 1)

  return [...map.values()].map((b) => ({ ...b, net: round(b.net), projected: round(b.projected) }))
}

/**
 * Solde d'une relation. On prend celui du serveur quand il existe, et on
 * retombe sur un calcul local sinon (mode demonstration, ou pote encore sans
 * aucun mouvement).
 */
export function balanceOf(state: AppState, otherId: ID): { net: number; projected: number } {
  const row = state.balances?.find((b) => b.otherId === otherId)
  if (row) return { net: row.net, projected: row.projected }
  return {
    net: relationBalance(state.ledger, state.currentUserId, otherId),
    projected: relationBalance(state.ledger, state.currentUserId, otherId, { includePending: true }),
  }
}

/** Index des parts par depense — evite un `filter` par depense (audit SCL-3). */
export function indexShares(state: AppState): Map<ID, ExpenseShare[]> {
  const map = new Map<ID, ExpenseShare[]>()
  for (const s of state.expenseShares) {
    const list = map.get(s.expenseId)
    if (list) list.push(s)
    else map.set(s.expenseId, [s])
  }
  return map
}

/** Identifiants des potes acceptes. */
export function friendIds(state: AppState): ID[] {
  const me = state.currentUserId
  return state.friendships
    .map((f) => (f.userLow === me ? f.userHigh : f.userHigh === me ? f.userLow : null))
    .filter((id): id is ID => Boolean(id))
}

/**
 * Demandes de pote recues en attente de reponse.
 * Si le profil du demandeur n'est pas visible, on affiche quand meme la
 * demande avec un libelle generique : une action en attente ne doit jamais
 * disparaitre silencieusement de l'interface.
 */
export function incomingRequests(state: AppState) {
  const me = state.currentUserId
  return state.friendRequests
    .filter((r) => r.toUser === me && r.status === 'pending')
    .map((r) => ({
      request: r,
      user: state.users.find((u) => u.id === r.fromUser) ?? {
        id: r.fromUser,
        name: 'Un pote',
        avatar: '🙂',
      },
    }))
}

/** Demandes envoyees, toujours sans reponse. */
export function outgoingRequests(state: AppState) {
  const me = state.currentUserId
  return state.friendRequests
    .filter((r) => r.fromUser === me && r.status === 'pending')
    .map((r) => ({
      request: r,
      user: state.users.find((u) => u.id === r.toUser) ?? {
        id: r.toUser,
        name: 'Invitation envoyee',
        avatar: '🙂',
      },
    }))
}

/**
 * Toutes les relations de l'utilisateur courant, triees par activite recente.
 * Un pote accepte apparait meme sans aucun mouvement (solde a zero).
 *
 * Les soldes viennent de `state.balances` (vue Postgres) : on ne parcourt plus
 * le grand livre, qui n'est de toute facon qu'une fenetre recente.
 */
export function relationSummaries(state: AppState): RelationSummary[] {
  const byUser = new Map<ID, User>(state.users.map((u) => [u.id, u]))
  const rows = new Map<ID, RelationBalance>()

  for (const b of state.balances ?? []) rows.set(b.otherId, b)

  // Un pote accepte sans aucun mouvement n'apparait pas dans la vue.
  for (const id of friendIds(state)) {
    if (!rows.has(id)) {
      rows.set(id, { otherId: id, net: 0, projected: 0, lastActivity: '', movementCount: 0 })
    }
  }

  const out: RelationSummary[] = []
  for (const [userId, row] of rows) {
    const user = byUser.get(userId)
    if (!user) continue
    out.push({
      userId,
      user,
      net: row.net,
      pending: round(row.projected - row.net),
      lastActivity: row.lastActivity,
      movementCount: row.movementCount,
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

/** Construit le mouvement affiche pour une depense, vu par `me`. */
function expenseToMovement(
  exp: Expense,
  shares: ExpenseShare[],
  counterpartId: ID,
  delta: number
): Movement {
  return {
    id: exp.id,
    kind: 'expense',
    createdAt: exp.createdAt,
    status: exp.status,
    label: exp.motive,
    delta: round(delta),
    amount: Math.abs(round(delta)),
    payerId: exp.payerId,
    counterpartId,
    totalAmount: exp.amount,
    participantsCount: shares.length,
    awaitingMe: false,
  }
}

/**
 * Timeline anti-chronologique d'une relation (CDC 2.3).
 * `index` est optionnel : le passer evite de reconstruire l'index des parts
 * quand on boucle sur plusieurs relations.
 */
export function relationMovements(
  state: AppState,
  otherId: ID,
  index?: Map<ID, ExpenseShare[]>
): Movement[] {
  const me = state.currentUserId
  const shareIndex = index ?? indexShares(state)
  const movements: Movement[] = []

  for (const exp of state.expenses) {
    if (exp.cancelled) continue
    const shares = shareIndex.get(exp.id) ?? []

    let delta = 0
    if (exp.payerId === me) {
      delta = shares.find((s) => s.userId === otherId)?.shareAmount ?? 0 // il me doit sa part
    } else if (exp.payerId === otherId) {
      delta = -(shares.find((s) => s.userId === me)?.shareAmount ?? 0) // je lui dois ma part
    }
    if (round(delta) === 0) continue

    movements.push(expenseToMovement(exp, shares, otherId, delta))
  }

  for (const s of state.settlements) {
    if (s.cancelled) continue
    const pair =
      (s.fromUser === me && s.toUser === otherId) || (s.fromUser === otherId && s.toUser === me)
    if (!pair) continue
    movements.push(settlementToMovement(s, state, otherId))
  }

  return movements.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/**
 * Toutes les activites recentes, tous potes confondus.
 *
 * Une seule passe sur les depenses et les remboursements. L'ancienne version
 * rappelait `relationMovements` pour chaque pote, et chacun de ces appels
 * refiltrait toutes les parts : le cout etait le produit
 * potes x depenses x parts (audit SCL-3).
 */
export function allMovements(state: AppState): (Movement & { otherUser: User })[] {
  const me = state.currentUserId
  const byId = new Map<ID, User>(state.users.map((u) => [u.id, u]))
  const shareIndex = indexShares(state)
  const out: (Movement & { otherUser: User })[] = []

  for (const exp of state.expenses) {
    if (exp.cancelled) continue
    const shares = shareIndex.get(exp.id) ?? []

    if (exp.payerId === me) {
      // J'ai avance : chaque participant m'en doit sa part.
      for (const share of shares) {
        if (share.userId === me || round(share.shareAmount) === 0) continue
        const otherUser = byId.get(share.userId)
        if (!otherUser) continue
        out.push({
          ...expenseToMovement(exp, shares, share.userId, share.shareAmount),
          otherUser,
        })
      }
    } else {
      // Quelqu'un a avance : je ne lui dois que ma propre part.
      const mine = shares.find((s) => s.userId === me)
      if (!mine || round(mine.shareAmount) === 0) continue
      const otherUser = byId.get(exp.payerId)
      if (!otherUser) continue
      out.push({
        ...expenseToMovement(exp, shares, exp.payerId, -mine.shareAmount),
        otherUser,
      })
    }
  }

  for (const s of state.settlements) {
    if (s.cancelled) continue
    const otherId = s.fromUser === me ? s.toUser : s.toUser === me ? s.fromUser : null
    if (!otherId) continue
    const otherUser = byId.get(otherId)
    if (!otherUser) continue
    out.push({ ...settlementToMovement(s, state, otherId), otherUser })
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

/**
 * Repartition gloutonne a partir de positions deja calculees.
 * > 0 : on lui doit ; < 0 : il doit.
 */
export function simplifyFromPositions(positions: Map<ID, number>): SimplifiedTransfer[] {
  const debtors = [...positions.entries()]
    .filter(([, v]) => v < -0.5)
    .map(([id, v]) => ({ id, v: -v }))
  const creditors = [...positions.entries()].filter(([, v]) => v > 0.5).map(([id, v]) => ({ id, v }))
  debtors.sort((a, b) => b.v - a.v)
  creditors.sort((a, b) => b.v - a.v)

  const transfers: SimplifiedTransfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].v, creditors[j].v)
    if (amount > 0.5) {
      transfers.push({ from: debtors[i].id, to: creditors[j].id, amount: round(amount) })
    }
    debtors[i].v -= amount
    creditors[j].v -= amount
    if (debtors[i].v <= 0.5) i++
    if (creditors[j].v <= 0.5) j++
  }
  return transfers
}

/**
 * Simplification calculee localement.
 *
 * Attention : sous RLS le client ne voit que les ecritures ou il est partie,
 * donc cette version ignore les dettes entre deux autres membres. Elle ne sert
 * que de repli (mode demonstration, projet sans le patch 06) — le chemin
 * nominal passe par `group_positions` cote serveur.
 */
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

  return simplifyFromPositions(positions)
}

export function userById(state: AppState, id: ID): User | undefined {
  return state.users.find((u) => u.id === id)
}

export function groupMembersOf(state: AppState, groupId: ID): User[] {
  const ids = new Set(
    state.groupMembers.filter((m) => m.groupId === groupId).map((m) => m.userId)
  )
  return state.users.filter((u) => ids.has(u.id))
}

export const splitTypeLabel: Record<SplitType, string> = {
  equal: 'Egale',
  custom: 'Parts personnalisees',
  items: 'Qui a consomme quoi',
}
