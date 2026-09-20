-- ============================================================================
--  Patch 10 — le pseudo est choisi a l'inscription
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent : rejouable.
--
--  Jusqu'ici le pseudo etait attribue d'office puis modifiable dans le profil.
--  Il devient un champ de l'inscription, verifie au moment de la frappe.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. DISPONIBILITE D'UN PSEUDO
--
--  Appelee a la frappe, donc concue pour etre la requete la moins chere
--  possible : un `exists` sur l'index unique, qui s'arrete a la premiere
--  ligne. Pas de `count`, pas de `select *`, aucune ligne rapatriee — juste un
--  booleen.
--
--  Accessible a `anon` : au moment de l'inscription, personne n'est encore
--  connecte. Cela revele qu'un pseudo est pris — mais un pseudo est un
--  identifiant PUBLIC, c'est precisement sa raison d'etre. Aucune donnee
--  personnelle ne transite : ni nom, ni email, ni identifiant de profil.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when lower(trim(coalesce(p_username, ''))) !~ '^[a-z0-9_.]{3,20}$' then false
      else not exists (
        select 1 from public.profiles p
         where p.username = lower(trim(p_username))
      )
    end;
$$;

grant execute on function public.username_available(text) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
--  2. L'INSCRIPTION POSE LE PSEUDO CHOISI
--
--  Le pseudo demande est repris TEL QUEL s'il est valide et libre. Il n'est
--  remplace que dans deux cas : format invalide, ou pseudo devenu indisponible
--  entre la verification a la frappe et la validation du formulaire. Sans ce
--  repli, cette course perdue ferait echouer toute l'inscription — un compte
--  refuse pour un pseudo pris a la seconde pres serait une mauvaise premiere
--  impression.
--
--  `suggest_username` tronque a 16 caracteres pour pouvoir suffixer un
--  numero ; on ne l'utilise donc QUE pour ce repli, jamais sur un pseudo
--  valide que l'utilisateur a choisi lui-meme.
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text;
begin
  wanted := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if wanted !~ '^[a-z0-9_.]{3,20}$'
     or exists (select 1 from public.profiles p where p.username = wanted) then
    wanted := public.suggest_username(
      coalesce(nullif(wanted, ''), new.email, 'pote')
    );
  end if;

  insert into public.profiles (user_id, name, phone, email, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, 'Pote'), '@', 1)),
    new.phone,
    new.email,
    wanted
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
--  3. Filet de securite : plus aucun profil sans pseudo.
--
--  L'unicite etait deja garantie par l'index ; ce qui manquait, c'est
--  l'obligation d'en avoir un. Un compte sans pseudo est introuvable par la
--  recherche, donc invisible pour ses potes.
-- ────────────────────────────────────────────────────────────────────────────

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

-- ────────────────────────────────────────────────────────────────────────────
--  Rechargement du cache de schema de PostgREST.
--
--  PostgREST garde en memoire la liste des fonctions exposees. Une fonction
--  fraichement creee reste invisible pour l'API tant qu'il ne l'a pas relue —
--  l'app recoit alors « Could not find the function public.… » alors que la
--  fonction existe bel et bien en base. Cette ligne le force a relire.
-- ────────────────────────────────────────────────────────────────────────────

notify pgrst, 'reload schema';
