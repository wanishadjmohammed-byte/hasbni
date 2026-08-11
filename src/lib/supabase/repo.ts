import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { Op } from '../ops'
import type { AppState, ID } from '../types'

type SB = SupabaseClient<Database>

/** Erreur non rejouable : l'operation est abandonnee au lieu d'etre retentee. */
export class PermanentSyncError extends Error {}

const RETRYABLE_CODES = new Set(['08000', '08006', '08003', '57014', '40001', '40P01'])

/**
 * La fonction SQL n'existe pas encore dans ce projet (patch non applique).
 * On sait alors retomber sur le chemin equivalent en requetes directes.
 */
function isMissingFunction(error: { code?: string; message: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message)
}

function classify(error: { code?: string; message: string } | null): void {
  if (!error) return
  if (error.code && RETRYABLE_CODES.has(error.code)) throw new Error(error.message)
  // Violation de contrainte, RLS, colonne inconnue… : rejouer n'aidera pas.
  throw new PermanentSyncError(error.message)
}

/** Le profil de l'utilisateur connecte (cree par trigger a l'inscription). */
export async function fetchMyProfileId(sb: SB, authUserId: string): Promise<ID | null> {
  const { data, error } = await sb
    .from('profiles')
    .select('id')
    .eq('user_id', authUserId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data?.id ?? null
}

/**
 * Charge tout le perimetre visible par l'utilisateur. La RLS fait le filtrage :
 * on ne recoit que les relations et groupes dont on fait partie.
 */
export async function fetchState(sb: SB, profileId: ID): Promise<AppState> {
  const [profiles, groups, members, expenses, shares, settlements, ledger, requests, friends] =
    await Promise.all([
      sb.from('profiles').select('*'),
      sb.from('groups').select('*'),
      sb.from('group_members').select('*'),
      sb.from('expenses').select('*'),
      sb.from('expense_shares').select('*'),
      sb.from('settlements').select('*'),
      sb.from('ledger_entries').select('*'),
      sb.from('friend_requests').select('*'),
      sb.from('friendships').select('*'),
    ])

  for (const res of [
    profiles,
    groups,
    members,
    expenses,
    shares,
    settlements,
    ledger,
    requests,
    friends,
  ]) {
    if (res.error) throw new Error(res.error.message)
  }

  return {
    currentUserId: profileId,
    users: (profiles.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone ?? undefined,
      email: p.email ?? undefined,
      avatar: p.avatar ?? undefined,
      color: p.color ?? undefined,
      createdBy: p.created_by ?? undefined,
    })),
    groups: (groups.data ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      emoji: g.emoji,
      ownerId: g.owner_id,
      createdAt: g.created_at,
    })),
    groupMembers: (members.data ?? []).map((m) => ({
      groupId: m.group_id,
      userId: m.user_id,
    })),
    expenses: (expenses.data ?? []).map((e) => ({
      id: e.id,
      groupId: e.group_id,
      payerId: e.payer_id,
      amount: e.amount,
      motive: e.motive,
      splitType: e.split_type,
      status: e.status,
      cancelled: e.cancelled,
      createdBy: e.created_by,
      createdAt: e.created_at,
    })),
    expenseShares: (shares.data ?? []).map((s) => ({
      expenseId: s.expense_id,
      userId: s.user_id,
      shareAmount: s.share_amount,
    })),
    settlements: (settlements.data ?? []).map((s) => ({
      id: s.id,
      fromUser: s.from_user,
      toUser: s.to_user,
      amount: s.amount,
      note: s.note ?? undefined,
      method: s.method,
      status: s.status,
      cancelled: s.cancelled,
      createdAt: s.created_at,
      confirmedAt: s.confirmed_at ?? undefined,
    })),
    ledger: (ledger.data ?? []).map((l) => ({
      id: l.id,
      userA: l.user_a,
      userB: l.user_b,
      amount: l.amount,
      refType: l.ref_type,
      refId: l.ref_id,
      status: l.status,
      label: l.label,
      createdAt: l.created_at,
    })),
    friendRequests: (requests.data ?? []).map((r) => ({
      id: r.id,
      fromUser: r.from_user,
      toUser: r.to_user,
      status: r.status,
      createdAt: r.created_at,
    })),
    friendships: (friends.data ?? []).map((f) => ({
      userLow: f.user_low,
      userHigh: f.user_high,
    })),
  }
}

/**
 * Demande de pote par email. La recherche se fait cote serveur (SECURITY
 * DEFINER) : la table des profils n'est jamais exposee a une recherche libre.
 */
export async function sendFriendRequest(sb: SB, email: string): Promise<'sent' | 'accepted'> {
  const { data, error } = await sb.rpc('send_friend_request', { target_email: email })
  if (error) throw new Error(error.message)
  return (data as 'sent' | 'accepted') ?? 'sent'
}

