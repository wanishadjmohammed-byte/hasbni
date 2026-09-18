'use server'

import { adminDb } from '@/lib/admin/server'
import { currentAdmin } from '@/lib/admin/session'

export interface RevealState {
  error?: string
  identity?: { name: string; email: string | null; phone: string | null }
}

/**
 * Levee d'anonymat.
 *
 * Seule action de la console qui renvoie un nom et un email. Le motif est
 * obligatoire, et `admin_reveal` inscrit la consultation au journal AVANT de
 * renvoyer quoi que ce soit — impossible de regarder sans laisser de trace.
 */
export async function revealIdentity(
  _previous: RevealState,
  formData: FormData
): Promise<RevealState> {
  const session = await currentAdmin()
  if (!session) return { error: 'Session expiree' }

  const profileId = String(formData.get('profileId') ?? '')
  const reason = String(formData.get('reason') ?? '').trim()

  if (reason.length < 3) return { error: 'Indique un motif (ticket, demande, incident).' }

  const { data, error } = await adminDb().rpc('admin_reveal', {
    p_admin_id: session.sub,
    p_profile_id: profileId,
    p_reason: reason,
  })
  if (error) return { error: error.message }

  const row = (data as { name: string; email: string | null; phone: string | null }[])?.[0]
  if (!row) return { error: 'Profil introuvable' }

  return { identity: { name: row.name, email: row.email, phone: row.phone } }
}
