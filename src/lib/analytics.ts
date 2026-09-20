'use client'

/**
 * Mesure du comportement.
 *
 * Deux regles tenues partout :
 *
 *  - **Jamais de montant dans un evenement**, seulement une TRANCHE. Un
 *    journal d'analytics finit toujours par etre lu par plus de monde qu'on ne
 *    l'imaginait ; savoir que quelqu'un a saisi « entre 5 000 et 20 000 DA »
 *    suffit a tous les tableaux de bord, et ne dit rien de personnel.
 *  - **Un evenement porte le nom de ce que la personne a fait**, pas du
 *    composant touche. `expense_created`, pas `AddExpenseModal_submit`.
 *
 * L'envoi est groupe et differe : la mesure ne doit jamais ralentir la saisie.
 */

import { getSupabase } from './supabase/client'

const ENDPOINT = '/api/events'
const FLUSH_MS = 4_000
const MAX_BATCH = 20

export type AmountBucket = '<1k' | '1-5k' | '5-20k' | '20k+'

/** Une tranche, jamais la valeur. */
export function bucket(amount: number): AmountBucket {
  const value = Math.abs(amount)
  if (value < 1_000) return '<1k'
  if (value < 5_000) return '1-5k'
  if (value < 20_000) return '5-20k'
  return '20k+'
}

interface Queued {
  event: string
  props: Record<string, unknown>
  sessionId: string
  platform: string
  appVersion: string
}

let queue: Queued[] = []
let timer: number | null = null
let sessionId = ''

function session(): string {
  if (sessionId) return sessionId
  if (typeof window === 'undefined') return ''
  try {
    const existing = window.sessionStorage.getItem('hasbni.session')
    if (existing) {
      sessionId = existing
      return sessionId
    }
    sessionId = crypto.randomUUID()
    window.sessionStorage.setItem('hasbni.session', sessionId)
  } catch {
    sessionId = crypto.randomUUID()
  }
  return sessionId
}

function platform(): string {
  if (typeof window === 'undefined') return 'server'
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone
  const ua = window.navigator.userAgent
  const os = /android/i.test(ua) ? 'android' : /iphone|ipad|ipod/i.test(ua) ? 'ios' : 'web'
  return standalone ? `${os}-pwa` : os
}

async function send(batch: Queued[]): Promise<void> {
  if (batch.length === 0) return
  try {
    // Le jeton sert a attribuer l'evenement : le serveur en deduit le profil,
    // il ne fait jamais confiance au corps de la requete pour ca.
    const sb = getSupabase()
    const token = sb ? (await sb.auth.getSession()).data.session?.access_token : undefined

    await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(batch),
      keepalive: true,
    })
  } catch {
    /* la mesure ne doit jamais casser ni ralentir l'app */
  }
}

function schedule(): void {
  if (timer !== null) return
  timer = window.setTimeout(() => {
    timer = null
    const batch = queue
    queue = []
    void send(batch)
  }, FLUSH_MS)
}

/** Enregistre un evenement. Ne leve jamais. */
export function track(event: string, props: Record<string, unknown> = {}): void {
  if (typeof window === 'undefined') return
  try {
    queue.push({
      event,
      props,
      sessionId: session(),
      platform: platform(),
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? 'dev',
    })
    if (queue.length >= MAX_BATCH) {
      const batch = queue
      queue = []
      void send(batch)
      return
    }
    schedule()
  } catch {
    /* ignore */
  }
}

/** Vide la file tout de suite (fermeture d'onglet, passage en arriere-plan). */
export function flushEvents(): void {
  if (queue.length === 0) return
  const batch = queue
  queue = []
  void send(batch)
}

/** Pose les declencheurs de vidage. Appele une fois au montage de l'app. */
export function installAnalytics(): () => void {
  if (typeof window === 'undefined') return () => {}

  track('session_start')

  const onHidden = () => {
    if (document.visibilityState === 'hidden') flushEvents()
  }
  document.addEventListener('visibilitychange', onHidden)
  window.addEventListener('pagehide', flushEvents)

  return () => {
    document.removeEventListener('visibilitychange', onHidden)
    window.removeEventListener('pagehide', flushEvents)
    flushEvents()
  }
}
