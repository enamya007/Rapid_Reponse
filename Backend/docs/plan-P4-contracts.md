# P4 — Contrats (CRUD tickets + RBAC + OwnershipGuard)

> Document de référence figé par l'**orchestrateur**. Les sous-agents le CONSOMMENT, ne le
> modifient pas. Dérivé de [`plan-backend.md`](./plan-backend.md) §4 (P4) et de
> [`data-model.md`](./data-model.md). Statut : **PROPOSÉ — en attente d'aval utilisateur**.
> Toute règle de statut RÉUTILISE la machine P3 (`src/modules/tickets/state/`) — aucune règle de
> transition n'est réécrite ici.

## 0. Périmètre de P4 (frontière)

**Inclus** : module/service/contrôleur tickets, CRUD, lecture filtrée paginée scopée par rôle,
soft delete, `OwnershipGuard`, commentaires public/interne, pièces jointes (via `StorageService`),
**et les transitions de statut hors affectation** (START, RESOLVE, REOPEN, CLOSE, CANCEL) qui
consomment l'évaluateur P3.

**Exclu (→ P5)** : `ASSIGN` (affectation manuelle admin), suggestion automatique, historique des
réaffectations. **Exclu (→ P6)** : événements, notifications, mails, WebSockets — aucune émission
ici, seulement l'écriture DB (statut + `ticket_status_history`).

