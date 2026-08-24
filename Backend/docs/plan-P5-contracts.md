# P5 — Affectation : contrat figé

> Figé par l'orchestrateur le 2026-08-06, avant toute délégation. Les sous-agents **consomment**
> ce document, ils ne le modifient pas. Toute déviation constatée en validation est un échec.

## 0. Périmètre

**Inclus** : gestion des techniciens (profil, disponibilité, compétences), affectation manuelle par
un ADMIN, réaffectation avec motif, suggestion automatique (disponibilité × compétences), historique
des affectations.

**Exclu (→ phases ultérieures)** : gestion générale des utilisateurs (lister/désactiver/promouvoir un
compte quelconque), notifications d'affectation (→ P6), statistiques de charge (→ P7).

### Pourquoi le périmètre est plus large que le « P5 » du plan initial

`docs/plan-backend.md` chiffrait P5 à 3 j sur la seule logique d'affectation. La reconnaissance du
2026-08-06 a établi que **le schéma est prêt mais qu'aucune couche applicative ne peut le peupler** :

- `TechnicianProfile` / `TechnicianSkill` ne sont importées nulle part hors de leurs fichiers d'entité.
- `UsersService.create()` ne crée jamais de profil technicien ; il n'a pas de méthode `update` ; il
  n'existe aucun `UsersController`.
- `RegisterDto` interdit `role` : l'auto-inscription produit toujours un CLIENT. Le seed ne crée
  aucun `technician_profiles` / `technician_skills`.

Sans cette couche, la suggestion automatique retournerait systématiquement une liste vide en usage
réel. Périmètre élargi décidé par l'utilisateur le 2026-08-06.

## 1. Conventions héritées de P4 (rappel, non négociable)

- Sérialisation sortie : DTO manuel avec `static fromEntity(...)`. Pas de `ClassSerializerInterceptor`,
  pas de `@Exclude`, pas de `class-transformer` sur les réponses.
- Ordre des décorateurs sur toute route à `:id` de ticket : `@UseGuards(OwnershipGuard)` **au-dessus**
  de `@Auth()` (Nest applique les décorateurs empilés du bas vers le haut ; ordre d'exécution requis
  `[JwtAuthGuard, RolesGuard, OwnershipGuard]`).
- Pagination via `toTypeOrmSkipTake` / `buildPaginatedResponse` (`src/common/utils/pagination.util.ts`)
  et `@ApiPaginatedResponse(Dto)` pour Swagger.
- `@ApiProperty` sur tout champ exposé ; `ParseUUIDPipe` sur tout param UUID.
- Le schéma de base est **figé** (P1) : aucune entité, aucun enum, aucune migration, aucun
  `data-model.md` modifié. Un besoin de schéma → escalade orchestrateur.
- Aucune nouvelle dépendance sans aval explicite de l'utilisateur.
- `src/app.module.ts` : modifié **uniquement** par l'orchestrateur (T5.0-bis).
- Les règles de transition ne sont jamais réécrites : tout passe par `evaluateTicketTransition` (P3).

## 2. Décisions figées

