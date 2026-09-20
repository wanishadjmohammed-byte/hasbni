-- ============================================================================
--  Patch 07 — socle de l'administration
--  A EXECUTER dans l'editeur SQL Supabase (Run). Idempotent : rejouable.
--
--  Trois principes, appliques partout dans ce fichier :
--
--  1. AUCUNE de ces tables n'est accessible au client. Elles ont la RLS
--     activee et AUCUNE politique : sous Postgres, cela veut dire « refus par
--     defaut ». Seule la cle `service_role`, detenue par le serveur de la
--     console, les traverse.
--
--  2. AUCUNE de ces fonctions n'est executable par un utilisateur connecte.
--     Postgres accorde EXECUTE a PUBLIC par defaut : sans le `revoke`
--     ci-dessous, une fonction `security definer` de reporting serait un
--     aspirateur a donnees ouvert a n'importe quel compte.
--
--  3. Le statut d'administrateur vit dans SA PROPRE table. Surtout pas une
--     colonne de `profiles` : le declencheur `guard_profile_columns` du patch
--     06 ne fige qu'une liste nommee de colonnes, et `profiles_update` laisse
--     chacun ecrire sa propre ligne. Un `is_admin` sur `profiles` serait donc
--     auto-attribuable par n'importe qui.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
--  1. QUI EST ADMINISTRATEUR
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'viewer' check (role in ('viewer', 'support', 'owner')),
  note       text,
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
-- Pas de politique : refus par defaut pour `authenticated` et `anon`.

-- ────────────────────────────────────────────────────────────────────────────
--  2. JOURNAL DES CONSULTATIONS
--
--  La console montre qui doit quoi, a qui, entre personnes reelles. Savoir qui
--  a regarde quoi n'est pas une option : c'est la premiere chose construite,
--  avant le premier ecran. Rattraper ce journal apres coup, c'est ne jamais
--  savoir ce qui a ete consulte avant.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.admin_audit_log (
  id         bigserial primary key,
  admin_id   uuid not null,
  action     text not null,         -- 'reveal', 'freeze', 'void', 'view_user'…
  subject_id uuid,                  -- le profil concerne, si applicable
  reason     text,
  payload    jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_admin_idx   on public.admin_audit_log (admin_id, created_at desc);
create index if not exists admin_audit_subject_idx on public.admin_audit_log (subject_id, created_at desc);

alter table public.admin_audit_log enable row level security;

-- ────────────────────────────────────────────────────────────────────────────
--  3. FLUX D'EVENEMENTS
--
--  L'app ne mesurait rien. Deux regles tenues dans tout le code :
--   - jamais de montant dans un evenement, seulement une TRANCHE ;
--   - un evenement porte le nom de ce que la personne a fait, pas du composant.
--
--  L'ecriture passe par une route serveur : le client ne peut donc ni forger
--  d'evenements pour un autre profil, ni relire le flux.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.analytics_events (
  id          bigserial primary key,
  profile_id  uuid,
  session_id  uuid,
  event       text not null,
  props       jsonb not null default '{}'::jsonb,
  app_version text,
  platform    text,
  created_at  timestamptz not null default now(),
  constraint analytics_event_name_length check (char_length(event) <= 60)
);

create index if not exists analytics_event_idx   on public.analytics_events (event, created_at desc);
create index if not exists analytics_profile_idx on public.analytics_events (profile_id, created_at desc);
create index if not exists analytics_created_idx on public.analytics_events (created_at desc);

alter table public.analytics_events enable row level security;

-- Agregat journalier — la console ne balaye pas le flux brut.
create table if not exists public.daily_metrics (
  day                   date primary key,
  signups               integer not null default 0,
  active_profiles       integer not null default 0,
  expenses_created      integer not null default 0,
  settlements_confirmed integer not null default 0,
  volume_da             bigint  not null default 0,
  computed_at           timestamptz not null default now()
);

alter table public.daily_metrics enable row level security;

