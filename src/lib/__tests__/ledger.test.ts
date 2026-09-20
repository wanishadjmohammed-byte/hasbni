import { describe, expect, it } from 'vitest'
import {
  applyEntriesToBalances,
  balanceOf,
  recomputeBalances,
  relationBalance,
  simplifyFromPositions,
  splitEqual,
} from '../ledger'
import type { AppState, LedgerEntry } from '../types'

const ME = 'me'
const OTHER = 'other'
const THIRD = 'third'

function entry(partial: Partial<LedgerEntry> & Pick<LedgerEntry, 'userA' | 'userB' | 'amount'>): LedgerEntry {
  return {
    id: Math.random().toString(36).slice(2),
    refType: 'expense',
    refId: 'ref',
    status: 'confirmed',
    createdAt: '2026-01-01T00:00:00.000Z',
    label: 'Test',
    ...partial,
  }
}

function emptyState(overrides: Partial<AppState> = {}): AppState {
  return {
    currentUserId: ME,
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
    ...overrides,
  }
}

// ──────────────────────────────────────────────────────────────────────────
//  splitEqual — CDC 3 : arrondi a l'unite, reste au payeur
// ──────────────────────────────────────────────────────────────────────────

describe('splitEqual', () => {
  it('repartit a parts egales quand le montant tombe juste', () => {
    expect(splitEqual(3000, ['a', 'b', 'c'], 'a')).toEqual({ a: 1000, b: 1000, c: 1000 })
  })

  it('donne le reste de l’arrondi au payeur', () => {
    const shares = splitEqual(1000, ['a', 'b', 'c'], 'b')
    expect(shares).toEqual({ a: 333, b: 334, c: 333 })
  })

  it('donne le reste au premier participant si le payeur ne consomme pas', () => {
    const shares = splitEqual(1000, ['a', 'b', 'c'], 'payeur-absent')
    expect(shares.a).toBe(334)
  })

  it('conserve toujours le total, quel que soit le nombre de participants', () => {
    for (let total = 1; total <= 400; total += 7) {
      for (let n = 1; n <= 9; n++) {
        const participants = Array.from({ length: n }, (_, i) => `p${i}`)
        const shares = splitEqual(total, participants, 'p0')
        const sum = Object.values(shares).reduce((s, v) => s + v, 0)
        expect(sum).toBe(total)
      }
    }
  })

  it('ne renvoie rien sans participant', () => {
    expect(splitEqual(500, [], 'a')).toEqual({})
  })
})

// ──────────────────────────────────────────────────────────────────────────
//  relationBalance — CDC 3 : signe et statut
// ──────────────────────────────────────────────────────────────────────────

describe('relationBalance', () => {
  it('compte positivement ce que l’autre me doit', () => {
    const ledger = [entry({ userA: OTHER, userB: ME, amount: 1200 })]
    expect(relationBalance(ledger, ME, OTHER)).toBe(1200)
  })

  it('compte negativement ce que je lui dois', () => {
    const ledger = [entry({ userA: ME, userB: OTHER, amount: 800 })]
    expect(relationBalance(ledger, ME, OTHER)).toBe(-800)
  })

  it('est antisymetrique : son solde est l’oppose du mien', () => {
    const ledger = [
      entry({ userA: OTHER, userB: ME, amount: 1200 }),
      entry({ userA: ME, userB: OTHER, amount: 500 }),
    ]
    expect(relationBalance(ledger, ME, OTHER)).toBe(700)
    expect(relationBalance(ledger, OTHER, ME)).toBe(-700)
  })

  it('exclut les mouvements en attente, sauf demande explicite', () => {
    const ledger = [
      entry({ userA: OTHER, userB: ME, amount: 1000 }),
      entry({ userA: OTHER, userB: ME, amount: 500, status: 'pending' }),
    ]
    expect(relationBalance(ledger, ME, OTHER)).toBe(1000)
    expect(relationBalance(ledger, ME, OTHER, { includePending: true })).toBe(1500)
  })

  it('ignore les ecritures qui ne concernent pas la paire', () => {
    const ledger = [entry({ userA: THIRD, userB: ME, amount: 9999 })]
    expect(relationBalance(ledger, ME, OTHER)).toBe(0)
  })
})

// ──────────────────────────────────────────────────────────────────────────
//  Soldes — le pont entre la vue Postgres et les operations optimistes
// ──────────────────────────────────────────────────────────────────────────

