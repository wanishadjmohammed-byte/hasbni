import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import type { Op } from '../ops'
import { recomputeBalances } from '../ledger'
import type { AppState, ID, RelationBalance } from '../types'

type SB = SupabaseClient<Database>

/** Erreur non rejouable : l'operation est abandonnee au lieu d'etre retentee. */
export class PermanentSyncError extends Error {}

const RETRYABLE_CODES = new Set(['08000', '08006', '08003', '57014', '40001', '40P01'])

/**
 * Fenetre d'historique chargee au demarrage.
 *
 * Avant, `fetchState` faisait neuf `select('*')` sans la moindre limite : tout
 * le grand livre, toutes les depenses, toutes les parts, a chaque ouverture, a
 * chaque retour d'onglet et a chaque evenement temps reel. Les SOLDES viennent
 * maintenant de la vue `relation_balances` (Postgres voit tout l'historique) ;
 * le client ne charge plus que les mouvements recents, pour la timeline.
 */
const HISTORY_LIMIT = 300
/** Taille des lots pour `in(...)`, qui transite par l'URL. */
const SHARE_CHUNK = 60

/**
 * Rejeu d'une operation deja passee : la cle primaire existe. C'est le
 * comportement attendu d'une file idempotente, pas une erreur.
 */
function isDuplicate(error: { code?: string; message: string } | null): boolean {
  return error?.code === '23505'
}

/**
 * La fonction SQL n'existe pas encore dans ce projet (patch non applique).
 * On sait alors retomber sur le chemin equivalent en requetes directes.
 */
function isMissingFunction(error: { code?: string; message: string } | null): boolean {
  if (!error) return false
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message)
}

/** Vue ou colonne absente : meme logique, le projet n'a pas le dernier patch. */
function isMissingRelation(error: { code?: string; message: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42P01' ||
    error.code === '42703' ||
    error.code === 'PGRST205' ||
    /does not exist|could not find the table/i.test(error.message)
  )
}

function classify(error: { code?: string; message: string } | null): void {
  if (!error) return
  if (error.code && RETRYABLE_CODES.has(error.code)) throw new Error(error.message)
  // Violation de contrainte, RLS, colonne inconnue… : rejouer n'aidera pas.
  throw new PermanentSyncError(translatePostgresError(error.message))
}

function classifyIfError(error: { code?: string; message: string } | null): void {
  if (error && !isDuplicate(error)) classify(error)
}

/**
 * Les messages Postgres arrivent bruts jusqu'au bandeau de synchro. On traduit
 * ceux que l'utilisateur peut vraiment corriger (audit CRD-4).
 */
export function translatePostgresError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('out of range') || m.includes('montant invalide')) {
    return 'Montant trop grand — maximum 100 000 000 DA.'
  }
  if (m.includes('ne correspond pas au montant')) {
    return 'La somme des parts ne correspond pas au montant total.'
  }
  if (m.includes('ni un pote ni un membre')) {
    return "Un participant n'est pas dans tes potes."
  }
  if (m.includes('trop d') && m.includes('operations')) {
    return 'Trop d’operations en peu de temps — reessaie dans une heure.'
  }
  if (m.includes('row-level security') || m.includes('violates row-level')) {
    return "Tu n'as pas le droit d'enregistrer ca."
  }
  if (m.includes('expenses_motive_length') || m.includes('settlements_note_length')) {
    return 'Le texte est trop long.'
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Pas de reseau.'
  }
  return message
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

/** Soldes calcules par Postgres. Retombe sur `null` si le patch 06 manque. */
async function fetchBalances(sb: SB): Promise<RelationBalance[] | null> {
  const { data, error } = await sb.from('relation_balances').select('*')
  if (error) {
    if (isMissingRelation(error)) return null
    throw new Error(error.message)
  }
  return (data ?? []).map((b) => ({
    otherId: b.other_id,
    net: Number(b.net),
    projected: Number(b.projected),
    lastActivity: b.last_activity ?? '',
    movementCount: Number(b.movement_count),
  }))
}

/**
 * Charge le perimetre visible par l'utilisateur. La RLS fait le filtrage : on
 * ne recoit que les relations et groupes dont on fait partie.
 *
 * Deux temps : les tables de reference et la fenetre de mouvements en
 * parallele, puis les parts des seules depenses effectivement chargees.
 */
