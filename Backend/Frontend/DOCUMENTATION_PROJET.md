# Rapid Response — Documentation projet

Document destiné à **un développeur ou un successeur de stage** qui doit comprendre le projet **dans sa globalité**, sans ambiguïté.

Le système a **deux dépôts** :

| Dépôt | Rôle |
| --- | --- |
| `D:\STAGE\APK_\STAGE_2_eme_annee\` (ce dossier) | Frontend Next.js « Rapid Response » |
| `D:\STAGE\APK_\backend\enamya-ticket-checker\` | Backend NestJS « Ticket Checker API » |

- **Guide utilisateur** (comment cliquer dans l’app) : `docs/MANUEL_UTILISATEUR.md`
- **Ce fichier** : ce que le produit *fait*, comment le **front** et le **backend** sont conçus, avec *quelles technologies*, et *où* se trouve chaque chose.

Date de rédaction : août 2026.

---

## 1. Qu’est-ce que ce dépôt, et qu’est-ce qu’il n’est pas ?

| Ceci (ce dossier Git) | L’autre dépôt |
| --- | --- |
| Le **frontend** Rapid Response | L’**API** NestJS |
| Next.js App Router | REST `/api` + Swagger + (optionnel) WebSocket |
| Code à éditer : **`src/`** | Code à éditer : `src/modules/…` côté backend |

API locale typique de ce stage : `http://127.0.0.1:4000/api`  
Swagger UI : `http://127.0.0.1:4000/docs`  
Spec JSON live : `http://127.0.0.1:4000/docs-json`  
Copie figée dans ce front : `openapi.raw.json` (**pas lue au runtime**).

Le navigateur ne parle **jamais** à PostgreSQL. Il parle seulement à Nest. Nest parle à PostgreSQL, Redis, MinIO/S3, SMTP.

**Règle de travail front :** on ne modifie le backend que si c’est explicitement demandé. Les règles « téléphone obligatoire », « site obligatoire » sont appliquées **côté front**. Les DTO Nest traitent encore souvent ces champs comme optionnels.

---

## 2. À quoi sert le produit ?

Rapid Response est une application web de **gestion d’interventions techniques** :

1. Un **client** (ou un admin) crée un **ticket** (panne, lieu, priorité, catégorie).
2. Un **administrateur** l’**affecte** à un **technicien**.
3. Le technicien **prend en charge**, puis **marque résolu** (avec une note).
4. Le client (ou l’admin) **clôture** ou **réouvre**.
5. Tout le monde concerné peut **commenter** et joindre des **fichiers**.
6. L’admin gère **utilisateurs**, **techniciens**, **compétences** et consulte des **statistiques**.

Nom affiché dans la barre latérale : **Rapid Response**.

---

## 3. Les trois rôles (contrat métier)

Les rôles viennent de l’API : `'ADMIN' | 'TECHNICIAN' | 'CLIENT'`.

Ils sont stockés dans le JWT NextAuth (`session.user.role`) et utilisés pour :

- le **menu** (`src/lib/roles.ts` → `navKeysForRole`) ;
- le **middleware** (blocage d’URL) ;
- les **boutons** sur un ticket (qui peut résoudre, annuler, etc.).

### 3.1 Client

- Voit **ses** tickets.
- Peut **créer** un ticket.
- Peut **modifier** titre / description / priorité / catégorie / lieu **uniquement si le ticket est Ouvert**.
- Peut **annuler** un ticket Ouvert.
- Peut **réouvrir** ou **clôturer** un ticket Résolu.
- Peut **modifier son propre profil** (identifiant, e-mail, prénom, nom, téléphone) via `PATCH /auth/me` — jamais le rôle ni l’activation.
- Menu : Tableau de bord, Tickets, Paramètres.

### 3.2 Technicien

