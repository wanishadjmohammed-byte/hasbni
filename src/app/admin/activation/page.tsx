import { formatCount, getActivation, guard } from '@/lib/admin/queries'

export const dynamic = 'force-dynamic'

/** Ramp ordinale : sur fond clair, jamais plus clair que le pas 250. */
const STEPS = [
  'var(--seq-650)',
  'var(--seq-550)',
  'var(--seq-450)',
  'var(--seq-350)',
  'var(--seq-250)',
]

export default async function ActivationPage() {
  await guard()
  const steps = await getActivation(30)
  const top = steps[0]?.reached ?? 0

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Activation</h1>
          <p>
            Inscrits des 30 derniers jours. Mesure sur l&apos;etat reel — amitie acceptee, depense
            creee — et non sur des evenements, pour repondre des aujourd&apos;hui.
          </p>
        </div>
      </div>

      {top === 0 ? (
        <p className="empty">Aucune inscription sur la periode.</p>
      ) : (
        <>
          <div className="panel">
            <div className="panel-head">
              <h2>Entonnoir</h2>
              <p className="hint">Part de la cohorte ayant atteint chaque etape.</p>
            </div>
            <div className="panel-body">
              <div className="funnel">
                {steps.map((s, i) => {
                  const pct = top > 0 ? (s.reached / top) * 100 : 0
                  const previous = i > 0 ? steps[i - 1].reached : null
                  const drop =
                    previous && previous > 0
                      ? Math.round(((previous - s.reached) / previous) * 100)
                      : null
                  return (
                    <div key={s.step} className="funnel-row">
                      <div className="funnel-label">
                        <b>{s.step}</b>
                        {s.median_hours !== null && (
                          <span>
                            mediane {Math.round(Number(s.median_hours))} h apres
                            l&apos;inscription
                          </span>
                        )}
                        {drop !== null && drop > 0 && (
                          <span className="funnel-drop"> · −{drop} % a cette etape</span>
                        )}
                      </div>
                      <div className="funnel-track">
                        <div
                          className="funnel-bar"
                          style={{
                            width: `${Math.max(pct, 2)}%`,
                            background: STEPS[Math.min(i, STEPS.length - 1)],
                          }}
                        >
                          <span>
                            {formatCount(s.reached)} · {Math.round(pct)} %
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          <div className="notice">
            <b>Ce que cet ecran doit vous dire.</b> Si la chute est forte entre « Inscription » et
            « Premier pote accepte », le probleme est le parcours d&apos;invitation : ajouter un
            pote suppose aujourd&apos;hui qu&apos;il ait deja un compte, a l&apos;adresse exacte
            que l&apos;on tape, et il n&apos;existe aucun lien d&apos;invitation. Si elle est forte
            entre « Premier pote » et « Premiere depense », le probleme est ailleurs — regarder la
            retention.
          </div>
        </>
      )}
    </>
  )
}