/** Recalcule un jour. Idempotent : rejouable autant de fois qu'on veut. */
create or replace function public.admin_rollup_day(p_day date)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.daily_metrics
    (day, signups, active_profiles, expenses_created, settlements_confirmed, volume_da, computed_at)
  select
    p_day,
    (select count(*) from public.profiles p
      where p.created_at >= p_day and p.created_at < p_day + 1),
    (select count(distinct e.profile_id) from public.analytics_events e
      where e.created_at >= p_day and e.created_at < p_day + 1 and e.profile_id is not null),
    (select count(*) from public.expenses x
      where x.created_at >= p_day and x.created_at < p_day + 1 and not x.cancelled),
    (select count(*) from public.settlements s
      where s.confirmed_at >= p_day and s.confirmed_at < p_day + 1 and not s.cancelled),
    (select coalesce(sum(x.amount), 0) from public.expenses x
      where x.created_at >= p_day and x.created_at < p_day + 1 and not x.cancelled),
    now()
  on conflict (day) do update set
    signups = excluded.signups,
    active_profiles = excluded.active_profiles,
    expenses_created = excluded.expenses_created,
    settlements_confirmed = excluded.settlements_confirmed,
    volume_da = excluded.volume_da,
    computed_at = excluded.computed_at;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  4. REQUETES DE LA CONSOLE
--  Toutes `security definer`, toutes retirees a PUBLIC en fin de fichier.
-- ════════════════════════════════════════════════════════════════════════════

/** Chiffres de tete + comparaison a la periode precedente. */
create or replace function public.admin_pulse()
returns table (
  dau bigint, wau bigint, mau bigint,
  signups_7d bigint, signups_prev_7d bigint,
  expenses_7d bigint, expenses_prev_7d bigint,
  settlements_7d bigint, settlements_prev_7d bigint,
  volume_7d bigint, volume_prev_7d bigint,
  total_profiles bigint, total_open_balance bigint
)
language sql stable security definer set search_path = public as $$
  select
    (select count(distinct profile_id) from public.analytics_events
      where created_at > now() - interval '1 day'),
    (select count(distinct profile_id) from public.analytics_events
      where created_at > now() - interval '7 days'),
    (select count(distinct profile_id) from public.analytics_events
      where created_at > now() - interval '30 days'),
    (select count(*) from public.profiles where created_at > now() - interval '7 days'),
    (select count(*) from public.profiles
      where created_at > now() - interval '14 days' and created_at <= now() - interval '7 days'),
    (select count(*) from public.expenses
      where created_at > now() - interval '7 days' and not cancelled),
    (select count(*) from public.expenses
      where created_at > now() - interval '14 days' and created_at <= now() - interval '7 days'
        and not cancelled),
    (select count(*) from public.settlements
      where confirmed_at > now() - interval '7 days' and not cancelled),
    (select count(*) from public.settlements
      where confirmed_at > now() - interval '14 days' and confirmed_at <= now() - interval '7 days'
        and not cancelled),
    (select coalesce(sum(amount), 0) from public.expenses
      where created_at > now() - interval '7 days' and not cancelled),
    (select coalesce(sum(amount), 0) from public.expenses
      where created_at > now() - interval '14 days' and created_at <= now() - interval '7 days'
        and not cancelled),
    (select count(*) from public.profiles where deleted_at is null),
    -- Encours : somme des positions positives du grand livre confirme.
    (select coalesce(sum(amount), 0) from public.ledger_entries where status = 'confirmed');
$$;

/** Serie journaliere pour les sparklines. */
create or replace function public.admin_timeseries(p_days integer default 30)
returns table (day date, signups bigint, expenses bigint, settlements bigint, active bigint, volume bigint)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(current_date - (p_days - 1), current_date, '1 day')::date as day
  )
  select
    d.day,
    (select count(*) from public.profiles p
      where p.created_at >= d.day and p.created_at < d.day + 1),
    (select count(*) from public.expenses x
      where x.created_at >= d.day and x.created_at < d.day + 1 and not x.cancelled),
    (select count(*) from public.settlements s
      where s.confirmed_at >= d.day and s.confirmed_at < d.day + 1 and not s.cancelled),
    (select count(distinct e.profile_id) from public.analytics_events e
      where e.created_at >= d.day and e.created_at < d.day + 1 and e.profile_id is not null),
    (select coalesce(sum(x.amount), 0) from public.expenses x
      where x.created_at >= d.day and x.created_at < d.day + 1 and not x.cancelled)
  from days d
  order by d.day;
