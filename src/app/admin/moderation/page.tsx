import Link from 'next/link'
import { pseudonym } from '@/lib/admin/pseudonym'
import { formatCount, formatDate, getModeration, guard } from '@/lib/admin/queries'

export const dynamic = 'force-dynamic'

function toneFor(signal: string): 'warning' | 'serious' {
  return signal.toLowerCase().includes('annulation') ? 'serious' : 'warning'
}

export default async function ModerationPage() {
  await guard()
  const signals = await getModeration()

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Moderation</h1>
          <p>
            Signaux d&apos;usage anormal. Un signal n&apos;est pas une accusation : c&apos;est une
            invitation a regarder.
          </p>
        </div>
      </div>

      <div className="notice">
        <b>Ce qui n&apos;est plus possible.</b> La falsification pure — inventer une dette contre
        quelqu&apos;un avec qui on n&apos;a aucun lien — a ete fermee cote base :{' '}
        <span className="mono">create_expense</span> exige desormais une amitie acceptee ou un
        groupe commun pour chaque participant. Restent les abus d&apos;un lien legitime, que seul
        l&apos;usage revele.
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>{formatCount(signals.length)} signal(aux)</h2>
          <p className="hint">Cadence, taux d&apos;annulation, montants inhabituels.</p>
        </div>
        <div className="panel-body flush scroll-x">
          {signals.length === 0 ? (
            <div className="panel-body">
              <p style={{ margin: 0 }}>
                <span className="chip good">✓ Rien a signaler</span>{' '}
                <span className="dim">Aucun compte ne sort des seuils.</span>
              </p>
            </div>
          ) : (
            <table className="grid">
              <thead>
                <tr>
                  <th>Compte</th>
                  <th style={{ textAlign: 'left' }}>Signal</th>
                  <th>Valeur</th>
                  <th>Depuis</th>
                </tr>
              </thead>
              <tbody>
                {signals.map((s, i) => (
                  <tr key={`${s.profile_id}-${s.signal}-${i}`}>
                    <td className="mono">
                      <Link
                        href={`/admin/utilisateurs/${s.profile_id}`}
                        style={{ textDecoration: 'underline', textUnderlineOffset: 2 }}
                      >
                        {pseudonym(s.profile_id)}
                      </Link>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={`chip ${toneFor(s.signal)}`}>• {s.signal}</span>
                    </td>
                    <td>{formatCount(Number(s.value))}</td>
                    <td>{formatDate(s.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="notice">
        <b>Actions volontairement absentes.</b> Geler un compte ou annuler d&apos;autorite une
        depense ne sont pas encore cablees : les brancher demande de decider ce qui arrive aux
        soldes des tiers, et une mauvaise reponse a cette question casse les comptes de gens qui
        n&apos;ont rien fait. Quand elles arriveront, elles passeront par une ecriture
        d&apos;ajustement — jamais par une suppression — comme tout le reste de l&apos;app.
      </div>
    </>
  )
}