describe('applyEntriesToBalances', () => {
  it('donne le meme resultat que le calcul direct sur le grand livre', () => {
    const ledger = [
      entry({ userA: OTHER, userB: ME, amount: 1200 }),
      entry({ userA: ME, userB: OTHER, amount: 500 }),
      entry({ userA: THIRD, userB: ME, amount: 300, status: 'pending' }),
    ]
    const balances = recomputeBalances(emptyState({ ledger }))

    expect(balances.find((b) => b.otherId === OTHER)?.net).toBe(
      relationBalance(ledger, ME, OTHER)
    )
    expect(balances.find((b) => b.otherId === THIRD)?.net).toBe(0)
    expect(balances.find((b) => b.otherId === THIRD)?.projected).toBe(300)
  })

  it('revient a l’etat initial quand on retire ce qu’on a ajoute', () => {
    const added = [entry({ userA: OTHER, userB: ME, amount: 1200 })]
    const after = applyEntriesToBalances([], ME, added)
    const back = applyEntriesToBalances(after, ME, [], added)
    expect(back.find((b) => b.otherId === OTHER)?.net).toBe(0)
  })

  it('ne compte pas les ecritures entre deux tiers', () => {
    const balances = applyEntriesToBalances(
      [],
      ME,
      [entry({ userA: OTHER, userB: THIRD, amount: 1000 })]
    )
    expect(balances).toHaveLength(0)
  })

  it('part du solde serveur et y applique le delta local', () => {
    const server = [
      { otherId: OTHER, net: 5000, projected: 5000, lastActivity: '2026-01-01', movementCount: 3 },
    ]
    const next = applyEntriesToBalances(server, ME, [
      entry({ userA: ME, userB: OTHER, amount: 2000, refId: 'nouveau' }),
    ])
    expect(next.find((b) => b.otherId === OTHER)?.net).toBe(3000)
  })
})

describe('balanceOf', () => {
  it('prefere le solde serveur quand il existe', () => {
    const state = emptyState({
      balances: [
        { otherId: OTHER, net: 4200, projected: 4700, lastActivity: '', movementCount: 2 },
      ],
      // Le grand livre local n'est qu'une fenetre : il ne doit pas primer.
      ledger: [entry({ userA: OTHER, userB: ME, amount: 100 })],
    })
    expect(balanceOf(state, OTHER)).toEqual({ net: 4200, projected: 4700 })
  })

  it('retombe sur le grand livre quand le pote n’est pas dans la vue', () => {
    const state = emptyState({ ledger: [entry({ userA: OTHER, userB: ME, amount: 700 })] })
    expect(balanceOf(state, OTHER).net).toBe(700)
  })
})

// ──────────────────────────────────────────────────────────────────────────
//  Simplification de groupe — CDC 2.7
// ──────────────────────────────────────────────────────────────────────────

describe('simplifyFromPositions', () => {
  it('ne propose rien quand tout est equilibre', () => {
    expect(simplifyFromPositions(new Map([['a', 0], ['b', 0]]))).toEqual([])
  })

  it('solde entierement le groupe', () => {
    const positions = new Map([
      ['a', -3000], // a doit 3000
      ['b', 1000],
      ['c', 2000],
    ])
    const transfers = simplifyFromPositions(positions)

    const after = new Map(positions)
    for (const t of transfers) {
      after.set(t.from, (after.get(t.from) ?? 0) + t.amount)
      after.set(t.to, (after.get(t.to) ?? 0) - t.amount)
    }
    for (const value of after.values()) expect(Math.abs(value)).toBeLessThanOrEqual(0.5)
  })

  it('n’utilise jamais plus de n-1 transferts', () => {
    const positions = new Map([
      ['a', -5000],
      ['b', -1000],
      ['c', 2000],
      ['d', 4000],
    ])
    const transfers = simplifyFromPositions(positions)
    expect(transfers.length).toBeLessThanOrEqual(positions.size - 1)
  })

  it('ne fait jamais payer un crediteur', () => {
    const positions = new Map([
      ['a', -2500],
      ['b', 2500],
    ])
    for (const t of simplifyFromPositions(positions)) {
      expect(positions.get(t.from)!).toBeLessThan(0)
      expect(positions.get(t.to)!).toBeGreaterThan(0)
    }
  })
})
