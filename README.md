# Hasbni — حسبني

PWA de gestion des dettes entre amis. Chaque pote est un « compte » : un seul chiffre net par
personne, et une timeline complete des mouvements (cf. `Hasbni_CDC.pdf`).

## Lancer

```bash
npm install
npm run dev            # http://localhost:3000 — mode demonstration
```

Le **mode demonstration** (jeu de donnees local, persistance IndexedDB, aucune requete
reseau) demande `NEXT_PUBLIC_DEMO=1`. En production, un build sans variables Supabase et
sans ce drapeau echoue volontairement : une app deployee avec des potes fictifs ressemble
a une app qui marche.

### Brancher Supabase

1. Creer un projet sur [supabase.com](https://supabase.com).
2. Coller `supabase/schema.sql` dans l'editeur SQL et l'executer. **Ce fichier suffit** :
   il contient l'etat consolide (tables, contraintes, triggers, RPC, RLS, vue des soldes,
   realtime). Les anciens patches sont archives dans `supabase/patches/` et ne doivent
   pas etre rejoues.
3. `cp .env.example .env.local` puis renseigner `NEXT_PUBLIC_SUPABASE_URL` et
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API).
4. Redemarrer `npm run dev` — les variables ne sont lues qu'au demarrage.

**Base deja en service ?** Executer `supabase/patch-06-durcissement.sql`, le seul patch
non encore applique. Il est idempotent.

L'authentification est **email + mot de passe** (provider Email, actif par defaut). Pour tester a
plusieurs sans boite mail, desactiver **Authentication > Sign In / Providers > Email > Confirm
email** : les comptes sont alors utilisables immediatement.

Au premier login, le trigger `on_auth_user_created` cree automatiquement le profil avec le prenom
saisi a l'inscription.

## Ce qui est implemente

| Ecran | Route | CDC |
| --- | --- | --- |
| Accueil — liste des potes, totaux globaux, recherche/tri | `/` | 2.2 |
| Relation — timeline anti-chronologique + solde net sticky | `/relation/[id]` | 2.3 |
| Ajout de depense — repartition egale / personnalisee / par items | modale | 2.4 |
| Remboursement — saisie + confirmation bilaterale | modale | 2.5 |
| Groupes — membres, soldes, bouton « Simplifier » | `/groupes` | 2.6 / 2.7 |
| Activite — tous les mouvements, file de confirmation | `/activite` | — |
| Profil — compte, potes, demande par email, etat de synchro | `/profil` | — |
| Connexion / inscription — email + mot de passe | `/login` | 4 (flow 1) |

Regles de gestion (CDC 3) : solde net sur mouvements confirmes, signe positif = l'autre me doit,
statut « en attente » jusqu'a confirmation, annulation par ecriture inverse (jamais de
suppression physique), DA arrondi a l'unite, reste d'arrondi au payeur.

## Architecture

### Front

- **Next.js 15 (App Router) + TypeScript**, Tailwind CSS 3, framer-motion 12, lucide-react.
- `src/lib/types.ts` — modele calque sur le CDC 5.2.
- `src/lib/ledger.ts` — moteur de grand livre : eclatement bilateral, soldes, timeline,
  simplification de dettes.
- `src/lib/ops.ts` — **toute mutation est une operation serialisable** (`Op`) appliquee par un
  reducteur pur. C'est ce qui rend la saisie hors ligne possible : meme fonction pour l'etat
  optimiste local et pour le rejeu.
- `src/context/AuthContext.tsx` — session Supabase (email + mot de passe), resolution du profil.
- `src/context/AppContext.tsx` — etat, file de synchronisation, temps reel.

### Backend (`supabase/schema.sql`)

- Tables : `profiles`, `groups`, `group_members`, `expenses`, `expense_shares`, `settlements`,
  `ledger_entries`, `audit_log`.
- **Le grand livre n'est jamais ecrit par le client** : des triggers derivent les entrees
  bilaterales depuis les parts de depense et les remboursements. Le solde d'une relation reste
  `SUM(ledger_entries confirmes entre A et B)`.
