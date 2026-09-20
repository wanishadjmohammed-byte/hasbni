-- ============================================================================
--  Patch 03 — le destinataire ne voyait pas le profil du demandeur
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent.
--
--  Bug : dans la politique `profiles_select`, la sous-requete etait ecrite
--
--      exists (select 1 from public.friend_requests r
--               where r.to_user = public.current_profile_id()
--                 and r.from_user = id)          -- ← piege
--
--  `id` n'est pas qualifie. Postgres resout d'abord dans la portee la plus
--  interne : `friend_requests` possede sa propre colonne `id`, donc la
--  condition devenait `r.from_user = r.id` — toujours fausse. Le profil du
--  demandeur restait invisible, et l'app masquait la demande faute de savoir
--  qui l'envoyait.
--
--  Correctif : qualifier explicitement la colonne de la table portant la
--  politique (`public.profiles.id`).
-- ============================================================================

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

-- ────────────────────────────────────────────────────────────────────────────
--  Nettoyage des comptes de test crees pendant le diagnostic.
--  (Sans effet s'il n'y en a pas.)
-- ────────────────────────────────────────────────────────────────────────────
delete from auth.users
 where email like 'hasbni-test-%@example.com';

delete from public.profiles
 where email like 'hasbni-test-%@example.com';
