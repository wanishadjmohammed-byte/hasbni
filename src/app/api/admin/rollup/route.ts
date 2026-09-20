import { NextResponse } from 'next/server'
import { adminDb } from '@/lib/admin/server'

/**
 * Agregation journaliere, a declencher par un cron (Vercel Cron, GitHub
 * Actions, pg_cron…). Protegee par un secret partage : sans lui, n'importe qui
 * pourrait la marteler.
 *
 *   curl -X POST https://…/api/admin/rollup -H "x-rollup-secret: …"
 */
export async function POST(request: Request) {
  const secret = process.env.ADMIN_ROLLUP_SECRET
  if (!secret || request.headers.get('x-rollup-secret') !== secret) {
    return NextResponse.json({ error: 'Non autorise' }, { status: 401 })
  }

  // Hier et aujourd'hui : un jour se remplit encore apres minuit cote client.
  const days = [0, 1].map((back) => {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - back)
    return d.toISOString().slice(0, 10)
  })

  for (const day of days) {
    const { error } = await adminDb().rpc('admin_rollup_day', { p_day: day })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, days })
}
