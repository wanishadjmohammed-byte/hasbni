-- ============================================================================
--  Hasbni — schema Postgres / Supabase  (AUTORITAIRE)
--
--  Etat consolide apres les patches 02 a 06. C'est le SEUL fichier a executer
--  pour monter un environnement neuf.
--
--  Avant, ce fichier etait reste a l'etat initial : il contenait encore la
--  politique `profiles_select` non qualifiee corrigee par le patch 03, la
--  politique `settlements_confirm` corrigee par le patch 05, et le parcours
--  « profil fantome » abandonne. Quiconque suivait le README obtenait donc une
--  base avec deux bugs connus.
--
--  Les anciens patches sont archives dans `supabase/patches/` — historique
--  seulement, ne pas les rejouer sur une base neuve.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════════════════
--  TABLES
-- ════════════════════════════════════════════════════════════════════════════

-- Profils --------------------------------------------------------------------
-- `deleted_at` : un compte supprime est anonymise, jamais efface. Sa ligne
-- survit pour que les soldes de ses potes restent justes.
create table if not exists public.profiles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid unique references auth.users (id) on delete set null,
  name       text not null,
  phone      text,
  email      text,
  avatar     text default '🙂',
  color      text default '#22A06B',
  created_by uuid references public.profiles (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profiles_name_length check (char_length(name) between 1 and 60)
);

create index if not exists profiles_user_id_idx    on public.profiles (user_id);
create index if not exists profiles_created_by_idx on public.profiles (created_by);
create index if not exists profiles_email_idx      on public.profiles (lower(email));
create index if not exists profiles_active_idx     on public.profiles (id) where deleted_at is null;

-- Un email = un compte.
create unique index if not exists profiles_email_unique
  on public.profiles (lower(email))
  where user_id is not null and email is not null;

-- Groupes --------------------------------------------------------------------
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  emoji      text not null default '👥',
  owner_id   uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint groups_name_length check (char_length(name) between 1 and 60)
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

-- Depenses et parts ----------------------------------------------------------
do $$ begin
  create type public.split_type as enum ('equal', 'custom', 'items');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.movement_status as enum ('pending', 'confirmed');
exception when duplicate_object then null;
end $$;

-- Les cles vers `profiles` sont en RESTRICT : une suppression de compte ne
-- doit jamais amputer le grand livre d'un tiers.
create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups (id) on delete set null,
  payer_id   uuid not null references public.profiles (id) on delete restrict,
  amount     integer not null,                              -- DA, arrondi a l'unite
  motive     text not null default 'Depense',
  split_type public.split_type not null default 'equal',
  status     public.movement_status not null default 'confirmed',
  cancelled  boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint expenses_amount_bounds check (amount between 1 and 100000000),
  constraint expenses_motive_length check (char_length(motive) <= 120)
);

create index if not exists expenses_payer_idx   on public.expenses (payer_id);
create index if not exists expenses_group_idx   on public.expenses (group_id);
create index if not exists expenses_created_idx on public.expenses (created_at desc);

create table if not exists public.expense_shares (
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete restrict,
  share_amount integer not null,
  primary key (expense_id, user_id),
  constraint expense_shares_amount_bounds check (share_amount between 0 and 100000000)
);

create index if not exists expense_shares_user_idx    on public.expense_shares (user_id);
create index if not exists expense_shares_expense_idx on public.expense_shares (expense_id);

-- Remboursements — confirmation bilaterale obligatoire ------------------------
create table if not exists public.settlements (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references public.profiles (id) on delete restrict,
  to_user      uuid not null references public.profiles (id) on delete restrict,
  amount       integer not null,
  note         text,
  method       text not null default 'cash' check (method in ('cash', 'transfer')),
  status       public.movement_status not null default 'pending',
  cancelled    boolean not null default false,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint settlements_distinct_parties check (from_user <> to_user),
  constraint settlements_amount_bounds   check (amount between 1 and 100000000),
  constraint settlements_note_length     check (note is null or char_length(note) <= 200)
);

create index if not exists settlements_from_idx    on public.settlements (from_user);
create index if not exists settlements_to_idx      on public.settlements (to_user);
create index if not exists settlements_pending_idx on public.settlements (to_user, status)
  where cancelled = false;