export async function respondFriendRequest(
  sb: SB,
  requestId: ID,
  accept: boolean
): Promise<void> {
  const { error } = await sb.rpc('respond_friend_request', { request_id: requestId, accept })
  if (error) throw new Error(error.message)
}

/**
 * Rejoue une operation vers Postgres. Les entrees de grand livre ne sont jamais
 * ecrites ici : elles sont derivees par les triggers SQL (source de verite).
 * Les upserts rendent le rejeu idempotent apres une coupure reseau.
 */
export async function pushOp(sb: SB, profileId: ID, op: Op): Promise<void> {
  switch (op.kind) {
    case 'expense.create': {
      const { error } = await sb.from('expenses').upsert(
        {
          id: op.expense.id,
          group_id: op.expense.groupId,
          payer_id: op.expense.payerId,
          amount: op.expense.amount,
          motive: op.expense.motive,
          split_type: op.expense.splitType,
          status: op.expense.status,
          cancelled: false,
          created_by: profileId,
          created_at: op.expense.createdAt,
        },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      classifyIfError(error)

      const { error: shareError } = await sb.from('expense_shares').upsert(
        op.shares.map((s) => ({
          expense_id: s.expenseId,
          user_id: s.userId,
          share_amount: s.shareAmount,
        })),
        { onConflict: 'expense_id,user_id', ignoreDuplicates: true }
      )
      classifyIfError(shareError)
      return
    }

    case 'settlement.create': {
      const { error } = await sb.from('settlements').upsert(
        {
          id: op.settlement.id,
          from_user: op.settlement.fromUser,
          to_user: op.settlement.toUser,
          amount: op.settlement.amount,
          note: op.settlement.note ?? null,
          method: op.settlement.method,
          status: 'pending',
          cancelled: false,
          created_at: op.settlement.createdAt,
        },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      classifyIfError(error)
      return
    }

    case 'settlement.confirm': {
      const { error } = await sb
        .from('settlements')
        .update({ status: 'confirmed', confirmed_at: op.confirmedAt })
        .eq('id', op.id)
      classifyIfError(error)
      return
    }

    case 'movement.cancel': {
      // Les ecritures inverses sont produites par le trigger d'annulation.
      const table = op.target === 'expense' ? 'expenses' : 'settlements'
      const { error } = await sb.from(table).update({ cancelled: true }).eq('id', op.id)
      classifyIfError(error)
      return
    }

    case 'group.create': {
      // Chemin nominal : une transaction serveur cree le groupe ET ses membres.
      const { error } = await sb.rpc('create_group', {
        p_name: op.group.name,
        p_emoji: op.group.emoji,
        p_member_ids: op.memberIds.filter((id) => id !== profileId),
        p_group_id: op.group.id,
      })
      if (!error) return
      if (!isMissingFunction(error)) {
        classifyIfError(error)
        return
      }

      // Repli pour un projet ou le patch 04 n'a pas encore ete applique.
      const { error: groupError } = await sb.from('groups').upsert(
        {
          id: op.group.id,
          name: op.group.name,
          emoji: op.group.emoji,
          owner_id: profileId,
          created_at: op.group.createdAt,
        },
        { onConflict: 'id', ignoreDuplicates: true }
      )
      classifyIfError(groupError)

      const ids = Array.from(new Set([profileId, ...op.memberIds]))
      const { error: memberError } = await sb.from('group_members').upsert(
        ids.map((userId) => ({ group_id: op.group.id, user_id: userId })),
        { onConflict: 'group_id,user_id', ignoreDuplicates: true }
      )
      classifyIfError(memberError)
      return
    }

    case 'group.member.add': {
      const { error } = await sb.rpc('add_group_member', {
        p_group_id: op.groupId,
        p_user_id: op.userId,
      })
      if (!error) return
      if (!isMissingFunction(error)) {
        classifyIfError(error)
        return
      }

      // Repli : la politique group_members_insert autorise deja tout membre.
      const { error: directError } = await sb
        .from('group_members')
        .upsert({ group_id: op.groupId, user_id: op.userId }, {
          onConflict: 'group_id,user_id',
          ignoreDuplicates: true,
        })
      classifyIfError(directError)
      return
    }

    case 'profile.update': {
      const { error } = await sb
        .from('profiles')
        .update({
          name: op.patch.name,
          phone: op.patch.phone ?? null,
          email: op.patch.email ?? null,
          avatar: op.patch.avatar ?? null,
        })
        .eq('id', op.id)
      classifyIfError(error)
      return
    }
  }
}

function classifyIfError(error: { code?: string; message: string } | null): void {
  if (error) classify(error)
}
