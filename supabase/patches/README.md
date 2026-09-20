# Historique des patches

Ces fichiers ont ete appliques successivement sur la base de developpement.
Ils sont conserves pour la trace du raisonnement — chacun documente le bug
qu'il corrige — mais **ne doivent pas etre rejoues** :

- sur une base **neuve** : executer uniquement `../schema.sql`, qui contient
  deja tout leur contenu sous sa forme finale ;
- sur la base **existante** : executer `../patch-06-durcissement.sql`, le seul
  patch qui n'a pas encore ete applique.

| Patch | Sujet |
| --- | --- |
| 02 | Creation de groupe + demandes de pote (remplace le patch 01) |
| 03 | Colonne non qualifiee dans `profiles_select` |
| 04 | Creation de groupe atomique (`create_group`) |
| 05 | Instantane RLS a l'insertion, annulation d'un remboursement confirme |

## Et ensuite

Le passage aux migrations Supabase CLI est la prochaine etape (audit OPS-4) :
ces fichiers sont a rejouer une seule fois dans `supabase/migrations/` avec
`supabase migration new`, apres quoi `supabase db push` remplace le
copier-coller dans l'editeur SQL.
