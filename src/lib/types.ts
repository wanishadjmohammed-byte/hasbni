/**
 * Modele de donnees Hasbni (cf. CDC 5.2).
 * Les ledger_entries sont la source de verite du solde : chaque depense ou
 * remboursement genere des entrees de grand livre bilaterales.
 */

export type ID = string

export interface User {
  id: ID
  name: string
  /** Compte supprime : la ligne survit pour que l'historique des potes reste juste. */
  deletedAt?: string
  phone?: string
  email?: string
  avatar?: string // emoji ou URL ; a defaut on affiche l'initiale
  color?: string // teinte de l'avatar
  createdBy?: ID
}

export interface Group {
  id: ID
  name: string
  ownerId: ID
  emoji: string
  createdAt: string
}

export interface GroupMember {
  groupId: ID
  userId: ID
}

export type SplitType = 'equal' | 'custom' | 'items'

export interface Expense {
  id: ID
  groupId: ID | null
  payerId: ID
  amount: number
  motive: string
  splitType: SplitType
  createdAt: string
  status: MovementStatus
  cancelled?: boolean
  createdBy?: ID
}

export interface ExpenseShare {
  expenseId: ID
  userId: ID
  shareAmount: number
}

export type MovementStatus = 'pending' | 'confirmed'

export interface Settlement {
  id: ID
  fromUser: ID
  toUser: ID
  amount: number
  note?: string
  method: 'cash' | 'transfer'
  status: MovementStatus
  createdAt: string
  confirmedAt?: string
  cancelled?: boolean
}

export type LedgerRefType = 'expense' | 'settlement' | 'adjustment'

/**
 * Une entree de grand livre est orientee : `debtor` doit `amount` a `creditor`.
 * Le solde de la relation A↔B = somme algebrique des entrees confirmees.
 */
export interface LedgerEntry {
  id: ID
  userA: ID // debiteur
  userB: ID // crediteur
  amount: number
  refType: LedgerRefType
  refId: ID
  status: MovementStatus
  createdAt: string
  label: string
}

export type FriendRequestStatus = 'pending' | 'accepted' | 'declined'

/** Demande de pote : l'amitie n'existe qu'apres acceptation. */
export interface FriendRequest {
  id: ID
  fromUser: ID
  toUser: ID
  status: FriendRequestStatus
  createdAt: string
}

export interface Friendship {
  userLow: ID
  userHigh: ID
}

/**
 * Solde d'une relation, calcule par Postgres (vue `relation_balances`).
 *
 * Le grand livre charge par le client est desormais une FENETRE — les N
 * derniers mouvements, pour la timeline. Les soldes ne peuvent donc plus en
 * etre deduits : ils viennent du serveur, qui lui voit tout l'historique. Les
 * operations locales appliquent leur delta ici en meme temps qu'au grand livre
 * (cf. `applyEntriesToBalances`), pour que la saisie reste optimiste.
 */
export interface RelationBalance {
  otherId: ID
  /** > 0 : il me doit ; < 0 : je lui dois. Mouvements confirmes uniquement. */
  net: number
  /** Idem, en incluant les mouvements en attente. */
  projected: number
  lastActivity: string
  movementCount: number
}

export interface AppState {
  currentUserId: ID
  users: User[]
  groups: Group[]
  groupMembers: GroupMember[]
  expenses: Expense[]
  expenseShares: ExpenseShare[]
  settlements: Settlement[]
  ledger: LedgerEntry[]
  friendRequests: FriendRequest[]
  friendships: Friendship[]
  /** Soldes par pote — source de verite cote serveur, cf. `RelationBalance`. */
  balances: RelationBalance[]
  /** true si `ledger` ne contient qu'une fenetre recente de l'historique. */
  ledgerWindowed?: boolean
}

/** Vue agregee d'une relation bilaterale, pour l'ecran d'accueil. */
export interface RelationSummary {
  userId: ID
  user: User
  net: number // > 0 : il me doit ; < 0 : je lui dois
  pending: number // impact previsionnel des mouvements non confirmes
  lastActivity: string
  movementCount: number
}

/** Un mouvement affiche dans la timeline d'une relation. */
export interface Movement {
  id: ID
  kind: 'expense' | 'settlement'
  createdAt: string
  status: MovementStatus
  label: string
  /** Effet sur le solde du point de vue de l'utilisateur courant. */
  delta: number
  amount: number
  payerId: ID
  counterpartId: ID
  totalAmount?: number
  participantsCount?: number
  method?: 'cash' | 'transfer'
  cancelled?: boolean
  /** true si c'est a l'utilisateur courant de confirmer ce mouvement. */
  awaitingMe: boolean
}
