-- ============================================================================
--  Patch 09 — pseudos et recherche de potes
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent : rejouable.
--
--  Ajouter un pote exigeait son adresse email EXACTE, et qu'il ait deja un
--  compte. Aucun moyen de chercher. On passe a un identifiant public court —
--  un pseudo, comme sur Instagram — et a une recherche par debut de chaine.
--
--  LE CHOIX QUI COMMANDE TOUT LE RESTE : la recherche est par PREFIXE
--  (`like 'abc%'`), jamais par sous-chaine (`like '%abc%'`).
--
--  Un index btree sait servir un prefixe : Postgres descend l'arbre et lit une
--  plage contigue, en temps logarithmique. Une sous-chaine ne peut pas
--  l'utiliser — chaque frappe deviendrait un balayage complet de la table des
--  profils, sur un chemin appele a chaque caractere tape par chaque
--  utilisateur. C'est exactement le genre de requete qui tient tant qu'on est
--  cent et qui met le projet a genoux a dix mille.
--
--  (Une vraie recherche « contient » se fait avec pg_trgm et un index GIN.
--  C'est plus lourd a maintenir et inutile ici : on cherche un pseudo qu'on
--  connait deja, on ne fouille pas un catalogue.)
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. LE PSEUDO
--
--  Toujours en minuscules : un identifiant public sensible a la casse cree des
--  doublons visuels (`Youba` / `youba`) et des usurpations faciles.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z0-9_.]{3,20}$');

-- ────────────────────────────────────────────────────────────────────────────
--  2. ATTRIBUTION D'UN PSEUDO AUX COMPTES EXISTANTS
--
--  Derive de la partie locale de l'email, nettoyee, avec un suffixe numerique
--  en cas de collision. Personne ne se retrouve sans pseudo : sans ca, les
--  comptes anterieurs seraient introuvables par la nouvelle recherche.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.suggest_username(p_seed text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  base      text;
  candidate text;
  n         integer := 0;
begin
  -- On ne garde que ce que le format autorise, et on garantit 3 caracteres.
  base := lower(coalesce(p_seed, ''));
  base := regexp_replace(base, '@.*$', '');
  base := regexp_replace(base, '[^a-z0-9_.]', '', 'g');
  base := left(base, 16);
  if char_length(base) < 3 then
    base := 'pote' || substr(md5(random()::text), 1, 4);
  end if;

  candidate := base;
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    n := n + 1;
    candidate := left(base, 16) || n::text;
  end loop;

  return candidate;
end;
$$;

do $$
declare
  r record;
begin
  perform set_config('hasbni.identity_write', 'on', true);
  for r in select id, email, name from public.profiles where username is null loop
    update public.profiles
       set username = public.suggest_username(coalesce(r.email, r.name))
     where id = r.id;
  end loop;
  perform set_config('hasbni.identity_write', 'off', true);
end $$;

create unique index if not exists profiles_username_unique on public.profiles (username);

-- ────────────────────────────────────────────────────────────────────────────
--  3. LES INDEX QUI RENDENT LA RECHERCHE GRATUITE
--
--  `text_pattern_ops` est indispensable : sans lui, l'index btree utilise la
--  collation de la base et Postgres REFUSE de s'en servir pour un `like`.
--  Avec, `username like 'abc%'` devient un parcours de plage.
-- ────────────────────────────────────────────────────────────────────────────

create index if not exists profiles_username_prefix
  on public.profiles (username text_pattern_ops) where deleted_at is null;

create index if not exists profiles_name_prefix
  on public.profiles (lower(name) text_pattern_ops) where deleted_at is null;

-- ────────────────────────────────────────────────────────────────────────────
--  4. CHOISIR SON PSEUDO
--
--  Passe par une fonction : le client ne peut pas ecrire `username`
--  directement (le declencheur `guard_profile_columns` le fige), ce qui evite
--  d'avoir a faire confiance a la validation cote navigateur pour le format,
--  l'unicite et la cadence.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('hasbni.identity_write', true), '') = 'on' then
    return new;
  end if;
  new.id         := old.id;
  new.user_id    := old.user_id;
  new.email      := old.email;
  new.username   := old.username;   -- passe par `set_username`
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.deleted_at := old.deleted_at;
  return new;
end;
$$;

create or replace function public.set_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me      uuid;
  wanted  text;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  wanted := lower(trim(coalesce(p_username, '')));

  if wanted !~ '^[a-z0-9_.]{3,20}$' then
    raise exception 'Le pseudo doit faire 3 a 20 caracteres : lettres, chiffres, point ou tiret bas';
  end if;

  if exists (select 1 from public.profiles p where p.username = wanted and p.id <> me) then
    raise exception 'Ce pseudo est deja pris';
  end if;

  perform set_config('hasbni.identity_write', 'on', true);
  update public.profiles set username = wanted where id = me;
  perform set_config('hasbni.identity_write', 'off', true);

  return wanted;
end;
$$;

-- Chaque nouvelle inscription repart avec un pseudo.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, name, phone, email, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'Pote'), '@', 1)),
    new.phone,
    new.email,
    public.suggest_username(
      coalesce(new.raw_user_meta_data ->> 'username', new.email, 'pote')
    )
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
--  5. LA RECHERCHE
--
--  Trois garde-fous, tous necessaires :
--
--   - TROIS CARACTERES MINIMUM. En dessous, le prefixe ne discrimine rien et
--     la requete ramene une part enorme de la table : autant balayer.
--   - DIX RESULTATS. Une borne dure, pas une pagination : on cherche
--     quelqu'un qu'on connait, pas une liste a parcourir.
--   - NI EMAIL NI TELEPHONE dans la reponse. La recherche est ouverte a tous,
--     elle ne doit donc jamais devenir un annuaire de coordonnees.
--
--  `relation` evite un aller-retour supplementaire : l'interface sait
--  immediatement s'il faut proposer « Ajouter », « Demande envoyee » ou
--  « Deja pote ».
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.search_profiles(p_query text)
returns table (
  profile_id uuid,
  username   text,
  name       text,
  avatar     text,
  color      text,
  relation   text
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as needle,
           public.current_profile_id() as me
  )
  select
    p.id,
    p.username,
    p.name,
    p.avatar,
    p.color,
    case
      when public.are_friends(q.me, p.id) then 'friend'
      when exists (select 1 from public.friend_requests r
                    where r.status = 'pending'
                      and r.from_user = q.me and r.to_user = p.id) then 'sent'
      when exists (select 1 from public.friend_requests r
                    where r.status = 'pending'
                      and r.to_user = q.me and r.from_user = p.id) then 'received'
      else 'none'
    end
  from public.profiles p, q
  where char_length(q.needle) >= 3
    and p.deleted_at is null
    and p.user_id is not null           -- un compte reel, pas une coquille
    and p.id <> q.me
    -- Prefixe des deux cotes : les deux branches sont indexees.
    and (p.username like q.needle || '%' or lower(p.name) like q.needle || '%')
  order by
    -- Le pseudo exact d'abord, puis le pseudo qui commence par, puis le nom.
    (p.username = q.needle) desc,
    (p.username like q.needle || '%') desc,
    p.username
  limit 10;
