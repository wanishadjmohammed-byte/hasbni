-- ============================================================================
--  Hasbni — schema Postgres / Supabase
--  A executer dans l'editeur SQL du projet Supabase (une seule fois).
--  Modele : CDC 5.2. Securite : CDC 5.3 (RLS, confirmation bilaterale, audit).
-- ============================================================================

create extension if not exists "pgcrypto";

-- ────────────────────────────────────────────────────────────────────────────
--  Profils
--  Un profil peut etre rattache a un compte auth (`user_id`) ou etre un
--  « pote fantome » cree par quelqu'un d'autre en attendant qu'il s'inscrive.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users (id) on delete set null,
  name        text not null,
  phone       text,
  email       text,
  avatar      text default '🙂',
  color       text default '#22A06B',
  created_by  uuid references public.profiles (id) on delete set null,
  claim_token uuid not null default gen_random_uuid(),
  created_at  timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on public.profiles (user_id);
create index if not exists profiles_created_by_idx on public.profiles (created_by);
create index if not exists profiles_claim_token_idx on public.profiles (claim_token);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ────────────────────────────────────────────────────────────────────────────
--  Groupes
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.groups (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  emoji      text not null default '👥',
  owner_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id  uuid not null references public.profiles (id) on delete cascade,
  primary key (group_id, user_id)
);

create index if not exists group_members_user_idx on public.group_members (user_id);

-- ────────────────────────────────────────────────────────────────────────────
--  Depenses et parts
-- ────────────────────────────────────────────────────────────────────────────
create type public.split_type as enum ('equal', 'custom', 'items');
create type public.movement_status as enum ('pending', 'confirmed');