| # | Décision | Motif |
|---|---|---|
| **D1** | **Blocage strict de la cible d'affectation.** Une affectation vers un technicien non éligible est refusée en **403**, que ce soit une première affectation ou une réaffectation. Éligible = compte existant, `role = TECHNICIAN`, `User.isActive = true`, non soft-deleted, profil technicien existant, `TechnicianProfile.isAvailable = true`, et `currentLoad < maxConcurrentTickets`. | Choix utilisateur du 2026-08-06. |
| **D2** | **La machine P3 n'est PAS modifiée.** La garde `canReassignFromAssigned` n'exige que `ADMIN + hasReason` : elle ne contrôle pas la disponibilité. Pour appliquer D1 uniformément, le **service valide l'éligibilité de la cible AVANT d'appeler `evaluateTicketTransition`**, et lève 403 si elle échoue. `isTargetTechnicianActiveAndAvailable` est malgré tout renseigné avec la vraie valeur calculée (jamais `false` en dur), pour que la garde `canAssignFromOpen` reste cohérente. | Éviter de toucher un composant livré et couvert par 100 tests, tout en respectant D1. |
| **D3** | `currentLoad` d'un technicien = nombre de tickets **non soft-deleted** dont `assigneeId = <userId>` et `status IN (ASSIGNED, IN_PROGRESS)`. `OPEN`, `RESOLVED`, `CLOSED`, `CANCELLED` ne comptent pas. | Seuls les tickets réellement en cours occupent un technicien. |
| **D4** | Dans toutes les routes `/technicians/:id`, **`:id` est le `userId`** du technicien, jamais le `TechnicianProfile.id`. | `ticket.assigneeId`, `ticket_assignments.technician_id` et `TransitionContext` manipulent tous des `userId` : une seule notion d'identité de technicien dans l'API. |
| **D5** | Réaffecter un ticket au technicien **déjà assigné** → **400** (`Ticket is already assigned to this technician`). | Évite une ligne d'historique et une transition sans changement d'état réel. |
| **D6** | La suggestion est **consultative** : elle ne déclenche aucune affectation. L'ADMIN lit les suggestions puis appelle `POST /tickets/:id/assign`. Le drapeau `ticket_assignments.is_auto_suggested` est renseigné par le client via `AssignTicketDto.isAutoSuggested` (défaut `false`). | Le cahier des charges §4.3 dit « suggestion automatique », pas « affectation automatique ». |
| **D7** | `slaDueAt` n'est **pas** recalculé à l'affectation. | Ni le code ni la documentation ne le prévoient : le SLA court depuis la création, l'affectation ne le remet pas à zéro. `assignedAt` reste strictement distinct de `slaDueAt`. |
| **D8** | `ARGON2_OPTIONS` est extrait dans `src/common/security/password.util.ts` (avec `hashPassword`), et **`AuthService` et `seed.ts` sont migrés pour le consommer**, supprimant les deux duplications existantes. | T5.1b doit hasher un mot de passe à la création d'un technicien : sans extraction, ce serait une **troisième** copie. Migration sûre : argon2 encode ses paramètres dans le hash, les mots de passe déjà stockés restent vérifiables. Dette héritée signalée dans le handoff du 2026-08-05, résolue ici. |
| **D9** | La désactivation d'un compte technicien passe par `PATCH /technicians/:id` (champ `isActive`), pas par une gestion générale des utilisateurs (hors périmètre). | Rend la garde « technicien actif » (D1) testable de bout en bout sans ouvrir un CRUD utilisateurs complet. |
| **D10** | Route `PATCH /technicians/me/availability` déclarée **AVANT** `GET/PATCH /technicians/:id` dans le contrôleur. **Corrigé le 2026-08-06** : la justification initiale (« sinon `me` est capturé par `:id` ») est **fausse pour cette route précise**. Vérifié empiriquement et dans `path-to-regexp` : `/technicians/:id` a deux segments et ne matche jamais `/technicians/me/availability`, qui en a trois. Aucune collision n'est possible et inverser l'ordre ne casse aucun test. | La règle est **conservée** comme discipline défensive, à coût nul : elle deviendrait réellement nécessaire le jour où une route `GET/PATCH /technicians/me` (deux segments, même forme que `:id`) serait ajoutée. Ne pas présenter un test d'ordre de routes comme une garantie contre cette collision : il n'en est pas une ici. |

## 3. Endpoints

Préfixe global `api` (posé par `main.ts`). « tous » = tout utilisateur authentifié.

### Compétences (T5.2)

| Route | Rôles | Entrée | Succès | Erreurs |
|---|---|---|---|---|
| `POST /skills` | ADMIN | `CreateSkillDto` | `201` `SkillResponseDto` | 400, 403, 409 (nom déjà pris) |
| `GET /skills` | tous | — | `200` `SkillResponseDto[]` | — |

### Techniciens (T5.1b)

| Route | Rôles | Entrée | Succès | Erreurs |
|---|---|---|---|---|
| `POST /technicians` | ADMIN | `CreateTechnicianDto` | `201` `TechnicianResponseDto` | 400, 403, 409 (username/email pris) |
| `GET /technicians` | ADMIN | `TechnicianQueryDto` | `200` `Paginated<TechnicianResponseDto>` | 403 |
| `GET /technicians/:id` | ADMIN, ou le technicien lui-même | — | `200` `TechnicianResponseDto` | 403, 404 |
| `PATCH /technicians/:id` | ADMIN | `UpdateTechnicianDto` | `200` `TechnicianResponseDto` | 400, 403, 404 |
| `PUT /technicians/:id/skills` | ADMIN | `SetTechnicianSkillsDto` | `200` `TechnicianResponseDto` | 400, 403, 404 (technicien ou compétence inconnue) |
| `PATCH /technicians/me/availability` | TECHNICIAN | `UpdateAvailabilityDto` | `200` `TechnicianResponseDto` | 400, 403, 404 (pas de profil) |

