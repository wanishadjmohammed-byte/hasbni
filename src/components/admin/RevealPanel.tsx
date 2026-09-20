'use client'

import { useActionState } from 'react'
import { revealIdentity, type RevealState } from '@/app/admin/utilisateurs/[id]/actions'

const initial: RevealState = {}

export default function RevealPanel({ profileId }: { profileId: string }) {
  const [state, action, pending] = useActionState(revealIdentity, initial)

  if (state.identity) {
    return (
      <div className="panel-body">
        <p style={{ margin: '0 0 0.5rem' }}>
          <span className="chip serious">• Identite revelee — consultation journalisee</span>
        </p>
        <table className="grid">
          <tbody>
            <tr>
              <td style={{ textAlign: 'left' }}>Nom</td>
              <td style={{ textAlign: 'left' }}>{state.identity.name}</td>
            </tr>
            <tr>
              <td style={{ textAlign: 'left' }}>Email</td>
              <td style={{ textAlign: 'left' }}>{state.identity.email ?? '—'}</td>
            </tr>
            <tr>
              <td style={{ textAlign: 'left' }}>Telephone</td>
              <td style={{ textAlign: 'left' }}>{state.identity.phone ?? '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <form action={action} className="panel-body">
      <input type="hidden" name="profileId" value={profileId} />
      {state.error && <p className="error">{state.error}</p>}
      <div className="field">
        <label htmlFor="reveal-reason">Motif de la consultation</label>
        <input
          id="reveal-reason"
          name="reason"
          type="text"
          placeholder="Ticket #42 — litige sur un remboursement"
          required
          minLength={3}
        />
      </div>
      <button type="submit" className="btn" disabled={pending}>
        {pending ? 'Enregistrement…' : "Reveler l'identite"}
      </button>
      <p className="tile-note" style={{ marginTop: '0.5rem' }}>
        Le motif et ton compte sont inscrits dans le journal des consultations, definitivement.
      </p>
    </form>
  )
}
