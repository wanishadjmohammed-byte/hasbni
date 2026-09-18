-- ============================================================================
--  Patch 06 — durcissement avant ouverture au public
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent : rejouable.
--
--  Issu de l'audit de pre-lancement. Ce patch couvre tout le travail serveur :
--  bornes, verrouillage d'identite, creation/correction atomique des depenses,
--  suppression de compte non destructrice, quotas, index, vue de soldes.
--
--  Choix produit assume (audit SEC-1) : une depense reste CONFIRMEE d'emblee,
--  sans accord du debiteur. La soupape est la correction : celui qui a saisi
--  peut modifier, et la correction repasse par le grand livre au lieu de le
--  desynchroniser (audit SEC-4). C'est `amend_expense` ci-dessous.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. BORNES (audit SEC-6)
--
--  `amount` etait un integer 32 bits garde par le seul `> 0` : un montant a
--  dix chiffres partait en « out of range », la file de synchro classait
--  l'erreur comme definitive et jetait l'operation apres avoir affiche un
--  succes optimiste. Les textes libres n'avaient aucune limite.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.expenses drop constraint if exists expenses_amount_bounds;
alter table public.expenses add constraint expenses_amount_bounds
  check (amount between 1 and 100000000);

alter table public.expenses drop constraint if exists expenses_motive_length;
alter table public.expenses add constraint expenses_motive_length
  check (char_length(motive) <= 120);

alter table public.settlements drop constraint if exists settlements_amount_bounds;
alter table public.settlements add constraint settlements_amount_bounds
  check (amount between 1 and 100000000);

alter table public.settlements drop constraint if exists settlements_note_length;
alter table public.settlements add constraint settlements_note_length
  check (note is null or char_length(note) <= 200);

alter table public.expense_shares drop constraint if exists expense_shares_amount_bounds;
alter table public.expense_shares add constraint expense_shares_amount_bounds
  check (share_amount between 0 and 100000000);

alter table public.groups drop constraint if exists groups_name_length;
alter table public.groups add constraint groups_name_length
  check (char_length(name) between 1 and 60);

alter table public.profiles drop constraint if exists profiles_name_length;
alter table public.profiles add constraint profiles_name_length
  check (char_length(name) between 1 and 60);

-- ────────────────────────────────────────────────────────────────────────────
--  2. VERROUILLAGE DE L'IDENTITE (audit SEC-3)
--
--  `profiles_update` limitait les LIGNES modifiables, pas les COLONNES, et
--  l'ecran Profil envoyait `email`. Or `send_friend_request` resout ses cibles
--  par `lower(profiles.email)` : on pouvait donc squatter une adresse pas
--  encore inscrite et intercepter les demandes qui lui etaient destinees.
--
--  Desormais l'email du profil est un miroir en lecture seule de
--  `auth.users.email`. Le client ne peut plus y toucher.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Les synchronisations internes (trigger auth, suppression de compte)
  -- lèvent ce drapeau le temps de leur transaction.
  if coalesce(current_setting('hasbni.identity_write', true), '') = 'on' then
    return new;
  end if;

  new.id         := old.id;
  new.user_id    := old.user_id;
  new.email      := old.email;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.deleted_at := old.deleted_at;
  return new;
end;
$$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

-- L'email du profil suit celui du compte, dans les deux sens de la vie du
-- compte (inscription deja couverte par handle_new_user, changement ici).
create or replace function public.sync_profile_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    perform set_config('hasbni.identity_write', 'on', true);
    update public.profiles set email = new.email where user_id = new.id;
    perform set_config('hasbni.identity_write', 'off', true);
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update on auth.users
  for each row execute function public.sync_profile_email();

-- Le jeton d'invitation appartenait au parcours « profil fantome » abandonne
-- par le patch 02. Plus rien ne le lit.
drop index if exists public.profiles_claim_token_idx;
alter table public.profiles drop column if exists claim_token;

