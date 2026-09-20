import Link from 'next/link'
import RevealPanel from '@/components/admin/RevealPanel'
import { pseudonym } from '@/lib/admin/pseudonym'
import { getTimeline, guard } from '@/lib/admin/queries'
import { logAdminAction } from '@/lib/admin/session'

export const dynamic = 'force-dynamic'

export default async function UtilisateurPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await guard()
  const { id } = await params

  // Ouvrir la fiche de quelqu'un est deja une consultation : elle se trace.
  await logAdminAction(session.sub, 'view_user', id)
  const timeline = await getTimeline(id)

  return (
    <>
      <div className="admin-head">
        <div>
          <h1 className="mono" style={{ fontSize: '1.1rem' }}>
            {pseudonym(id)}
          </h1>
          <p>
            Journal d&apos;activite. Aucun montant n&apos;est affiche ici : le detail financier
            n&apos;est pas necessaire pour traiter un ticket.
          </p>
        </div>
        <Link href="/admin/utilisateurs" className="btn ghost">
          Retour a la liste
        </Link>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Identite</h2>
          <p className="hint">Masquee par defaut.</p>
        </div>
        <RevealPanel profileId={id} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Activite recente</h2>
          <p className="hint">60 derniers elements, mouvements et evenements confondus.</p>
        </div>
        <div className="panel-body flush scroll-x">
          {timeline.length === 0 ? (
            <p className="empty">Aucune activite enregistree.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Quand</th>
                  <th style={{ textAlign: 'left' }}>Type</th>
                  <th style={{ textAlign: 'left' }}>Detail</th>
                  <th style={{ textAlign: 'left' }}>Etat</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((row, i) => (
                  <tr key={`${row.at}-${i}`}>
                    <td className="mono">
                      {new Date(row.at).toLocaleString('fr-FR', {
                        day: '2-digit',
                        month: '2-digit',
                        year: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ textAlign: 'left' }}>{row.kind}</td>
                    <td style={{ textAlign: 'left' }} className="mono">
                      {row.label}
                    </td>
                    <td style={{ textAlign: 'left' }} className="dim">
                      {row.status || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  )
}