-- Grand livre — source de verite du solde, alimente uniquement par triggers.
-- `user_a` doit `amount` a `user_b`.
create table if not exists public.ledger_entries (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references public.profiles (id) on delete restrict,
  user_b     uuid not null references public.profiles (id) on delete restrict,
  amount     integer not null,
  ref_type   text not null check (ref_type in ('expense', 'settlement', 'adjustment')),
  ref_id     uuid not null,
  status     public.movement_status not null default 'confirmed',
  label      text not null default '',
  created_at timestamptz not null default now()
);

-- La politique de lecture filtre `user_a = moi OR user_b = moi` : il faut un
-- index par colonne, un index composite ne sert que la premiere branche.
create index if not exists ledger_pair_idx       on public.ledger_entries (user_a, user_b);
create index if not exists ledger_user_b_idx     on public.ledger_entries (user_b);
create index if not exists ledger_user_a_created on public.ledger_entries (user_a, created_at desc);
create index if not exists ledger_user_b_created on public.ledger_entries (user_b, created_at desc);
create index if not exists ledger_ref_idx        on public.ledger_entries (ref_type, ref_id);

-- Journal d'audit immuable (append-only) -------------------------------------
create table if not exists public.audit_log (
  id         bigserial primary key,
  actor_id   uuid,
  table_name text not null,
  action     text not null,
  row_id     uuid,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- Potes ----------------------------------------------------------------------
create table if not exists public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references public.profiles (id) on delete cascade,
  to_user      uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_distinct check (from_user <> to_user),
  constraint friend_requests_unique unique (from_user, to_user)
);

create index if not exists friend_requests_to_idx   on public.friend_requests (to_user, status);
create index if not exists friend_requests_from_idx on public.friend_requests (from_user, status);

-- Amitie stockee une seule fois, paire ordonnee (user_low < user_high).
create table if not exists public.friendships (
  user_low   uuid not null references public.profiles (id) on delete cascade,
  user_high  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high)
);

create index if not exists friendships_high_idx on public.friendships (user_high);

-- ════════════════════════════════════════════════════════════════════════════
--  FONCTIONS UTILITAIRES
--  `SECURITY DEFINER` : contournent la RLS pour eviter les recursions de
--  politiques.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.current_profile_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.profiles where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_group_member(gid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.group_members m where m.group_id = gid and m.user_id = pid
  );
$$;

create or replace function public.is_group_owner(gid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.groups g where g.id = gid and g.owner_id = pid);
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.friendships f
     where f.user_low = least(a, b) and f.user_high = greatest(a, b)
  );
$$;

-- Deux profils sont « lies » s'ils sont potes, partagent un groupe, ou ont deja
-- une ecriture commune.
create or replace function public.shares_context(a uuid, b uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a = b
      or public.are_friends(a, b)
      or exists (select 1 from public.group_members m1
                 join public.group_members m2 on m1.group_id = m2.group_id
                 where m1.user_id = a and m2.user_id = b)
      or exists (select 1 from public.ledger_entries l
                 where (l.user_a = a and l.user_b = b) or (l.user_a = b and l.user_b = a));
$$;

create or replace function public.has_expense_share(eid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.expense_shares s where s.expense_id = eid and s.user_id = pid
  );
$$;

create or replace function public.can_see_expense(eid uuid, pid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.expenses e
    where e.id = eid
      and (e.payer_id = pid or e.created_by = pid or public.has_expense_share(e.id, pid))
  );
$$;

-- Qui a le droit de figurer sur une depense que je saisis.
create or replace function public.can_share_with(a uuid, b uuid, gid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select a = b
      or public.are_friends(a, b)
      or (gid is not null
          and public.is_group_member(gid, a)
          and public.is_group_member(gid, b));
$$;

-- Quotas horaires par profil.
create or replace function public.assert_quota(p_action text, p_limit int)
returns void language plpgsql stable security definer set search_path = public as $$
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

-- ════════════════════════════════════════════════════════════════════════════
--  TRIGGERS METIER
-- ════════════════════════════════════════════════════════════════════════════

-- Chaque inscription cree son profil.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, name, phone, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'Pote'), '@', 1)),
    new.phone,
    new.email
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- L'email du profil est un MIROIR de celui du compte. Le laisser modifiable
-- permettait de squatter une adresse pas encore inscrite et d'intercepter les
-- demandes de pote qui lui etaient destinees.
create or replace function public.guard_profile_columns()
returns trigger language plpgsql security definer set search_path = public as $$
begin
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

create or replace function public.sync_profile_email()
returns trigger language plpgsql security definer set search_path = public as $$
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

