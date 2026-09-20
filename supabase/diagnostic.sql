-- ============================================================================
--  Diagnostic — quels patches sont reellement appliques ?
--  Lecture seule : rien n'est modifie. A coller dans l'editeur SQL.
--
--  Un `false` sur une ligne « fonction » alors que le patch a bien ete execute
--  signale presque toujours la MEME chose : PostgREST n'a pas relu son cache
--  de schema. Dans ce cas, executer la derniere ligne de ce fichier.
-- ============================================================================

select 'patch 02 — potes'                as objet, to_regclass('public.friendships')            is not null as present
union all select 'patch 04 — create_group',        to_regproc('public.create_group')            is not null
union all select 'patch 05 — has_expense_share',   to_regproc('public.has_expense_share')       is not null
union all select 'patch 06 — create_expense',      to_regproc('public.create_expense')          is not null
union all select 'patch 06 — amend_expense',       to_regproc('public.amend_expense')           is not null
union all select 'patch 06 — group_positions',     to_regproc('public.group_positions')         is not null
union all select 'patch 06 — vue des soldes',      to_regclass('public.relation_balances')      is not null
union all select 'patch 07 — admin_users',         to_regclass('public.admin_users')            is not null
union all select 'patch 07 — controle integrite',  to_regproc('public.admin_ledger_integrity')  is not null
union all select 'patch 08 — delete_group',        to_regproc('public.delete_group')            is not null
union all select 'patch 09 — set_username',        to_regproc('public.set_username')            is not null
union all select 'patch 09 — search_profiles',     to_regproc('public.search_profiles')         is not null
union all select 'patch 09 — demande par id',      to_regproc('public.send_friend_request_to')  is not null
union all select 'patch 10 — username_available',  to_regproc('public.username_available')      is not null
union all select 'colonne profiles.username',
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'username')
union all select 'tous les profils ont un pseudo',
  not exists (select 1 from public.profiles where username is null);

-- Si une fonction existe en base mais reste introuvable pour l'API :
-- notify pgrst, 'reload schema';
