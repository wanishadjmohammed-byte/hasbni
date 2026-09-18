'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export default function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? 'Connexion impossible')
        return
      }
      router.replace('/admin')
      router.refresh()
    } catch {
      setError('Pas de reseau')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      {error && <p className="error">{error}</p>}
      <div className="field">
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="admin-password">Mot de passe</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      <button type="submit" className="btn full" disabled={busy}>
        {busy ? 'Verification…' : 'Entrer'}
      </button>
    </form>
  )
}
