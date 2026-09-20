'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'

const LINKS = [
  { href: '/admin', label: 'Pulse' },
  { href: '/admin/activation', label: 'Activation' },
  { href: '/admin/retention', label: 'Retention' },
  { href: '/admin/utilisateurs', label: 'Utilisateurs' },
  { href: '/admin/sante', label: 'Sante du grand livre' },
  { href: '/admin/moderation', label: 'Moderation' },
]

export default function Nav({ role }: { role: string }) {
  const pathname = usePathname()
  const router = useRouter()

  const logout = async () => {
    await fetch('/api/admin/logout', { method: 'POST' })
    router.replace('/admin/login')
    router.refresh()
  }

  return (
    <nav className="admin-side">
      <div className="admin-brand">
        <div>
          <span>Hasbni</span>
          <b>Console</b>
        </div>
      </div>

      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className="admin-nav-link"
          aria-current={pathname === l.href ? 'page' : undefined}
        >
          {l.label}
        </Link>
      ))}

      <div style={{ marginTop: 'auto', paddingTop: '1rem' }}>
        <p className="tile-note" style={{ padding: '0 0.55rem 0.5rem' }}>
          Connecte — role {role}
        </p>
        <button onClick={() => void logout()} className="btn ghost full">
          Se deconnecter
        </button>
      </div>
    </nav>
  )
}
