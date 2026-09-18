import StatTile from '@/components/admin/StatTile'
import {
  formatCount,
  formatDA,
  getPulse,
  getSeries,
  guard,
} from '@/lib/admin/queries'

export const dynamic = 'force-dynamic'

export default async function PulsePage() {
  await guard()
  const [pulse, series] = await Promise.all([getPulse(), getSeries(30)])

  if (!pulse) {
    return <p className="empty">Aucune donnee. Le patch 07 a-t-il ete execute ?</p>
  }

  const stickiness = pulse.mau > 0 ? Math.round((pulse.wau / pulse.mau) * 100) : 0
  const col = (key: keyof (typeof series)[number]) => series.map((d) => Number(d[key]))

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Pulse</h1>
          <p>
            Les sept derniers jours, compares aux sept precedents. C&apos;est l&apos;ecran a
            laisser ouvert.
          </p>
        </div>
      </div>

      <div className="tiles">
        <StatTile
          label="Actifs du jour"
          value={formatCount(pulse.dau)}
          series={col('active')}
          note={`${formatCount(pulse.wau)} sur 7 j · ${formatCount(pulse.mau)} sur 30 j`}
        />
        <StatTile
          label="Fidelite (WAU / MAU)"
          value={`${stickiness} %`}
          note="Part des actifs du mois revenus cette semaine"
        />
        <StatTile
          label="Inscriptions"
          value={formatCount(pulse.signups_7d)}
          current={pulse.signups_7d}
          previous={pulse.signups_prev_7d}
          series={col('signups')}
        />
        <StatTile
          label="Depenses creees"
          value={formatCount(pulse.expenses_7d)}
          current={pulse.expenses_7d}
          previous={pulse.expenses_prev_7d}
          series={col('expenses')}
        />
        <StatTile
          label="Remboursements confirmes"
          value={formatCount(pulse.settlements_7d)}
          current={pulse.settlements_7d}
          previous={pulse.settlements_prev_7d}
          series={col('settlements')}
        />
        <StatTile
          label="Volume saisi"
          value={formatDA(pulse.volume_7d)}
          current={pulse.volume_7d}
          previous={pulse.volume_prev_7d}
          series={col('volume')}
        />
        <StatTile
          label="Comptes actifs"
          value={formatCount(pulse.total_profiles)}
          note="Hors comptes supprimes"
        />
        <StatTile
          label="Encours total"
          value={formatDA(pulse.total_open_balance)}
          note="Somme des dettes confirmees au grand livre"
        />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>30 derniers jours</h2>
          <p className="hint">Une ligne par jour — les jours vides sont des jours sans activite.</p>
        </div>
        <div className="panel-body flush scroll-x">
          <table className="grid">
            <thead>
              <tr>
                <th>Jour</th>
                <th>Actifs</th>
                <th>Inscriptions</th>
                <th>Depenses</th>
                <th>Remboursements</th>
                <th>Volume</th>
              </tr>
            </thead>
            <tbody>
              {[...series].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="mono">{d.day}</td>
                  <td>{formatCount(d.active)}</td>
                  <td>{formatCount(d.signups)}</td>
                  <td>{formatCount(d.expenses)}</td>
                  <td>{formatCount(d.settlements)}</td>
                  <td>{d.volume > 0 ? formatDA(d.volume) : <span className="dim">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}