-- ────────────────────────────────────────────────────────────────────────────
--  3. SUPPRESSION DE COMPTE NON DESTRUCTRICE (audit SEC-5)
--
--  Toutes les cles etrangeres vers `profiles` etaient en CASCADE. Supprimer un
--  compte effacait donc des ecritures appartenant a ses creanciers, et
--  reecrivait LEURS soldes. On passe en RESTRICT : le grand livre ne peut plus
--  etre ampute par l'action d'un tiers.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.ledger_entries drop constraint if exists ledger_entries_user_a_fkey;
alter table public.ledger_entries add constraint ledger_entries_user_a_fkey
  foreign key (user_a) references public.profiles (id) on delete restrict;

alter table public.ledger_entries drop constraint if exists ledger_entries_user_b_fkey;
alter table public.ledger_entries add constraint ledger_entries_user_b_fkey
  foreign key (user_b) references public.profiles (id) on delete restrict;

alter table public.expenses drop constraint if exists expenses_payer_id_fkey;
alter table public.expenses add constraint expenses_payer_id_fkey
  foreign key (payer_id) references public.profiles (id) on delete restrict;

alter table public.expenses drop constraint if exists expenses_created_by_fkey;
alter table public.expenses add constraint expenses_created_by_fkey
  foreign key (created_by) references public.profiles (id) on delete restrict;

alter table public.expense_shares drop constraint if exists expense_shares_user_id_fkey;
alter table public.expense_shares add constraint expense_shares_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete restrict;

alter table public.settlements drop constraint if exists settlements_from_user_fkey;
alter table public.settlements add constraint settlements_from_user_fkey
  foreign key (from_user) references public.profiles (id) on delete restrict;

alter table public.settlements drop constraint if exists settlements_to_user_fkey;
alter table public.settlements add constraint settlements_to_user_fkey
  foreign key (to_user) references public.profiles (id) on delete restrict;

/**
 * Suppression de compte : on anonymise et on coupe l'acces, on ne supprime
 * jamais la ligne. Les soldes des potes restent exacts.
 */
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  perform set_config('hasbni.identity_write', 'on', true);

  update public.profiles
     set name       = 'Compte supprime',
         email      = null,
         phone      = null,
         avatar     = '👤',
         deleted_at = now(),
         user_id    = null
   where id = me;

  delete from public.friend_requests where from_user = me or to_user = me;
  delete from public.friendships     where user_low = me or user_high = me;
  delete from public.group_members   where user_id = me;

  perform set_config('hasbni.identity_write', 'off', true);

  delete from auth.users where id = auth.uid();
end;
$$;

grant execute on function public.delete_my_account() to authenticated;

/** Export des donnees personnelles (audit OPS-5). */
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'profil',          (select to_jsonb(p) from public.profiles p where p.id = public.current_profile_id()),
    'depenses',        (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.expenses e
                         where e.payer_id = public.current_profile_id()
                            or e.created_by = public.current_profile_id()
                            or public.has_expense_share(e.id, public.current_profile_id())),
    'remboursements',  (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.settlements s
                         where s.from_user = public.current_profile_id()
                            or s.to_user = public.current_profile_id()),
    'grand_livre',     (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.ledger_entries l
                         where l.user_a = public.current_profile_id()
                            or l.user_b = public.current_profile_id()),
    'exporte_le',      to_jsonb(now())
  );
$$;

grant execute on function public.export_my_data() to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  4. QUOTAS (audit SEC-7)
--
--  Rien ne limitait la cadence : ni les demandes de pote, ni la creation de
--  depenses. Un compte pouvait en emettre autant qu'il voulait.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.assert_quota(p_action text, p_limit int)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  used int;
  me   uuid := public.current_profile_id();