$$;

grant execute on function public.search_profiles(text) to authenticated;
grant execute on function public.set_username(text) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  6. DEMANDE DE POTE PAR IDENTIFIANT
--
--  La recherche renvoie deja des identifiants de profil : inutile de repasser
--  par l'email. Les memes verifications s'appliquent — quota horaire, pas
--  soi-meme, pas un compte supprime, acceptation croisee si la demande
--  inverse existe deja.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.send_friend_request_to(p_profile_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me       uuid;
  incoming uuid;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  perform public.assert_quota('friend_request', 30);

  if p_profile_id = me then
    raise exception 'C''est toi';
  end if;

  if not exists (
    select 1 from public.profiles p
     where p.id = p_profile_id and p.deleted_at is null and p.user_id is not null
  ) then
    raise exception 'Ce compte n''existe plus';
  end if;

  if public.are_friends(me, p_profile_id) then
    raise exception 'Vous etes deja potes';
  end if;

  -- S'il m'a deja invite, on accepte au lieu de croiser deux demandes.
  select id into incoming
    from public.friend_requests
   where from_user = p_profile_id and to_user = me and status = 'pending';

  if incoming is not null then
    perform public.respond_friend_request(incoming, true);
    return 'accepted';
  end if;

  insert into public.friend_requests (from_user, to_user, status)
  values (me, p_profile_id, 'pending')
  on conflict (from_user, to_user) do update
    set status = 'pending', created_at = now(), responded_at = null
    where public.friend_requests.status <> 'pending';

  return 'sent';
end;
$$;

grant execute on function public.send_friend_request_to(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  7. Le pseudo fait partie du contexte visible d'un profil.
--     (La politique `profiles_select` est inchangee : la recherche passe par
--      une fonction SECURITY DEFINER qui ne divulgue que quatre colonnes.)
-- ────────────────────────────────────────────────────────────────────────────