$$;

/**
 * Entonnoir d'activation.
 *
 * Volontairement calcule sur l'ETAT REEL (amitie acceptee, depense creee) et
 * non sur des evenements : il repond donc des aujourd'hui, avant que le flux
 * d'evenements ait accumule de l'historique.
 */
create or replace function public.admin_activation(p_days integer default 30)
returns table (step text, rank integer, reached bigint, median_hours numeric)
language sql stable security definer set search_path = public as $$
  with cohort as (
    select p.id, p.created_at
      from public.profiles p
     where p.created_at > now() - (p_days || ' days')::interval
       and p.deleted_at is null
  ),
  first_friend as (
    select c.id, min(f.created_at) as at
      from cohort c
      join public.friendships f on f.user_low = c.id or f.user_high = c.id
     group by c.id
  ),
  first_expense as (
    select c.id, min(x.created_at) as at
      from cohort c
      join public.expenses x on x.created_by = c.id
     group by c.id
  ),
  second_expense as (
    select c.id
      from cohort c
      join public.expenses x on x.created_by = c.id
     group by c.id having count(*) >= 2
  ),
  first_settlement as (
    select c.id, min(s.created_at) as at
      from cohort c
      join public.settlements s on s.from_user = c.id or s.to_user = c.id
     group by c.id
  )
  select 'Inscription'::text, 1, (select count(*) from cohort), null::numeric
  union all
  select 'Premier pote accepte', 2, (select count(*) from first_friend),
         (select percentile_cont(0.5) within group (
            order by extract(epoch from (ff.at - c.created_at)) / 3600)
            from first_friend ff join cohort c on c.id = ff.id)
  union all
  select 'Premiere depense', 3, (select count(*) from first_expense),
         (select percentile_cont(0.5) within group (
            order by extract(epoch from (fe.at - c.created_at)) / 3600)
            from first_expense fe join cohort c on c.id = fe.id)
  union all
  select 'Deuxieme depense', 4, (select count(*) from second_expense), null::numeric
  union all
  select 'Premier remboursement', 5, (select count(*) from first_settlement),
         (select percentile_cont(0.5) within group (
            order by extract(epoch from (fs.at - c.created_at)) / 3600)
            from first_settlement fs join cohort c on c.id = fs.id)
  order by 2;
$$;

/**
 * Retention par cohorte d'inscription.
 * L'activite est mesuree sur les mouvements crees, pas sur les evenements :
 * meme raison que ci-dessus.
 */
create or replace function public.admin_retention(p_weeks integer default 8)
returns table (cohort_week date, cohort_size bigint, week_offset integer, retained bigint)
language sql stable security definer set search_path = public as $$
  with cohort as (
    select p.id, date_trunc('week', p.created_at)::date as cohort_week
      from public.profiles p
     where p.created_at > now() - ((p_weeks * 7) || ' days')::interval
       and p.deleted_at is null
  ),
  sizes as (select cohort_week, count(*) as n from cohort group by cohort_week),
  acts as (
    select c.id, c.cohort_week, date_trunc('week', a.at)::date as active_week
      from cohort c
      join (
        select created_by as id, created_at as at from public.expenses where not cancelled
        union all
        select from_user, created_at from public.settlements where not cancelled
        union all
        select to_user, created_at from public.settlements where not cancelled
      ) a on a.id = c.id
  )
  select s.cohort_week, s.n,
         ((act.active_week - s.cohort_week) / 7)::integer,
         count(distinct act.id)
    from sizes s
    join acts act on act.cohort_week = s.cohort_week
   where act.active_week >= s.cohort_week
   group by s.cohort_week, s.n, ((act.active_week - s.cohort_week) / 7)
   order by s.cohort_week desc, 3;
