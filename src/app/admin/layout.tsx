import './admin.css'
import type { Metadata } from 'next'
import { currentAdmin } from '@/lib/admin/session'
import Nav from '@/components/admin/Nav'

export const metadata: Metadata = {
  title: 'Console Hasbni',
  // Une console de back-office n'a rien a faire dans un index.
  robots: { index: false, follow: false },
}

/**
 * La console est servie par le meme domaine que l'app, mais ne partage rien
 * avec elle : ni fournisseur de session, ni etat, ni service worker (exclu
 * dans `public/sw.js`), ni chrome PWA.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await currentAdmin()

  // L'ecran de connexion vit sous /admin/login : pas de charpente autour.
  if (!session) return <div className="admin">{children}</div>

  return (
    <div className="admin">
      <div className="admin-shell">
        <Nav role={session.role} />
        <main className="admin-main">{children}</main>
      </div>
    </div>
  )
}
