# Hasbni — حسبني

PWA de gestion des dettes entre amis. Chaque pote est un « compte » : un seul chiffre net par
personne, et une timeline complete des mouvements (cf. `Hasbni_CDC.pdf`).

## Lancer

```bash
npm install
npm run dev            # http://localhost:3000 — mode demonstration
```

Sans variables d'environnement, l'app tourne en **mode demonstration** : jeu de donnees local
(Souhil, Mosaab, Yacine…), persistance IndexedDB, aucune requete reseau.

### Brancher Supabase

1. Creer un projet sur [supabase.com](https://supabase.com).
2. Coller `supabase/schema.sql` dans l'editeur SQL et l'executer (tables, triggers, RLS,
   realtime).
3. `cp .env.example .env.local` puis renseigner `NEXT_PUBLIC_SUPABASE_URL` et
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Project Settings > API).
4. Redemarrer `npm run dev` — les variables ne sont lues qu'au demarrage.

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
| Profil — compte, potes, etat de synchro | `/profil` | — |
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
- `src/context/AuthContext.tsx` — session Supabase (OTP email/telephone), resolution du profil.
- `src/context/AppContext.tsx` — etat, file de synchronisation, temps reel, notifications.

### Backend (`supabase/schema.sql`)

- Tables : `profiles`, `groups`, `group_members`, `expenses`, `expense_shares`, `settlements`,
  `ledger_entries`, `audit_log`.
- **Le grand livre n'est jamais ecrit par le client** : des triggers derivent les entrees
  bilaterales depuis les parts de depense et les remboursements. Le solde d'une relation reste
  `SUM(ledger_entries confirmes entre A et B)`.
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

## Reste a faire

- Invitations reelles (lien / contact) : un pote ajoute est aujourd'hui un profil « fantome »
  cree par toi, pas encore rattache a son compte quand il s'inscrit.
- Notifications push (CDC 5.1, V1.1) — retirees pour l'instant.
- Points ouverts du CDC 8 : multi-devises, groupe sans compte, confidentialite intra-groupe.
