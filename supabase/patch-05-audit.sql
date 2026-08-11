-- ============================================================================
--  Patch 05 — corrections issues de l'audit complet des ecritures
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent.
--
--  Audit : tous les chemins d'ecriture de l'app rejoues par de vrais comptes,
--  RLS active. Trois defauts trouves.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. « new row violates row-level security policy for table expenses »
--
--  `expenses_select` appelait `can_see_expense()`, fonction STABLE qui
--  interroge... `expenses`. Des qu'une insertion doit relire sa ligne
--  (RETURNING, ou ON CONFLICT d'un upsert), la fonction est evaluee sur un
--  instantane anterieur a l'insertion : la ligne n'y figure pas, la lecture
--  est refusee, et Postgres signale une violation de politique.
--
--  Correctif : la politique de lecture repose sur des colonnes de la ligne
--  elle-meme (payer_id, created_by), immediatement disponibles. Seul le cas
--  « je suis simple participant » passe encore par une fonction, et celle-ci
--  n'interroge que `expense_shares`.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.has_expense_share(eid uuid, pid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.expense_shares s
     where s.expense_id = eid and s.user_id = pid
  );
$$;

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses for select to authenticated
  using (
    payer_id = public.current_profile_id()
    or created_by = public.current_profile_id()
    or public.has_expense_share(public.expenses.id, public.current_profile_id())
  );

drop policy if exists expense_shares_select on public.expense_shares;
create policy expense_shares_select on public.expense_shares for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.can_see_expense(public.expense_shares.expense_id, public.current_profile_id())
  );

-- ────────────────────────────────────────────────────────────────────────────
--  2. Meme piege sur les membres de groupe
--
--  `group_members_select` ne reposait que sur `is_group_member()`, qui
--  interroge `group_members` : en ajoutant le tout premier membre, la ligne
--  n'est pas encore visible. D'ou le refus a la creation d'un groupe.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members for select to authenticated
  using (
    user_id = public.current_profile_id()
    or public.is_group_owner(group_id, public.current_profile_id())
    or public.is_group_member(group_id, public.current_profile_id())
  );

-- ────────────────────────────────────────────────────────────────────────────
--  3. Impossible d'annuler un remboursement deja confirme
--
--  La politique exigeait `to_user = moi` des lors que la ligne portait le
--  statut « confirme » — y compris quand la modification ne touchait que le
--  drapeau d'annulation. Celui qui a saisi le remboursement ne pouvait donc
--  plus l'annuler.
--
--  Regle voulue : seul le beneficiaire peut CONFIRMER ; les deux parties
--  peuvent ANNULER.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists settlements_confirm on public.settlements;
create policy settlements_confirm on public.settlements for update to authenticated
  using (
    from_user = public.current_profile_id() or to_user = public.current_profile_id()
  )
  with check (
    (from_user = public.current_profile_id() or to_user = public.current_profile_id())
    and (
      status <> 'confirmed'                          -- en attente : libre
      or to_user = public.current_profile_id()       -- confirmation : beneficiaire
      or cancelled                                   -- annulation : les deux
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
--  Nettoyage des comptes de test du diagnostic.
-- ────────────────────────────────────────────────────────────────────────────
delete from auth.users where email like 'hasbni-test-%@example.com';
delete from public.profiles where email like 'hasbni-test-%@example.com';