-- Une part de depense genere une dette du participant vers le payeur.
create or replace function public.ledger_from_share()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  exp public.expenses%rowtype;
begin
  select * into exp from public.expenses where id = new.expense_id;
  if exp.payer_id = new.user_id or new.share_amount <= 0 then
    return new;
  end if;

  insert into public.ledger_entries (user_a, user_b, amount, ref_type, ref_id, status, label)
  values (new.user_id, exp.payer_id, new.share_amount, 'expense', exp.id, exp.status, exp.motive);

  return new;
end;
$$;

drop trigger if exists expense_shares_to_ledger on public.expense_shares;
create trigger expense_shares_to_ledger
  after insert on public.expense_shares
  for each row execute function public.ledger_from_share();

-- Un remboursement de X vers Y reduit ce que X doit a Y : ecriture inverse.
create or replace function public.ledger_from_settlement()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.ledger_entries (user_a, user_b, amount, ref_type, ref_id, status, label)
  values (new.to_user, new.from_user, new.amount, 'settlement', new.id, new.status,
          coalesce(new.note, 'Remboursement'));
  return new;
end;
$$;

drop trigger if exists settlements_to_ledger on public.settlements;
create trigger settlements_to_ledger
  after insert on public.settlements
  for each row execute function public.ledger_from_settlement();

create or replace function public.settlement_status_changed()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    update public.ledger_entries
       set status = new.status
     where ref_type = 'settlement' and ref_id = new.id;
  end if;

  -- Annulation : jamais de suppression physique, on ecrit l'inverse (CDC 3).
  if new.cancelled and not old.cancelled then
    insert into public.ledger_entries (user_a, user_b, amount, ref_type, ref_id, status, label)
    select l.user_b, l.user_a, l.amount, 'adjustment', l.ref_id, l.status,
           'Annulation — ' || l.label
      from public.ledger_entries l
     where l.ref_type = 'settlement' and l.ref_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists settlements_status on public.settlements;
create trigger settlements_status
  after update on public.settlements
  for each row execute function public.settlement_status_changed();

create or replace function public.expense_cancelled()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelled and not old.cancelled then
    insert into public.ledger_entries (user_a, user_b, amount, ref_type, ref_id, status, label)
    select l.user_b, l.user_a, l.amount, 'adjustment', l.ref_id, l.status,
           'Annulation — ' || l.label
      from public.ledger_entries l
     where l.ref_type = 'expense' and l.ref_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_cancelled on public.expenses;
create trigger expenses_cancelled
  after update on public.expenses
  for each row execute function public.expense_cancelled();

-- Journal d'audit sur tous les mouvements.
create or replace function public.write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (actor_id, table_name, action, row_id, payload)
  values (public.current_profile_id(), tg_table_name, tg_op,
          (to_jsonb(new) ->> 'id')::uuid, to_jsonb(new));
  return new;
end;
$$;

drop trigger if exists audit_expenses on public.expenses;
create trigger audit_expenses
  after insert or update on public.expenses
  for each row execute function public.write_audit();

drop trigger if exists audit_settlements on public.settlements;
create trigger audit_settlements
  after insert or update on public.settlements
  for each row execute function public.write_audit();

-- ════════════════════════════════════════════════════════════════════════════
--  RPC — tout ce qui doit etre transactionnel ou verifie cote serveur
-- ════════════════════════════════════════════════════════════════════════════

/**
 * Creation atomique d'une depense.
 * `p_shares` : [{ "user_id": "...", "share_amount": 1200 }, …]
 */
create or replace function public.create_expense(
  p_id uuid, p_group_id uuid, p_payer_id uuid, p_amount integer, p_motive text,
  p_split_type public.split_type, p_shares jsonb, p_created_at timestamptz default now()
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid; share_sum integer; bad uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;

  if exists (select 1 from public.expenses e where e.id = p_id) then
    return p_id;                                    -- rejeu de la file : rien a faire
  end if;

  perform public.assert_quota('expense', 60);

  if p_amount is null or p_amount < 1 or p_amount > 100000000 then
    raise exception 'Montant invalide';
  end if;
  if jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) = 0 then
    raise exception 'Aucune part fournie';
  end if;
  if not public.can_share_with(me, p_payer_id, p_group_id) then
    raise exception 'Ce payeur ne fait pas partie de tes potes';
  end if;

  select (s ->> 'user_id')::uuid into bad
    from jsonb_array_elements(p_shares) s
   where not public.can_share_with(me, (s ->> 'user_id')::uuid, p_group_id) limit 1;
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

