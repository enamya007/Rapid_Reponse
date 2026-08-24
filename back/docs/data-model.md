# Contrat — Modèle de données

Autorité unique sur le schéma de base. Toute divergence entre une entité TypeORM et ce
document est un bug de l'entité, pas du document.

Conventions :

- Clés primaires `uuid`, générées par `uuid_generate_v4()` (extension `uuid-ossp` déjà activée).
- Colonnes en `snake_case` en base, propriétés en `camelCase` en TypeScript.
- Horodatages en `timestamptz`.
- Soft delete : colonne `deleted_at` nullable + `@DeleteDateColumn` de TypeORM.
- Enums PostgreSQL natifs, nommés explicitement via `enumName`.

---

## 1. Enums

| Enum PG | Valeurs |
|---|---|
| `user_role_enum` | `ADMIN`, `TECHNICIAN`, `CLIENT` |
| `ticket_status_enum` | `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `RESOLVED`, `CLOSED`, `CANCELLED` |
| `ticket_priority_enum` | `LOW`, `NORMAL`, `HIGH`, `CRITICAL` |
| `comment_visibility_enum` | `PUBLIC`, `INTERNAL` |
| `notification_type_enum` | `TICKET_CREATED`, `TICKET_ASSIGNED`, `TICKET_STATUS_CHANGED`, `TICKET_COMMENTED`, `TICKET_SLA_BREACHED` |

`user_role_enum` existe déjà avec les valeurs `ADMIN` / `USER`. Migration : ajout de
`TECHNICIAN` et `CLIENT`, remap `USER` → `CLIENT`, suppression de `USER`.

---

## 2. Tables

### 2.1 `users` *(existante — modifiée)*

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `username` | varchar(50) | unique, non null |
| `email` | varchar(255) | unique, non null |
| `password` | varchar(255) | non null, `select: false` |
| `first_name` | varchar(80) | nullable |
| `last_name` | varchar(80) | nullable |
| `phone` | varchar(30) | nullable |
| `role` | `user_role_enum` | défaut `CLIENT` |
| `is_active` | boolean | défaut `true` |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz | nullable *(nouveau)* |

Le défaut passe de `USER` à `CLIENT`. Un compte désactivé (`is_active = false`) est conservé
pour la traçabilité — jamais supprimé physiquement.

### 2.2 `technician_profiles`

Un technicien a des attributs qu'un client n'a pas. Table séparée plutôt que colonnes
nullables sur `users`.

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | unique, FK `users` ON DELETE CASCADE |
| `is_available` | boolean | défaut `true` |
| `max_concurrent_tickets` | int | défaut 5 |
| `created_at` / `updated_at` | timestamptz | |

### 2.3 `skills`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `name` | varchar(80) | unique, non null |
| `description` | text | nullable |
| `created_at` / `updated_at` | timestamptz | |

### 2.4 `technician_skills` *(jointure many-to-many)*

| Colonne | Type | Contraintes |
|---|---|---|
| `technician_profile_id` | uuid | FK CASCADE, PK composite |
| `skill_id` | uuid | FK CASCADE, PK composite |
| `level` | smallint | 1 à 5, défaut 3 — alimente le score de suggestion |

### 2.5 `categories`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `name` | varchar(80) | unique, non null |
| `description` | text | nullable |
| `required_skill_id` | uuid | nullable, FK `skills` ON DELETE SET NULL |
| `is_active` | boolean | défaut `true` |
| `created_at` / `updated_at` | timestamptz | |

`required_skill_id` est le pivot de la suggestion automatique : catégorie → compétence
requise → techniciens la possédant.

### 2.6 `sla_policies`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `priority` | `ticket_priority_enum` | **unique** |
| `resolution_target_minutes` | int | non null |
| `created_at` / `updated_at` | timestamptz | |

Seed : `CRITICAL` 240 · `HIGH` 1440 · `NORMAL` 4320 · `LOW` 7200.

### 2.7 `tickets`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `reference` | varchar(20) | unique — format `TCK-000123`, séquence PG |
| `title` | varchar(150) | non null |
| `description` | text | non null |
| `status` | `ticket_status_enum` | défaut `OPEN` |
| `priority` | `ticket_priority_enum` | défaut `NORMAL` |
| `category_id` | uuid | FK `categories` ON DELETE RESTRICT |
| `created_by_id` | uuid | FK `users` ON DELETE RESTRICT |
| `assignee_id` | uuid | nullable, FK `users` ON DELETE SET NULL |
| `site_label` | varchar(150) | nullable |
| `site_address` | text | nullable |
| `sla_due_at` | timestamptz | nullable — calculé à la création |
| `assigned_at` | timestamptz | nullable |
| `started_at` | timestamptz | nullable |
| `resolved_at` | timestamptz | nullable |
| `closed_at` | timestamptz | nullable |
| `cancelled_at` | timestamptz | nullable |
| `resolution_note` | text | nullable |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz | nullable |

`assignee_id` est une dénormalisation volontaire du technicien courant : elle évite une
jointure sur `ticket_assignments` pour le filtre le plus fréquent de l'application.
`ticket_assignments` reste la source de vérité de l'historique.

Les cinq horodatages de transition sont ce qui rend les statistiques de délai calculables
sans rejouer l'historique.

Index : `status`, `assignee_id`, `created_by_id`, `priority`, `created_at`, `sla_due_at`,
plus un index partiel `WHERE deleted_at IS NULL`.

### 2.8 `ticket_status_history`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `ticket_id` | uuid | FK CASCADE |
| `from_status` | `ticket_status_enum` | nullable — `null` à la création |
| `to_status` | `ticket_status_enum` | non null |
| `changed_by_id` | uuid | nullable, FK `users` ON DELETE SET NULL |
| `note` | text | nullable |
| `created_at` | timestamptz | |

Index : `(ticket_id, created_at)`.

### 2.9 `ticket_assignments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `ticket_id` | uuid | FK CASCADE |
| `technician_id` | uuid | FK `users` ON DELETE RESTRICT |
| `assigned_by_id` | uuid | nullable, FK `users` ON DELETE SET NULL |
| `reason` | text | nullable — obligatoire côté service en cas de réaffectation |
| `is_auto_suggested` | boolean | défaut `false` |
| `assigned_at` | timestamptz | |
| `unassigned_at` | timestamptz | nullable |

