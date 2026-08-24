# P6.5 — Administration des comptes & référentiels : contrat figé

> Figé le 2026-08-13, avant toute écriture de code. Comble le trou identifié dans
> `plan-P5-contracts.md` §0, qui excluait « la gestion générale des utilisateurs » en la renvoyant
> à des « phases ultérieures » — renvoi qui ne pointait vers aucune phase existante (P7 =
> statistiques, P8 = exploitation/RGPD, P9 = qualité).

## 0. Périmètre

**Inclus** : CRUD des comptes utilisateurs réservé à l'ADMIN, CRUD du référentiel des catégories,
lecture/écriture des politiques SLA.

**Exclu** : instrumentation `audit_logs` (l'entité reste orpheline, décision reportée), export et
anonymisation RGPD (→ P8), statistiques (→ P7).

### Ce que le cahier des charges exige et qui manquait

- §3 : « Gestion des utilisateurs (**création/désactivation**) » pour le rôle Admin.
- §3 : « l'admin puisse **désactiver un compte sans le supprimer** (conservation de l'historique
  pour traçabilité) ». La colonne `users.is_active` existait, lue par `JwtStrategy` et
  `AuthService.refresh`, mais aucune route ne permettait de la basculer sauf pour un technicien
  (`PATCH /technicians/:id`, D9 de P5).
- D6 de `plan-backend.md` promet une table `sla_policies` « configurable, pas de constante en
  dur ». Elle était lue par `TicketsService` mais non modifiable par API — donc pas configurable.
- `GET /categories` n'existait pas alors que `POST /tickets` exige un `categoryId` : le front ne
  pouvait pas construire son formulaire de création de ticket.

### Aucune migration

Les trois tables (`users`, `categories`, `sla_policies`) existent depuis P1. Cette phase n'ajoute
ni colonne, ni contrainte, ni enum. Elle reste donc à l'écart de
`pnpm typeorm migration:generate`, seule commande qui se bloque dans cet environnement.

## 1. Conventions héritées (rappel, non négociable)

- Sérialisation sortie : DTO manuel avec `static fromEntity(...)`. Jamais l'entité brute.
- `@ApiProperty` sur tout champ exposé ; `ParseUUIDPipe` sur tout param UUID.
- Pagination via `toTypeOrmSkipTake` / `buildPaginatedResponse` et `@ApiPaginatedResponse(Dto)`.
- Politique de mot de passe via `@IsStrongPassword()` (D15 de P6), jamais recopiée.
- Hachage via `hashPassword` (`common/security/password.util.ts`), jamais `argon2.hash` en direct.
- Le schéma de base est figé : aucune entité, aucun enum, aucune migration modifiés.

## 2. Décisions

