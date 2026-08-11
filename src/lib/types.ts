/**
 * Modele de donnees Hasbni (cf. CDC 5.2).
 * Les ledger_entries sont la source de verite du solde : chaque depense ou
 * remboursement genere des entrees de grand livre bilaterales.
 */

export type ID = string

export interface User {
  id: ID
  name: string
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