/**
 * Correction d'une depense.
 *
 * Choix produit : la depense est confirmee des sa saisie, sans accord du
 * debiteur. La contrepartie est qu'elle reste corrigeable — et la correction
 * doit repasser par le grand livre, sinon l'ecran affiche un total pendant que
 * les soldes en portent un autre. On solde donc la position actuelle par des
 * ecritures d'ajustement (le grand livre reste strictement additif), puis on
 * reecrit les parts, ce qui regenere des ecritures propres.
 */
create or replace function public.amend_expense(
  p_id uuid, p_amount integer, p_motive text, p_split_type public.split_type,
  p_shares jsonb, p_group_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid; exp public.expenses%rowtype; share_sum integer; bad uuid;
begin
  me := public.current_profile_id();
  select * into exp from public.expenses where id = p_id;

  if exp.id is null then raise exception 'Depense introuvable'; end if;
  if exp.cancelled then
    raise exception 'Cette depense est annulee — elle ne peut plus etre corrigee';
  end if;
  -- Seul le payeur : la correction est sinon une porte derobee vers
  -- l'effacement de sa propre dette.
  if me <> exp.payer_id then
    raise exception 'Seul celui qui a paye peut corriger cette depense';
  end if;
  if p_amount is null or p_amount < 1 or p_amount > 100000000 then
    raise exception 'Montant invalide';
  end if;

  select (s ->> 'user_id')::uuid into bad
    from jsonb_array_elements(p_shares) s
   where not public.can_share_with(me, (s ->> 'user_id')::uuid,
                                   coalesce(p_group_id, exp.group_id)) limit 1;
  if bad is not null then
    raise exception 'Un participant n''est ni un pote ni un membre du groupe';
  end if;

  select coalesce(sum((s ->> 'share_amount')::integer), 0) into share_sum
    from jsonb_array_elements(p_shares) s;
  if share_sum <> p_amount then
    raise exception 'La somme des parts (%) ne correspond pas au montant (%)', share_sum, p_amount;
  end if;

  -- 1. Solder la position actuelle, paire par paire.
  insert into public.ledger_entries (user_a, user_b, amount, ref_type, ref_id, status, label)
  select
    case when net.amt > 0 then net.hi else net.lo end,
    case when net.amt > 0 then net.lo else net.hi end,
    abs(net.amt), 'adjustment', p_id, 'confirmed', 'Correction — ' || exp.motive
  from (
    select least(l.user_a, l.user_b) as lo, greatest(l.user_a, l.user_b) as hi,
           sum(case when l.user_a = least(l.user_a, l.user_b) then l.amount else -l.amount end) as amt
      from public.ledger_entries l
     where l.ref_id = p_id and l.ref_type in ('expense', 'adjustment')
     group by 1, 2
  ) net
  where net.amt <> 0;

  -- 2. Reecrire la depense AVANT les parts : le trigger lit motif et statut
  --    sur la ligne de depense.
  update public.expenses
     set amount = p_amount,
         motive = coalesce(nullif(trim(p_motive), ''), exp.motive),
         split_type = coalesce(p_split_type, exp.split_type),
         group_id = coalesce(p_group_id, exp.group_id)
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

/** Cree un groupe et y place l'appelant plus les membres fournis. */
create or replace function public.create_group(
  p_name text, p_emoji text, p_member_ids uuid[] default '{}', p_group_id uuid default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid; gid uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;

  gid := coalesce(p_group_id, gen_random_uuid());

  insert into public.groups (id, name, emoji, owner_id)
  values (gid, coalesce(nullif(trim(p_name), ''), 'Nouveau groupe'), coalesce(p_emoji, '👥'), me)
  on conflict (id) do nothing;

  if not exists (select 1 from public.groups g where g.id = gid and g.owner_id = me) then
    raise exception 'Ce groupe appartient a quelqu''un d''autre';
  end if;

  insert into public.group_members (group_id, user_id)
  select gid, m from unnest(array_append(coalesce(p_member_ids, '{}'), me)) as m
   where m is not null
  on conflict do nothing;

  return gid;
end;
$$;

/** Ajoute un membre : reserve aux membres du groupe (pas seulement au chef). */
create or replace function public.add_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;
  if not public.is_group_member(p_group_id, me)
     and not public.is_group_owner(p_group_id, me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group_id, p_user_id) on conflict do nothing;
end;
$$;

/** Le chef retire qui il veut ; chacun peut se retirer lui-meme. */
create or replace function public.remove_group_member(p_group_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;
  if me <> p_user_id and not public.is_group_owner(p_group_id, me) then
    raise exception 'Seul le createur du groupe peut en retirer quelqu''un';
  end if;
  if public.is_group_owner(p_group_id, p_user_id) then
    raise exception 'Le createur ne peut pas quitter son propre groupe';
  end if;

  delete from public.group_members where group_id = p_group_id and user_id = p_user_id;
end;
$$;

create or replace function public.rename_group(p_group_id uuid, p_name text, p_emoji text)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := public.current_profile_id();
  if not public.is_group_member(p_group_id, me) and not public.is_group_owner(p_group_id, me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;
  update public.groups
     set name = coalesce(nullif(trim(p_name), ''), name),
         emoji = coalesce(nullif(trim(p_emoji), ''), emoji)
   where id = p_group_id;
end;
$$;

/**
 * Suppression d'un groupe par son createur.
 *
 * Un groupe est un CONTEXTE de saisie, pas une caisse : ses depenses sont
 * detachees (`group_id` passe a null) et ses membres retires, mais les dettes
 * qu'il a servi a repartir sont bilaterales et lui survivent intactes.
 */
create or replace function public.delete_group(p_group_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;
  if not public.is_group_owner(p_group_id, me) then
    raise exception 'Seul le createur du groupe peut le supprimer';
  end if;
  delete from public.groups where id = p_group_id;
end;
$$;

/**
 * Positions nettes des membres d'un groupe.
 * Necessairement cote serveur : la RLS ne montre au client que les ecritures ou
 * il est partie, donc une simplification calculee en local ignore les dettes
 * entre deux autres membres.
 *
 * `net_position` et non `position` : ce dernier est un mot-cle Postgres refuse
 * comme nom de colonne dans un `returns table (...)`.
 */
create or replace function public.group_positions(p_group_id uuid)
returns table (user_id uuid, net_position bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_group_member(p_group_id, public.current_profile_id())
     and not public.is_group_owner(p_group_id, public.current_profile_id()) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  return query
  with members as (
    select m.user_id as id from public.group_members m where m.group_id = p_group_id
  )
  select mem.id,
         coalesce(sum(case when l.user_b = mem.id then l.amount
                           when l.user_a = mem.id then -l.amount else 0 end), 0)::bigint
    from members mem
    left join public.ledger_entries l
      on (l.user_a = mem.id or l.user_b = mem.id)
     and l.status = 'confirmed'
     and l.user_a in (select id from members)
     and l.user_b in (select id from members)
   group by mem.id;
end;
$$;

/** Demande de pote par email — la table des profils n'est jamais exposee. */
create or replace function public.send_friend_request(target_email text)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid; target uuid; incoming uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;

  perform public.assert_quota('friend_request', 30);

  select id into target from public.profiles
   where user_id is not null and deleted_at is null and email is not null
     and lower(email) = lower(trim(target_email)) limit 1;

  if target is null then raise exception 'Aucun compte Hasbni avec cet email'; end if;
  if target = me then raise exception 'C''est ton propre email'; end if;
  if public.are_friends(me, target) then raise exception 'Vous etes deja potes'; end if;

  -- S'il m'a deja invite, on accepte au lieu de croiser deux demandes.
  select id into incoming from public.friend_requests
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

create or replace function public.respond_friend_request(request_id uuid, accept boolean)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid; req public.friend_requests%rowtype;
begin
  me := public.current_profile_id();
  select * into req from public.friend_requests where id = request_id;

  if req.id is null then raise exception 'Demande introuvable'; end if;
  -- `send_friend_request` appelle cette fonction pour l'acceptation croisee :
  -- on autorise aussi le demandeur dans ce cas precis.
  if me <> req.to_user and me <> req.from_user then
    raise exception 'Cette demande ne te concerne pas';
  end if;
  if req.status <> 'pending' then return req.status; end if;

  update public.friend_requests
     set status = case when accept then 'accepted' else 'declined' end, responded_at = now()
   where id = request_id;

  if accept then
    insert into public.friendships (user_low, user_high)
    values (least(req.from_user, req.to_user), greatest(req.from_user, req.to_user))
    on conflict do nothing;
  end if;

  return case when accept then 'accepted' else 'declined' end;
end;
$$;

/** Suppression de compte : anonymisation, jamais d'effacement. */
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare me uuid;
begin
  me := public.current_profile_id();
  if me is null then raise exception 'Profil introuvable'; end if;

  perform set_config('hasbni.identity_write', 'on', true);

  update public.profiles
     set name = 'Compte supprime', email = null, phone = null, avatar = '👤',
         deleted_at = now(), user_id = null
   where id = me;

  delete from public.friend_requests where from_user = me or to_user = me;
  delete from public.friendships     where user_low = me or user_high = me;
  delete from public.group_members   where user_id = me;

  perform set_config('hasbni.identity_write', 'off', true);

  delete from auth.users where id = auth.uid();
end;
$$;

create or replace function public.export_my_data()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'profil',         (select to_jsonb(p) from public.profiles p where p.id = public.current_profile_id()),
    'depenses',       (select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) from public.expenses e
                        where e.payer_id = public.current_profile_id()
                           or e.created_by = public.current_profile_id()
                           or public.has_expense_share(e.id, public.current_profile_id())),
    'remboursements', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.settlements s
                        where s.from_user = public.current_profile_id()
                           or s.to_user = public.current_profile_id()),
    'grand_livre',    (select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb) from public.ledger_entries l
                        where l.user_a = public.current_profile_id()
                           or l.user_b = public.current_profile_id()),
    'exporte_le',     to_jsonb(now())
  );
$$;

grant execute on function public.create_expense(uuid, uuid, uuid, integer, text, public.split_type, jsonb, timestamptz) to authenticated;
grant execute on function public.amend_expense(uuid, integer, text, public.split_type, jsonb, uuid) to authenticated;
grant execute on function public.create_group(text, text, uuid[], uuid) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.delete_group(uuid) to authenticated;
grant execute on function public.rename_group(uuid, text, text) to authenticated;
grant execute on function public.group_positions(uuid) to authenticated;
grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.delete_my_account() to authenticated;
grant execute on function public.export_my_data() to authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY — un user ne voit que ses relations / groupes (CDC 5.3)
-- ════════════════════════════════════════════════════════════════════════════

alter table public.profiles       enable row level security;
alter table public.groups         enable row level security;
alter table public.group_members  enable row level security;
alter table public.expenses       enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements    enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.audit_log      enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;

-- Profils ---------------------------------------------------------------------
-- `public.profiles.id` est qualifie : non qualifie, Postgres resolvait `id`
-- dans la portee la plus interne (`friend_requests.id`) et la condition etait
-- toujours fausse.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    public.shares_context(public.current_profile_id(), public.profiles.id)
    or exists (
      select 1 from public.friend_requests r
       where r.status = 'pending'
         and ((r.from_user = public.current_profile_id() and r.to_user = public.profiles.id)
           or (r.to_user = public.current_profile_id() and r.from_user = public.profiles.id))
    )
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (created_by = public.current_profile_id() and user_id is null);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = public.current_profile_id())
  with check (id = public.current_profile_id());

-- Groupes ---------------------------------------------------------------------
drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (
    owner_id = public.current_profile_id()
    or public.is_group_member(id, public.current_profile_id())
  );

drop policy if exists groups_insert on public.groups;
create policy groups_insert on public.groups for insert to authenticated
  with check (owner_id = public.current_profile_id());

drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update to authenticated
  using (owner_id = public.current_profile_id())
  with check (owner_id = public.current_profile_id());

-- `user_id = moi` en premier : en ajoutant le tout premier membre, la ligne
-- n'est pas encore visible pour `is_group_member`.
drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated
  using (owner_id = public.current_profile_id());

drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.is_group_owner(group_id, public.current_profile_id())
    or public.is_group_member(group_id, public.current_profile_id())
  );