`GET /technicians/:id` : un TECHNICIAN ne peut lire que son propre profil (403 sinon) ; un ADMIN lit
n'importe lequel. Un CLIENT est toujours refusé.

### Affectation (T5.3)

| Route | Rôles | Guards | Entrée | Succès | Erreurs |
|---|---|---|---|---|---|
| `GET /tickets/:id/assignment-suggestions` | ADMIN | — | `SuggestionQueryDto` | `200` `TechnicianSuggestionDto[]` | 403, 404 |
| `POST /tickets/:id/assign` | ADMIN | — | `AssignTicketDto` | `200` `TicketResponseDto` | 400, 403, 404, 409 |
| `GET /tickets/:id/assignments` | tous | **OwnershipGuard** | — | `200` `TicketAssignmentResponseDto[]` | 403, 404 |

`POST /tickets/:id/assign` et `GET .../assignment-suggestions` sont `@Auth(UserRole.ADMIN)` : le
`RolesGuard` suffit, `OwnershipGuard` serait redondant (un ADMIN le franchit toujours) — même
raisonnement que le `DELETE /tickets/:id` de P4. Le service lève `404` si le ticket n'existe pas.

`GET /tickets/:id/assignments` est ouvert à tous **derrière `OwnershipGuard`** : owner, assigné et
ADMIN voient l'historique du ticket qu'ils peuvent déjà consulter.

## 4. Règles de service

### 4.1 Éligibilité d'un technicien (D1) — fonction partagée

Exposée par le module techniciens et consommée par l'affectation :

```ts
interface TechnicianEligibility {
  eligible: boolean;
  reason?: 'NOT_FOUND' | 'NOT_A_TECHNICIAN' | 'INACTIVE' | 'NO_PROFILE'
         | 'UNAVAILABLE' | 'AT_CAPACITY';
  currentLoad: number;
  maxConcurrentTickets: number;
}
```

Ordre d'évaluation (le premier échec l'emporte, pour un message d'erreur exploitable) :
`NOT_FOUND` → `NOT_A_TECHNICIAN` → `INACTIVE` (compte inactif ou soft-deleted) → `NO_PROFILE` →
`UNAVAILABLE` (`isAvailable = false`) → `AT_CAPACITY` (`currentLoad >= maxConcurrentTickets`).

### 4.2 Affectation (`POST /tickets/:id/assign`)

1. Charger le ticket ; `404` s'il n'existe pas.
2. `400` si `technicianId === ticket.assigneeId` (D5).
3. Évaluer l'éligibilité de la cible (4.1) ; `403` si non éligible, avec le `reason` dans le message.
4. Construire le `TransitionContext` avec `isTargetTechnicianActiveAndAvailable` = résultat réel de
   l'étape 3 (jamais `false` en dur), `hasReason = isNonEmpty(dto.reason)`, `actorRole`,
   `isActorOwnerClient`, `isActorAssignedTechnician`.
5. `evaluateTicketTransition(ticket.status, 'ASSIGN', ctx)` : `INVALID_TRANSITION` → **409**,
   `GUARD_FAILED` → **403**. C'est cette étape qui impose le motif obligatoire en réaffectation
   (garde `canReassignFromAssigned`), la règle n'est jamais réimplémentée à la main.
6. Dans **une seule transaction** :
   - clore l'affectation courante s'il y en a une : la ligne `ticket_assignments` de ce ticket dont
     `unassignedAt IS NULL` reçoit `unassignedAt = now` ;
   - insérer la nouvelle ligne `ticket_assignments` (`ticketId`, `technicianId`, `assignedById` =
     ADMIN courant, `reason`, `isAutoSuggested`, `assignedAt = now`, `unassignedAt = null`) ;
   - mettre à jour le ticket : `assigneeId`, `assignedAt = now`, `status = ASSIGNED` ;
   - insérer la ligne `ticket_status_history` (`fromStatus`, `toStatus`, `changedById`,
     `note = reason ?? null`).
7. Retourner le ticket rechargé.