- Voit **uniquement les tickets qui lui sont affectés**.
- **Ne crée pas** de ticket, **ne patche pas** les champs.
- Peut **Prendre en charge** (Ouvert/Affecté → En cours) s’il est l’assigné.
- Peut **Marquer résolu** s’il est l’assigné et que le ticket est En cours (note obligatoire).  
  Personne d’autre ne peut résoudre : sinon le ticket resterait bloqué (contrainte Nest).
- Peut indiquer **Disponible / Indisponible** (`PATCH /technicians/me/availability`).
- Peut **modifier son propre profil** (identifiant, e-mail, prénom, nom, téléphone) via `PATCH /auth/me` — jamais le rôle ni l’activation.
- Menu : Tableau de bord, Tickets, Paramètres.

### 3.3 Administrateur

- Voit **tous** les tickets, peut en créer, filtrer, modifier, affecter / réaffecter.
- Peut prendre en charge un ticket déjà affecté, annuler, réouvrir, clôturer.
- **Ne peut pas** « Marquer résolu » à la place du technicien.
- Gère clients et admins sur **Utilisateurs** (`/users`).
- Gère les techniciens sur **Techniciens** (`/technicians` + `/skills`) — **pas** via `/users`.
- Accède à **Statistiques** (calculées côté front à partir des listes tickets / techniciens ; pas d’endpoint stats dédié).
- Peut **modifier son propre profil** via `PATCH /auth/me` (pas le rôle ni l’activation ici) — `PATCH /users/:id` reste réservé à la gestion des *autres* comptes (rôle, activation compris).
- Menu : Tableau de bord, Tickets, Techniciens, Utilisateurs, Statistiques, Paramètres.

### 3.4 Cycle de vie d’un ticket (important)

Le statut **n’est pas un menu déroulant libre**. On déclenche une **action** qui appelle un endpoint dédié.

```
Ouvert → Affecté → En cours → Résolu → Fermé
              ↘ Annulé (selon le rôle et le statut)
```

| Action UI | Endpoint | Qui |
| --- | --- | --- |
| Créer | `POST /tickets` | Client, Admin |
| Modifier les champs | `PATCH /tickets/:id` | Admin ; Client propriétaire si Ouvert |
| Affecter / réaffecter | `POST /tickets/:id/assign` | Admin (Ouvert ou Affecté ; motif obligatoire en réaffectation) |
| Suggestions | `GET /tickets/:id/assignment-suggestions` | Admin |
| Prendre en charge | `POST /tickets/:id/start` | Technicien assigné, Admin |
| Marquer résolu | `POST /tickets/:id/resolve` | Technicien assigné seulement |
| Réouvrir | `POST /tickets/:id/reopen` | Client propriétaire, Admin (motif obligatoire) |
| Clôturer | `POST /tickets/:id/close` | Client propriétaire, Admin |
| Annuler | `POST /tickets/:id/cancel` | Client si Ouvert ; Admin si Ouvert / Affecté / En cours |

Priorités : Basse, Moyenne, Haute, Urgente (`LOW` / `NORMAL` / `HIGH` / `CRITICAL`).

---

## 4. Pages et URLs

| URL | Page | Accès |
| --- | --- | --- |
| `/login` | Connexion | Public |
| `/register` | Inscription (crée un **CLIENT**) | Public |
| `/forgot-password` | Demande de reset | Public |
| `/reset-password` | Nouveau mot de passe (lien e-mail) | Public |
| `/dashboard` | Tableau de bord (page d’arrivée après login) | Connecté |
| `/dashboard/tickets` | Liste + création + filtres + recherche **locale** | Connecté |
| `/dashboard/tickets/[id]` | Détail, actions, commentaires, pièces jointes | Connecté (si droit API) |
| `/dashboard/techniciens` | CRUD techniciens + skills | Admin seulement |
| `/dashboard/utilisateurs` | CRUD clients / admins | Admin seulement |
| `/dashboard/statistiques` | KPI, graphiques, export CSV | Admin seulement |
| `/dashboard/parametres` | Profil | Connecté |

Il n’y a **plus de recherche globale** dans la barre du haut. La recherche tickets est **uniquement** sur `/dashboard/tickets`.