drop policy if exists group_members_insert on public.group_members;
create policy group_members_insert on public.group_members for insert to authenticated
  with check (
    public.is_group_owner(group_id, public.current_profile_id())
    or public.is_group_member(group_id, public.current_profile_id())
  );

drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete to authenticated
  using (
    public.is_group_owner(group_id, public.current_profile_id())
    or user_id = public.current_profile_id()
  );

-- Depenses ---------------------------------------------------------------------
-- La lecture repose d'abord sur des colonnes de la ligne elle-meme : une
-- fonction STABLE interrogeant `expenses` est evaluee sur un instantane
-- anterieur a l'insertion, et la relecture d'une ligne fraiche echoue.
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    payer_id = public.current_profile_id()
    or created_by = public.current_profile_id()
    or public.has_expense_share(public.expenses.id, public.current_profile_id())
  );

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (created_by = public.current_profile_id());

-- Seul le payeur controle sa depense : il est le creancier. Autoriser aussi
-- `created_by` laissait un debiteur annuler — ou, via la correction, reecrire
-- a 1 DA — une dette dont il n'etait pas le beneficiaire.
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (payer_id = public.current_profile_id())
  with check (payer_id = public.current_profile_id());

drop policy if exists expense_shares_select on public.expense_shares;
create policy expense_shares_select on public.expense_shares for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.can_see_expense(public.expense_shares.expense_id, public.current_profile_id())
  );

