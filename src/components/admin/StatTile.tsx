import Sparkline from './Sparkline'

function formatDelta(current: number, previous: number): { text: string; tone: string } {
  if (previous === 0 && current === 0) return { text: '—', tone: 'flat' }
  if (previous === 0) return { text: 'nouveau', tone: 'up' }
  const pct = Math.round(((current - previous) / previous) * 100)
  if (pct === 0) return { text: '0 %', tone: 'flat' }
  return { text: `${pct > 0 ? '+' : ''}${pct} %`, tone: pct > 0 ? 'up' : 'down' }
}

export default function StatTile({
  label,
  value,
  previous,
  current,
  series,
  note,
}: {
  label: string
  value: string
  /** Fournir les deux pour afficher l'ecart semaine sur semaine. */
  previous?: number
  current?: number
  series?: number[]
  note?: string
}) {
  const delta =
    previous !== undefined && current !== undefined ? formatDelta(current, previous) : null

  return (
    <div className="tile">
      <p className="tile-label">{label}</p>
      <p className="tile-value">{value}</p>
      <div className="tile-foot">
        {delta ? (
          <span className={`tile-delta ${delta.tone}`}>
            {delta.text}
            <span className="dim" style={{ fontWeight: 400 }}> vs 7 j</span>
          </span>
        ) : (
          <span />
        )}
        {series && series.length > 1 && <Sparkline values={series} label={label} />}
      </div>
      {note && <p className="tile-note">{note}</p>}
    </div>
  )
}
