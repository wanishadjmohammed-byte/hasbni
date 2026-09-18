import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Client Postgres de la console, porteur de la cle `service_role`.
 *
 * `import 'server-only'` en tete : si ce module est un jour importe depuis un
 * composant client, le BUILD echoue. C'est volontaire. Cette cle contourne
 * entierement la RLS — dans un bundle navigateur, elle donnerait la base
 * complete a quiconque ouvre les outils de developpement.
 *
 * Elle n'est donc jamais prefixee `NEXT_PUBLIC_`.
 */
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

let client: SupabaseClient | null = null

export function adminDb(): SupabaseClient {
  if (!url || !serviceKey) {
    throw new Error(
      'Console indisponible : NEXT_PUBLIC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.'
    )
  }
  if (client) return client
  client = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}

export const adminConfigured = Boolean(url && serviceKey && process.env.ADMIN_SESSION_SECRET)

/** Appelle une fonction SQL de reporting et renvoie ses lignes. */
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T[]> {
  const { data, error } = await adminDb().rpc(name, args)
  if (error) throw new Error(`${name} : ${error.message}`)
  return (data ?? []) as T[]
}