$$;

/**
 * Liste des utilisateurs.
 * Ne renvoie NI nom NI email : la console affiche des pseudonymes, et la levee
 * d'anonymat est une action separee, motivee et journalisee.
 */
create or replace function public.admin_users_list(
  p_limit integer default 100, p_offset integer default 0, p_filter text default 'all'
)
returns table (
  profile_id uuid, created_at timestamptz, last_seen timestamptz,
  friends bigint, groups bigint, expenses bigint, settlements_confirmed bigint,
  pending_old bigint, net_position bigint, is_deleted boolean
)
language sql stable security definer set search_path = public as $$
  with base as (
    select
      p.id,
      p.created_at,
      p.deleted_at,
      (select max(e.created_at) from public.analytics_events e where e.profile_id = p.id) as last_seen,
      (select count(*) from public.friendships f
        where f.user_low = p.id or f.user_high = p.id) as friends,
      (select count(*) from public.group_members m where m.user_id = p.id) as groups,
      (select count(*) from public.expenses x
        where x.created_by = p.id and not x.cancelled) as expenses,
      (select count(*) from public.settlements s
        where (s.from_user = p.id or s.to_user = p.id)
          and s.status = 'confirmed' and not s.cancelled) as settlements_confirmed,
      (select count(*) from public.settlements s
        where s.to_user = p.id and s.status = 'pending' and not s.cancelled
          and s.created_at < now() - interval '7 days') as pending_old,
      (select coalesce(sum(case when l.user_b = p.id then l.amount else -l.amount end), 0)
         from public.ledger_entries l
        where (l.user_a = p.id or l.user_b = p.id) and l.status = 'confirmed') as net_position
    from public.profiles p
  )
  select id, created_at, last_seen, friends, groups, expenses,
         settlements_confirmed, pending_old, net_position, deleted_at is not null
    from base
   where case p_filter
           when 'no_friend'  then friends = 0
           when 'stuck'      then friends > 0 and expenses = 0
           when 'pending'    then pending_old > 0
           when 'deleted'    then deleted_at is not null
           else true
         end
   order by created_at desc
   limit p_limit offset p_offset;
$$;

/**
 * CONTROLE D'INTEGRITE DU GRAND LIVRE.
 *
 * C'est l'ecran qu'aucun outil d'analytics tiers ne peut fournir, parce qu'il
 * demande la logique metier : pour chaque paire, la somme du grand livre
 * correspond-elle encore a ce que les parts de depense et les remboursements
 * impliquent ?
 *
 * Un ecart signifie un bug dans un declencheur ou dans le rejeu de la file
 * hors ligne. On veut le voir le jour ou il apparait, pas trois mois plus tard
 * par un utilisateur qui trouve que le chiffre est bizarre.
 */
