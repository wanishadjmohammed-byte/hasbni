/**
 * Serie unique : pas de legende — le titre de la tuile nomme la mesure.
 * Aire + ligne 2px + point final accentue, grille absente a cette taille.
 */
export default function Sparkline({
  values,
  label,
  width = 132,
  height = 34,
}: {
  values: number[]
  label: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return <div style={{ height }} aria-hidden="true" />

  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pad = 3

  const x = (i: number) => (i / (values.length - 1)) * (width - pad * 2) + pad
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const area = `${line} L${x(values.length - 1).toFixed(1)},${height} L${x(0).toFixed(1)},${height} Z`
  const lastX = x(values.length - 1)
  const lastY = y(values[values.length - 1])
  const id = `spark-${label.replace(/\W/g, '')}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label} — evolution sur ${values.length} jours, derniere valeur ${values[values.length - 1]}`}
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {/* Anneau de surface : le point final reste lisible sur la ligne. */}
      <circle cx={lastX} cy={lastY} r="4" fill="var(--surface)" />
      <circle cx={lastX} cy={lastY} r="2.5" fill="var(--accent)" />
    </svg>
  )
}