`src/app/page.tsx` est encore le squelette Next par défaut : l’entrée réelle métier est `/login` puis `/dashboard`.

---

## 5. Stack technique — quoi, pourquoi, où

### 5.1 Socle

| Outil | Version (package.json) | Rôle |
| --- | --- | --- |
| **Next.js** | 16.2 (App Router) | Pages, layouts, middleware, API route NextAuth |
| **React** | 19.2 | UI |
| **TypeScript** | 5, `strict: true` | Typage |
| **pnpm** | gestionnaire du projet | `pnpm dev`, `pnpm build` |
| **Tailwind CSS** | 4 | Style du dashboard (classes `moon-*`) |
| **Geist** | via `next/font` | Police |

Alias : `@/*` → `src/*` (voir `tsconfig.json`).

### 5.2 Auth

| Outil | Rôle |
| --- | --- |
| **NextAuth v4** (Credentials) | Session navigateur, JWT, page `/login` |
| **Axios** + intercepteur | `Authorization: Bearer <accessToken>` vers Nest |
| `POST /auth/refresh` | Rotation des tokens quand l’access expire |
| `POST /auth/logout` | Révocation du refresh côté API |

Fichiers clés :

- `src/lib/auth.ts` — `authorize()` appelle `authService.login`, met `role`, `accessToken`, `refreshToken` dans le JWT.
- `src/app/api/auth/[...nextauth]/route.ts` — route NextAuth.
- `src/types/next-auth.d.ts` — extension des types Session / JWT.
- `src/components/SessionTokenSync.tsx` — copie les tokens de la session vers Axios ; après refresh, `session.update(...)` ; si refresh échoue → `signOut`.
- `src/lib/logout.ts` — logout API + NextAuth.
- `src/middleware.ts` — videur : pas de session → `/login` ; non-admin sur page admin → `/dashboard`.

**Changement de mot de passe une fois connecté : inexistant.** Uniquement forgot + reset.

### 5.3 Données API

| Outil | Rôle |
| --- | --- |
| **Axios** (`instance_api`) | Client HTTP, `baseURL = NEXT_PUBLIC_API_URL` |
| **TanStack Query** | Cache, refetch, mutations ; pas de retry sur 401/403 |
| **Valibot** | Validation des **corps envoyés** (et formulaires auth) |

Couche type par ressource :

```
src/types/*.ts          → formes de réponse (User, Ticket, …)
src/schema/*.ts         → Valibot des entrées (create/update)
src/services/*.service.ts → appels HTTP + v.parse() avant envoi
src/keys/*.keys.ts      → query keys TanStack
src/hooks/use*.ts       → useQuery / useMutation
```

Services : `auth`, `tickets` (+ comments), `users`, `technicians`, `categories`, `skills`, `attachments`, `notifications`.

`src/config/env.ts` lit `NEXT_PUBLIC_API_URL` avec un fallback. **Axios n’importe pas ce fichier** : il lit `process.env.NEXT_PUBLIC_API_URL` directement. `env.ts` est donc optionnel / peu utilisé.

### 5.4 Formulaires — deux styles, ne pas les confondre

**A. Auth (login, register, forgot, reset)**

- **react-hook-form** (`useForm`, `Controller`)
- **@hookform/resolvers/valibot**
- **MUI** `TextField` via `MoonField`
- Schémas dans `src/features/auth/schemas/`
- Composants dans `src/features/auth/components/`

**B. Dashboard (tickets, users, techs, paramètres)**

- Champs HTML + **`useState`**
- Classes **Tailwind**
- Valibot surtout dans les **services** au moment du `PATCH`/`POST`

MUI n’est **pas** le design system du dashboard. Il sert surtout aux écrans d’authentification (+ ThemeProvider dans `providers.tsx`).

### 5.5 UI dashboard