create or replace function public.admin_ledger_integrity()
returns table (user_a uuid, user_b uuid, ledger_net bigint, derived_net bigint, drift bigint)
language sql stable security definer set search_path = public as $$
  with pairs as (
    select distinct least(user_a, user_b) as lo, greatest(user_a, user_b) as hi
      from public.ledger_entries
  ),
  -- Ce que dit le journal : positif = `hi` doit a `lo`.
  from_ledger as (
    select p.lo, p.hi,
           coalesce(sum(case when l.user_a = p.hi then l.amount else -l.amount end), 0) as net
      from pairs p
      join public.ledger_entries l
        on least(l.user_a, l.user_b) = p.lo and greatest(l.user_a, l.user_b) = p.hi
     where l.status = 'confirmed'
     group by p.lo, p.hi
  ),
  -- Ce que les depenses et remboursements impliquent, recalcule a neuf.
  from_shares as (
    select p.lo, p.hi,
           coalesce(sum(
             case when x.payer_id = p.lo and s.user_id = p.hi then  s.share_amount
                  when x.payer_id = p.hi and s.user_id = p.lo then -s.share_amount
                  else 0 end), 0) as net
      from pairs p
      join public.expenses x on not x.cancelled and x.status = 'confirmed'
      join public.expense_shares s on s.expense_id = x.id
     where (x.payer_id = p.lo and s.user_id = p.hi)
        or (x.payer_id = p.hi and s.user_id = p.lo)
     group by p.lo, p.hi
  ),
  from_settlements as (
    select p.lo, p.hi,
           coalesce(sum(
             case when st.from_user = p.hi then -st.amount
                  else st.amount end), 0) as net
      from pairs p
      join public.settlements st
        on least(st.from_user, st.to_user) = p.lo
       and greatest(st.from_user, st.to_user) = p.hi
     where st.status = 'confirmed' and not st.cancelled
     group by p.lo, p.hi
  )
  select p.lo, p.hi,
         coalesce(fl.net, 0)::bigint,
         (coalesce(fs.net, 0) + coalesce(fst.net, 0))::bigint,
         (coalesce(fl.net, 0) - coalesce(fs.net, 0) - coalesce(fst.net, 0))::bigint
    from pairs p
    left join from_ledger fl      on fl.lo  = p.lo and fl.hi  = p.hi
    left join from_shares fs      on fs.lo  = p.lo and fs.hi  = p.hi
    left join from_settlements fst on fst.lo = p.lo and fst.hi = p.hi
   where coalesce(fl.net, 0) - coalesce(fs.net, 0) - coalesce(fst.net, 0) <> 0
   order by abs(coalesce(fl.net, 0) - coalesce(fs.net, 0) - coalesce(fst.net, 0)) desc;
$$;

/** Sante operationnelle : ce qui coince, sans nommer personne. */
create or replace function public.admin_health()
returns table (metric text, value bigint, detail text)
language sql stable security definer set search_path = public as $$
  select 'Remboursements en attente > 7 j'::text,
         count(*)::bigint,
         'Quelqu''un a declare un paiement que l''autre n''a jamais confirme'::text
    from public.settlements
   where status = 'pending' and not cancelled and created_at < now() - interval '7 days'
  union all
  select 'Depenses annulees apres coup', count(*)::bigint,
         'Annulations sur des depenses de plus de 24 h'
    from public.expenses x
   where x.cancelled
     and exists (select 1 from public.ledger_entries l
                  where l.ref_id = x.id and l.ref_type = 'adjustment'
                    and l.created_at > x.created_at + interval '24 hours')
  union all
  select 'Paires en ecart de grand livre',
         (select count(*) from public.admin_ledger_integrity())::bigint,
         'Doit rester a zero — tout ecart est un bug'
  union all
  select 'Erreurs de synchronisation (7 j)', count(*)::bigint,
         'Operations refusees definitivement cote client'
    from public.analytics_events
   where event = 'sync_op_failed' and created_at > now() - interval '7 days'
  union all
  select 'Plantages applicatifs (7 j)', count(*)::bigint,
         'Evenements app_error remontes par les frontieres d''erreur'
    from public.analytics_events
   where event = 'app_error' and created_at > now() - interval '7 days'
  union all
  select 'Comptes supprimes', count(*)::bigint, 'Anonymises, historique conserve'
    from public.profiles where deleted_at is not null;
$$;

/**
 * Signaux d'abus.
 *
 * `create_expense` verifie deja l'amitie ou le groupe commun, donc la
 * falsification pure n'est plus possible. Restent les usages limites :
 * cadence anormale, taux d'annulation eleve, montants inhabituels.
 */