| # | Décision | Justification |
|---|---|---|
| **D1** | `POST /users` **refuse `role: TECHNICIAN`** (400, message pointant vers `POST /technicians`). | Un `User` de rôle TECHNICIAN sans `TechnicianProfile` est invisible de l'éligibilité (D1 de P5) et de la suggestion automatique : il ne peut recevoir aucun ticket. `TechniciansService.create` est le seul chemin qui crée compte **et** profil dans une transaction. Ouvrir un second chemin qui ne crée que la moitié réintroduirait exactement l'incohérence que P5 avait fermée. |
| **D2** | `PATCH /users/:id` **refuse tout changement de rôle vers ou depuis TECHNICIAN** (400). | Symétrique de D1, dans les deux sens : promouvoir laisse un technicien sans profil, rétrograder laisse un `TechnicianProfile` orphelin pointant un compte qui n'est plus technicien. Les transitions ADMIN ↔ CLIENT restent libres. |
| **D3** | Un ADMIN **ne peut modifier ni son propre `role`, ni son propre `isActive`, ni se supprimer** (400). | Anti-verrouillage. Et cette seule règle suffit à garantir qu'il reste **toujours au moins un ADMIN actif** : pour appeler la route il faut être un ADMIN actif et non supprimé (`JwtStrategy` le revérifie à chaque requête), et cet appelant-là ne peut pas être la cible. Aucun comptage « dernier admin » n'est donc nécessaire. |
| **D4** | `DELETE /users/:id` est un **soft delete**. Refusé en **409** si l'utilisateur est l'assigné d'au moins un ticket en statut non terminal (`OPEN`, `ASSIGNED`, `IN_PROGRESS`). | « Conservation de l'historique pour traçabilité » (cahier §3) : la ligne n'est jamais détruite. Le blocage sur les tickets en cours empêche de faire disparaître l'assigné d'un travail en vol, ce qui laisserait un ticket ni réassignable ni traçable. |
| **D5** | **Aucune révocation explicite des refresh tokens** sur désactivation ou suppression. | Elle serait redondante, pas prudente : `JwtStrategy.validate` recharge l'utilisateur à **chaque** requête et rejette `!isActive` ou introuvable ; `AuthService.refresh` fait le même contrôle avant d'émettre. Les deux portes sont déjà fermées, vérifié dans le code. Écrire une troisième fermeture donnerait l'illusion qu'elle porte la garantie. |
| **D6** | **Les catégories ne se suppriment pas** : il n'y a pas de `DELETE /categories/:id`, seulement `isActive: false`. | `tickets.category_id` est une FK. `TicketsService.create` traite déjà une catégorie inactive comme « retirée » (404 volontairement indistinct de « inconnue »). La désactivation est donc le retrait déjà implémenté ; une suppression casserait les tickets historiques. |
| **D7** | `GET /categories` et `GET /categories/:id` sont ouverts à **tout utilisateur authentifié** ; création et modification réservées à l'ADMIN. | Un CLIENT doit pouvoir peupler la liste déroulante du formulaire de création de ticket. Même arbitrage que `GET /skills` (P5). |
| **D8** | `PUT /sla-policies/:priority` **upsert** (crée la ligne si la priorité n'en a pas). Le changement ne vaut que pour les **tickets futurs**. | `Ticket.slaDueAt` est matérialisé au moment de la création (`resolveSlaDueAt`) : recalculer l'échéance de tickets déjà ouverts changerait rétroactivement le respect du SLA déjà mesuré. L'upsert supprime par ailleurs le cas « aucune politique pour cette priorité », aujourd'hui seulement journalisé en warning. |
| **D9** | `GET /sla-policies` ouvert à tout utilisateur authentifié, écriture ADMIN. | L'objectif de résolution est une information contractuelle destinée au demandeur, pas un secret d'exploitation. |
| **D10** | Le filtre `search` de `GET /users` porte sur `username`, `email`, `firstName`, `lastName`, en `ILIKE`, avec **échappement de `%` et `_`**. | Sans échappement, un `search=%` renvoie tout le monde et un `search=_` devient un joker : le filtre serait contournable et le coût de la requête non maîtrisé. |
| **D11** | Le conflit `username`/`email` est vérifié **`withDeleted: true`**. | Les contraintes d'unicité en base ne sont pas restreintes aux lignes non supprimées (`data-model.md` §2.1) : un compte soft-deleted bloque légitimement la réutilisation de son identifiant, et un pré-contrôle qui l'ignorerait produirait un 500 (`23505`) au lieu d'un 409. |
| **D12** | `TicketsService.getById` et `list` passent en **`withDeleted()` + garde explicite `ticket.deletedAt IS NULL`**. | **Défaut de production trouvé par le e2e de D4**, hors périmètre demandé. TypeORM pousse le filtre `deleted_at IS NULL` **dans la condition de JOIN** de toute relation soft-deletable — `LEFT JOIN "users" "createdBy" ON … AND ("createdBy"."deleted_at" IS NULL)`. Un ticket dont l'auteur venait d'être soft-deleted revenait donc avec `createdBy: null`, et `TicketResponseDto.fromEntity`, dont `createdBy` est non-nullable au contrat P4 §5, levait : **500 sur tout ticket ouvert par un compte depuis supprimé**. Invisible avant P6.5, faute de route capable de supprimer un compte. `withDeleted()` lève le filtre mais pour **toute** la requête, y compris le ticket lui-même : la garde est donc réécrite à la main. Résultat : un ticket supprimé reste un 404, un auteur supprimé reste nommé. |

## 3. Routes

Préfixe global `api`. « tous » = tout utilisateur authentifié.

### Comptes

| Méthode | Route | Rôle | Réponse |
|---|---|---|---|
| `GET` | `/users` | ADMIN | `PaginatedResponseDto<UserResponseDto>`, tri `username ASC` |
| `GET` | `/users/:id` | ADMIN | `UserResponseDto` |
| `POST` | `/users` | ADMIN | `201` `UserResponseDto` |
| `PATCH` | `/users/:id` | ADMIN | `UserResponseDto` |
| `DELETE` | `/users/:id` | ADMIN | `204`, sans corps |

Filtres de `GET /users` : `role`, `isActive`, `search` (D10), plus `page`/`limit`.
Les comptes soft-deleted sont **exclus** de la liste comme de `GET /users/:id`.

### Catégories

| Méthode | Route | Rôle | Réponse |
|---|---|---|---|
| `GET` | `/categories` | tous | `CategoryResponseDto[]`, tri `name ASC`, non paginé |
| `GET` | `/categories/:id` | tous | `CategoryResponseDto` |
| `POST` | `/categories` | ADMIN | `201` `CategoryResponseDto` |
| `PATCH` | `/categories/:id` | ADMIN | `CategoryResponseDto` |

Filtre de `GET /categories` : `isActive`. Non paginé, comme `GET /skills` : le référentiel est
borné par construction (une dizaine de lignes).

### SLA

| Méthode | Route | Rôle | Réponse |
|---|---|---|---|
| `GET` | `/sla-policies` | tous | `SlaPolicyResponseDto[]`, tri par sévérité décroissante |
| `PUT` | `/sla-policies/:priority` | ADMIN | `SlaPolicyResponseDto` (upsert, D8) |

`:priority` est une valeur de `TicketPriority`, validée par `ParseEnumPipe` (400 sinon).
Tri : `CRITICAL`, `HIGH`, `NORMAL`, `LOW` — ordre métier, pas alphabétique.

## 4. Formes de réponse

`UserResponseDto` **existe déjà** (`src/modules/users/dto/user-response.dto.ts`) et est réutilisé
tel quel : `{ id, username, email, firstName, lastName, phone, role, isActive, createdAt }`.
Aucun nouveau DTO de sortie pour les comptes, aucune fuite de `password` (colonne
`select: false`) ni de `deletedAt`.

```
CategoryResponseDto  { id, name, description, requiredSkill: SkillResponseDto | null, isActive }
SlaPolicyResponseDto { priority, resolutionTargetMinutes, updatedAt }
```

`requiredSkill` est imbriqué plutôt que réduit à un `requiredSkillId` : le front affiche le nom de
la compétence requise, et l'imbriquer évite un second aller-retour vers `/skills`.

## 5. Préfixes de fixtures e2e

`usr_e2e_`, `cat_e2e_`, `sla_e2e_`. Aucun ne commence par `e2e_` (purgé par `auth.e2e-spec.ts`).
La suite SLA ne crée aucune ligne : elle **restaure** les valeurs seedées en `afterAll`, la table
étant bornée à quatre lignes partagées.

## 6. Dette laissée ouverte

- **`audit_logs` reste orpheline.** La table existe depuis P1, l'entité `AuditLog` n'est importée
  nulle part, rien ne l'écrit ni ne la lit. Exclue de cette phase par choix de périmètre : son
  instrumentation est transverse (auth, tickets, users, technicians) et mérite son propre contrat.
- **La suppression d'un compte n'anonymise rien.** Le soft delete conserve `username`, `email`,
  `firstName`, `lastName`, `phone`. C'est ce que veut la traçabilité du cahier §3, mais cela ne
  couvre pas l'« export et anonymisation des données personnelles » attendu en P8. Les deux
  besoins sont réels et se contredisent : l'arbitrage est à faire en P8, pas ici.
- **Pas de changement de mot de passe par l'ADMIN.** Volontaire (voir `UpdateUserDto`) : le
  chemin est `POST /auth/forgot-password`. À rouvrir seulement si un besoin réel apparaît.