| Outil | Rôle |
| --- | --- |
| **Tailwind** + tokens `moon-rose`, `moon-lavande`, `moon-violet`, `moon-violet-dark`, `moon-abyss` | Couleurs (`src/app/globals.css`) |
| **lucide-react** | Icônes (cloche, crayon, etc.) |
| **framer-motion** | Dépendance présente (animations auth / promo) |
| Composants maison | `Sidebar`, `Topbar`, `Modal`, `StatCard`, `RequireRole` |

Palette voulue :

- fond des pages : **blanc** ;
- cartes KPI : rose / lavande / vert / violet ;
- cloche : fond rose, icône violette ;
- badges de statut : rose, ambre, lavande, vert, bleu, rouge.

### 5.6 Autres fichiers à la racine

| Fichier | Rôle |
| --- | --- |
| `openapi.raw.json` | Copie de `http://127.0.0.1:4000/docs-json`. Utile pour regen / rapport. **L’app ne le lit pas.** |
| `manifest.json` | Spec simplifiée (génération historique api-forge). |
| `rapid_response/` | **Copie imbriquée** du même front. `tsconfig` du parent **exclut** ce dossier. En pratique on édite `src/` puis on aligne `rapid_response/src/` si on garde les deux. **Source de vérité : `src/`.** |

---

## 6. Carte des dossiers `src/`

```
src/
  app/                    Pages Next (App Router)
    api/auth/[...nextauth]/   Route NextAuth
    login, register, forgot-password, reset-password
    dashboard/            Layout sidebar + topbar
      page.tsx            Tableau de bord
      tickets/            Liste + [id] détail
      techniciens/
      utilisateurs/
      statistiques/
      parametres/
  components/             RequireRole, SessionTokenSync
  config/env.ts           Lecture optionnelle de l’URL API
  features/
    auth/                 Formulaires MUI + schémas Valibot
    dashboard/            Sidebar, Topbar, Modal, StatCard
    tickets/              AssignTicketModal, comments, attachments, ticketUi
  hooks/                  TanStack Query
  keys/                   Query keys
  lib/                    auth.ts, logout.ts, roles.ts
  middleware.ts           Garde /dashboard
  schema/                 Valibot API (user, ticket, phone, …)
  services/               Axios par ressource + http/axios.ts
  types/                  Types réponse + next-auth.d.ts
```

---

## 7. Authentification, de bout en bout

1. L’utilisateur saisit identifiant + mot de passe sur `/login`.
2. NextAuth `authorize` → `POST /auth/login` (Nest) → `accessToken`, `refreshToken`, `user`.
3. Ces valeurs sont mises dans le **JWT NextAuth** (pas seulement le cookie de session « vide »).
4. `SessionTokenSync` les copie en mémoire Axios.
5. Chaque requête dashboard part avec `Bearer <accessToken>`.
6. Si Nest répond 401, Axios tente `POST /auth/refresh` **une fois** (évite les rafales).
7. Nouveaux tokens → `session.update` pour survivre au rechargement de page.
8. Si le refresh échoue → déconnexion vers `/login`.

Le middleware ne connaît que « y a-t-il une session ? » et « le rôle est-il ADMIN ? ». Il ne parle pas à Nest.

---

## 8. Variables d’environnement

Fichiers **hors Git** (voir `.gitignore`) :

| Fichier | Usage |
| --- | --- |
| `.env` | Défauts publics éventuels (`NEXT_PUBLIC_API_URL`) |
| `.env.local` | Machine locale + secrets. **Prioritaire** sur `.env` |

Variables nécessaires :

| Nom | Où | Sens |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | Front (navigateur) | Base Axios, ex. `http://localhost:4000/api` |
| `NEXTAUTH_URL` | Serveur Next | URL du front, ex. `http://localhost:3000` |
| `NEXTAUTH_SECRET` | Serveur Next | Signature des JWT NextAuth (**ne jamais le coller dans un rapport**) |

Côté backend (autre dépôt) : `APP_FRONTEND_URL=http://localhost:3000` pour les liens de reset password.

