import type { Metadata, Viewport } from 'next'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // `maximumScale: 1` + `userScalable: false` bloquaient le zoom a deux
  // doigts : echec WCAG 1.4.4, et un probleme reel pour lire des montants
  // (audit UX-7). Le zoom est rendu a l'utilisateur.
  viewportFit: 'cover',
  themeColor: '#22A06B',
}

export const metadata: Metadata = {
  title: 'Hasbni — حسبني',
  description: 'Le releve de compte clair entre potes : qui doit quoi, sans prise de tete.',
  applicationName: 'Hasbni',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'Hasbni',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
}

/**
 * Racine minimale.
 *
 * Les fournisseurs de l'app (session, etat, file de synchro, temps reel) sont
 * descendus dans le groupe `(app)` : la console d'administration partage le
 * meme domaine mais n'a rien a faire d'un contexte PWA, d'un abonnement temps
 * reel ou d'une base IndexedDB.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
