import { Suspense } from 'react'
import LoginClient from '@/components/LoginClient'

export default function LoginPage() {
  // `useSearchParams` (parametre `next`) impose une frontiere Suspense
  // pour que la page reste prerendue statiquement.
  return (
    <Suspense fallback={null}>
      <LoginClient />
    </Suspense>
  )
}