`NEXT_PUBLIC_*` est volontairement exposé au navigateur : ce n’est pas un secret.

---

## 9. Middleware (`src/middleware.ts`)

S’applique **uniquement** à `/dashboard` et `/dashboard/*`.

1. Pas de session NextAuth → redirection `/login`.
2. Session mais rôle ≠ `ADMIN` et URL dans Techniciens / Utilisateurs / Statistiques → redirection `/dashboard`.
3. Sinon → la page s’affiche.

Le menu cache déjà ces liens. Le middleware empêche d’y aller en tapant l’URL.

---

## 10. Règles front importantes (pas dans Nest)

Ces contrôles sont **volontaires côté UI / schémas front** :

- Téléphone **obligatoire** à l’inscription, création user, création technicien, sauvegarde profil (`src/schema/phone.schema.ts`) : au moins **8 chiffres réels** (les espaces/`+` ne comptent pas), 30 caractères max. Champ prérempli avec l’indicatif `+228`.
- **Site / lieu d’intervention** obligatoire à la création de ticket.
- On ne crée **pas** un `TECHNICIAN` via `/users` (Nest refuse) : page Techniciens uniquement.
- Un admin **ne peut pas** se désactiver / se supprimer lui-même.
- Compte désactivé : bouton **Réactiver** ou **Modifier → Statut → Actif**.
- Erreurs de formulaire d’édition user : remises à zéro à l’ouverture d’un autre utilisateur (`updateUser.reset()`).

---

## 11. Ce que le projet ne fait pas (limites API / choix)

À connaître pour ne pas chercher une feature inexistante :

- Pas de changement de mot de passe **connecté** (uniquement via « mot de passe oublié »).
- Pas d’écran d’admin pour les **politiques SLA** (`GET/PUT /sla-policies` existe côté API, pas d’UI).
- Pas d’endpoint « statistiques » : la page calcule à partir de `GET /tickets` et `GET /technicians`.
- Pas de WebSocket notifications dans ce front : liste + compteur HTTP (cloche).
- `openapi.raw.json` / `manifest.json` ne font pas tourner l’app.

---

## 12. Comment lancer le projet

Prérequis : Node, pnpm, **backend Nest déjà démarré** sur le port 4000.

```bash
cd D:\STAGE\APK_\STAGE_2_eme_annee
# Vérifier .env.local (NEXT_PUBLIC_API_URL, NEXTAUTH_URL, NEXTAUTH_SECRET)
pnpm install
pnpm dev
```

Ouvrir `http://localhost:3000/login`.

Scripts utiles : `pnpm dev:clean` (efface `.next` puis relance), `pnpm build`, `pnpm lint`.

L’inscription crée un **client**. Les comptes admin / technicien se créent dans l’UI admin (ou via le seed backend, hors de ce dépôt).

---

## 13. Comment modifier le code sans se tromper

1. Travailler dans **`src/`**, pas dans `.next/`.
2. Si le dossier `rapid_response/` est encore utilisé, **recopier** les fichiers touchés vers `rapid_response/src/`.
3. Nouvelle ressource API : `types` → `schema` → `service` → `keys` → `hook` → page.
4. Nouvelle page admin : l’ajouter dans `ADMIN_ONLY_PREFIXES` **et** `navKeysForRole` (`src/lib/roles.ts`).
5. Ne pas committer `.env`, `.env.local`, ni de secrets.
6. Ne pas « corriger » un 403 en ouvrant l’API à tout le monde : d’abord vérifier le rôle.

---

## 14. Historique utile (pour ne pas se perdre)

- Couche `services` / `hooks` / `schema` : générée à l’origine depuis OpenAPI (api-forge), puis **maintenue à la main**.
- `openapi.raw.json` à la racine de **ce** dépôt a été resynchronisé avec Swagger le **14 août 2026** (users, catégories, SLA inclus).
- Une copie plus ancienne peut exister ailleurs (`RR2`) : ne pas la confondre avec celle-ci.

