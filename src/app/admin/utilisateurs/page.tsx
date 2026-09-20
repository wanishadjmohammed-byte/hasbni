import Link from 'next/link'
import { pseudonym } from '@/lib/admin/pseudonym'
import {
  formatAgo,
  formatCount,
  formatDA,
  formatDate,
  getUsers,
  guard,
} from '@/lib/admin/queries'

export const dynamic = 'force-dynamic'

/**
 * Les filtres sont la vraie valeur de cet ecran : ce sont des files de
 * support, pas des options de tri.
 */
const FILTERS = [
  { key: 'all', label: 'Tous' },
  { key: 'no_friend', label: 'Inscrits sans aucun pote' },
  { key: 'stuck', label: 'Un pote, aucune depense' },
  { key: 'pending', label: 'Remboursement en attente > 7 j' },
  { key: 'deleted', label: 'Comptes supprimes' },
]

export default async function UtilisateursPage({
  searchParams,
}: {
  searchParams: Promise<{ filtre?: string }>
}) {
  await guard()
  const params = await searchParams
  const filter = FILTERS.some((f) => f.key === params.filtre) ? params.filtre! : 'all'
  const users = await getUsers(filter)

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Utilisateurs</h1>
          <p>
            Pseudonymes par defaut. Voir un nom demande une action motivee, inscrite au journal
            des consultations.
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.2rem' }}>
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/admin/utilisateurs' : `/admin/utilisateurs?filtre=${f.key}`}
            className={filter === f.key ? 'btn' : 'btn ghost'}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{formatCount(users.length)} compte(s)</h2>
          <p className="hint">Les 100 plus recents pour ce filtre.</p>
        </div>
        <div className="panel-body flush scroll-x">
          {users.length === 0 ? (
            <p className="empty">Aucun compte pour ce filtre.</p>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th>Inscrit</th>
                  <th>Vu</th>
                  <th>Potes</th>
                  <th>Groupes</th>
                  <th>Depenses</th>
                  <th>Rembours.</th>
                  <th>En attente</th>
                  <th>Position nette</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.profile_id}>
                    <td className="mono">
                      <Link
                        href={`/admin/utilisateurs/${u.profile_id}`}
                        style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}
                      >
                        {pseudonym(u.profile_id)}
                      </Link>
                      {u.is_deleted && <span className="chip neutral" style={{ marginLeft: 6 }}>supprime</span>}
                    </td>
                    <td>{formatDate(u.created_at)}</td>
                    <td className={u.last_seen ? undefined : 'dim'}>{formatAgo(u.last_seen)}</td>
                    <td className={Number(u.friends) === 0 ? 'dim' : undefined}>
                      {formatCount(Number(u.friends))}
                    </td>
                    <td>{formatCount(Number(u.groups))}</td>
                    <td>{formatCount(Number(u.expenses))}</td>
                    <td>{formatCount(Number(u.settlements_confirmed))}</td>
                    <td>
                      {Number(u.pending_old) > 0 ? (
                        <span className="chip warning">• {u.pending_old}</span>
                      ) : (
                        <span className="dim">—</span>
                      )}
                    </td>
                    <td
                      style={{
                        color:
                          Number(u.net_position) > 0
                            ? 'var(--up)'
                            : Number(u.net_position) < 0
                              ? 'var(--critical)'
                              : undefined,
                      }}
                    >
                      {formatDA(Number(u.net_position))}
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