> ⚠️ **Fork à confirmer** : inclure les transitions START/RESOLVE/REOPEN/CLOSE/CANCEL dans P4
> (recommandé — la machine P3 est prête, sinon les tickets restent immobiles jusqu'à P5), ou les
> repousser en P5 à côté de ASSIGN. Défaut retenu ci-dessous : **inclus dans P4**.

## 1. Conventions transverses (déjà en place — à réutiliser tel quel)

- **Sérialisation sortie** : DTO manuel avec `static fromEntity(...)` (comme `UserResponseDto`).
  Pas de `ClassSerializerInterceptor`, pas de `@Exclude`. On renvoie des DTO de réponse, **jamais
  l'entité brute**.
- **Validation entrée** : `class-validator` + `@ApiProperty`. `ValidationPipe` global déjà
  `whitelist + forbidNonWhitelisted + transform + enableImplicitConversion` → tout champ non
  déclaré dans un DTO est rejeté (400).
- **Pagination** : `PaginationQueryDto` (`page`, `limit`) + `buildPaginatedResponse()` +
  `toTypeOrmSkipTake()` + décorateur `@ApiPaginatedResponse(Dto)`. P4 est le **premier
  consommateur réel** de ce plumbing.
- **Auth** : `@Auth(...roles)` (JWT + RolesGuard + Swagger 401/403). `@CurrentUser()` injecte
  l'entité `User` complète ; `@CurrentUser('id')`, `@CurrentUser('role')`.
- **OpenAPI** : contrat de référence = DTO + décorateurs `@nestjs/swagger`. Pas de `openapi.yaml`
  versionné (cohérent avec l'existant). *(Optionnel, à décider : dumper un `openapi.json` figé en
  CI ; hors périmètre P4 par défaut.)*
- **Soft delete** : `@DeleteDateColumn deletedAt` déjà sur les entités ; toute lecture exclut les
  supprimés (comportement TypeORM par défaut).

## 2. Définition de l'ownership (source unique, alignée sur P3)

Pour un ticket `t` et un utilisateur courant `u` :
- **propriétaire (owner)** ⇔ `t.createdById === u.id` (rôle `CLIENT`) → `isActorOwnerClient`.
- **assigné** ⇔ `t.assigneeId === u.id` (rôle `TECHNICIAN`) → `isActorAssignedTechnician`.
- **ADMIN** : accès total.

Ces trois définitions sont EXACTEMENT celles que consomme `TransitionContext` (P3). Aucune autre
définition d'ownership ne doit apparaître dans le code.

## 3. `OwnershipGuard` (à créer)

Garde HTTP de **visibilité d'un ticket** (grain gros), distincte des gardes de transition (grain
fin, dans l'évaluateur P3).

- S'applique aux routes portant un paramètre `:id` de ticket.
- Charge le ticket (non supprimé) ; **404** s'il n'existe pas.
- Autorise ssi `ADMIN` **ou** owner **ou** assigné (cf. §2) ; sinon **403**.
- Attache le ticket résolu à la requête (`request.ticket`) pour éviter un second SELECT dans le
  handler/service.
- Ne porte PAS les règles fines de transition (rôle × statut) : celles-ci restent dans
  l'évaluateur P3, appelé par le service. Séparation : le guard dit « tu peux voir ce ticket »,
  l'évaluateur dit « tu peux faire CETTE transition ».

## 4. Endpoints — contrat figé

Base `@ApiTags('tickets')`, `@Controller('tickets')`. Tous authentifiés (`@Auth(...)`).

| Méthode & route | Rôles (accès route) | Garde ownership | Corps | Réponse | Codes |
|---|---|---|---|---|---|
| `POST /tickets` | CLIENT, ADMIN | — | `CreateTicketDto` | `201` `TicketResponseDto` | 400, 404 (catégorie) |
| `GET /tickets` | tous | scoping service | query `TicketQueryDto` | `200` `Paginated<TicketListItemDto>` | 400 |
| `GET /tickets/:id` | tous | **OwnershipGuard** | — | `200` `TicketResponseDto` | 403, 404 |
| `PATCH /tickets/:id` | tous | **OwnershipGuard** + règle | `UpdateTicketDto` | `200` `TicketResponseDto` | 400, 403, 404 |
| `DELETE /tickets/:id` | ADMIN | — (ADMIN-only) | — | `204` | 403, 404 |
| `POST /tickets/:id/start` | tous | **OwnershipGuard** | — | `200` `TicketResponseDto` | 403, 404, 409 |
| `POST /tickets/:id/resolve` | tous | **OwnershipGuard** | `ResolveTicketDto {resolutionNote}` | `200` `TicketResponseDto` | 400, 403, 404, 409 |
| `POST /tickets/:id/reopen` | tous | **OwnershipGuard** | `ReasonDto {reason}` | `200` `TicketResponseDto` | 400, 403, 404, 409 |
| `POST /tickets/:id/close` | tous | **OwnershipGuard** | — | `200` `TicketResponseDto` | 403, 404, 409 |
| `POST /tickets/:id/cancel` | tous | **OwnershipGuard** | `ReasonDto {reason?}` | `200` `TicketResponseDto` | 403, 404, 409 |
| `POST /tickets/:id/comments` | tous | **OwnershipGuard** | `CreateCommentDto` | `201` `CommentResponseDto` | 400, 403, 404 |
| `GET /tickets/:id/comments` | tous | **OwnershipGuard** | query pagination | `200` `Paginated<CommentResponseDto>` | 403, 404 |
| `POST /tickets/:id/attachments` | tous | **OwnershipGuard** | multipart `file` | `201` `AttachmentResponseDto` | 400, 403, 404, 413, 415 |
| `GET /tickets/:id/attachments` | tous | **OwnershipGuard** | — | `200` `AttachmentResponseDto[]` (URL présignée) | 403, 404 |
| `DELETE /tickets/:id/attachments/:attId` | tous | **OwnershipGuard** + auteur/admin | — | `204` | 403, 404 |

### Règles fines (couche service, au-delà de la route/guard)

- **`GET /tickets` (scoping)** : `CLIENT` → `createdById = u.id` ; `TECHNICIAN` → `assigneeId = u.id` ;
  `ADMIN` → tout. Les filtres `assigneeId`/`createdById` de la query ne sont honorés que pour `ADMIN`.
- **`PATCH`** : `ADMIN` à tout moment ; `CLIENT` owner uniquement si `status = OPEN` ; `TECHNICIAN`
  interdit (403). Champs mutables : `title`, `description`, `priority`, `categoryId`, `siteLabel`,
  `siteAddress`. Changement de `priority` → **recalcul de `slaDueAt`**. `status` jamais mutable ici.
- **Transitions** : le handler construit `TransitionContext` puis appelle `evaluateTicketTransition`
  (P3). `INVALID_TRANSITION` → **409 Conflict** ; `GUARD_FAILED` → **403 Forbidden**. Sur succès :
  MAJ `status` + horodatage dédié (`startedAt`/`resolvedAt`/`closedAt`/`cancelledAt`) + insertion
  d'une ligne `ticket_status_history` (`fromStatus`, `toStatus`, `changedById`, `note`=reason/note),
  le tout dans **une transaction**. `isTargetTechnicianActiveAndAvailable` = `false` ici (ASSIGN → P5).
- **Commentaires** : `visibility = INTERNAL` réservé à `ADMIN`/`TECHNICIAN` ; un `CLIENT` qui tente
  `INTERNAL` → forcé `PUBLIC` ou 403 (défaut : **403**, plus explicite). En lecture, la couche
  service **exclut les `INTERNAL` pour un `CLIENT`** (règle `data-model.md`). Tri du fil :
  `createdAt ASC` (chronologique), pagination via `PaginationQueryDto` réutilisé tel quel.
- **Pièces jointes** : `POST` passe le buffer à `StorageService.upload` (valide MIME/taille → 413/415),
  puis crée la ligne `attachments` (`ticketId`, `bucket`, `storageKey`, `originalName`, `mimeType`,
  `sizeBytes`, `uploadedById`). `GET` renvoie chaque pièce avec une URL présignée
  (`StorageService.getPresignedDownloadUrl`). `DELETE` : auteur (`uploadedById`) ou `ADMIN` ; soft
  delete de la ligne (le binaire S3 n'est pas supprimé en P4 — nettoyage différé).

### Décisions complémentaires figées pour T4.5 / T4.6 (2026-08-06)

| # | Décision | Motif |
|---|---|---|
| D1 | **T4.5 vit dans un module dédié `src/modules/ticket-comments/`** (`TicketCommentsModule`), pas dans `TicketsModule`. `tickets.module.ts`, `tickets.controller.ts`, `tickets.service.ts` restent **intouchés**. | Symétrie avec `src/modules/attachments/` (T4.6) et périmètres strictement disjoints → T4.5 et T4.6 réellement parallélisables. |
| D2 | **Aucune nouvelle dépendance.** `@types/multer` est absent et `multer@2.2.0` n'embarque pas ses types : le fichier uploadé est typé par une **interface locale** `MulterFileLike { buffer: Buffer; mimetype: string; originalname: string; size: number }` déclarée dans `src/modules/attachments/`. `Express.Multer.File` est **interdit**. | Éviter une dépendance de typage pour 4 champs. |
| D3 | `AttachmentResponseDto.sizeBytes` est un **`number`** (`Number(entity.sizeBytes)`). | `sizeBytes` est un `bigint` PG rendu en `string` par le driver : détail d'infrastructure à ne pas exposer dans l'API. |
| D4 | `keyPrefix` d'upload = `` `tickets/${ticketId}/attachments` ``. `Attachment.commentId` reste **`null`** en P4 (pas d'endpoint d'upload sous un commentaire) ; la contrainte `CHECK` est satisfaite par `ticketId`. | Conforme au commentaire de `UploadInput` ; l'upload sous commentaire est hors périmètre P4. |
| D5 | `DELETE /tickets/:id/attachments/:attId` : `OwnershipGuard` couvre la visibilité du **ticket** (il ne lit que `params.id`) ; la règle **auteur (`uploadedById === user.id`) ou `ADMIN`** est appliquée dans le **service** → `403` sinon, `404` si la pièce jointe n'existe pas ou n'appartient pas au ticket. | Le guard n'est pas conçu pour `:attId` ; même découpage que la règle `PATCH` du ticket. |
| D6 | `TicketComment` et `Attachment` sont enregistrés en `TypeOrmModule.forFeature` **dans leurs modules respectifs** (avec `Ticket`, requis par `OwnershipGuard`). `TicketsModule` n'est pas modifié. | Corollaire de D1 ; `forFeature` sur la même entité depuis plusieurs modules est supporté. |
| D7 | Câblage dans `app.module.ts` : **orchestrateur uniquement** (T4.0-bis). `app.module.ts` reste hors périmètre agent (§8). **Livré** : seuls `TicketCommentsModule` et `AttachmentsModule` sont ajoutés aux `imports`. `StorageModule` n'y figure **pas** (il est importé par `AttachmentsModule`, son unique consommateur) et `storageConfig` n'est **pas** ajouté au `load: [...]` global (`StorageModule` le charge déjà via `ConfigModule.forFeature`) — ces deux ajouts auraient été des doubles déclarations sans effet. | Éviter une déclaration redondante du même module et de la même config à deux endroits. |

## 5. DTO — signatures figées

```ts
// create-ticket.dto.ts
class CreateTicketDto {
  @IsString() @Length(3, 150) title: string;
  @IsString() @Length(1, 5000) description: string;
  @IsEnum(TicketPriority) @IsOptional() priority?: TicketPriority;   // défaut NORMAL si absent
  @IsUUID() categoryId: string;
  @IsString() @IsOptional() @MaxLength(150) siteLabel?: string;
  @IsString() @IsOptional() @MaxLength(2000) siteAddress?: string;
}

// update-ticket.dto.ts — tous optionnels, au moins un requis (validé service)
class UpdateTicketDto {
  @IsString() @IsOptional() @Length(3,150) title?: string;
  @IsString() @IsOptional() @Length(1,5000) description?: string;
  @IsEnum(TicketPriority) @IsOptional() priority?: TicketPriority;
  @IsUUID() @IsOptional() categoryId?: string;
  @IsString() @IsOptional() @MaxLength(150) siteLabel?: string;
  @IsString() @IsOptional() @MaxLength(2000) siteAddress?: string;
}

// ticket-query.dto.ts extends PaginationQueryDto
class TicketQueryDto extends PaginationQueryDto {
  @IsEnum(TicketStatus) @IsOptional() status?: TicketStatus;
  @IsEnum(TicketPriority) @IsOptional() priority?: TicketPriority;
  @IsUUID() @IsOptional() categoryId?: string;
  @IsUUID() @IsOptional() assigneeId?: string;    // honoré ADMIN seulement
  @IsUUID() @IsOptional() createdById?: string;    // honoré ADMIN seulement
  @IsString() @IsOptional() @MaxLength(100) q?: string;   // recherche title + reference
  @IsIn(['createdAt','priority','slaDueAt','status']) @IsOptional() sort?: string; // défaut createdAt
  @IsIn(['ASC','DESC']) @IsOptional() order?: 'ASC'|'DESC';   // défaut DESC
}

// resolve-ticket.dto.ts
class ResolveTicketDto { @IsString() @Length(1,2000) resolutionNote: string; }
// reason.dto.ts (reopen requis / cancel optionnel — le service impose hasReason selon P3)
class ReasonDto { @IsString() @IsOptional() @Length(1,1000) reason?: string; }

// create-comment.dto.ts
class CreateCommentDto {
  @IsString() @Length(1,5000) body: string;
  @IsEnum(CommentVisibility) @IsOptional() visibility?: CommentVisibility; // défaut PUBLIC
}
```

### DTO de réponse (`fromEntity`)

- `TicketResponseDto` : `id, reference, title, description, status, priority, category {id,name},
  createdBy {id,username,firstName,lastName}, assignee {id,username,firstName,lastName}|null,
  siteLabel, siteAddress, slaDueAt, assignedAt, startedAt, resolvedAt, closedAt, cancelledAt,
  resolutionNote, createdAt, updatedAt`. **Jamais** `password`, `deletedAt`.
- `TicketListItemDto` : sous-ensemble léger pour la liste — `id, reference, title, status, priority,
  category {id,name}, assignee {id,username}|null, slaDueAt, createdAt`.
- `UserSummaryDto` : `{ id, username, firstName, lastName }` — DTO imbriqué réutilisable (owner/assigné).
- `CommentResponseDto` : `id, body, visibility, author {id,username}|null, createdAt`.
- `AttachmentResponseDto` : `id, originalName, mimeType, sizeBytes, createdAt, downloadUrl` (présignée,
  non persistée). `sizeBytes` est un `number` (cf. D3) ; `downloadUrl` est un `string | null`
  (`null` si la génération d'URL présignée échoue — la liste ne doit pas casser pour autant).

## 6. Calcul du SLA à la création

À la création d'un ticket : chercher `SlaPolicy WHERE priority = ticket.priority`. Si trouvée :
`slaDueAt = createdAt + resolutionTargetMinutes minutes`. Si absente : `slaDueAt = null` + log
d'avertissement (pas d'erreur bloquante). `reference` n'est jamais fixé par le code (séquence PG).

## 7. Découpage en tâches atomiques (pour délégation ultérieure)

| Tâche | Contenu | Périmètre (nouveaux fichiers) | Dépend |
|---|---|---|---|
| **T4.0** (orchestrateur) | Câbler `TicketsModule` (+ modules référentiels nécessaires) dans `app.module.ts`, wiring `StorageModule` | `app.module.ts` | — |
| **T4.1** | `TicketsModule` + `TicketsService` (create, getById, calcul SLA) + `OwnershipGuard` + `TicketResponseDto`/`UserSummaryDto` + `CreateTicketDto` + `POST /tickets`, `GET /tickets/:id` + RBAC | `src/modules/tickets/*` (module, service, controller, guards/, dto/) | T4.0 |
| **T4.2** | `GET /tickets` : `TicketQueryDto`, scoping RBAC, filtres, pagination, `TicketListItemDto` | dto/ + service/controller (méthode `list`) | T4.1 |
| **T4.3** | `PATCH /tickets/:id` (règles), `DELETE` soft delete, `UpdateTicketDto` | dto/ + service/controller | T4.1 |
| **T4.4** | Transitions START/RESOLVE/REOPEN/CLOSE/CANCEL : endpoints + `ResolveTicketDto`/`ReasonDto`, appel évaluateur P3, écriture `ticket_status_history`, transactions | dto/ + service/controller (méthode `transition`) | T4.1, P3 |
| **T4.5** | Commentaires : `CreateCommentDto`/`CommentResponseDto`, filtrage INTERNAL, endpoints | `src/modules/ticket-comments/*` (module, service, controller, dto/) — cf. D1 | T4.1 |
| **T4.6** | Pièces jointes : upload/list/download via `StorageService`, `AttachmentResponseDto`, `AttachmentsModule` | `src/modules/attachments/*` | T4.1, T2.3 |
| **T4.0-bis** (orchestrateur) | Câbler `TicketCommentsModule`, `AttachmentsModule`, `StorageModule` + `storageConfig` dans `app.module.ts` | `src/app.module.ts` | T4.5, T4.6 |

**Dépendances / parallélisme** : T4.0 puis T4.1 en séquence (fondation). Ensuite T4.2, T4.3, T4.4,
T4.5, T4.6 dépendent toutes de T4.1 mais sont **disjointes entre elles** (fichiers DTO/méthodes
distincts) → parallélisables par vagues de 2, en évitant les collisions sur `tickets.service.ts` et
`tickets.controller.ts` (les tâches qui y ajoutent des méthodes seront séquencées ou découpées en
services dédiés — `TicketLifecycleService`, `TicketCommentsService` — pour rester disjointes).

**Tests** : chaque tâche livre ses tests (unitaires service + guard ; e2e par rôle pour les chemins
critiques d'accès croisé — un CLIENT ne lit pas le ticket d'un autre, un TECHNICIAN non assigné est
bloqué, un INTERNAL n'apparaît pas pour un CLIENT). Relecture par mutation exigée.

## 8. Garde-fous P4

- Aucune entité, enum, migration ou `data-model.md` modifié : le schéma est figé (P1). Si un besoin
  de schéma émerge → escalade orchestrateur (nouvelle migration, hors périmètre agent).
- Aucune règle de transition réécrite : tout passe par `evaluateTicketTransition` (P3).
- Aucune nouvelle dépendance sans aval (multipart via `@nestjs/platform-express`/multer déjà présent).
- `app.module.ts` (bootstrap partagé) : modifié uniquement par l'orchestrateur (T4.0).