export async function fetchState(sb: SB, profileId: ID): Promise<AppState> {
  const [profiles, groups, members, expenses, settlements, ledger, requests, friends, balances] =
    await Promise.all([
      sb.from('profiles').select('*'),
      sb.from('groups').select('*'),
      sb.from('group_members').select('*'),
      sb
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
      sb
        .from('settlements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT),
      sb
        .from('ledger_entries')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(HISTORY_LIMIT * 3),
      sb.from('friend_requests').select('*'),
      sb.from('friendships').select('*'),
      fetchBalances(sb),
    ])

  for (const res of [profiles, groups, members, expenses, settlements, ledger, requests, friends]) {
    if (res.error) throw new Error(res.error.message)
  }

  // `in(...)` voyage dans l'URL : 300 UUID font ~11 ko et depassent la limite
  // habituelle des serveurs. On decoupe.
  const expenseIds = (expenses.data ?? []).map((e) => e.id)
  const shareRows: Database['public']['Tables']['expense_shares']['Row'][] = []
  for (let i = 0; i < expenseIds.length; i += SHARE_CHUNK) {
    const chunk = expenseIds.slice(i, i + SHARE_CHUNK)
    const { data, error } = await sb.from('expense_shares').select('*').in('expense_id', chunk)
    if (error) throw new Error(error.message)
    shareRows.push(...(data ?? []))
  }

  const state: AppState = {
    currentUserId: profileId,
    users: (profiles.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      phone: p.phone ?? undefined,
      email: p.email ?? undefined,
      avatar: p.avatar ?? undefined,
      color: p.color ?? undefined,
      createdBy: p.created_by ?? undefined,
      deletedAt: p.deleted_at ?? undefined,
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
    expenseShares: shareRows.map((s) => ({
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
    balances: [],
    ledgerWindowed: (ledger.data ?? []).length >= HISTORY_LIMIT * 3,
  }

  // Sans le patch 06 la vue n'existe pas : le grand livre charge fait alors
  // foi, comme avant.
  state.balances = balances ?? recomputeBalances(state)
  return state
}

/**
 * Positions nettes des membres d'un groupe, calculees par Postgres.
 *
 * Indispensable : la RLS ne montre au client que les ecritures ou il est
 * partie, donc une simplification calculee localement ignore les dettes entre
 * deux AUTRES membres et propose des transferts faux (audit).
 */
export async function fetchGroupPositions(
  sb: SB,
  groupId: ID
): Promise<Map<ID, number> | null> {
  const { data, error } = await sb.rpc('group_positions', { p_group_id: groupId })
  if (error) {
    if (isMissingFunction(error)) return null
    throw new Error(translatePostgresError(error.message))
  }
  return new Map((data ?? []).map((r) => [r.user_id, Number(r.net_position)]))
}

/**
 * Demande de pote par email. La recherche se fait cote serveur (SECURITY
 * DEFINER) : la table des profils n'est jamais exposee a une recherche libre.
 */
export async function sendFriendRequest(sb: SB, email: string): Promise<'sent' | 'accepted'> {
  const { data, error } = await sb.rpc('send_friend_request', { target_email: email })
  if (error) throw new Error(translatePostgresError(error.message))
  return (data as 'sent' | 'accepted') ?? 'sent'
}

export async function respondFriendRequest(
  sb: SB,
  requestId: ID,
  accept: boolean
): Promise<void> {
  const { error } = await sb.rpc('respond_friend_request', { request_id: requestId, accept })
  if (error) throw new Error(translatePostgresError(error.message))
}

/** Suppression de compte : anonymisation, jamais d'effacement (audit SEC-5). */
export async function deleteMyAccount(sb: SB): Promise<void> {
  const { error } = await sb.rpc('delete_my_account', {})
  if (error) throw new Error(translatePostgresError(error.message))
}

/** Export des donnees personnelles (audit OPS-5). */
export async function exportMyData(sb: SB): Promise<unknown> {
  const { data, error } = await sb.rpc('export_my_data', {})
  if (error) throw new Error(translatePostgresError(error.message))
  return data
}

/**
 * Rejoue une operation vers Postgres. Les entrees de grand livre ne sont jamais
 * ecrites ici : elles sont derivees par les triggers SQL (source de verite).
 * Les identifiants venant du client rendent le rejeu idempotent.
 */
export async function pushOp(sb: SB, profileId: ID, op: Op): Promise<void> {
  switch (op.kind) {
    case 'expense.create': {
      // Chemin nominal : une transaction serveur cree la depense ET ses parts,
      // en verifiant que chaque participant est bien un pote ou un membre du
      // groupe. Sans cette transaction on pouvait laisser une depense
      // orpheline, sans parts et sans ecriture (audit CRD-2).
      const { error } = await sb.rpc('create_expense', {
        p_id: op.expense.id,
        p_group_id: op.expense.groupId,
        p_payer_id: op.expense.payerId,
        p_amount: op.expense.amount,
        p_motive: op.expense.motive,
        p_split_type: op.expense.splitType,
        p_shares: op.shares.map((s) => ({ user_id: s.userId, share_amount: s.shareAmount })),
        p_created_at: op.expense.createdAt,
      })
      if (!error) return
      if (!isMissingFunction(error)) {
        classifyIfError(error)
        return
      }

      // Repli pour un projet ou le patch 06 n'a pas encore ete applique.
      const { error: expenseError } = await sb.from('expenses').insert({
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
      })
      classifyIfError(expenseError)

      const { error: shareError } = await sb.from('expense_shares').insert(
        op.shares.map((s) => ({
          expense_id: s.expenseId,
          user_id: s.userId,
          share_amount: s.shareAmount,
        }))
      )
      classifyIfError(shareError)
      return
    }

    case 'expense.amend': {
      // La correction solde l'ancienne position par des ecritures d'ajustement
      // puis en regenere des neuves : le grand livre reste additif et ne peut
      // plus diverger de ce qu'affiche l'ecran (audit SEC-4).
      const { error } = await sb.rpc('amend_expense', {
        p_id: op.expense.id,
        p_amount: op.expense.amount,
        p_motive: op.expense.motive,
        p_split_type: op.expense.splitType,
        p_shares: op.shares.map((s) => ({ user_id: s.userId, share_amount: s.shareAmount })),
        p_group_id: op.expense.groupId,
      })
      if (isMissingFunction(error)) {
        throw new PermanentSyncError(
          'La correction des depenses demande le patch 06 (supabase/patch-06-durcissement.sql).'
        )
      }
      classifyIfError(error)
      return
    }

    case 'settlement.create': {
      const { error } = await sb.from('settlements').insert({
        id: op.settlement.id,
        from_user: op.settlement.fromUser,
        to_user: op.settlement.toUser,
        amount: op.settlement.amount,
        note: op.settlement.note ?? null,
        method: op.settlement.method,
        status: 'pending',
        cancelled: false,
        created_at: op.settlement.createdAt,
      })
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
      const { error: groupError } = await sb.from('groups').insert({
        id: op.group.id,
        name: op.group.name,
        emoji: op.group.emoji,
        owner_id: profileId,
        created_at: op.group.createdAt,
      })
      classifyIfError(groupError)

      // Membre par membre : un doublon isole ne doit pas faire echouer le lot.
      const ids = Array.from(new Set([profileId, ...op.memberIds]))
      for (const userId of ids) {
        const { error: memberError } = await sb
          .from('group_members')
          .insert({ group_id: op.group.id, user_id: userId })
        classifyIfError(memberError)
      }
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
        .insert({ group_id: op.groupId, user_id: op.userId })
      classifyIfError(directError)
      return
    }

    case 'group.member.remove': {
      const { error } = await sb.rpc('remove_group_member', {
        p_group_id: op.groupId,
        p_user_id: op.userId,
      })
      if (!error) return
      if (!isMissingFunction(error)) {
        classifyIfError(error)
        return
      }

      // Repli : group_members_delete autorise deja le chef et l'interesse.
      const { error: directError } = await sb
        .from('group_members')
        .delete()
        .eq('group_id', op.groupId)
        .eq('user_id', op.userId)
      classifyIfError(directError)
      return
    }

    case 'group.delete': {
      const { error } = await sb.rpc('delete_group', { p_group_id: op.groupId })
      if (!error) return
      if (!isMissingFunction(error)) {
        classifyIfError(error)
        return
      }

      // Repli : la politique `groups_delete` autorise deja le createur.
      const { error: directError } = await sb.from('groups').delete().eq('id', op.groupId)
      classifyIfError(directError)
      return
    }

    case 'group.update': {
      const { error } = await sb.rpc('rename_group', {
        p_group_id: op.groupId,
        p_name: op.name,
        p_emoji: op.emoji,
      })
      if (!error) return
      if (!isMissingFunction(error)) {
        classifyIfError(error)
        return
      }

      const { error: directError } = await sb
        .from('groups')
        .update({ name: op.name, emoji: op.emoji })
        .eq('id', op.groupId)
      classifyIfError(directError)
      return
    }

    case 'profile.update': {
      // `email` n'est volontairement PAS envoye : c'est un miroir en lecture
      // seule de `auth.users.email`. Le laisser modifiable permettait de
      // squatter une adresse pas encore inscrite et d'intercepter les demandes
      // de pote qui lui etaient destinees (audit SEC-3).
      const { error } = await sb
        .from('profiles')
        .update({
          name: op.patch.name,
          phone: op.patch.phone ?? null,
          avatar: op.patch.avatar ?? null,
        })
        .eq('id', op.id)
      classifyIfError(error)
      return
    }
  }
}