-- La verification de relation est ce qui empeche d'attribuer une part a
-- n'importe quel identifiant de profil connu.
drop policy if exists expense_shares_insert on public.expense_shares;
create policy expense_shares_insert on public.expense_shares for insert to authenticated
  with check (
    exists (
      select 1 from public.expenses e
       where e.id = expense_id
         and e.created_by = public.current_profile_id()
         and public.can_share_with(public.current_profile_id(),
                                   public.expense_shares.user_id, e.group_id)
    )
  );

-- Remboursements ---------------------------------------------------------------
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated
  using (from_user = public.current_profile_id() or to_user = public.current_profile_id());

drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert to authenticated
  with check (
    (from_user = public.current_profile_id() or to_user = public.current_profile_id())
    and status = 'pending'
  );

-- Seul le beneficiaire CONFIRME ; les deux parties peuvent ANNULER.
drop policy if exists settlements_confirm on public.settlements;
create policy settlements_confirm on public.settlements for update to authenticated
  using (from_user = public.current_profile_id() or to_user = public.current_profile_id())
  with check (
    (from_user = public.current_profile_id() or to_user = public.current_profile_id())
    and (
      status <> 'confirmed'                      -- en attente : libre
      or to_user = public.current_profile_id()   -- confirmation : beneficiaire
      or cancelled                               -- annulation : les deux
    )
  );