---

## 15. Fichiers à ouvrir en premier

Pour comprendre le **front** en 20 minutes :

1. Ce document (sections 1–14).
2. `src/lib/roles.ts` — qui voit quoi.
3. `src/middleware.ts` — qui entre où.
4. `src/lib/auth.ts` + `src/services/http/axios.ts` — comment on parle à Nest.
5. `src/app/dashboard/tickets/[id]/page.tsx` — le cœur métier UI.
6. `docs/MANUEL_UTILISATEUR.md` — ce que voit l’utilisateur.

Pour comprendre le **backend** ensuite :

7. Ce document, **section 16**.
8. `enamya-ticket-checker/docs/plan-backend.md` — décisions et machine à états.
9. `enamya-ticket-checker/src/modules/tickets/state/ticket-status.machine.ts` — transitions autorisées.
10. `enamya-ticket-checker/src/app.module.ts` — modules branchés.

S’il y a un doute entre « ce que le front affiche » et « ce que Nest autorise », **Nest gagne** : un bouton peut être visible à tort, l’API renverra 403.

---

## 16. Backend — technologies et conception

Dépôt : `D:\STAGE\APK_\backend\enamya-ticket-checker`  
Nom npm / OpenAPI : **ticket-checker** / **Ticket Checker API**.  
Plans détaillés (phases P1 → P6.5, contrats D1–D8) : `docs/plan-backend.md` et `docs/plan-P*.md` **dans le dépôt backend**, pas ici.

### 16.1 Rôle dans le système

Nest est le **seul serveur métier**. Il :

- authentifie (JWT access + refresh) ;
- applique les **droits** (rôle, propriétaire, assigné) ;
- applique la **machine à états** des tickets ;
- persiste dans **PostgreSQL** ;
- stocke les fichiers sur **S3 / MinIO** ;
- envoie des e-mails via **BullMQ + Redis + Nodemailer** ;
- crée des **notifications** in-app (REST + gateway WebSocket côté API).

Le front Rapid Response consomme le **REST**. Il n’est **pas** branché sur le WebSocket `/notifications` (la cloche utilise `GET /notifications` et `GET /notifications/unread-count`).

### 16.2 Stack backend

| Technologie | Usage |
| --- | --- |
| **NestJS 11** | Framework API, modules, guards, pipes |
| **TypeScript** | Typage |
| **TypeORM** | ORM + **migrations versionnées** (choix D1 : pas Prisma) |
| **PostgreSQL** | Base de données |
| **pg** | Driver PostgreSQL |
| **Passport + JWT** (`@nestjs/jwt`, `passport-jwt`) | Access token et refresh token |
| **Argon2id** | Hachage des mots de passe |
| **class-validator** + **class-transformer** | Validation des DTO (`ValidationPipe` global : `whitelist` + `forbidNonWhitelisted`) |
| **XState v5** | Machine à états du ticket, **en validateur pur** (pas d’acteur persisté) |
| **@nestjs/swagger** | Doc OpenAPI générée **depuis le code** au boot |
| **@nestjs/throttler** | Rate limit global + limite stricte sur le login |
| **@nestjs/event-emitter** | Bus interne `ticket.*` après commit |
| **BullMQ** + **Redis** | File d’attente e-mails |
| **Nodemailer** | Envoi SMTP (Mailpit en local) |
| **AWS SDK S3** | Pièces jointes (MinIO en local, S3-compatible en prod) |
| **Socket.IO** (`@nestjs/websockets`) | Push notifications (`NotificationsGateway`, namespace `/notifications`) |
| **Pino** (`nestjs-pino`) | Logs structurés |
| **Jest** + **Supertest** | Tests unitaires et e2e |
| **Docker Compose** | Redis, MinIO, Mailpit (PostgreSQL souvent installé à part en local) |
| **pnpm** | Scripts `start:dev`, `migration:run`, `seed`, `test:e2e` |

