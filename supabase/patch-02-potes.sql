-- ============================================================================
--  Patch 02 — creation de groupe + demandes de pote
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent : rejouable.
--  Ce fichier remplace le patch 01 : il contient tout, inutile de lancer
--  l'autre.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. CREATION DE GROUPE
--
--  Bug : la politique d'insertion d'un membre verifiait le proprietaire via un
--  `select` sur `groups`, lui-meme soumis a une RLS exigeant d'etre deja
--  membre. Au moment d'ajouter le premier membre, personne ne l'est : toute
--  creation de groupe echouait.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.is_group_owner(gid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.groups g where g.id = gid and g.owner_id = pid);
$$;

drop policy if exists groups_select on public.groups;
create policy groups_select on public.groups for select to authenticated
  using (
    owner_id = public.current_profile_id()
    or public.is_group_member(id, public.current_profile_id())
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

-- ────────────────────────────────────────────────────────────────────────────
--  2. POTES — demande, acceptation, amitie
--
--  On ajoute un pote par son email : il doit deja avoir un compte. Il recoit
--  une demande dans l'app ; l'amitie n'existe qu'apres son acceptation.
-- ────────────────────────────────────────────────────────────────────────────

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

create index if not exists friend_requests_to_idx on public.friend_requests (to_user, status);
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

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.friendships f
     where f.user_low = least(a, b) and f.user_high = greatest(a, b)
  );
$$;

-- Un pote fait partie du contexte visible (profils, soldes).
create or replace function public.shares_context(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a = b
      or public.are_friends(a, b)
      or exists (select 1 from public.group_members m1
                 join public.group_members m2 on m1.group_id = m2.group_id
                 where m1.user_id = a and m2.user_id = b)
      or exists (select 1 from public.ledger_entries l
                 where (l.user_a = a and l.user_b = b) or (l.user_a = b and l.user_b = a));
$$;

-- Le demandeur et le destinataire doivent se voir tant que la demande vit.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    public.shares_context(public.current_profile_id(), id)
    or exists (
      select 1 from public.friend_requests r
       where r.status = 'pending'
         and (
           (r.from_user = public.current_profile_id() and r.to_user = id)
           or (r.to_user = public.current_profile_id() and r.from_user = id)
         )
    )
  );

alter table public.friend_requests enable row level security;
alter table public.friendships     enable row level security;

drop policy if exists friend_requests_select on public.friend_requests;
create policy friend_requests_select on public.friend_requests for select to authenticated
  using (
    from_user = public.current_profile_id() or to_user = public.current_profile_id()
  );

drop policy if exists friendships_select on public.friendships;
create policy friendships_select on public.friendships for select to authenticated
  using (
    user_low = public.current_profile_id() or user_high = public.current_profile_id()
  );

-- Aucune ecriture directe : tout passe par les deux fonctions ci-dessous, qui
-- valident l'email, empechent les doublons et evitent d'exposer la table des
-- profils a une recherche libre.

/**
 * Envoie une demande de pote a partir d'un email.
 * Retourne : 'sent' | 'accepted' (si l'autre m'avait deja invite).
 */
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

  select id into target
    from public.profiles
   where user_id is not null
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

  -- S'il m'a deja invite, on accepte directement au lieu de croiser deux
  -- demandes symetriques.
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

/** Accepte ou refuse une demande recue. */
create or replace function public.respond_friend_request(request_id uuid, accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid;
  req public.friend_requests%rowtype;
begin
  me := public.current_profile_id();
  select * into req from public.friend_requests where id = request_id;

  if req.id is null then
    raise exception 'Demande introuvable';
  end if;

  -- `send_friend_request` appelle cette fonction pour l'acceptation croisee :
  -- on autorise aussi le demandeur dans ce cas precis.
  if me <> req.to_user and me <> req.from_user then
    raise exception 'Cette demande ne te concerne pas';
  end if;

  if req.status <> 'pending' then
    return req.status;
  end if;

  update public.friend_requests
     set status = case when accept then 'accepted' else 'declined' end,
         responded_at = now()
   where id = request_id;

  if accept then
    insert into public.friendships (user_low, user_high)
    values (least(req.from_user, req.to_user), greatest(req.from_user, req.to_user))
    on conflict do nothing;
  end if;

  return case when accept then 'accepted' else 'declined' end;
end;
$$;

grant execute on function public.send_friend_request(text) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;

-- Les demandes doivent arriver en direct chez le destinataire.
do $$
begin
  alter publication supabase_realtime add table public.friend_requests;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.friendships;
exception when duplicate_object then null;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
--  3. Nettoyage : le parcours « profil fantome + lien d'invitation » est
--     abandonne au profit des demandes ci-dessus.
-- ────────────────────────────────────────────────────────────────────────────
drop function if exists public.claim_profile(uuid);

-- Chaque inscription cree simplement son profil.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
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

-- Un email = un compte.
create unique index if not exists profiles_email_unique
  on public.profiles (lower(email))
  where user_id is not null and email is not null;
