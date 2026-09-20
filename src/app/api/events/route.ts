import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/admin/server'

/**
 * Collecte des evenements de comportement.
 *
 * L'ecriture passe par ici, jamais en direct depuis le navigateur, pour deux
 * raisons : le client ne peut pas forger d'evenements au nom d'un autre profil
 * (le profil est resolu a partir du jeton, pas du corps de la requete), et il
 * ne peut pas relire le flux.
 */
const MAX_EVENTS = 20
const MAX_PROP_BYTES = 2_000

/** Rien qui ressemble a un montant ne doit entrer : on veut des tranches. */
const FORBIDDEN_PROPS = /^(amount|montant|total|solde|balance|net|price|prix)$/i

function sanitize(props: unknown): Record<string, unknown> {
  if (!props || typeof props !== 'object' || Array.isArray(props)) return {}
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
    if (FORBIDDEN_PROPS.test(key) && typeof value === 'number') continue
    if (typeof value === 'object' && value !== null) continue
    out[key] = value
  }
  if (JSON.stringify(out).length > MAX_PROP_BYTES) return {}
  return out
}

interface Incoming {
  event?: string
  props?: unknown
  sessionId?: string
  platform?: string
  appVersion?: string
}

export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return NextResponse.json({ ok: false }, { status: 204 })

  let batch: Incoming[] = []
  try {
    const body = await request.json()
    batch = Array.isArray(body) ? body : [body]
  } catch {
    return NextResponse.json({ error: 'Requete invalide' }, { status: 400 })
  }
  if (batch.length === 0 || batch.length > MAX_EVENTS) {
    return NextResponse.json({ error: 'Lot invalide' }, { status: 400 })
  }

  // Le profil vient du jeton, jamais du corps : sinon n'importe qui pourrait
  // attribuer son activite a quelqu'un d'autre.
  let profileId: string | null = null
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (token) {
    const sb = createClient(url, anonKey, { auth: { persistSession: false } })
    const { data } = await sb.auth.getUser(token)
    if (data.user) {
      const { data: profile } = await adminDb()
        .from('profiles')
        .select('id')
        .eq('user_id', data.user.id)
        .maybeSingle()
      profileId = (profile as { id: string } | null)?.id ?? null
    }
  }

  const rows = batch
    .filter((e) => typeof e.event === 'string' && e.event.length > 0 && e.event.length <= 60)
    .map((e) => ({
      profile_id: profileId,
      session_id: e.sessionId ?? null,
      event: e.event as string,
      props: sanitize(e.props),
      platform: (e.platform ?? '').slice(0, 40) || null,
      app_version: (e.appVersion ?? '').slice(0, 20) || null,
    }))

  if (rows.length === 0) return new NextResponse(null, { status: 204 })

  const { error } = await adminDb().from('analytics_events').insert(rows)
  // La mesure ne doit jamais degrader l'app : on avale l'erreur.
  if (error) return new NextResponse(null, { status: 204 })

  return new NextResponse(null, { status: 204 })
}
