import { pseudonym } from '@/lib/admin/pseudonym'
import { formatCount, formatDA, getHealth, getIntegrity, guard } from '@/lib/admin/queries'

export const dynamic = 'force-dynamic'

/** Un compteur a zero est bon ; au-dessus, la gravite depend de la mesure. */
function tone(metric: string, value: number): 'good' | 'warning' | 'critical' {
  if (value === 0) return 'good'
  if (metric.includes('ecart')) return 'critical'
  return 'warning'
}

export default async function SantePage() {
  await guard()
  const [health, integrity] = await Promise.all([getHealth(), getIntegrity()])

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Sante du grand livre</h1>
          <p>
            L&apos;ecran qu&apos;aucun outil d&apos;analytics ne peut fournir, parce qu&apos;il
            demande la logique metier de Hasbni.
          </p>
        </div>
      </div>

      {/* Le controle d'integrite passe en premier : c'est le seul indicateur
          dont la valeur normale est zero et dont toute valeur non nulle est un
          bug, pas une tendance. */}
      <div className="panel">
        <div className="panel-head">
          <h2>Controle d&apos;integrite</h2>
          <p className="hint">
            Pour chaque paire : la somme du grand livre correspond-elle encore a ce que les parts
            de depense et les remboursements impliquent ?
          </p>
        </div>

        {integrity.length === 0 ? (
          <div className="panel-body">
            <p style={{ margin: 0 }}>
              <span className="chip good">✓ Aucun ecart</span>{' '}
              <span className="dim">
                Toutes les paires sont coherentes. C&apos;est l&apos;etat attendu.
              </span>
            </p>
          </div>
        ) : (
          <>
            <div className="panel-body" style={{ paddingBottom: 0 }}>
              <p style={{ margin: '0 0 0.75rem' }}>
                <span className="chip critical">⚠ {integrity.length} paire(s) en ecart</span>{' '}
                <span className="dim">
                  Un ecart est toujours un bug — declencheur SQL ou rejeu de la file hors ligne.
                  Traiter avant toute autre chose.
                </span>
              </p>
            </div>
            <div className="panel-body flush scroll-x">
              <table className="grid">
                <thead>
                  <tr>
                    <th>Paire</th>
                    <th>Grand livre</th>
                    <th>Recalcule</th>
                    <th>Ecart</th>
                  </tr>
                </thead>
                <tbody>
                  {integrity.map((row) => (
                    <tr key={`${row.user_a}-${row.user_b}`}>
                      <td className="mono">
                        {pseudonym(row.user_a)} ↔ {pseudonym(row.user_b)}
                      </td>
                      <td>{formatDA(row.ledger_net)}</td>
                      <td>{formatDA(row.derived_net)}</td>
                      <td style={{ color: 'var(--critical)', fontWeight: 600 }}>
                        {formatDA(row.drift)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Indicateurs operationnels</h2>
          <p className="hint">Sur les 7 derniers jours, sauf mention contraire.</p>
        </div>
        <div className="panel-body flush scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>Mesure</th>
                <th>Valeur</th>
                <th style={{ textAlign: 'left' }}>Ce que ca veut dire</th>
              </tr>
            </thead>
            <tbody>
              {health.map((row) => {
                const t = tone(row.metric.toLowerCase(), Number(row.value))
                return (
                  <tr key={row.metric}>
                    <td>{row.metric}</td>
                    <td>
                      <span className={`chip ${t}`}>
                        {t === 'good' ? '✓' : t === 'critical' ? '⚠' : '•'}{' '}
                        {formatCount(Number(row.value))}
                      </span>
                    </td>
                    <td style={{ textAlign: 'left' }} className="dim">
                      {row.detail}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="notice">
        <b>Comment lire un ecart.</b> « Grand livre » est la somme des ecritures confirmees de la
        paire. « Recalcule » repart des parts de depense et des remboursements, a neuf. Les deux
        doivent coincider : une depense annulee est compensee par son ecriture inverse, une
        depense corrigee par ses ecritures d&apos;ajustement. Un ecart signifie qu&apos;une
        ecriture manque, est en double, ou porte le mauvais signe.
      </div>
    </>
  )
}