Écarts assumés par rapport au cahier des charges (mémoire) : TypeORM au lieu de Prisma ; rôles en anglais `ADMIN` / `TECHNICIAN` / `CLIENT` ; XState sans interpréteur ; SLA en table plutôt qu’en dur ; login par `identifier` (username **ou** e-mail). L’export PDF (pdfkit) prévu en fin de plan **n’est pas** dans les dépendances actuelles.

### 16.3 Comment l’API est démarrée (`main.ts`)

1. Préfixe global **`/api`** : toutes les routes métier sont `/api/...`.
2. **CORS** depuis `CORS_ORIGINS` (ex. `http://localhost:3000`).
3. **ValidationPipe** : champs inconnus rejetés, types transformés.
4. **Swagger** si `SWAGGER_ENABLED=true`, monté **hors** préfixe `/api` (`/docs`, `/docs-json`).
5. Port : variable `PORT` du `.env` backend (dans ce stage souvent **4000** ; l’exemple du backend peut indiquer 3000 — **c’est le `.env` réel qui compte**).

### 16.4 Découpage en modules

Chaque domaine a son module Nest (`src/modules/`) :

| Module | Responsabilité |
| --- | --- |
| `auth` | register, login, refresh, logout, forgot/reset, `GET /auth/me`, `PATCH /auth/me` (auto-édition, tout rôle authentifié) |
| `users` | CRUD admin ` /users` (`PATCH /users/:id` **ADMIN only**, pour gérer les *autres* comptes — rôle et activation compris) |
| `tickets` | CRUD + transitions + assignation + suggestions |
| `ticket-comments` | Commentaires PUBLIC / INTERNAL |
| `attachments` | Upload / liste / suppression, stockage S3 |
| `technicians` | Profils techniciens, disponibilité, compétences |
| `skills` | Référentiel de compétences |
| `categories` | Catégories de tickets (le client en a besoin pour créer un ticket) |
| `sla` | Politiques SLA par priorité (`GET /sla-policies`, `PUT /sla-policies/:priority`) |
| `notifications` | Liste, unread-count, mark read, gateway WS |
| `mail` | Worker BullMQ qui envoie les mails |

Config validée au boot : `src/config/env.validation.ts` (si une variable obligatoire manque, l’app ne démarre pas).

### 16.5 Authentification et autorisation (3 couches)

Ordre typique sur une route ticket sensible :

1. **`JwtAuthGuard`** — JWT access Bearer valide, sinon 401. Compte désactivé refusé au login.
2. **`RolesGuard`** + `@Roles(...)` / `@Auth(ADMIN)` — le rôle du token doit matcher, sinon 403.
3. **`OwnershipGuard`** (tickets, commentaires, pièces jointes) — le caller doit être **propriétaire**, **assigné**, ou **admin**, sinon 403. Ça répond à « a-t-il le droit de *voir* ce ticket ? », pas encore à « a-t-il le droit de *changer le statut* ? ».
4. **Évaluateur P3** (`evaluateTicketTransition` + machine XState) — « cette **transition** est-elle légale pour ce rôle, ce statut, et ce contexte ? »  
   Refus : `GUARD_FAILED` (403) ou `INVALID_TRANSITION` (409).

Refresh : `POST /auth/refresh` **fait tourner** les tokens (l’ancien refresh ne peut plus être réutilisé). `POST /auth/logout` révoque le refresh. Access court (`JWT_ACCESS_EXPIRES_IN`, ex. 15 min), refresh plus long (ex. 7 j).

`PATCH /auth/me` permet à **tout utilisateur authentifié** (client, technicien, admin) de mettre à jour son propre profil (identifiant, e-mail, prénom, nom, téléphone — jamais rôle, activation ni mot de passe). `PATCH /users/:id` reste **ADMIN only**, pour gérer les comptes des *autres* utilisateurs (rôle et activation compris).

### 16.6 Machine à états (cœur métier)

Fichier unique de vérité des transitions :

`src/modules/tickets/state/ticket-status.machine.ts`

