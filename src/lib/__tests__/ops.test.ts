import { describe, expect, it } from 'vitest'
import {
  applyOp,
  buildAmendOp,
  buildCancelOp,
  buildExpenseOp,
  buildSettlementOp,
  type Op,
} from '../ops'
import { balanceOf, relationBalance } from '../ledger'
import type { AppState } from '../types'

const ME = 'me'
const OTHER = 'other'

function emptyState(): AppState {
  return {
    currentUserId: ME,
    users: [
      { id: ME, name: 'Moi' },
      { id: OTHER, name: 'Pote' },
    ],
    groups: [],
    groupMembers: [],
    expenses: [],
    expenseShares: [],
    settlements: [],
    ledger: [],
    friendRequests: [],
    friendships: [{ userLow: ME < OTHER ? ME : OTHER, userHigh: ME < OTHER ? OTHER : ME }],
    balances: [],
  }
}

/** Depense de 1000 payee par moi, partagee en deux. */
function expenseOp() {
  return buildExpenseOp({
    amount: 1000,
    motive: 'Restau',
    payerId: ME,
    groupId: null,
    splitType: 'equal',
    shares: { [ME]: 500, [OTHER]: 500 },
    createdBy: ME,
  })
}

describe('applyOp — idempotence', () => {
  it('rejouer une creation de depense ne change rien', () => {
    const op = expenseOp()
    const once = applyOp(emptyState(), op)
    const twice = applyOp(once, op)

    expect(twice.expenses).toHaveLength(1)
    expect(twice.expenseShares).toHaveLength(once.expenseShares.length)
    expect(twice.ledger).toHaveLength(once.ledger.length)
    expect(balanceOf(twice, OTHER).net).toBe(balanceOf(once, OTHER).net)
  })

  it('rejouer un remboursement ne le compte pas deux fois', () => {
    const op = buildSettlementOp({
      fromUser: ME,
      toUser: OTHER,
      amount: 400,
      method: 'cash',
    })
    const once = applyOp(emptyState(), op)
    const twice = applyOp(once, op)
    expect(twice.settlements).toHaveLength(1)
    expect(twice.ledger).toHaveLength(once.ledger.length)
  })

  it('rejouer une confirmation laisse le meme solde', () => {
    const create = buildSettlementOp({
      fromUser: OTHER,
      toUser: ME,
      amount: 300,
      method: 'cash',
    })
    const settlementId = (create as Extract<Op, { kind: 'settlement.create' }>).settlement.id

    let state = applyOp(emptyState(), create)
    const confirm: Op = {
      kind: 'settlement.confirm',
      id: settlementId,
      confirmedAt: '2026-01-02T00:00:00.000Z',
    }
    state = applyOp(state, confirm)
    const after = balanceOf(state, OTHER).net
    state = applyOp(state, confirm)
    expect(balanceOf(state, OTHER).net).toBe(after)
  })

  it('rejouer un ajout de membre ne cree pas de doublon', () => {
    const op: Op = { kind: 'group.member.add', groupId: 'g1', userId: OTHER }
    const once = applyOp(emptyState(), op)
    const twice = applyOp(once, op)
    expect(twice.groupMembers).toHaveLength(1)
  })
})

describe('applyOp — soldes', () => {
  it('une depense payee par moi fait que l’autre me doit sa part', () => {
    const state = applyOp(emptyState(), expenseOp())
    expect(balanceOf(state, OTHER).net).toBe(500)
    // Le grand livre local doit raconter la meme chose.
    expect(relationBalance(state.ledger, ME, OTHER)).toBe(500)
  })

  it('un remboursement reste en attente tant qu’il n’est pas confirme', () => {
    let state = applyOp(emptyState(), expenseOp())
    const settle = buildSettlementOp({
      fromUser: OTHER,
      toUser: ME,
      amount: 500,
      method: 'cash',
    })
    state = applyOp(state, settle)

    expect(balanceOf(state, OTHER).net).toBe(500) // inchange
    expect(balanceOf(state, OTHER).projected).toBe(0) // previsionnel a jour
  })

  it('la confirmation bascule le previsionnel dans le solde', () => {
    let state = applyOp(emptyState(), expenseOp())
    const settle = buildSettlementOp({
      fromUser: OTHER,
      toUser: ME,
      amount: 500,
      method: 'cash',
    })
    state = applyOp(state, settle)
    state = applyOp(state, {
      kind: 'settlement.confirm',
      id: (settle as Extract<Op, { kind: 'settlement.create' }>).settlement.id,
      confirmedAt: '2026-01-02T00:00:00.000Z',
    })

    expect(balanceOf(state, OTHER).net).toBe(0)
    expect(balanceOf(state, OTHER).projected).toBe(0)
  })
})

describe('applyOp — annulation', () => {
  it('ramene le solde a zero sans rien supprimer', () => {
    const op = expenseOp()
    const expenseId = (op as Extract<Op, { kind: 'expense.create' }>).expense.id
    let state = applyOp(emptyState(), op)
    expect(balanceOf(state, OTHER).net).toBe(500)

    state = applyOp(state, buildCancelOp(state, 'expense', expenseId))

    expect(balanceOf(state, OTHER).net).toBe(0)
    // CDC 3 : jamais de suppression physique — la depense reste, marquee.
    expect(state.expenses).toHaveLength(1)
    expect(state.expenses[0].cancelled).toBe(true)
    expect(state.ledger.length).toBeGreaterThan(1)
  })
})