Index : `(ticket_id, assigned_at)`, `technician_id`.

### 2.10 `ticket_comments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `ticket_id` | uuid | FK CASCADE |
| `author_id` | uuid | nullable, FK `users` ON DELETE SET NULL |
| `body` | text | non null |
| `visibility` | `comment_visibility_enum` | défaut `PUBLIC` |
| `created_at` / `updated_at` | timestamptz | |
| `deleted_at` | timestamptz | nullable |

Un commentaire `INTERNAL` n'est jamais renvoyé à un `CLIENT`. Le filtrage se fait dans la
couche service, pas dans le contrôleur.

### 2.11 `attachments`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `ticket_id` | uuid | nullable, FK CASCADE |
| `comment_id` | uuid | nullable, FK `ticket_comments` CASCADE |
| `uploaded_by_id` | uuid | nullable, FK `users` ON DELETE SET NULL |
| `bucket` | varchar(100) | non null |
| `storage_key` | varchar(500) | non null |
| `original_name` | varchar(255) | non null |
| `mime_type` | varchar(120) | non null |
| `size_bytes` | bigint | non null |
| `checksum` | varchar(64) | nullable |
| `created_at` | timestamptz | |
| `deleted_at` | timestamptz | nullable |

Contrainte `CHECK (ticket_id IS NOT NULL OR comment_id IS NOT NULL)`.
Le binaire vit dans MinIO/S3 ; la base ne stocke que la référence.

### 2.12 `notifications`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `recipient_id` | uuid | FK `users` ON DELETE CASCADE |
| `type` | `notification_type_enum` | non null |
| `ticket_id` | uuid | nullable, FK `tickets` ON DELETE CASCADE |
| `title` | varchar(150) | non null |
| `body` | text | non null |
| `payload` | jsonb | nullable |
| `read_at` | timestamptz | nullable |
| `created_at` | timestamptz | |

Index : `(recipient_id, read_at)`, `(recipient_id, created_at)`.

### 2.13 `password_reset_tokens`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `user_id` | uuid | FK CASCADE |
| `token_hash` | varchar(255) | non null — jamais le token en clair |
| `expires_at` | timestamptz | non null — création + 1 h |
| `used_at` | timestamptz | nullable — usage unique |
| `created_at` | timestamptz | |

### 2.14 `audit_logs`

| Colonne | Type | Contraintes |
|---|---|---|
| `id` | uuid | PK |
| `actor_id` | uuid | nullable, FK `users` ON DELETE SET NULL |
| `action` | varchar(80) | non null |
| `entity_type` | varchar(60) | nullable |
| `entity_id` | uuid | nullable |
| `ip_address` | inet | nullable |
| `user_agent` | varchar(300) | nullable |
| `metadata` | jsonb | nullable |
| `created_at` | timestamptz | |

Actions journalisées : `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_RESET_REQUESTED`,
`PASSWORD_RESET_COMPLETED`, `ROLE_CHANGED`, `USER_DEACTIVATED`, `TICKET_DELETED`,
`TICKET_REASSIGNED`, `PERSONAL_DATA_EXPORTED`, `PERSONAL_DATA_ANONYMIZED`.

Index : `(actor_id, created_at)`, `(action, created_at)`.

### 2.15 `refresh_tokens` *(existante — inchangée)*

---

## 3. Relations

```
users 1──1  technician_profiles ──M2M(technician_skills)── skills
users 1──N  tickets (created_by)          skills 1──N categories (required_skill)
users 1──N  tickets (assignee)            categories 1──N tickets
users 1──N  notifications                 sla_policies 1──1 priority
users 1──N  refresh_tokens
users 1──N  password_reset_tokens
users 1──N  audit_logs (actor)

tickets 1──N ticket_status_history
tickets 1──N ticket_assignments
tickets 1──N ticket_comments ──1──N attachments
tickets 1──N attachments
tickets 1──N notifications
```

---

## 4. Découpage des migrations

| Ordre | Migration | Contenu |
|---|---|---|
| 1 | `AlignUserRoles` | Enum 3 rôles + remap `USER` → `CLIENT`, colonnes `first_name`, `last_name`, `phone`, `deleted_at` sur `users` |
| 2 | `TicketDomain` | Enums ticket, séquence `reference`, et les 12 tables du domaine |

Chaque migration doit avoir un `down()` réellement réversible, testé par
`migration:run` puis `migration:revert` sur base vierge.
