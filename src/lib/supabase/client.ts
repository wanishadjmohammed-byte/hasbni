import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const configured = Boolean(url && anonKey)

/**
 * Mode demonstration EXPLICITE.
 *
 * Avant, l'absence de variables suffisait a y basculer : si le deploiement
 * perdait ses variables, l'app demarrait quand meme, avec des potes fictifs
 * (Souhil, Mosaab…) et une base locale — un utilisateur pouvait s'inscrire
 * dans une app factice sans jamais s'en rendre compte (audit OPS-6).
 * On exige desormais un aveu : `NEXT_PUBLIC_DEMO=1`.
 */
const demoRequested = process.env.NEXT_PUBLIC_DEMO === '1'

if (!configured && !demoRequested && process.env.NODE_ENV === 'production') {
  throw new Error(
    'Hasbni : NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY sont absents. ' +
      'Renseigne-les, ou pose NEXT_PUBLIC_DEMO=1 pour assumer le mode demonstration.'
  )
}

export const supabaseEnabled = configured

let client: SupabaseClient<Database> | null = null

export function getSupabase(): SupabaseClient<Database> | null {
  if (!supabaseEnabled) return null
  if (client) return client
  client = createClient<Database>(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  })
  return client
}
