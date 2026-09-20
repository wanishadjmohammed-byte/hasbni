-- ============================================================================
--  Patch 08 — qui controle une depense, et suppression d'un groupe
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent : rejouable.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. SEUL LE PAYEUR CONTROLE UNE DEPENSE
--
--  Regle metier : celui qui a avance l'argent est le creancier. Lui seul peut
--  annuler ou corriger. Si Youba paie pour moi, je ne peux pas effacer ma
--  dette ; si je paie pour Youba, je peux revenir sur ma saisie.
--
--  Ce n'etait pas qu'une question de confort : `created_by` avait les memes
--  droits que `payer_id`, sur l'annulation ET sur la correction. Or on peut
--  saisir une depense payee par quelqu'un d'autre. Il suffisait donc
--  d'enregistrer « Youba a paye 5000, je lui dois 2500 », puis de corriger le
--  montant a 1 : sa creance disparaissait, sans qu'il ait rien a dire. La
--  correction etait une porte derobee vers l'effacement de sa propre dette.
--
--  Cas limite assume : si j'ai saisi une depense payee par Youba et que je me
--  suis trompe, c'est desormais a Youba de corriger. C'est le prix a payer
--  pour que personne ne puisse toucher a ce qu'il doit.
-- ────────────────────────────────────────────────────────────────────────────

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (payer_id = public.current_profile_id())
  with check (payer_id = public.current_profile_id());

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

  -- Seul le payeur. Voir l'en-tete de ce patch : autoriser l'auteur revenait a
  -- laisser un debiteur reecrire sa propre dette.
  if me <> exp.payer_id then
    raise exception 'Seul celui qui a paye peut corriger cette depense';
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

-- ────────────────────────────────────────────────────────────────────────────
--  2. SUPPRESSION D'UN GROUPE PAR SON CREATEUR
--
--  Un groupe est un CONTEXTE de saisie, pas une caisse : les dettes qu'il a
--  servi a repartir sont bilaterales et lui survivent. Supprimer le groupe
--  detache donc ses depenses (`group_id` passe a null, cf. la cle etrangere)
--  et retire ses membres — aucun solde ne bouge.
--
--  C'est justement pour ca que la suppression peut etre franche : elle ne
--  detruit aucun mouvement. Si elle touchait aux soldes, il faudrait passer
--  par des ecritures d'ajustement comme partout ailleurs.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.delete_group(p_group_id uuid)
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

  if not public.is_group_owner(p_group_id, me) then
    raise exception 'Seul le createur du groupe peut le supprimer';
  end if;

  -- Les depenses passent en `group_id = null` (on delete set null) et les
  -- membres sont retires (on delete cascade). Le grand livre n'est pas touche.
  delete from public.groups where id = p_group_id;
end;
$$;

grant execute on function public.delete_group(uuid) to authenticated;

drop policy if exists groups_delete on public.groups;
create policy groups_delete on public.groups for delete to authenticated
  using (owner_id = public.current_profile_id());
