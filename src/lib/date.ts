const DAY = 86_400_000

export function relativeDate(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return "a l'instant"
  if (diff < 3_600_000) return `il y a ${Math.floor(diff / 60_000)} min`
  if (diff < DAY) return `il y a ${Math.floor(diff / 3_600_000)} h`
  const days = Math.floor(diff / DAY)
  if (days === 1) return 'hier'
  if (days < 7) return `il y a ${days} jours`
  if (days < 30) return `il y a ${Math.floor(days / 7)} sem.`
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

export function fullDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10)
}

export function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY)
}
