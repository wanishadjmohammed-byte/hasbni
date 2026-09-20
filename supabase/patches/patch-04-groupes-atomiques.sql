-- ============================================================================
--  Patch 04 — creation de groupe atomique
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent.
--
--  Symptome : « new row violates row-level security policy for table
--  group_members » a la creation d'un groupe.
--
--  Cause : le client faisait deux requetes separees — d'abord `groups`, puis
--  `group_members`. La politique d'insertion des membres exige que l'appelant
--  soit deja proprietaire ou membre. Si la premiere requete n'a pas abouti
--  (rejeu d'une operation en file, groupe cree sous un autre compte, coupure
--  reseau entre les deux), la seconde arrive sans que le groupe existe au nom
--  de l'appelant : refus.
--
--  Correctif : une seule fonction SECURITY DEFINER cree le groupe ET ses
--  membres dans la meme transaction. Plus d'etat intermediaire possible.
-- ============================================================================

/**
 * Cree un groupe et y place l'appelant plus les membres fournis.
 * `p_group_id` permet au client de fournir son identifiant : le rejeu d'une
 * operation restee en file ne cree pas de doublon.
 */
create or replace function public.create_group(
  p_name       text,
  p_emoji      text,
  p_member_ids uuid[] default '{}',
  p_group_id   uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me  uuid;
  gid uuid;
begin
  me := public.current_profile_id();
  if me is null then
    raise exception 'Profil introuvable';
  end if;

  gid := coalesce(p_group_id, gen_random_uuid());

  insert into public.groups (id, name, emoji, owner_id)
  values (gid, coalesce(nullif(trim(p_name), ''), 'Nouveau groupe'), coalesce(p_emoji, '👥'), me)
  on conflict (id) do nothing;

  -- Le groupe existe-t-il bien sous mon nom ? (protege contre un identifiant
  -- deja utilise par quelqu'un d'autre)
  if not exists (select 1 from public.groups g where g.id = gid and g.owner_id = me) then
    raise exception 'Ce groupe appartient a quelqu''un d''autre';
  end if;

  insert into public.group_members (group_id, user_id)
  select gid, m
    from unnest(array_append(coalesce(p_member_ids, '{}'), me)) as m
   where m is not null
  on conflict do nothing;

  return gid;
end;
$$;

/** Ajoute un membre : reserve aux membres du groupe (pas seulement au chef). */
create or replace function public.add_group_member(p_group_id uuid, p_user_id uuid)
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

  if not public.is_group_member(p_group_id, me)
     and not public.is_group_owner(p_group_id, me) then
    raise exception 'Tu ne fais pas partie de ce groupe';
  end if;

  insert into public.group_members (group_id, user_id)
  values (p_group_id, p_user_id)
  on conflict do nothing;
end;
$$;

grant execute on function public.create_group(text, text, uuid[], uuid) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  Nettoyage des comptes de test du diagnostic (sans effet s'il n'y en a pas).
-- ────────────────────────────────────────────────────────────────────────────
delete from auth.users where email like 'hasbni-test-%@example.com';
delete from public.profiles where email like 'hasbni-test-%@example.com';