- **Les soldes sont calcules par Postgres** (vue `relation_balances`). Le client ne charge
  qu'une fenetre recente de mouvements, pour la timeline — pas tout l'historique.
- **Creation et correction d'une depense sont transactionnelles** (`create_expense`,
  `amend_expense`) : jamais de depense sans ses parts, jamais de montant modifie sans que le
  grand livre suive. Une correction solde l'ancienne position par des ecritures d'ajustement
  puis en regenere des neuves — le journal reste strictement additif.
- **Qui peut figurer sur une depense** : `can_share_with()` exige un lien d'amitie ou un
  groupe commun. Sans ca, connaitre un identifiant de profil suffisait a fabriquer une dette
  contre son proprietaire.
- **L'email du profil est un miroir en lecture seule** de `auth.users.email` : c'est la cle
  de recherche des demandes de pote, la laisser modifiable permettait de squatter une adresse.
- **Suppression de compte non destructrice** : anonymisation, `deleted_at`, cles en RESTRICT.
  Les soldes des potes restent justes.
- **RLS** (CDC 5.3) : `current_profile_id()`, `is_group_member()`, `shares_context()` et
  `can_see_expense()` sont `SECURITY DEFINER` pour eviter les recursions de politiques. On ne voit
  que les relations et groupes dont on fait partie.
- **Confirmation bilaterale** garantie au niveau SQL : la politique `settlements_confirm`
  n'autorise le passage a `confirmed` que par le beneficiaire (`to_user`).
- **Annulation** : trigger qui insere l'ecriture inverse ; aucune suppression physique.
- **Audit** append-only sur les depenses et remboursements.
- **Realtime** active sur `ledger_entries`, `settlements`, `expenses` — les soldes se mettent a
  jour tout seuls quand un pote saisit quelque chose.

### PWA

- `public/sw.js` — app shell precachee, navigations en network-first avec repli `/offline`,
  statiques Next en cache-first, reste en stale-while-revalidate.
- **File de synchronisation** (`src/lib/idb.ts`) : hors ligne, chaque operation part dans
  IndexedDB. Le retour du reseau (evenement `online` ou **Background Sync** via le service
  worker) la vide dans l'ordre, avec upserts idempotents et abandon des erreurs non rejouables.
- Un instantane de l'etat est garde dans IndexedDB : l'app s'ouvre instantanement, meme sans
  reseau.
- Banniere d'installation (`beforeinstallprompt`) et indicateur hors ligne / synchro.

Le service worker n'est enregistre qu'en production (`npm run build && npm start`) — en dev, le
cache des chunks entre en conflit avec le rechargement a chaud.

## Design system — verre depoli (vert)

Palette dans `tailwind.config.ts`, utilitaires dans `src/app/globals.css` :

| Token | Valeur | Usage |
| --- | --- | --- |
| `navy` | `#0B3A2B` | texte, titres |
| `brand` | `#22A06B` | CTA, etats actifs, focus |
| `ocean` | `#14724F` | hover des CTA |
| `cream` | `#FFFAE6` | badges « en attente » |
| `mist` | `#E9FFF4` | base du fond |
| `frost` | `#A9FBD7` | milieu du degrade |
| `silver` | `#E4EEE8` | bordures |
| `credit` / `debit` | `#15A05F` / `#E5484D` | il me doit / je lui dois |

Classes : `.glass`, `.glass-sm`, `.glass-sidebar`, `.glass-nav`, `.blob-1/2/3`.
Animations : variantes partagees dans `src/lib/motion.ts`.

## Console d'administration — `/admin`

Application a part, servie par le meme deploiement mais ne partageant rien avec
l'app : ni fournisseur de session, ni etat, ni temps reel, ni service worker
(exclu dans `public/sw.js`). Les routes applicatives vivent dans le groupe
`src/app/(app)/`, la console dans `src/app/admin/`.

### Mise en route

1. Executer `supabase/patch-07-admin.sql`.
2. Renseigner dans `.env.local` : `SUPABASE_SERVICE_ROLE_KEY` (Project Settings >
   API) et `ADMIN_SESSION_SECRET` (`openssl rand -base64 48`).
