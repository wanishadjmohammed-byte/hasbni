import type { Metadata, Viewport } from 'next'
import './globals.css'
import AppShell from '@/components/AppShell'
import { AppProvider } from '@/context/AppContext'
import { AuthProvider } from '@/context/AuthContext'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <AuthProvider>
          <AppProvider>
            <AppShell>{children}</AppShell>
          </AppProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