create table if not exists public.expenses (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid references public.groups (id) on delete set null,
  payer_id   uuid not null references public.profiles (id) on delete cascade,
  amount     integer not null check (amount > 0),          -- DA, arrondi a l'unite
  motive     text not null default 'Depense',
  split_type public.split_type not null default 'equal',
  status     public.movement_status not null default 'confirmed',
  cancelled  boolean not null default false,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists expenses_payer_idx on public.expenses (payer_id);
create index if not exists expenses_group_idx on public.expenses (group_id);

create table if not exists public.expense_shares (
  expense_id   uuid not null references public.expenses (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  share_amount integer not null check (share_amount >= 0),
  primary key (expense_id, user_id)
);

create index if not exists expense_shares_user_idx on public.expense_shares (user_id);

-- ────────────────────────────────────────────────────────────────────────────
--  Remboursements — confirmation bilaterale obligatoire
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.settlements (
  id           uuid primary key default gen_random_uuid(),
  from_user    uuid not null references public.profiles (id) on delete cascade,
  to_user      uuid not null references public.profiles (id) on delete cascade,
  amount       integer not null check (amount > 0),
  note         text,
  method       text not null default 'cash' check (method in ('cash', 'transfer')),
  status       public.movement_status not null default 'pending',
  cancelled    boolean not null default false,
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint settlements_distinct_parties check (from_user <> to_user)
);

create index if not exists settlements_from_idx on public.settlements (from_user);
create index if not exists settlements_to_idx on public.settlements (to_user);

-- ────────────────────────────────────────────────────────────────────────────
--  Grand livre — source de verite du solde, alimente uniquement par triggers.
--  `user_a` doit `amount` a `user_b`.
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.ledger_entries (
  id         uuid primary key default gen_random_uuid(),
  user_a     uuid not null references public.profiles (id) on delete cascade,
  user_b     uuid not null references public.profiles (id) on delete cascade,
  amount     integer not null,
  ref_type   text not null check (ref_type in ('expense', 'settlement', 'adjustment')),
  ref_id     uuid not null,
  status     public.movement_status not null default 'confirmed',
  label      text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists ledger_pair_idx on public.ledger_entries (user_a, user_b);
create index if not exists ledger_ref_idx on public.ledger_entries (ref_type, ref_id);

-- ────────────────────────────────────────────────────────────────────────────
--  Journal d'audit immuable (append-only)
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists public.audit_log (
  id         bigserial primary key,
  actor_id   uuid,
  table_name text not null,
  action     text not null,
  row_id     uuid,
  payload    jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
--  Fonctions utilitaires (SECURITY DEFINER : contournent la RLS pour eviter
--  les recursions de politiques).
-- ============================================================================

create or replace function public.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.profiles where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_group_member(gid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members m where m.group_id = gid and m.user_id = pid
  );
$$;

create or replace function public.is_group_owner(gid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.groups g where g.id = gid and g.owner_id = pid);
$$;

-- Deux profils sont « lies » s'ils partagent un groupe, une depense, un
-- remboursement, ou si l'un a cree l'autre.
create or replace function public.shares_context(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a = b
      or exists (select 1 from public.profiles p
                 where (p.id = b and p.created_by = a) or (p.id = a and p.created_by = b))
      or exists (select 1 from public.group_members m1
                 join public.group_members m2 on m1.group_id = m2.group_id
                 where m1.user_id = a and m2.user_id = b)
      or exists (select 1 from public.ledger_entries l
                 where (l.user_a = a and l.user_b = b) or (l.user_a = b and l.user_b = a));
$$;

create or replace function public.can_see_expense(eid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.expenses e
    where e.id = eid
      and (
        e.payer_id = pid
        or e.created_by = pid
        or exists (select 1 from public.expense_shares s
                   where s.expense_id = e.id and s.user_id = pid)
      )
  );
$$;

-- ============================================================================
--  Triggers metier
-- ============================================================================

-- Creation du profil a l'inscription. Si un pote a deja ajoute cet email,
-- on rattache le profil « fantome » existant au lieu d'en creer un nouveau :
-- le nouvel inscrit recupere ainsi tout l'historique deja saisi.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ghost_id uuid;
  fallback_name text;
begin
  fallback_name := coalesce(
    new.raw_user_meta_data ->> 'name',
    split_part(coalesce(new.email, 'Pote'), '@', 1)
  );

  select id into ghost_id
    from public.profiles
   where user_id is null
     and email is not null
     and new.email is not null
     and lower(email) = lower(new.email)
   order by created_at
   limit 1;

  if ghost_id is not null then
    update public.profiles
       set user_id = new.id,
           name    = coalesce(nullif(fallback_name, ''), name),
           phone   = coalesce(phone, new.phone)
     where id = ghost_id;
  else
    insert into public.profiles (user_id, name, phone, email)
    values (new.id, fallback_name, new.phone, new.email)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- Acceptation d'une invitation via son lien : l'appelant reclame le profil
-- fantome correspondant au jeton.
create or replace function public.claim_profile(token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_id uuid;
  own_id    uuid;
  busy      boolean;
begin
  if auth.uid() is null then
    raise exception 'Connecte-toi pour accepter une invitation';
  end if;

  select id into target_id
    from public.profiles
   where claim_token = token and user_id is null;

  if target_id is null then
    raise exception 'Invitation invalide ou deja utilisee';
  end if;

  select id into own_id from public.profiles where user_id = auth.uid();

  if own_id is not null then
    if own_id = target_id then
      return own_id;
    end if;

    select exists (
      select 1 from public.ledger_entries where user_a = own_id or user_b = own_id
    ) into busy;

    if busy then
      raise exception 'Ton compte a deja des mouvements : impossible de le fusionner avec cette invitation';
    end if;

    delete from public.profiles where id = own_id;
  end if;

  update public.profiles
     set user_id = auth.uid(),
         email   = coalesce(email, (select email from auth.users where id = auth.uid()))
   where id = target_id;

  return target_id;
end;
$$;

grant execute on function public.claim_profile(uuid) to authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Une part de depense genere une dette du participant vers le payeur.
create or replace function public.ledger_from_share()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- Confirmation / annulation d'un remboursement.
create or replace function public.settlement_status_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- ============================================================================
--  Row Level Security — un user ne voit que ses relations / groupes (CDC 5.3)
-- ============================================================================

alter table public.profiles           enable row level security;
alter table public.groups             enable row level security;
alter table public.group_members      enable row level security;
alter table public.expenses           enable row level security;
alter table public.expense_shares     enable row level security;
alter table public.settlements        enable row level security;
alter table public.ledger_entries     enable row level security;
alter table public.audit_log          enable row level security;

-- Profils ------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    public.shares_context(public.current_profile_id(), public.profiles.id)
    or exists (
      select 1
        from public.friend_requests r
       where r.status = 'pending'
         and (
           (r.from_user = public.current_profile_id() and r.to_user = public.profiles.id)
           or (r.to_user = public.current_profile_id() and r.from_user = public.profiles.id)
         )
    )
  );

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles for insert to authenticated
  with check (created_by = public.current_profile_id() and user_id is null);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = public.current_profile_id() or created_by = public.current_profile_id())
  with check (id = public.current_profile_id() or created_by = public.current_profile_id());

-- Groupes ------------------------------------------------------------------
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

drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select to authenticated
  using (public.is_group_member(group_id, public.current_profile_id()));

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

-- Depenses -----------------------------------------------------------------
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (public.can_see_expense(id, public.current_profile_id()));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses for insert to authenticated
  with check (created_by = public.current_profile_id());

-- Seul le createur peut annuler ; le montant reste immuable.
drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (created_by = public.current_profile_id() or payer_id = public.current_profile_id())
  with check (created_by = public.current_profile_id() or payer_id = public.current_profile_id());

drop policy if exists expense_shares_select on public.expense_shares;
create policy expense_shares_select on public.expense_shares for select to authenticated
  using (public.can_see_expense(expense_id, public.current_profile_id()));

drop policy if exists expense_shares_insert on public.expense_shares;
create policy expense_shares_insert on public.expense_shares for insert to authenticated
  with check (
    exists (select 1 from public.expenses e
            where e.id = expense_id and e.created_by = public.current_profile_id())
  );

-- Remboursements -----------------------------------------------------------
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements for select to authenticated
  using (from_user = public.current_profile_id() or to_user = public.current_profile_id());

drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements for insert to authenticated
  with check (
    (from_user = public.current_profile_id() or to_user = public.current_profile_id())
    and status = 'pending'
  );

-- Seul le beneficiaire confirme la reception (anti-litige, CDC 5.3).
drop policy if exists settlements_confirm on public.settlements;
create policy settlements_confirm on public.settlements for update to authenticated
  using (from_user = public.current_profile_id() or to_user = public.current_profile_id())
  with check (
    case
      when status = 'confirmed' then to_user = public.current_profile_id()
      else from_user = public.current_profile_id() or to_user = public.current_profile_id()
    end
  );

-- Grand livre : lecture seule cote client, ecriture par triggers uniquement.
drop policy if exists ledger_select on public.ledger_entries;
create policy ledger_select on public.ledger_entries for select to authenticated
  using (user_a = public.current_profile_id() or user_b = public.current_profile_id());

-- Audit : lecture de ses propres actions, aucune ecriture cliente.
drop policy if exists audit_select on public.audit_log;
create policy audit_select on public.audit_log for select to authenticated
  using (actor_id = public.current_profile_id());

-- ============================================================================
--  Realtime — soldes a jour en direct (CDC 5.1)
-- ============================================================================
alter publication supabase_realtime add table public.ledger_entries;
alter publication supabase_realtime add table public.settlements;
alter publication supabase_realtime add table public.expenses;
