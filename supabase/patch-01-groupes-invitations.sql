-- ============================================================================
--  Patch 01 — creation de groupe + invitations par email
--  A executer dans l'editeur SQL Supabase SI `schema.sql` a deja ete lance.
--  (Une nouvelle installation de schema.sql contient deja tout ceci.)
--  Le script est idempotent : on peut le rejouer sans risque.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. Creation de groupe
--
--  Bug : `group_members_insert` verifiait l'appartenance du groupe via un
--  `select` sur `public.groups`, lui-meme soumis a la RLS qui exige d'etre
--  deja membre. Au moment d'ajouter le tout premier membre, personne ne l'est
--  encore : l'insertion etait donc toujours refusee.
--  Correctif : passer par une fonction SECURITY DEFINER, qui ignore la RLS.
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

-- Le proprietaire voit son groupe meme avant d'y avoir ajoute des membres.
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

-- Retirer un membre : reserve au proprietaire (ou soi-meme).
drop policy if exists group_members_delete on public.group_members;
create policy group_members_delete on public.group_members for delete to authenticated
  using (
    public.is_group_owner(group_id, public.current_profile_id())
    or user_id = public.current_profile_id()
  );

-- ────────────────────────────────────────────────────────────────────────────
--  2. Invitations
--
--  Ajouter un pote cree un profil « fantome » (user_id null). Deux facons pour
--  lui de le reclamer, c'est-a-dire de rattacher ce profil a son compte :
--    a. il s'inscrit avec l'email de l'invitation → rattachement automatique ;
--    b. il ouvre le lien d'invitation → appel de `claim_profile(token)`.
--  Dans les deux cas il recupere l'historique deja saisi par son pote.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.profiles
  add column if not exists claim_token uuid not null default gen_random_uuid();

create index if not exists profiles_claim_token_idx on public.profiles (claim_token);
create index if not exists profiles_email_idx on public.profiles (lower(email));

-- (a) Rattachement automatique a l'inscription, par email.
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

  -- Un pote m'a-t-il deja ajoute avec cet email ?
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- (b) Rattachement via le lien d'invitation.
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

    -- On ne fusionne pas deux historiques : refus si le compte a deja servi.
    select exists (
      select 1 from public.ledger_entries where user_a = own_id or user_b = own_id
    ) into busy;

    if busy then
      raise exception 'Ton compte a deja des mouvements : impossible de le fusionner avec cette invitation';
    end if;

    -- Profil vide cree a l'inscription : on le remplace par celui de l'invitation.
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

-- L'invitant doit pouvoir relire le profil fantome qu'il a cree (pour le lien).
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    public.shares_context(public.current_profile_id(), id)
    or created_by = public.current_profile_id()
  );