-- Grand livre : lecture seule cote client, ecriture par triggers uniquement.
drop policy if exists ledger_select on public.ledger_entries;
create policy ledger_select on public.ledger_entries for select to authenticated
  using (user_a = public.current_profile_id() or user_b = public.current_profile_id());

-- Audit : lecture de ses propres actions, aucune ecriture cliente.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (actor_id = public.current_profile_id());

revoke insert, update, delete on public.audit_log from authenticated;

-- Potes -------------------------------------------------------------------------
-- Aucune ecriture directe : tout passe par les deux RPC, qui valident l'email et
-- evitent d'exposer la table des profils a une recherche libre.
drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests for select to authenticated
  using (from_user = public.current_profile_id() or to_user = public.current_profile_id());

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (user_low = public.current_profile_id() or user_high = public.current_profile_id());

-- ════════════════════════════════════════════════════════════════════════════
--  VUE DES SOLDES
--
--  L'accueil telechargeait tout le grand livre pour recalculer chaque solde
--  dans le navigateur. Postgres le fait ici, en une ligne par pote, et le
--  client ne charge plus qu'une fenetre recente de mouvements pour la timeline.
--
--  `security_invoker` : la RLS de `ledger_entries` s'applique normalement.
-- ════════════════════════════════════════════════════════════════════════════

drop view if exists public.relation_balances;
create view public.relation_balances
with (security_invoker = true) as
with mine as (
  select
    case when l.user_a = public.current_profile_id() then l.user_b else l.user_a end as other_id,
    case when l.user_b = public.current_profile_id() then l.amount else -l.amount end as signed_amount,
    l.status, l.created_at, l.ref_id
  from public.ledger_entries l
  where l.user_a = public.current_profile_id() or l.user_b = public.current_profile_id()
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

-- ════════════════════════════════════════════════════════════════════════════
--  REALTIME — soldes a jour en direct (CDC 5.1)
--  `expenses` n'y figure pas : toute depense produit deja des ecritures de
--  grand livre, l'abonnement ferait doublon.
-- ════════════════════════════════════════════════════════════════════════════

do $$ begin
  alter publication supabase_realtime add table public.ledger_entries;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.settlements;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.friend_requests;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null; end $$;
