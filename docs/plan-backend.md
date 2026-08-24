# Plan backend — Ticket Checker

Document de référence du périmètre **backend uniquement**, dérivé du
[Cahier des charges KOLA Balakiyém](./Cahier%20des%20charges%20KOLA%20Balakiy%C3%A9m.docx.md).

Statut : décisions verrouillées le 2026-07-28.

---

## 1. Écarts assumés par rapport au cahier des charges

Ces écarts sont validés et doivent figurer en annexe du mémoire.

| # | Cahier | Retenu | Justification |
|---|---|---|---|
| D1 | ORM Prisma | **TypeORM** | Le socle (migrations versionnées, entités, seed, e2e, CI, image Docker) est déjà bâti sur TypeORM. Les trois bénéfices invoqués pour Prisma — migrations versionnées, typage automatique des modèles, protection native contre l'injection SQL — sont intégralement couverts par TypeORM. Migrer coûterait 4 à 6 jours pour zéro gain fonctionnel. |
| D2 | Rôles `Admin / Technicien / Client` | **`ADMIN / TECHNICIAN / CLIENT`** | Identifiants en anglais, cohérents avec le reste du code. L'enum existant `ADMIN / USER` est migré, les comptes `USER` sont remappés en `CLIENT`. |
| D3 | XState | **XState en validateur pur** | Aucun acteur, aucun interpréteur, aucune machine persistée. La colonne `status` reste l'unique source de vérité. Voir §3. |
| D4 | BullMQ + Redis + Nodemailer | **Retenu** | Redis ajouté au compose dev et prod. SMTP réel déjà fourni (`MAIL_*`). |
| D5 | *(non tranché par le cahier)* | **S3 / MinIO** | Le cahier exige des pièces jointes et une sauvegarde « vers un stockage distinct » sans choisir de techno. MinIO en dev, S3-compatible en prod, derrière une abstraction `StorageService`. |
| D6 | SLA mentionné, jamais défini | **SLA par priorité, en table** | `CRITICAL` 4 h · `HIGH` 24 h · `NORMAL` 72 h · `LOW` 120 h. Table `sla_policies` configurable, pas de constante en dur. |
| D7 | Export PDF (Puppeteer ou pdfkit) | **pdfkit** | Puppeteer embarque ~400 Mo de Chromium dans l'image Docker. Placé en fin de P7, coupable en premier en cas de retard. |
| D8 | Comptes email | **Champ `identifier`** | Le login accepte indifféremment le username ou l'email. |
| — | WebSockets « différable » | **Retenu** | Notifications in-app poussées en temps réel. Impose un adapter Redis pour socket.io dès deux instances. |
| — | zxcvbn | **Écarté** | Règle de longueur (10 caractères minimum) + complexité via DTO. Le cahier le classe optionnel. |
| — | NestJS 10.x, PostgreSQL 16.x | **NestJS 11, PostgreSQL 17** | Versions déjà en place, support à jour. Aucun impact fonctionnel. |

---

## 2. Acquis (ne pas refaire)

- NestJS 11 · TypeScript · pnpm
- PostgreSQL via `docker-compose.yml`, migrations TypeORM versionnées
- Validation stricte des variables d'environnement (`src/config/env.validation.ts`)
- Authentification JWT complète : `register`, `login`, `refresh` avec rotation, `logout` avec
  révocation, `me` — hachage Argon2id
- `JwtAuthGuard`, `RolesGuard`, décorateurs `@Auth()`, `@Roles()`, `@CurrentUser()`
- Swagger, `ValidationPipe` global (`whitelist` + `forbidNonWhitelisted`), CORS configurable
- Jest unitaire + e2e authentification, CI GitHub Actions, Dockerfile de production

Couvre S1, S2 et une partie de S8 du planning du cahier.

---

## 3. Contrat : machine à états du ticket

Fichier de référence : `src/modules/tickets/state/ticket-status.machine.ts`.
Exportable tel quel vers le frontend Next.js — **aucune règle de transition ne doit être
dupliquée ailleurs**.