begin
  if p_action = 'expense' then
    select count(*) into used from public.expenses
     where created_by = me and created_at > now() - interval '1 hour';
  elsif p_action = 'friend_request' then
    select count(*) into used from public.friend_requests
     where from_user = me and created_at > now() - interval '1 hour';
  elsif p_action = 'settlement' then
    select count(*) into used from public.settlements
     where from_user = me and created_at > now() - interval '1 hour';
  else
    return;
  end if;

  if used >= p_limit then
    raise exception 'Trop d''operations en peu de temps — reessaie dans une heure';
  end if;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
--  5. QUI PEUT FIGURER SUR UNE DEPENSE (audit SEC-2)
--
--  `expense_shares_insert` ne verifiait que `created_by = moi`. On pouvait donc
--  attribuer une part a N'IMPORTE QUEL identifiant de profil, sans amitie ni
--  groupe commun. Le trigger ecrivait alors l'ecriture bilaterale, ce qui
--  rendait `shares_context()` vrai... et donnait au faussaire l'acces en
--  lecture au profil de sa victime. La falsification creait sa propre
--  visibilite.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.can_share_with(a uuid, b uuid, gid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a = b
      or public.are_friends(a, b)
      or (gid is not null
          and public.is_group_member(gid, a)
          and public.is_group_member(gid, b));
$$;

drop policy if exists expense_shares_insert on public.expense_shares;
create policy expense_shares_insert on public.expense_shares for insert to authenticated
  with check (
    exists (
      select 1 from public.expenses e
       where e.id = expense_id
         and e.created_by = public.current_profile_id()
         and public.can_share_with(public.current_profile_id(),
                                   public.expense_shares.user_id,
                                   e.group_id)
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
--  6. CREATION ATOMIQUE D'UNE DEPENSE (audit CRD-2)
--
--  Le client inserait la depense, puis ses parts dans une SECONDE requete. Si
--  celle-ci echouait — RLS, identifiant invalide, montant hors bornes, reseau
--  coupe entre les deux — il restait une depense orpheline, visible, sans
--  parts et sans ecriture. Exactement le probleme resolu pour les groupes par
--  le patch 04 ; meme remede.
-- ────────────────────────────────────────────────────────────────────────────

/**
 * `p_shares` : [{ "user_id": "...", "share_amount": 1200 }, …]
 * `p_id` vient du client : le rejeu d'une operation en file ne cree pas de
 * doublon.
 */
create or replace function public.create_expense(
  p_id         uuid,
  p_group_id   uuid,
  p_payer_id   uuid,
  p_amount     integer,
  p_motive     text,
  p_split_type public.split_type,
  p_shares     jsonb,
  p_created_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me         uuid;
  share_sum  integer;
  bad        uuid;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  -- Rejeu d'une operation deja passee : on ressort sans rien refaire.
  if exists (select 1 from public.expenses e where e.id = p_id) then
    return p_id;
  end if;

  perform public.assert_quota('expense', 60);

  if p_amount is null or p_amount < 1 or p_amount > 100000000 then
    raise exception 'Montant invalide';
  end if;

  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Aucune part fournie';
  end if;

  -- Le payeur doit m'etre accessible, et chaque participant aussi.
  if not public.can_share_with(me, p_payer_id, p_group_id) then
    raise exception 'Ce payeur ne fait pas partie de tes potes';
  end if;

  select (s ->> 'user_id')::uuid into bad
    from jsonb_array_elements(p_shares) s
   where not public.can_share_with(me, (s ->> 'user_id')::uuid, p_group_id)
   limit 1;

  if bad is not null then
    raise exception 'Un participant n''est ni un pote ni un membre du groupe';
  end if;

  select coalesce(sum((s ->> 'share_amount')::integer), 0) into share_sum
    from jsonb_array_elements(p_shares) s;

  if share_sum <> p_amount then
    raise exception 'La somme des parts (%) ne correspond pas au montant (%)', share_sum, p_amount;
  end if;

  insert into public.expenses
    (id, group_id, payer_id, amount, motive, split_type, status, cancelled, created_by, created_at)
  values
    (p_id, p_group_id, p_payer_id, p_amount,
     coalesce(nullif(trim(p_motive), ''), 'Depense'),
     coalesce(p_split_type, 'equal'), 'confirmed', false, me, coalesce(p_created_at, now()));

  insert into public.expense_shares (expense_id, user_id, share_amount)
  select p_id, (s ->> 'user_id')::uuid, (s ->> 'share_amount')::integer
    from jsonb_array_elements(p_shares) s
   where (s ->> 'share_amount')::integer > 0
  on conflict do nothing;

  return p_id;
end;
$$;

grant execute on function public.create_expense(uuid, uuid, uuid, integer, text, public.split_type, jsonb, timestamptz) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  7. CORRECTION D'UNE DEPENSE (audit SEC-4 / CRD-3)
--
--  C'est la contrepartie du choix produit : la depense est confirmee d'emblee,
--  donc elle doit rester corrigeable. Mais une simple mise a jour du montant
--  laissait le grand livre sur les anciennes valeurs — l'ecran affichait un
--  total et les soldes en portaient un autre.
--
--  Ici : on solde la contribution actuelle de la depense par des ecritures
--  d'ajustement (le grand livre reste strictement additif), puis on reecrit
--  les parts, ce qui regenere des ecritures propres via le trigger existant.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.amend_expense(
  p_id         uuid,
  p_amount     integer,
  p_motive     text,
  p_split_type public.split_type,
  p_shares     jsonb,
  p_group_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me        uuid;
  exp       public.expenses%rowtype;
  share_sum integer;
  bad       uuid;
begin
  me := public.current_profile_id();
  select * into exp from public.expenses where id = p_id;

  if exp.id is null then
    raise exception 'Depense introuvable';
  end if;
  if exp.cancelled then
    raise exception 'Cette depense est annulee — elle ne peut plus etre corrigee';
  end if;
  if me <> exp.created_by and me <> exp.payer_id then
    raise exception 'Seul l''auteur ou le payeur peut corriger cette depense';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then
    raise exception 'Montant invalide';
  end if;

  select (s ->> 'user_id')::uuid into bad
    from jsonb_array_elements(p_shares) s
   where not public.can_share_with(me, (s ->> 'user_id')::uuid,
                                   coalesce(p_group_id, exp.group_id))
   limit 1;

  if bad is not null then
    raise exception 'Un participant n''est ni un pote ni un membre du groupe';
  end if;

  select coalesce(sum((s ->> 'share_amount')::integer), 0) into share_sum
    from jsonb_array_elements(p_shares) s;

  if share_sum <> p_amount then
    raise exception 'La somme des parts (%) ne correspond pas au montant (%)', share_sum, p_amount;
  end if;

  -- 1. Solder la position actuelle de cette depense, paire par paire.
  insert into public.ledger_entries (user_a, user_b, amount, ref_type, ref_id, status, label)
  select
    case when net.amt > 0 then net.hi else net.lo end,
    case when net.amt > 0 then net.lo else net.hi end,
    abs(net.amt), 'adjustment', p_id, 'confirmed',
    'Correction — ' || exp.motive
  from (
    select least(l.user_a, l.user_b) as lo,
           greatest(l.user_a, l.user_b) as hi,
           sum(case when l.user_a = least(l.user_a, l.user_b) then l.amount else -l.amount end) as amt
      from public.ledger_entries l
     where l.ref_id = p_id and l.ref_type in ('expense', 'adjustment')
     group by 1, 2
  ) net
  where net.amt <> 0;

  -- 2. Reecrire la depense AVANT les parts : le trigger `ledger_from_share`
  --    lit le motif et le statut sur la ligne de depense.
  update public.expenses
     set amount     = p_amount,
         motive     = coalesce(nullif(trim(p_motive), ''), exp.motive),
         split_type = coalesce(p_split_type, exp.split_type),
         group_id   = coalesce(p_group_id, exp.group_id)
   where id = p_id;

  -- 3. Nouvelles parts → nouvelles ecritures.
  delete from public.expense_shares where expense_id = p_id;

  insert into public.expense_shares (expense_id, user_id, share_amount)
  select p_id, (s ->> 'user_id')::uuid, (s ->> 'share_amount')::integer
    from jsonb_array_elements(p_shares) s
   where (s ->> 'share_amount')::integer > 0;

  return p_id;
end;
$$;

grant execute on function public.amend_expense(uuid, integer, text, public.split_type, jsonb, uuid) to authenticated;

-- Les parts doivent pouvoir etre remplacees par la correction, jamais par le
-- client en direct.
drop policy if exists expense_shares_delete on public.expense_shares;

-- ────────────────────────────────────────────────────────────────────────────
--  8. QUITTER UN GROUPE / RETIRER UN MEMBRE (audit CRD-5)
--
--  La politique de suppression existait depuis le patch 02 mais aucune
--  interface ni operation ne l'appelait : une erreur d'ajout etait definitive.
--  Quitter un groupe ne touche pas aux soldes : la relation reste bilaterale.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  if me <> p_user_id and not public.is_group_owner(p_group_id, me) then
    raise exception 'Seul le createur du groupe peut en retirer quelqu''un';
  end if;

  if public.is_group_owner(p_group_id, p_user_id) then
    raise exception 'Le createur ne peut pas quitter son propre groupe';
  end if;

  delete from public.group_members
   where group_id = p_group_id and user_id = p_user_id;
end;
$$;

grant execute on function public.remove_group_member(uuid, uuid) to authenticated;

create or replace function public.rename_group(p_group_id uuid, p_name text, p_emoji text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid;
begin
  me := public.current_profile_id();
  if not public.is_group_member(p_group_id, me) and not public.is_group_owner(p_group_id, me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  update public.groups
     set name  = coalesce(nullif(trim(p_name), ''), name),
         emoji = coalesce(nullif(trim(p_emoji), ''), emoji)
   where id = p_group_id;
end;
$$;

grant execute on function public.rename_group(uuid, text, text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  9. QUOTA SUR LES DEMANDES DE POTE (audit SEC-7)
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.send_friend_request(target_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid;
  target   uuid;
  incoming uuid;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  perform public.assert_quota('friend_request', 30);

  select id into target
    from public.profiles
   where user_id is not null
     and deleted_at is null
     and email is not null
     and lower(email) = lower(trim(target_email))
   limit 1;

  if target is null then
    raise exception 'Aucun compte Hasbni avec cet email';
  end if;

  if target = me then
    raise exception 'C''est ton propre email';
  end if;

  if public.are_friends(me, target) then
    raise exception 'Vous etes deja potes';
  end if;

  select id into incoming
    from public.friend_requests
   where from_user = target and to_user = me and status = 'pending';

  if incoming is not null then
    perform public.respond_friend_request(incoming, true);
    return 'accepted';
  end if;

  insert into public.friend_requests (from_user, to_user, status)
  values (me, target, 'pending')
  on conflict (from_user, to_user) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.friend_requests.status <> 'pending';

  return 'sent';
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
--  10. INDEX ALIGNES SUR LES PREDICATS REELS (audit SCL-5)
--
--  `ledger_pair_idx (user_a, user_b)` ne servait que la premiere branche du
--  `user_a = moi OR user_b = moi` de la politique de lecture. Et rien
--  n'indexait `created_at`, sur quoi toute pagination va trier.
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists ledger_user_b_idx      on public.ledger_entries (user_b);
create index if not exists ledger_user_a_created  on public.ledger_entries (user_a, created_at desc);
create index if not exists ledger_user_b_created  on public.ledger_entries (user_b, created_at desc);
create index if not exists expenses_created_idx   on public.expenses (created_at desc);
create index if not exists settlements_pending_idx on public.settlements (to_user, status)
  where cancelled = false;
create index if not exists expense_shares_expense_idx on public.expense_shares (expense_id);

-- ────────────────────────────────────────────────────────────────────────────
--  11. SOLDES CALCULES PAR POSTGRES (audit SCL-1)
--
--  L'accueil telechargeait tout le grand livre pour recalculer chaque solde
--  cote navigateur. Cette vue en renvoie une ligne par pote.
--  `security_invoker` : la RLS de `ledger_entries` s'applique normalement, la
--  vue ne voit donc que mes propres ecritures.
-- ────────────────────────────────────────────────────────────────────────────

drop view if exists public.relation_balances;
create view public.relation_balances
with (security_invoker = true) as
with mine as (
  select
    case when l.user_a = public.current_profile_id() then l.user_b else l.user_a end as other_id,
    case when l.user_b = public.current_profile_id() then l.amount else -l.amount end as signed_amount,
    l.status,
    l.created_at,
    l.ref_id
  from public.ledger_entries l
  where l.user_a = public.current_profile_id()
     or l.user_b = public.current_profile_id()
)
select
  other_id,
  coalesce(sum(signed_amount) filter (where status = 'confirmed'), 0)::bigint as net,
  coalesce(sum(signed_amount), 0)::bigint                                     as projected,
  max(created_at)                                                             as last_activity,
  count(distinct ref_id)                                                      as movement_count
from mine
group by other_id;

grant select on public.relation_balances to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  12. AUDIT VRAIMENT APPEND-ONLY (audit SEC hardening)
-- ────────────────────────────────────────────────────────────────────────────

revoke insert, update, delete on public.audit_log from authenticated;

drop policy if exists audit_no_write on public.audit_log;

-- ────────────────────────────────────────────────────────────────────────────
--  13. Les profils supprimes sortent du champ de visibilite.
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists profiles_active_idx on public.profiles (id) where deleted_at is null;

-- ────────────────────────────────────────────────────────────────────────────
--  14. SIMPLIFICATION DE GROUPE CALCULEE PAR LE SERVEUR
--
--  `simplifyGroup()` cote client additionnait les entrees de `state.ledger` —
--  or la RLS ne laisse voir que les ecritures ou je suis partie. Les dettes
--  entre deux AUTRES membres etaient donc invisibles, et la simplification
--  proposait des transferts faux des que le groupe depassait deux personnes.
--
--  Cette fonction voit tout le groupe (SECURITY DEFINER) mais ne renvoie que
--  des positions nettes par membre — jamais le detail des mouvements entre
--  tiers.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.group_positions(p_group_id uuid)
returns table (user_id uuid, position bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_group_member(p_group_id, public.current_profile_id())
     and not public.is_group_owner(p_group_id, public.current_profile_id()) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  return query
  with members as (
    select m.user_id as id from public.group_members m where m.group_id = p_group_id
  )
  select
    mem.id,
    coalesce(sum(
      case
        when l.user_b = mem.id then  l.amount   -- on lui doit
        when l.user_a = mem.id then -l.amount   -- il doit
        else 0
      end
    ), 0)::bigint
  from members mem
  left join public.ledger_entries l
    on (l.user_a = mem.id or l.user_b = mem.id)
   and l.status = 'confirmed'
   and l.user_a in (select id from members)
   and l.user_b in (select id from members)
  group by mem.id;
end;
$$;

grant execute on function public.group_positions(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  15. `profiles_update` : je ne modifie que MON profil
--
--  La politique autorisait aussi `created_by = moi`, hérité du parcours
--  « profil fantome » abandonné par le patch 02. Plus rien ne le cree.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());

-- ────────────────────────────────────────────────────────────────────────────
--  16. Temps reel : `expenses` fait doublon
--
--  Toute depense produit deja des lignes de grand livre, donc un evenement.
--  L'abonnement a `expenses` doublait la charge de rafraichissement.
-- ────────────────────────────────────────────────────────────────────────────

do $$
begin
  alter publication supabase_realtime drop table public.expenses;
exception when others then null;
end $$;
