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
    // Android compose son ecran de demarrage a partir du manifeste ; iOS
    // n'affiche rien sans ces images et ouvre la PWA sur un blanc franc.
    // Elles reprennent le degrade du splash applicatif : la bascule de l'une a
    // l'autre est invisible. Regenerer avec `npm run icons`.
    startupImage: [
      { url: '/splash/splash-1290x2796.png', media: '(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/splash-1284x2778.png', media: '(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/splash-1242x2688.png', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/splash-1179x2556.png', media: '(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/splash-1170x2532.png', media: '(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/splash-1125x2436.png', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)' },
      { url: '/splash/splash-828x1792.png',  media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)' },
      { url: '/splash/splash-750x1334.png',  media: '(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)' },
      { url: '/splash/splash-640x1136.png',  media: '(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2)' },
    ],
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
