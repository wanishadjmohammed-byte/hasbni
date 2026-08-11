import { ledgerFromExpense, ledgerFromSettlement, splitEqual } from './ledger'
import type { AppState, Expense, ExpenseShare, LedgerEntry, Settlement } from './types'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const ago = (ms: number) => new Date(Date.now() - ms).toISOString()

export const ME = 'u_wanis'

export function buildSeed(): AppState {
  const users = [
    { id: ME, name: 'Wanis', phone: '+213 55 12 34 56', avatar: '🦊', color: '#22A06B' },
    { id: 'u_souhil', name: 'Souhil', phone: '+213 66 22 11 09', avatar: '🐼', color: '#0A8F6B' },
    { id: 'u_mosaab', name: 'Mosaab', phone: '+213 77 45 88 21', avatar: '🐧', color: '#2F9E7E' },
    { id: 'u_yacine', name: 'Yacine', phone: '+213 55 90 33 12', avatar: '🦉', color: '#1E8F8F' },
    { id: 'u_amine', name: 'Amine', phone: '+213 66 71 04 77', avatar: '🐺', color: '#3AA655' },
    { id: 'u_riad', name: 'Riad', phone: '+213 79 55 61 30', avatar: '🐨', color: '#12805C' },
  ]

  const groups = [
    { id: 'g_potes', name: 'Les potes', ownerId: ME, emoji: '🍽️', createdAt: ago(90 * DAY) },
    { id: 'g_coloc', name: 'Coloc', ownerId: 'u_souhil', emoji: '🏠', createdAt: ago(60 * DAY) },
    { id: 'g_voyage', name: 'Voyage Tikjda', ownerId: ME, emoji: '⛰️', createdAt: ago(20 * DAY) },
  ]

  const groupMembers = [
    ...['u_wanis', 'u_souhil', 'u_mosaab', 'u_yacine', 'u_amine'].map((userId) => ({
      groupId: 'g_potes',
      userId,
    })),
    ...['u_wanis', 'u_riad', 'u_mosaab'].map((userId) => ({ groupId: 'g_coloc', userId })),
    ...['u_wanis', 'u_souhil', 'u_yacine', 'u_amine'].map((userId) => ({
      groupId: 'g_voyage',
      userId,
    })),
  ]

  const expenses: Expense[] = []
  const expenseShares: ExpenseShare[] = []

  const addExpense = (
    e: Omit<Expense, 'status'> & { status?: Expense['status'] },
    participants: string[],
    custom?: Record<string, number>
  ) => {
    const expense: Expense = { ...e, status: e.status ?? 'confirmed' }
    expenses.push(expense)
    const shares = custom ?? splitEqual(expense.amount, participants, expense.payerId)
    for (const [userId, shareAmount] of Object.entries(shares)) {
      expenseShares.push({ expenseId: expense.id, userId, shareAmount })
    }
  }

  addExpense(
    {
      id: 'e_restau',
      groupId: 'g_potes',
      payerId: 'u_souhil',
      amount: 3000,
      motive: 'Restau samedi',
      splitType: 'equal',
      createdAt: ago(2 * DAY),
    },
    ['u_souhil', 'u_mosaab', ME]
  )

  addExpense(
    {
      id: 'e_taxi',
      groupId: 'g_potes',
      payerId: ME,
      amount: 1200,
      motive: 'Taxi retour',
      splitType: 'equal',
      createdAt: ago(2 * DAY - 3 * HOUR),
    },
    [ME, 'u_souhil', 'u_mosaab']
  )

  addExpense(
    {
      id: 'e_courses',
      groupId: 'g_coloc',
      payerId: ME,
      amount: 7400,
      motive: 'Courses du mois',
      splitType: 'equal',
      createdAt: ago(9 * DAY),
    },
    [ME, 'u_riad', 'u_mosaab']
  )

  addExpense(
    {
      id: 'e_netflix',
      groupId: 'g_coloc',
      payerId: 'u_riad',
      amount: 1800,
      motive: 'Abonnement Netflix',
      splitType: 'equal',
      createdAt: ago(16 * DAY),
    },
    ['u_riad', ME, 'u_mosaab']
  )

  addExpense(
    {
      id: 'e_essence',
      groupId: 'g_voyage',
      payerId: ME,
      amount: 6000,
      motive: 'Essence + peage Tikjda',
      splitType: 'equal',
      createdAt: ago(12 * DAY),
    },
    [ME, 'u_souhil', 'u_yacine', 'u_amine']
  )

  addExpense(
    {
      id: 'e_gite',
      groupId: 'g_voyage',
      payerId: 'u_yacine',
      amount: 12000,
      motive: 'Gite 2 nuits',
      splitType: 'custom',
      createdAt: ago(11 * DAY),
    },
    [],
    { u_yacine: 4000, u_wanis: 3000, u_souhil: 3000, u_amine: 2000 }
  )

  addExpense(
    {
      id: 'e_cafe',
      groupId: 'g_potes',
      payerId: 'u_amine',
      amount: 900,
      motive: 'Cafe + croissants',
      splitType: 'items',
      createdAt: ago(6 * HOUR),
      status: 'pending',
    },
    [],
    { u_amine: 300, u_wanis: 350, u_yacine: 250 }
  )

  const settlements: Settlement[] = [
    {
      id: 's_1',
      fromUser: ME,
      toUser: 'u_souhil',
      amount: 1000,
      note: 'Rendu en cash au cafe',
      method: 'cash',
      status: 'confirmed',
      createdAt: ago(5 * DAY),
      confirmedAt: ago(5 * DAY - HOUR),
    },
    {
      id: 's_2',
      fromUser: 'u_mosaab',
      toUser: ME,
      amount: 2000,
      note: 'Acompte courses',
      method: 'transfer',
      status: 'confirmed',
      createdAt: ago(4 * DAY),
      confirmedAt: ago(4 * DAY - 2 * HOUR),
    },
    {
      id: 's_3',
      fromUser: 'u_yacine',
      toUser: ME,
      amount: 1500,
      note: 'Part essence',
      method: 'cash',
      status: 'pending',
      createdAt: ago(4 * HOUR),
    },
    {
      id: 's_4',
      fromUser: ME,
      toUser: 'u_riad',
      amount: 600,
      note: 'Netflix janvier',
      method: 'transfer',
      status: 'pending',
      createdAt: ago(30 * 60_000),
    },
  ]

  const ledger: LedgerEntry[] = []
  for (const exp of expenses) {
    ledger.push(...ledgerFromExpense(exp, expenseShares.filter((s) => s.expenseId === exp.id)))
  }
  for (const s of settlements) {
    ledger.push(...ledgerFromSettlement(s))
  }

  return {
    currentUserId: ME,
    users,
    groups,
    groupMembers,
    expenses,
    expenseShares,
    settlements,
    ledger,
    // En demo, tout le monde est deja pote.
    friendRequests: [],
    friendships: users
      .filter((u) => u.id !== ME)
      .map((u) => ({
        userLow: ME < u.id ? ME : u.id,
        userHigh: ME < u.id ? u.id : ME,
      })),
  }
}