describe('applyOp — correction', () => {
  it('remplace la position de la depense au lieu de l’additionner', () => {
    const op = expenseOp()
    const expense = (op as Extract<Op, { kind: 'expense.create' }>).expense
    let state = applyOp(emptyState(), op)
    expect(balanceOf(state, OTHER).net).toBe(500)

    // La note etait en fait de 600, pas 1000.
    state = applyOp(
      state,
      buildAmendOp(expense, {
        amount: 600,
        motive: 'Restau',
        payerId: ME,
        groupId: null,
        splitType: 'equal',
        shares: { [ME]: 300, [OTHER]: 300 },
      })
    )

    expect(balanceOf(state, OTHER).net).toBe(300)
    expect(state.expenses).toHaveLength(1)
    expect(state.expenses[0].amount).toBe(600)
    expect(state.expenseShares.filter((s) => s.expenseId === expense.id)).toHaveLength(2)
  })

  it('garde l’identifiant et la date d’origine', () => {
    const op = expenseOp()
    const expense = (op as Extract<Op, { kind: 'expense.create' }>).expense
    const amend = buildAmendOp(expense, {
      amount: 2000,
      motive: 'Autre chose',
      payerId: OTHER,
      groupId: null,
      splitType: 'custom',
      shares: { [ME]: 2000 },
    })
    const amended = (amend as Extract<Op, { kind: 'expense.amend' }>).expense

    expect(amended.id).toBe(expense.id)
    expect(amended.createdAt).toBe(expense.createdAt)
    expect(amended.payerId).toBe(OTHER)
  })

  it('corriger une depense inconnue ne fait rien', () => {
    const state = emptyState()
    const ghost = (expenseOp() as Extract<Op, { kind: 'expense.create' }>).expense
    const next = applyOp(
      state,
      buildAmendOp(ghost, {
        amount: 100,
        motive: 'x',
        payerId: ME,
        groupId: null,
        splitType: 'equal',
        shares: { [OTHER]: 100 },
      })
    )
    expect(next).toBe(state)
  })

  it('une correction rejouee est stable', () => {
    const op = expenseOp()
    const expense = (op as Extract<Op, { kind: 'expense.create' }>).expense
    let state = applyOp(emptyState(), op)
    const amend = buildAmendOp(expense, {
      amount: 600,
      motive: 'Restau',
      payerId: ME,
      groupId: null,
      splitType: 'equal',
      shares: { [ME]: 300, [OTHER]: 300 },
    })
    state = applyOp(state, amend)
    const once = balanceOf(state, OTHER).net
    state = applyOp(state, amend)
    expect(balanceOf(state, OTHER).net).toBe(once)
  })
})

describe('applyOp — suppression d’un groupe', () => {
  it('detache les depenses au lieu de les supprimer', () => {
    let state = emptyState()
    state = applyOp(state, { kind: 'group.member.add', groupId: 'g1', userId: OTHER })

    const op = buildExpenseOp({
      amount: 1000,
      motive: 'Restau du groupe',
      payerId: ME,
      groupId: 'g1',
      splitType: 'equal',
      shares: { [ME]: 500, [OTHER]: 500 },
      createdBy: ME,
    })
    state = applyOp(state, op)
    const soldeAvant = balanceOf(state, OTHER).net

    state = applyOp(state, { kind: 'group.delete', groupId: 'g1' })

    // Le groupe disparait, ses membres aussi…
    expect(state.groups.find((g) => g.id === 'g1')).toBeUndefined()
    expect(state.groupMembers.filter((m) => m.groupId === 'g1')).toHaveLength(0)

    // …mais la depense survit, simplement detachee, et le solde ne bouge pas :
    // un groupe sert a repartir, les dettes qu'il cree sont bilaterales.
    expect(state.expenses).toHaveLength(1)
    expect(state.expenses[0].groupId).toBeNull()
    expect(balanceOf(state, OTHER).net).toBe(soldeAvant)
  })

  it('ne touche pas aux depenses d’un autre groupe', () => {
    let state = emptyState()
    state = applyOp(
      state,
      buildExpenseOp({
        amount: 400,
        motive: 'Autre groupe',
        payerId: ME,
        groupId: 'g2',
        splitType: 'custom',
        shares: { [OTHER]: 400 },
        createdBy: ME,
      })
    )
    state = applyOp(state, { kind: 'group.delete', groupId: 'g1' })
    expect(state.expenses[0].groupId).toBe('g2')
  })
})

describe('buildExpenseOp', () => {
  it('ecarte les parts nulles', () => {
    const op = buildExpenseOp({
      amount: 1000,
      motive: '  ',
      payerId: ME,
      groupId: null,
      splitType: 'custom',
      shares: { [ME]: 1000, [OTHER]: 0 },
      createdBy: ME,
    }) as Extract<Op, { kind: 'expense.create' }>

    expect(op.shares).toHaveLength(1)
    expect(op.expense.motive).toBe('Depense')
  })
})