3. Se creer un compte normal dans l'app, puis decommenter le bloc final du patch
   07 avec son email pour se declarer administrateur.
4. Ouvrir `/admin`.

### Securite

- **`SUPABASE_SERVICE_ROLE_KEY` n'est jamais prefixee `NEXT_PUBLIC_`.** Elle
  contourne la RLS : dans un bundle navigateur, elle donnerait la base complete.
  `src/lib/admin/server.ts` ouvre sur `import 'server-only'` — un import depuis un
  composant client fait echouer le BUILD.
- **Le statut d'admin vit dans sa propre table**, jamais dans une colonne de
  `profiles` : le declencheur `guard_profile_columns` ne fige qu'une liste nommee
  de colonnes, et chacun peut ecrire sa propre ligne — un `is_admin` sur
  `profiles` serait auto-attribuable.
- **Toutes les fonctions `admin_*` sont retirees a `public`, `anon` et
  `authenticated`.** Postgres accorde EXECUTE a PUBLIC par defaut : sans ce
  `revoke`, ces fonctions `security definer` seraient un aspirateur a donnees
  ouvert a tout compte connecte.
- **La console a sa propre session**, cookie signe en HMAC et `httpOnly` :
  l'app garde la sienne dans `localStorage`, qu'un middleware ne peut pas lire.
- **Pseudonymes par defaut.** Voir un nom demande un motif, et la consultation
  est inscrite dans `admin_audit_log` — avant que la donnee soit renvoyee.

### Les six ecrans

| Ecran | Repond a |
| --- | --- |
| Pulse | Est-ce que quelque chose brule ? |
| Activation | Ou perd-on les nouveaux inscrits ? |
| Retention | Reviennent-ils la semaine suivante ? |
| Utilisateurs | Files de support : sans pote, bloque, en attente depuis 7 j |
| Sante du grand livre | `SUM(ledger_entries)` colle-t-il encore aux parts et remboursements ? |
| Moderation | Cadence anormale, taux d'annulation, montants inhabituels |

« Sante du grand livre » est la raison de construire cette console plutot que de
tout confier a un outil tiers : aucun produit d'analytics ne peut verifier cet
invariant, il demande la logique metier de Hasbni. Un ecart y est toujours un
bug — declencheur SQL ou rejeu de la file hors ligne.

### Mesure

`src/lib/analytics.ts` envoie les evenements par lots vers `/api/events`, qui les
ecrit avec la cle de service. Deux regles tenues partout : **jamais de montant
dans un evenement**, seulement une tranche (`<1k`, `1-5k`, `5-20k`, `20k+`) ; et
un evenement porte le nom de ce que la personne a fait, pas du composant touche.
Le profil est deduit du jeton, jamais du corps de la requete — sinon n'importe
qui pourrait attribuer son activite a quelqu'un d'autre.

Agregation journaliere : `POST /api/admin/rollup` avec l'en-tete
`x-rollup-secret`, a brancher sur un cron.

## Verification

```bash
npm run verify        # types + lint + tests
npm run test:watch
```

Les tests couvrent le coeur comptable : repartition avec reste, signe et statut des soldes,
idempotence du reducteur d'operations (rejouer une operation ne double jamais un montant),
correction d'une depense, et simplification de groupe. La CI GitHub Actions rejoue tout
plus le build.

## Reste a faire

- **Notifications** (CDC 5.1) : personne n'est prevenu d'une depense le concernant. C'est
  le maillon manquant de la boucle produit, reporte jusqu'a la mise sur l'App Store.
- Parcours d'invitation : ajouter un pote suppose aujourd'hui qu'il ait deja un compte,
  a l'adresse exacte qu'on tape.
- Migrations Supabase CLI a la place du copier-coller dans l'editeur SQL.
- Console : geler un compte et annuler d'autorite une depense ne sont pas cables
  — il faut d'abord decider ce qui arrive aux soldes des tiers.
- Points ouverts du CDC 8 : multi-devises, groupe sans compte, confidentialite intra-groupe.