| État courant | Événement | → État | Garde |
|---|---|---|---|
| `OPEN` | `ASSIGN` | `ASSIGNED` | rôle `ADMIN`, technicien actif et disponible |
| `ASSIGNED` | `ASSIGN` | `ASSIGNED` | `ADMIN` — réaffectation, motif obligatoire |
| `ASSIGNED` | `START` | `IN_PROGRESS` | `TECHNICIAN` assigné au ticket, ou `ADMIN` |
| `IN_PROGRESS` | `RESOLVE` | `RESOLVED` | `TECHNICIAN` assigné, `resolutionNote` non vide |
| `RESOLVED` | `REOPEN` | `IN_PROGRESS` | `CLIENT` propriétaire ou `ADMIN`, motif obligatoire |
| `RESOLVED` | `CLOSE` | `CLOSED` | `ADMIN`, ou `CLIENT` propriétaire |
| `OPEN` · `ASSIGNED` · `IN_PROGRESS` | `CANCEL` | `CANCELLED` | `ADMIN`, ou `CLIENT` propriétaire si `OPEN` |
| `CLOSED` · `CANCELLED` | *(aucun)* | — | états terminaux |

Règles non négociables :

1. Toute transition absente de ce tableau est **rejetée par la couche service**, jamais
   seulement par le frontend.
2. Chaque transition acceptée écrit une ligne dans `ticket_status_history` et met à jour
   l'horodatage dédié sur le ticket (`assignedAt`, `startedAt`, `resolvedAt`, …).
3. La machine est une fonction pure. Elle ne lit pas la base, n'émet pas d'événement,
   n'envoie pas de mail.

---

## 4. Découpage en phases

`∥` = parallélisable. Chaque tâche est validée par le `validator` sur le diff réel avant
d'ouvrir la suivante.

| # | Phase | Tâches | Dépend de | Est. |
|---|---|---|---|---|
| **P1** | Modèle de données & rôles | `T1.1` migration rôles + remap · `T1.2` domaine ticket (entités, migration, seed référentiel) | D1, D2, D6 | 3-4 j |
| **P2 ∥** | Socle transverse | `T2.1` infra (Redis, MinIO, env, deps) · `T2.2` pagination, filtre d'exception, logger Pino, audit, throttler · `T2.3` `StorageService` S3/MinIO | D4, D5 | 4-5 j |
| **P3** | Machine à états | `ticketStatusMachine` XState pure + matrice de tests exhaustive | P1 | 2-3 j |
| **P4** | CRUD tickets + RBAC | endpoints, liste filtrable paginée, soft delete, commentaires public/interne, pièces jointes, `OwnershipGuard` | P1, P2, P3 | 4-5 j |
| **P5** | Affectation | manuelle admin, suggestion automatique (disponibilité × compétences), historique des réaffectations | P4 | 3 j |
| **P6** | Événements & notifications | `@nestjs/event-emitter`, BullMQ + Redis, Nodemailer, notifications in-app, WebSockets + adapter Redis, reset de mot de passe par email | P2, P4, P5 | 6-7 j |
| **P6.5** | Administration des comptes & référentiels | CRUD utilisateurs ADMIN (création, rôle, désactivation, soft delete), CRUD catégories, politiques SLA configurables. Voir [`plan-P6.5-contracts.md`](./plan-P6.5-contracts.md) | P5, P6 | 1 j |
| **P7** | Statistiques & exports | agrégations par rôle, délai moyen, charge par technicien, taux SLA, export CSV puis PDF | P5, P6 | 3 j |
| **P8** | Exploitation & RGPD | backup `pg_dump` planifié + backup bucket, `helmet`, HTTPS/reverse proxy, export et anonymisation des données personnelles | P6 | 2-3 j |
| **P9** | Qualité & recette | couverture ≥ 80 %, e2e par rôle, tests d'accès croisés, k6 (50 utilisateurs / 500 ms), gate CI, grille UAT | tout | 4-5 j |

**Chemin critique** : P1 → P3 → P4 → P5 → P6 → P7 → P9.
**Total estimé** : 32 à 37 jours-homme backend.

> P6.5 a été ouverte le 2026-08-13 : `plan-P5-contracts.md` §0 excluait « la gestion générale des
> utilisateurs » en la renvoyant à des « phases ultérieures », mais aucune phase ne la reprenait —
> P7 est statistiques, P8 exploitation/RGPD, P9 qualité. Le cahier des charges §3 l'exige pourtant
> explicitement pour le rôle Admin (« création/désactivation »).

---

## 5. Garde-fous de délégation

- Le schéma de base, les DTO partagés et la spec OpenAPI sont du ressort exclusif de
  l'orchestrateur. Les sous-agents les consomment, ne les modifient pas.
- Aucune dépendance ajoutée hors de la liste validée (§1).
- Aucune tâche déclarée terminée sans build vert, lint vert et tests verts.
- Les identifiants SMTP sont de vraies credentials : jamais dans un fichier versionné,
  jamais dans `.env.production.example`, uniquement via GitHub Secrets en CI et prod.
