import { formatCount, getRetention, guard } from '@/lib/admin/queries'

export const dynamic = 'force-dynamic'

/**
 * Sequentielle a une seule teinte, clair vers fonce.
 * La valeur est ecrite dans chaque cellule : la couleur appuie la lecture,
 * elle ne la porte jamais seule.
 */
function cellColor(pct: number): { bg: string; fg: string } {
  if (pct <= 0) return { bg: 'var(--surface-2)', fg: 'var(--ink-3)' }
  if (pct < 20) return { bg: 'var(--seq-100)', fg: '#0b0b0b' }
  if (pct < 40) return { bg: 'var(--seq-250)', fg: '#0b0b0b' }
  if (pct < 60) return { bg: 'var(--seq-350)', fg: '#0b0b0b' }
  if (pct < 80) return { bg: 'var(--seq-450)', fg: '#ffffff' }
  return { bg: 'var(--seq-650)', fg: '#ffffff' }
}

export default async function RetentionPage() {
  await guard()
  const rows = await getRetention(8)

  const cohorts = new Map<string, { size: number; weeks: Map<number, number> }>()
  let maxOffset = 0
  for (const r of rows) {
    if (!cohorts.has(r.cohort_week)) {
      cohorts.set(r.cohort_week, { size: Number(r.cohort_size), weeks: new Map() })
    }
    cohorts.get(r.cohort_week)!.weeks.set(r.week_offset, Number(r.retained))
    if (r.week_offset > maxOffset) maxOffset = r.week_offset
  }
  const offsets = Array.from({ length: maxOffset + 1 }, (_, i) => i)

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Retention</h1>
          <p>
            Par cohorte d&apos;inscription. « Actif » veut dire avoir cree une depense ou touche a
            un remboursement pendant la semaine.
          </p>
        </div>
      </div>

      {cohorts.size === 0 ? (
        <p className="empty">Pas encore assez d&apos;historique pour des cohortes.</p>
      ) : (
        <div className="panel">
          <div className="panel-head">
            <h2>Semaines depuis l&apos;inscription</h2>
            <p className="hint">Chaque cellule : part de la cohorte active cette semaine-la.</p>
          </div>
          <div className="panel-body scroll-x">
            <table className="cohort">
              <thead>
                <tr>
                  <th className="row-head">Cohorte</th>
                  <th>Taille</th>
                  {offsets.map((o) => (
                    <th key={o}>S{o}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...cohorts.entries()].map(([week, data]) => (
                  <tr key={week}>
                    <th className="row-head">{week}</th>
                    <td style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
                      {formatCount(data.size)}
                    </td>
                    {offsets.map((o) => {
                      const retained = data.weeks.get(o)
                      if (retained === undefined) {
                        return (
                          <td key={o} className="empty">
                            ·
                          </td>
                        )
                      }
                      const pct = data.size > 0 ? Math.round((retained / data.size) * 100) : 0
                      const { bg, fg } = cellColor(pct)
                      return (
                        <td
                          key={o}
                          style={{ background: bg, color: fg }}
                          title={`${retained} sur ${data.size} actifs en semaine ${o}`}
                        >
                          {pct} %
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="notice">
        <b>Le chiffre a surveiller pour une app de dettes.</b> Une cohorte ou les DEUX personnes
        d&apos;une relation sont actives se retient bien mieux qu&apos;une cohorte a sens unique.
        Si la retention plafonne, c&apos;est presque toujours que le second cote n&apos;a jamais
        ete active — ce que la notification, aujourd&apos;hui absente, est censee resoudre.
      </div>
    </>
  )
}
