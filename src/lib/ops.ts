import { ledgerFromExpense, ledgerFromSettlement, round, uid } from './ledger'
import type {
  AppState,
  Expense,
  ExpenseShare,
  Group,
  ID,
  LedgerEntry,
  Settlement,
  User,
} from './types'

/**
 * Toute mutation passe par une operation serialisable : elle est appliquee
 * localement tout de suite (optimiste), mise en file dans IndexedDB, puis
 * rejouee vers Supabase des que le reseau revient.
 */
export type Op =
  | { kind: 'expense.create'; expense: Expense; shares: ExpenseShare[] }
  | { kind: 'settlement.create'; settlement: Settlement }
  | { kind: 'settlement.confirm'; id: ID; confirmedAt: string }
  | { kind: 'movement.cancel'; target: 'expense' | 'settlement'; id: ID; inverse: LedgerEntry[] }
  | { kind: 'group.create'; group: Group; memberIds: ID[] }
  | { kind: 'profile.update'; id: ID; patch: Partial<User> }

export interface QueuedOp {
  opId: string
  createdAt: string
  attempts: number
  op: Op
}

export function envelope(op: Op): QueuedOp {
  return { opId: uid('op'), createdAt: new Date().toISOString(), attempts: 0, op }
}

/** Reducteur pur : etat + operation → nouvel etat. */
export function applyOp(state: AppState, op: Op): AppState {
  switch (op.kind) {
    case 'expense.create': {
      if (state.expenses.some((e) => e.id === op.expense.id)) return state
      return {
        ...state,
        expenses: [...state.expenses, op.expense],
        expenseShares: [...state.expenseShares, ...op.shares],
        ledger: [...state.ledger, ...ledgerFromExpense(op.expense, op.shares)],
      }
    }

    case 'settlement.create': {
      if (state.settlements.some((s) => s.id === op.settlement.id)) return state
      return {
        ...state,
        settlements: [...state.settlements, op.settlement],
        ledger: [...state.ledger, ...ledgerFromSettlement(op.settlement)],
      }
    }

    case 'settlement.confirm':
      return {
        ...state,
        settlements: state.settlements.map((s) =>
          s.id === op.id ? { ...s, status: 'confirmed', confirmedAt: op.confirmedAt } : s
        ),
        ledger: state.ledger.map((e) =>
          e.refType === 'settlement' && e.refId === op.id ? { ...e, status: 'confirmed' } : e
        ),
      }

    case 'movement.cancel':
      return {
        ...state,
        expenses:
          op.target === 'expense'
            ? state.expenses.map((e) => (e.id === op.id ? { ...e, cancelled: true } : e))
            : state.expenses,
        settlements:
          op.target === 'settlement'
            ? state.settlements.map((s) => (s.id === op.id ? { ...s, cancelled: true } : s))
            : state.settlements,
        ledger: [...state.ledger, ...op.inverse],
      }

    case 'group.create': {
      if (state.groups.some((g) => g.id === op.group.id)) return state
      const ids = Array.from(new Set([state.currentUserId, ...op.memberIds]))
      return {
        ...state,
        groups: [...state.groups, op.group],
        groupMembers: [
          ...state.groupMembers,
          ...ids.map((userId) => ({ groupId: op.group.id, userId })),
        ],
      }
    }

    case 'profile.update':
      return {
        ...state,
        users: state.users.map((u) => (u.id === op.id ? { ...u, ...op.patch } : u)),
      }
  }
}

// ── Constructeurs d'operations ─────────────────────────────────────────────

export function buildExpenseOp(input: {
  amount: number
  motive: string
  payerId: ID
  groupId: ID | null
  splitType: Expense['splitType']
  shares: Record<ID, number>
  createdBy: ID
}): Op {
  const expense: Expense = {
    id: uid('exp'),
    groupId: input.groupId,
    payerId: input.payerId,
    amount: round(input.amount),
    motive: input.motive.trim() || 'Depense',
    splitType: input.splitType,
    createdAt: new Date().toISOString(),
    status: 'confirmed',
    createdBy: input.createdBy,
  }
  const shares: ExpenseShare[] = Object.entries(input.shares)
    .filter(([, v]) => round(v) > 0)
    .map(([userId, shareAmount]) => ({
      expenseId: expense.id,
      userId,
      shareAmount: round(shareAmount),
    }))
  return { kind: 'expense.create', expense, shares }
}

export function buildSettlementOp(input: {
  fromUser: ID
  toUser: ID
  amount: number
  note?: string
  method: 'cash' | 'transfer'
}): Op {
  const settlement: Settlement = {
    id: uid('set'),
    fromUser: input.fromUser,
    toUser: input.toUser,
    amount: round(input.amount),
    note: input.note?.trim() || undefined,
    method: input.method,
    // Confirmation bilaterale obligatoire (CDC 5.3).
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  return { kind: 'settlement.create', settlement }
}

export function buildCancelOp(
  state: AppState,
  target: 'expense' | 'settlement',
  id: ID
): Op {
  const now = new Date().toISOString()
  const inverse: LedgerEntry[] = state.ledger
    .filter((e) => e.refId === id && e.refType === target)
    .map((e) => ({
      id: uid('led'),
      userA: e.userB,
      userB: e.userA,
      amount: e.amount,
      refType: 'adjustment' as const,
      refId: id,
      status: e.status,
      createdAt: now,
      label: `Annulation — ${e.label}`,
    }))
  return { kind: 'movement.cancel', target, id, inverse }
}

export function buildGroupOp(name: string, emoji: string, memberIds: ID[], ownerId: ID): Op {
  const group: Group = {
    id: uid('g'),
    name: name.trim() || 'Nouveau groupe',
    emoji: emoji || '👥',
    ownerId,
    createdAt: new Date().toISOString(),
  }
  return { kind: 'group.create', group, memberIds }
}
