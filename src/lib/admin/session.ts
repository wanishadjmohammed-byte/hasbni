import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { adminDb } from './server'

/**
 * Session de la console, independante de celle de l'app.
 *
 * L'app garde sa session Supabase dans `localStorage` : un middleware, qui
 * s'execute cote serveur, ne peut pas la lire. La console a donc son propre
 * cookie — signe en HMAC, `httpOnly`, illisible et infalsifiable cote client.
 */
const COOKIE = 'hasbni_admin'
const MAX_AGE_S = 60 * 60 * 8 // 8 h : une session de travail, pas plus

interface Payload {
  sub: string // auth.users.id
  role: string
  exp: number // secondes epoch
}

function secret(): string {
  const value = process.env.ADMIN_SESSION_SECRET
  if (!value || value.length < 32) {
    throw new Error('ADMIN_SESSION_SECRET manquant ou trop court (32 caracteres minimum).')
  }
  return value
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url')
}

export function serialize(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function parse(token: string | undefined): Payload | null {
  if (!token) return null
  const [body, mac] = token.split('.')
  if (!body || !mac) return null

  // Comparaison a temps constant : une comparaison naive fuit la signature
  // octet par octet.
  const expected = Buffer.from(sign(body))
  const given = Buffer.from(mac)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as Payload
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function buildPayload(userId: string, role: string): Payload {
  return { sub: userId, role, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S }
}

export const cookieName = COOKIE
export const cookieMaxAge = MAX_AGE_S

/** Session courante, ou `null`. A appeler depuis un composant serveur. */
export async function currentAdmin(): Promise<Payload | null> {
  const store = await cookies()
  return parse(store.get(COOKIE)?.value)
}

/**
 * Session courante, ou une exception.
 * Le middleware filtre deja, mais chaque page revalide : une protection qui
 * ne tient qu'au middleware tombe des qu'une route lui echappe.
 */
export async function requireAdmin(): Promise<Payload> {
  const session = await currentAdmin()
  if (!session) throw new Error('Session administrateur requise')
  return session
}

/** Verifie que ce compte est bien administrateur, en base. */
export async function lookupAdminRole(userId: string): Promise<string | null> {
  const { data, error } = await adminDb()
    .from('admin_users')
    .select('role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data) return null
  return (data as { role: string }).role
}

/** Trace toute action sensible de la console. */
export async function logAdminAction(
  adminId: string,
  action: string,
  subjectId?: string | null,
  reason?: string | null,
  payload?: unknown
): Promise<void> {
  await adminDb().from('admin_audit_log').insert({
    admin_id: adminId,
    action,
    subject_id: subjectId ?? null,
    reason: reason ?? null,
    payload: payload ?? null,
  })
}