XState décrit **quelles** transitions existent et **quelles gardes** s’appliquent. La colonne SQL `ticket.status` reste la **seule** source de vérité persistée. La machine **ne lit pas** la base, **n’envoie pas** de mail, **n’est pas** interprétée comme un acteur long-vivant.

| De | Événement | Vers | Garde principale |
| --- | --- | --- | --- |
| OPEN | ASSIGN | ASSIGNED | ADMIN + technicien actif et disponible |
| ASSIGNED | ASSIGN | ASSIGNED | ADMIN + **motif** (réaffectation) |
| ASSIGNED | START | IN_PROGRESS | Technicien **assigné** ou ADMIN |
| IN_PROGRESS | RESOLVE | RESOLVED | Technicien **assigné** + `resolutionNote` |
| RESOLVED | REOPEN | IN_PROGRESS | Client **propriétaire** ou ADMIN + **motif** |
| RESOLVED | CLOSE | CLOSED | Client propriétaire ou ADMIN |
| OPEN / ASSIGNED / IN_PROGRESS | CANCEL | CANCELLED | ADMIN ; client propriétaire **seulement si OPEN** |
| CLOSED / CANCELLED | — | — | Terminaux |

Toute transition hors tableau est rejetée **dans le service**, même si le front l’autorise. Chaque transition acceptée écrit `ticket_status_history` et les horodatages (`assignedAt`, `startedAt`, …).

L’affectation : `technicianId` = **`user.id` du technicien**, jamais l’id interne du profil (`TechnicianProfile`).

### 16.7 Données, fichiers, mails, SLA

- **PostgreSQL + TypeORM** : utilisateurs, tickets, historique, skills, catégories, `sla_policies`, notifications, tokens de refresh / reset, etc. Voir `docs/data-model.md` côté backend.
- **SLA** : délais par priorité en **base** (défauts du plan : CRITICAL 4 h, HIGH 24 h, NORMAL 72 h, LOW 120 h). Configurable via `PUT /sla-policies/:priority`. Le front **n’a pas d’écran SLA**.
- **Pièces jointes** : upload multipart → objet S3/MinIO ; métadonnées en base ; URL de téléchargement signée.
- **Événements** : après un commit réussi, le service émet `ticket.*`. Un listener crée la notification et peut **enfiler un mail**. Un listener qui plante **ne doit pas** faire échouer la requête HTTP.
- **Seed** : `pnpm seed` crée l’admin initial (identifiants dans le `.env` backend `SEED_ADMIN_*`, à ne pas coller dans un mémoire public).

### 16.8 Comment lancer le backend (rappel)

Dans `enamya-ticket-checker` :

1. Copier `.env.example` → `.env`, ajuster `PORT`, Postgres, Redis, MinIO, `APP_FRONTEND_URL=http://localhost:3000`, `CORS_ORIGINS`.
2. `pnpm db:up` (Redis / MinIO / Mailpit selon le compose).
3. Postgres local joignable (`DB_*`).
4. `pnpm migration:run` puis éventuellement `pnpm seed`.
5. `pnpm start:dev`.
6. Vérifier Swagger : `/docs`.

Le front doit avoir `NEXT_PUBLIC_API_URL` = cette API **avec** le suffixe `/api`.

### 16.9 Ce que le front et le backend ne partagent pas

| Sujet | Backend | Front Rapid Response |
| --- | --- | --- |
| Validation DTO | `class-validator` | Valibot (+ HTML) |
| Transitions ticket | XState + service (autorité) | Boutons selon le rôle (confort) |
| Notifications temps réel | Gateway Socket.IO | Non branché (HTTP seulement) |
| SLA admin | Routes REST | Pas d’UI |
| Profil self-service | `PATCH /auth/me`, tout rôle | Formulaire d’édition pour tout rôle (`/dashboard/parametres`) |
| OpenAPI | Généré au boot depuis les décorateurs | Fichier `openapi.raw.json` optionnel, copie manuelle |

---