create or replace function public.admin_moderation()
returns table (profile_id uuid, signal text, value bigint, since timestamptz)
language sql stable security definer set search_path = public as $$
  select x.created_by, 'Depenses en 24 h'::text, count(*)::bigint, min(x.created_at)
    from public.expenses x
   where x.created_at > now() - interval '1 day'
   group by x.created_by
  having count(*) >= 20
  union all
  select x.created_by, 'Taux d''annulation eleve', count(*) filter (where x.cancelled)::bigint,
         min(x.created_at)
    from public.expenses x
   where x.created_at > now() - interval '30 days'
   group by x.created_by
  having count(*) >= 5
     and count(*) filter (where x.cancelled)::numeric / count(*) > 0.3
  union all
  select x.created_by, 'Depense inhabituellement elevee', max(x.amount)::bigint, min(x.created_at)
    from public.expenses x
   where x.created_at > now() - interval '7 days' and not x.cancelled and x.amount > 500000
   group by x.created_by
  order by 3 desc;
$$;

/**
 * Journal d'un utilisateur. Toujours pseudonyme : la levee d'anonymat est
 * l'affaire de `admin_reveal`, qui laisse une trace.
 */
create or replace function public.admin_user_timeline(p_profile_id uuid, p_limit integer default 60)
returns table (at timestamptz, kind text, label text, status text)
language sql stable security definer set search_path = public as $$
  select x.created_at, 'Depense'::text,
         case when x.cancelled then 'annulee' else 'creee' end,
         x.status::text
    from public.expenses x
   where x.created_by = p_profile_id
  union all
  select s.created_at, 'Remboursement'::text,
         case when s.cancelled then 'annule'
              when s.from_user = p_profile_id then 'envoye' else 'recu' end,
         s.status::text
    from public.settlements s
   where s.from_user = p_profile_id or s.to_user = p_profile_id
  union all
  select e.created_at, 'Evenement'::text, e.event, coalesce(e.platform, '')
    from public.analytics_events e
   where e.profile_id = p_profile_id
  order by 1 desc
  limit p_limit;
$$;

/**
 * LEVEE D'ANONYMAT.
 *
 * Seule fonction qui renvoie un nom et un email, et la seule qui ECRIT dans le
 * journal des consultations. Un motif est obligatoire.
 */
create or replace function public.admin_reveal(
  p_admin_id uuid, p_profile_id uuid, p_reason text
)
returns table (profile_id uuid, name text, email text, phone text)
language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or char_length(trim(p_reason)) < 3 then
    raise exception 'Un motif est obligatoire pour lever l''anonymat';
  end if;

  insert into public.admin_audit_log (admin_id, action, subject_id, reason)
  values (p_admin_id, 'reveal', p_profile_id, trim(p_reason));

  return query
    select p.id, p.name, p.email, p.phone
      from public.profiles p
     where p.id = p_profile_id;
end;
$$;

-- ════════════════════════════════════════════════════════════════════════════
--  5. FERMETURE DES ACCES
--
--  Postgres accorde EXECUTE a PUBLIC par defaut. Sans ce bloc, chacune des
--  fonctions ci-dessus serait appelable par n'importe quel compte connecte —
--  et comme elles sont `security definer`, elles contourneraient la RLS. Ce
--  `revoke` est la partie la plus importante du fichier.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'admin_pulse', 'admin_timeseries', 'admin_activation', 'admin_retention',
         'admin_users_list', 'admin_ledger_integrity', 'admin_health',
         'admin_moderation', 'admin_user_timeline', 'admin_reveal', 'admin_rollup_day'
       )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.sig);
  end loop;
end $$;

revoke all on public.admin_users      from anon, authenticated;
revoke all on public.admin_audit_log  from anon, authenticated;
revoke all on public.analytics_events from anon, authenticated;
revoke all on public.daily_metrics    from anon, authenticated;

-- ════════════════════════════════════════════════════════════════════════════
--  6. CREER LE PREMIER ADMINISTRATEUR
--
--  Remplacer l'adresse ci-dessous par la tienne, puis decommenter et executer.
--  Le compte doit deja exister (inscription normale dans l'app).
-- ════════════════════════════════════════════════════════════════════════════

-- insert into public.admin_users (user_id, role, note)
-- select id, 'owner', 'Fondateur'
--   from auth.users
--  where email = 'ton-email@exemple.com'
-- on conflict (user_id) do update set role = 'owner';
