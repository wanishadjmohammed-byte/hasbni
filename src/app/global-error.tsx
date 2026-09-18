'use client'

/**
 * Dernier filet : une erreur pendant le rendu de la racine.
 * Sans ce fichier, un throw laissait une page blanche sans issue (audit UX-4).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#E9FFF4',
          color: '#0B3A2B',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 360, textAlign: 'center' }}>
          <h1 style={{ fontSize: 18, fontWeight: 700, margin: '0 0 8px' }}>
            Hasbni s&apos;est arrete
          </h1>
          <p style={{ fontSize: 13, opacity: 0.7, margin: '0 0 16px' }}>
            Tes donnees sont en securite. Recharge pour reprendre la ou tu en etais.
          </p>
          {error.digest && (
            <p style={{ fontSize: 11, opacity: 0.45, margin: '0 0 16px' }}>
              Code : {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: '#22A06B',
              color: '#fff',
              border: 0,
              borderRadius: 12,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
        </div>
      </body>
    </html>
  )
}
