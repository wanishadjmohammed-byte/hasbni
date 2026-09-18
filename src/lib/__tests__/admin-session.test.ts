import { beforeAll, describe, expect, it } from 'vitest'

/**
 * Le cookie de session de la console est la seule chose qui separe un visiteur
 * de la totalite des donnees. Ces tests verifient qu'il ne peut pas etre
 * fabrique, modifie, ni rejoue apres expiration.
 */
beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'secret-de-test-suffisamment-long-pour-passer'
})

// Import differe : le module lit la variable d'environnement a l'appel.
async function mod() {
  return import('../admin/session')
}

describe('session admin — signature', () => {
  it('accepte un jeton qu’elle vient d’emettre', async () => {
    const { serialize, parse, buildPayload } = await mod()
    const token = serialize(buildPayload('user-1', 'owner'))
    const payload = parse(token)
    expect(payload?.sub).toBe('user-1')
    expect(payload?.role).toBe('owner')
  })

  it('refuse un jeton dont la charge utile a ete modifiee', async () => {
    const { serialize, parse, buildPayload } = await mod()
    const token = serialize(buildPayload('user-1', 'viewer'))
    const [, mac] = token.split('.')

    // On se promeut « owner » en reecrivant le corps, signature inchangee.
    const forged = Buffer.from(
      JSON.stringify({ sub: 'user-1', role: 'owner', exp: Math.floor(Date.now() / 1000) + 600 })
    ).toString('base64url')

    expect(parse(`${forged}.${mac}`)).toBeNull()
  })

  it('refuse une signature bricolee', async () => {
    const { serialize, parse, buildPayload } = await mod()
    const token = serialize(buildPayload('user-1', 'owner'))
    const [body] = token.split('.')
    expect(parse(`${body}.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`)).toBeNull()
  })

  it('refuse un jeton signe avec une autre cle', async () => {
    const { serialize, parse, buildPayload } = await mod()
    const token = serialize(buildPayload('user-1', 'owner'))

    // La cle est relue a chaque signature : changer la variable suffit a
    // simuler une rotation, sans recharger le module.
    process.env.ADMIN_SESSION_SECRET = 'une-autre-cle-tout-aussi-longue-mais-differente'
    expect(parse(token)).toBeNull()

    process.env.ADMIN_SESSION_SECRET = 'secret-de-test-suffisamment-long-pour-passer'
    expect(parse(token)?.sub).toBe('user-1')
  })

  it('refuse un jeton expire', async () => {
    const { serialize, parse } = await mod()
    const expired = serialize({ sub: 'user-1', role: 'owner', exp: Math.floor(Date.now() / 1000) - 1 })
    expect(parse(expired)).toBeNull()
  })

  it('refuse les formes degenerees', async () => {
    const { parse } = await mod()
    expect(parse(undefined)).toBeNull()
    expect(parse('')).toBeNull()
    expect(parse('sans-point')).toBeNull()
    expect(parse('.')).toBeNull()
  })

  it('exige une cle de signature serieuse', async () => {
    const original = process.env.ADMIN_SESSION_SECRET
    process.env.ADMIN_SESSION_SECRET = 'trop-court'
    const { serialize, buildPayload } = await mod()
    expect(() => serialize(buildPayload('user-1', 'owner'))).toThrow(/ADMIN_SESSION_SECRET/)
    process.env.ADMIN_SESSION_SECRET = original
  })
})

describe('pseudonyme', () => {
  it('est stable et ne laisse pas remonter a l’identifiant complet', async () => {
    const { pseudonym } = await import('../admin/pseudonym')
    const id = '8f3a1b2c-4d5e-6f70-8192-a3b4c5d6e7f8'
    expect(pseudonym(id)).toBe('user_8f3a1b')
    expect(pseudonym(id)).toBe(pseudonym(id))
    expect(pseudonym(id)).not.toContain(id)
  })

  it('distingue deux profils differents', async () => {
    const { pseudonym } = await import('../admin/pseudonym')
    expect(pseudonym('11111111-0000-0000-0000-000000000000')).not.toBe(
      pseudonym('22222222-0000-0000-0000-000000000000')
    )
  })
})
