import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import {
  buildPayload,
  cookieMaxAge,
  cookieName,
  logAdminAction,
  lookupAdminRole,
  serialize,
} from '@/lib/admin/session'

/**
 * Connexion a la console.
 *
 * Deux verifications, dans cet ordre : le mot de passe est valide (Supabase
 * Auth), PUIS le compte figure dans `admin_users`. Le message d'echec est le
 * meme dans les deux cas — sinon il devient un moyen de savoir qui est
 * administrateur.
 */
export async function POST(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Console non configuree' }, { status: 500 })
  }

  let email = ''
  let password = ''
  try {
    const body = (await request.json()) as { email?: string; password?: string }
    email = (body.email ?? '').trim()
    password = body.password ?? ''
  } catch {
    return NextResponse.json({ error: 'Requete invalide' }, { status: 400 })
  }

  if (!email || !password) {
    return NextResponse.json({ error: 'Email et mot de passe requis' }, { status: 400 })
  }

  const refuse = () =>
    NextResponse.json({ error: 'Identifiants invalides ou compte non autorise' }, { status: 401 })

  const sb = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await sb.auth.signInWithPassword({ email, password })
  if (error || !data.user) return refuse()

  const role = await lookupAdminRole(data.user.id)
  if (!role) return refuse()

  await logAdminAction(data.user.id, 'login', null, null, { email })

  const response = NextResponse.json({ ok: true, role })
  response.cookies.set(cookieName, serialize(buildPayload(data.user.id, role)), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: cookieMaxAge,
  })
  return response
}
