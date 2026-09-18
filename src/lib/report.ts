/**
 * Point d'entree unique du signalement d'erreur.
 *
 * L'app n'avait aucun rapport d'erreur : un throw produisait un ecran blanc et
 * personne ne l'apprenait (audit OPS-3). On centralise ici pour n'avoir qu'un
 * fichier a modifier le jour ou un Sentry / GlitchTip est branche.
 *
 * Brancher un service : renseigner `NEXT_PUBLIC_ERROR_ENDPOINT` — les rapports
 * y sont postes en `sendBeacon`, sans bloquer le rendu.
 */

const ENDPOINT = process.env.NEXT_PUBLIC_ERROR_ENDPOINT

export interface ErrorContext {
  boundary?: string
  [key: string]: unknown
}

export function reportError(error: unknown, context: ErrorContext = {}): void {
  const payload = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    digest: (error as { digest?: string } | null)?.digest,
    context,
    url: typeof window !== 'undefined' ? window.location.pathname : undefined,
    at: new Date().toISOString(),
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('[Hasbni]', payload.message, payload)
    return
  }

  if (!ENDPOINT || typeof navigator === 'undefined') return

  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' })
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, blob)
    } else {
      void fetch(ENDPOINT, { method: 'POST', body: blob, keepalive: true })
    }
  } catch {
    /* le signalement ne doit jamais casser l'app */
  }
}

/**
 * Erreurs echappant a React (promesses rejetees, handlers natifs).
 * Appele une fois au montage de l'app.
 */
export function installGlobalErrorHandlers(): () => void {
  if (typeof window === 'undefined') return () => {}

  const onError = (event: ErrorEvent) => reportError(event.error ?? event.message, { kind: 'window' })
  const onRejection = (event: PromiseRejectionEvent) =>
    reportError(event.reason, { kind: 'unhandledrejection' })

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
  }
}