L'implémentation remplit le `case 'ASSIGN'` déjà présent dans `TicketsService.applyTransition`
(aujourd'hui un `break;` marqué « Unreachable in practice ») **ou** ajoute une méthode dédiée qui
réutilise la même transaction — au choix de l'implementer, à condition que l'écriture de
`ticket_status_history` et la mise à jour du ticket restent atomiques et non dupliquées.

### 4.3 Suggestion (`GET /tickets/:id/assignment-suggestions`)

1. Charger le ticket et sa catégorie ; `404` si le ticket n'existe pas.
2. Candidats : `role = TECHNICIAN`, `isActive = true`, non soft-deleted, profil existant avec
   `isAvailable = true`.
3. Exclure `currentLoad >= maxConcurrentTickets` (D3).
4. Exclure le technicien actuellement assigné au ticket.
5. Si `category.requiredSkillId` est renseigné : ne garder que les techniciens possédant cette
   compétence, et `skillLevel` = `technician_skills.level`. Sinon : garder tous les candidats avec
   `skillLevel = null`.
6. Tri **déterministe** : `skillLevel` DESC (`null` en dernier), puis `currentLoad` ASC, puis
   `username` ASC. Le troisième critère n'est pas décoratif : sans lui, deux techniciens à égalité
   sortiraient dans un ordre dicté par le plan d'exécution PostgreSQL, et les tests seraient flaky.
7. Limite : `?limit=` entre 1 et 50, défaut **10**.
8. Une liste vide est une réponse **200 valide**, jamais une erreur.

### 4.4 Historique (`GET /tickets/:id/assignments`)

Toutes les lignes `ticket_assignments` du ticket, triées `assignedAt DESC` (la plus récente en tête).
La ligne courante est celle dont `unassignedAt` est `null`.

## 5. DTO — signatures figées

```ts
// ---------- Compétences ----------
class CreateSkillDto {
  @IsString() @Length(2, 80) name: string;
  @IsString() @IsOptional() @MaxLength(2000) description?: string;
}
// SkillResponseDto : { id, name, description }

// ---------- Techniciens ----------
class CreateTechnicianDto {
  @IsString() @Length(3, 50) username: string;
  @IsEmail() @MaxLength(255) email: string;
  // CORRIGÉ le 2026-08-06 : la version initiale écrivait `@Length(8, 72)` en la présentant comme
  // « la même contrainte que RegisterDto ». C'était faux. `RegisterDto` impose `@Length(10, 72)`
  // ET une règle de complexité, la borne de 10 venant du cahier des charges §6.3. Un technicien
  // créé par un ADMIN aurait donc eu une politique de mot de passe PLUS FAIBLE qu'un client
  // auto-inscrit, alors qu'il dispose de plus de privilèges. Les deux DTO sont alignés.
  @IsString()
  @Length(10, 72)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
  password: string;
  @IsString() @IsOptional() @MaxLength(80) firstName?: string;
  @IsString() @IsOptional() @MaxLength(80) lastName?: string;
  @IsString() @IsOptional() @MaxLength(30) phone?: string;
  @IsBoolean() @IsOptional() isAvailable?: boolean;             // défaut true
  @IsInt() @Min(1) @Max(50) @IsOptional() maxConcurrentTickets?: number; // défaut 5
  @ValidateNested({each:true}) @Type(() => TechnicianSkillInputDto) @IsArray() @IsOptional()
  skills?: TechnicianSkillInputDto[];
}

class TechnicianSkillInputDto {
  @IsUUID() skillId: string;
  @IsInt() @Min(1) @Max(5) @IsOptional() level?: number;  // défaut 3
}

class UpdateTechnicianDto {   // tous optionnels, au moins un requis (validé service → 400)
  @IsBoolean() @IsOptional() isAvailable?: boolean;
  @IsInt() @Min(1) @Max(50) @IsOptional() maxConcurrentTickets?: number;
  @IsBoolean() @IsOptional() isActive?: boolean;          // D9
}

class SetTechnicianSkillsDto {   // remplacement COMPLET du jeu de compétences
  @ValidateNested({each:true}) @Type(() => TechnicianSkillInputDto) @IsArray() skills: TechnicianSkillInputDto[];
}

class UpdateAvailabilityDto { @IsBoolean() isAvailable: boolean; }

class TechnicianQueryDto extends PaginationQueryDto {
  @IsBoolean() @IsOptional() @Type(() => Boolean) isAvailable?: boolean;
  @IsUUID() @IsOptional() skillId?: string;
  @IsBoolean() @IsOptional() @Type(() => Boolean) isActive?: boolean;
}

// ---------- Affectation ----------
class AssignTicketDto {
  @IsUUID() technicianId: string;
  @IsString() @IsOptional() @Length(1, 1000) reason?: string;   // obligatoire en réaffectation (garde P3)
  @IsBoolean() @IsOptional() isAutoSuggested?: boolean;         // défaut false
}

class SuggestionQueryDto {
  @IsInt() @Min(1) @Max(50) @IsOptional() @Type(() => Number) limit?: number;  // défaut 10
}
```

### DTO de réponse (`static fromEntity`)

- `SkillResponseDto` : `{ id, name, description }`.
- `TechnicianSkillResponseDto` : `{ id, name, level }` (`id`/`name` de la compétence).
- `TechnicianResponseDto` : `{ id, username, email, firstName, lastName, phone, isActive,
  isAvailable, maxConcurrentTickets, currentLoad, skills: TechnicianSkillResponseDto[] }`.
  **`id` est le `userId`** (D4). **Jamais** `password`, `deletedAt`, ni le `TechnicianProfile.id`.
- `TechnicianSuggestionDto` : `{ technicianId, username, firstName, lastName, skillLevel: number|null,
  currentLoad, maxConcurrentTickets }`.
- `TicketAssignmentResponseDto` : `{ id, technician {id, username}, assignedBy {id, username}|null,
  reason, isAutoSuggested, assignedAt, unassignedAt }`.

## 6. Découpage en tâches

| Tâche | Contenu | Périmètre | Dépend |
|---|---|---|---|
| **T5.1a** | `src/common/security/password.util.ts` (`ARGON2_OPTIONS` + `hashPassword`), migration de `AuthService` et `seed.ts` pour le consommer (D8), ajout de `UsersService.update()` | `src/common/security/**`, `src/modules/auth/auth.service.ts`, `src/database/seeds/seed.ts`, `src/modules/users/users.service.ts` (+ specs) | — |
| **T5.2** | `SkillsModule` : `POST`/`GET /skills`, `CreateSkillDto`, `SkillResponseDto` | `src/modules/skills/**` (hors `entities/`), `test/skills.e2e-spec.ts` | — |
| **T5.1b** | `TechniciansModule` : CRUD profil, disponibilité, compétences, `currentLoad`, service d'éligibilité (4.1) et de suggestion (4.3) **exportés** | `src/modules/technicians/**` (hors `entities/`), `test/technicians.e2e-spec.ts` | T5.1a, T5.2 |
| **T5.3** | Affectation : `POST /tickets/:id/assign`, `GET /tickets/:id/assignment-suggestions`, `GET /tickets/:id/assignments`, remplissage du `case 'ASSIGN'` | `src/modules/tickets/**`, `test/ticket-assignment.e2e-spec.ts` | T5.1b |
| **T5.0-bis** (orchestrateur) | Câbler `SkillsModule` et `TechniciansModule` dans `app.module.ts` | `src/app.module.ts` | T5.2, T5.1b |

**Parallélisme** : T5.1a et T5.2 sont disjointes → **vague 1 en parallèle**. T5.1b puis T5.3 sont
séquentielles (chacune consomme la précédente).

**Préfixes de fixtures e2e** (une base réelle partagée, `maxWorkers: 1`) : `skl_e2e_` (T5.2),
`tch_e2e_` (T5.1b), `asg_e2e_` (T5.3). Aucun ne doit commencer par `e2e_`, purgé par
`auth.e2e-spec.ts`.

**Tests** : chaque tâche livre ses tests (unitaires service + e2e par rôle sur les accès croisés).
Relecture par **mutation** exigée : casser 3 points, prouver qu'un test ciblé rougit, restaurer.

## 7. Garde-fous P5

- Schéma figé : aucune entité, enum, migration ni `data-model.md` modifié.
- Machine P3 figée : `ticket-status.machine.ts`, `ticket-status.evaluator.ts`, `ticket-status.types.ts`
  sont en **lecture seule** pour tous les agents (D2).
- Aucune nouvelle dépendance.
- `app.module.ts` : orchestrateur uniquement.
- **Ne jamais exécuter `pnpm typeorm migration:generate`** : la commande hang dans cet environnement.
  `pnpm seed` et `pnpm migration:run`, eux, fonctionnent normalement.
