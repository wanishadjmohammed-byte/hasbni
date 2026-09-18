import 'server-only'
import { redirect } from 'next/navigation'
import { currentAdmin } from './session'
import { rpc } from './server'

export interface PulseRow {
  dau: number
  wau: number
  mau: number
  signups_7d: number
  signups_prev_7d: number
  expenses_7d: number
  expenses_prev_7d: number
  settlements_7d: number
  settlements_prev_7d: number
  volume_7d: number
  volume_prev_7d: number
  total_profiles: number
  total_open_balance: number
}

export interface SeriesRow {
  day: string
  signups: number
  expenses: number
  settlements: number
  active: number
  volume: number
}

export interface ActivationRow {
  step: string
  rank: number
  reached: number
  median_hours: number | null
}

export interface RetentionRow {
  cohort_week: string
  cohort_size: number
  week_offset: number
  retained: number
}

export interface UserRow {
  profile_id: string
  created_at: string
  last_seen: string | null
  friends: number
  groups: number
  expenses: number
  settlements_confirmed: number
  pending_old: number
  net_position: number
  is_deleted: boolean
}

export interface IntegrityRow {
  user_a: string
  user_b: string
  ledger_net: number
  derived_net: number
  drift: number
}

export interface HealthRow {
  metric: string
  value: number
  detail: string
}

export interface ModerationRow {
  profile_id: string
  signal: string
  value: number
  since: string
}

export interface TimelineRow {
  at: string
  kind: string
  label: string
  status: string
}

/** Garde de page. Le middleware redirige deja, mais on ne s'y fie jamais seul. */
export async function guard() {
  const session = await currentAdmin()
  if (!session) redirect('/admin/login')
  return session
}

export const getPulse = () => rpc<PulseRow>('admin_pulse').then((r) => r[0] ?? null)
export const getSeries = (days = 30) => rpc<SeriesRow>('admin_timeseries', { p_days: days })
export const getActivation = (days = 30) => rpc<ActivationRow>('admin_activation', { p_days: days })
export const getRetention = (weeks = 8) => rpc<RetentionRow>('admin_retention', { p_weeks: weeks })
export const getIntegrity = () => rpc<IntegrityRow>('admin_ledger_integrity')
export const getHealth = () => rpc<HealthRow>('admin_health')
export const getModeration = () => rpc<ModerationRow>('admin_moderation')
export const getTimeline = (profileId: string) =>
  rpc<TimelineRow>('admin_user_timeline', { p_profile_id: profileId })

export const getUsers = (filter = 'all', limit = 100, offset = 0) =>
  rpc<UserRow>('admin_users_list', { p_filter: filter, p_limit: limit, p_offset: offset })

// ── Mise en forme ──────────────────────────────────────────────────────────

export function formatDA(value: number): string {
  return `${Math.round(value).toLocaleString('fr-FR').replace(/ | /g, ' ')} DA`
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString('fr-FR').replace(/ | /g, ' ')
}

export function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
  })
}

export function formatAgo(value: string | null): string {
  if (!value) return 'jamais'
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (days <= 0) return "aujourd'hui"
  if (days === 1) return 'hier'
  if (days < 31) return `il y a ${days} j`
  return formatDate(value)
}
