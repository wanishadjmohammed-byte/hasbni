import { Suspense } from 'react'
import ProfileClient from '@/components/ProfileClient'

export default function ProfilePage() {
  // `useSearchParams` (raccourci `?ajouter-pote=1` depuis l'accueil vide)
  // impose une frontiere Suspense pour garder la page prerendue.
  return (
    <Suspense fallback={null}>
      <ProfileClient />
    </Suspense>
  )
}
