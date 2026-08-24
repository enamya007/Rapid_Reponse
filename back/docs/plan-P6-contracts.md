# P6 — Événements & notifications : contrat figé

> Figé par l'orchestrateur le 2026-08-07, avant toute délégation. Les sous-agents **consomment**
> ce document, ils ne le modifient pas. Toute déviation constatée en validation est un échec.

## 0. Périmètre

**Inclus** : bus d'événements interne (`@nestjs/event-emitter`), file d'attente BullMQ + Redis,
envoi d'emails Nodemailer, notifications in-app persistées + API REST, gateway WebSocket,
réinitialisation de mot de passe par email.

**Exclu (→ phases ultérieures)** :

- Notifications de dépassement SLA. La valeur `NotificationType.TICKET_SLA_BREACHED` existe déjà
  dans l'enum et la base, mais **rien ne peut la déclencher** : il n'y a pas de planificateur dans
  le projet (`@nestjs/schedule` n'est pas installé, et n'est **pas** dans les dépendances validées).
  Aucun agent ne doit tenter de la produire. → P7.
- Adapter Redis pour socket.io (`@socket.io/redis-adapter`) : utile en multi-instance uniquement,
  différé par décision utilisateur du 2026-08-07.
- Préférences de notification par utilisateur, emails de digest, canal SMS.
- Toute agrégation statistique (→ P7).

### Ce que la reconnaissance du 2026-08-07 a établi

Fait déterminant : **la table `notifications` et la table `password_reset_tokens` existent déjà
en base**, créées par la migration `1785254838687-TicketDomain`, avec leurs index
(`IDX_notifications_recipient_read`, `IDX_notifications_recipient_created`) et leurs clés
étrangères. Les entités `Notification` et `PasswordResetToken` sont écrites. Ce qui manque est
exclusivement la couche applicative : aucun module, service, controller, listener, ni repository
injecté.

**Conséquence contractuelle : P6 ne génère AUCUNE migration.** C'est une bonne nouvelle et une
interdiction stricte — `pnpm typeorm migration:generate` est la seule commande qui se bloque
indéfiniment dans cet environnement. Un agent qui croit avoir besoin d'une migration se trompe et
doit escalader à l'orchestrateur.

## 1. Conventions héritées de P4/P5 (rappel, non négociable)

- Sérialisation sortie : DTO manuel avec `static fromEntity(...)`. Pas de
  `ClassSerializerInterceptor`, pas de `@Exclude`.
- Pagination via `toTypeOrmSkipTake` / `buildPaginatedResponse`
  (`src/common/utils/pagination.util.ts`) et `@ApiPaginatedResponse(Dto)` pour Swagger.
- `@ApiProperty` sur tout champ exposé ; `ParseUUIDPipe` sur tout param UUID.
- Sur un controller, les routes **statiques** se déclarent **avant** les routes `:id`
  (discipline P5 D10 — conservée comme défense à coût nul, pas comme correctif d'un bug réel).
- Le schéma de base est **figé** : aucune entité modifiée, aucun enum modifié, aucune migration,
  `docs/data-model.md` intouché.
- `pnpm lint` porte `--fix` et **réécrit les fichiers** : interdit aux validators et à tout agent
  travaillant en parallèle d'un autre. Utiliser `npx eslint <périmètre>` sans `--fix`.

## 2. Dépendances autorisées (décision utilisateur du 2026-08-07)

Exactement ces six, aucune autre :

```
@nestjs/event-emitter
@nestjs/bullmq   bullmq@^5
nodemailer       @types/nodemailer   (devDependency)
@nestjs/websockets   @nestjs/platform-socket.io
```

`socket.io` (**serveur**) arrive en dépendance transitive de `@nestjs/platform-socket.io` et n'est
pas installé explicitement.

### `socket.io-client` en devDependency (décision utilisateur du 2026-08-08)

Ce contrat affirmait que `socket.io-client` était « présent en transitive ». **Faux**, remonté par
l'implementer de T6.6 et vérifié trois fois : `pnpm why socket.io-client` muet, zéro occurrence
dans `pnpm-lock.yaml`, et `node_modules/.pnpm` ne contient que la pile **serveur**
(`socket.io@4.8.3`, `socket.io-adapter`, `socket.io-parser`, `engine.io`) — jamais
`socket.io-client` ni `engine.io-client`. `@nestjs/platform-socket.io` ne dépend que du serveur.

Sans client, le e2e de la gateway est impossible à écrire, et c'est **lui** qui devait prouver
l'invariant de sécurité : *un second client authentifié ne reçoit pas les notifications du
premier*. Un mock ne peut pas le prouver — un broadcast global à la place d'un envoi ciblé passerait
inaperçu.

**Décision : `socket.io-client` ajouté en `devDependency`.** Jamais expédié en production, utilisé
uniquement dans `test/*.e2e-spec.ts` — exactement le statut de `supertest`, déjà présent pour les
e2e HTTP.

`socket.io` (serveur) **n'est pas** ajouté explicitement. Conséquence connue et assumée : sous pnpm
en mode strict, `import type { Socket, Namespace } from 'socket.io'` depuis `src/` lève `TS2307`,
parce que les paquets transitifs ne sont pas exposés à l'import direct. La gateway décrit donc le
sous-ensemble d'API qu'elle utilise via des interfaces structurelles locales, vérifiées contre les
vraies définitions de `socket.io`. Sans dépendance ajoutée, et sans `any`.

### Pourquoi `bullmq` est épinglé sur `^5` (correction du 2026-08-07)

Ce contrat affirmait initialement « `ioredis` arrive en transitive de `bullmq` », **sans version
épinglée**. C'était faux et l'implementer de T6.0a l'a remonté au lieu de le contourner :

- `pnpm add bullmq` résout `bullmq@6.0.9`, et `@nestjs/bullmq@11.0.5` l'accepte
  (`^3 || ^4 || ^5 || ^6`).
- Depuis le majeur 6, `bullmq` est multi-backend (ioredis, node-redis, Postgres) et `ioredis`
  est passée de **dépendance dure** à **peer dependency optionnelle**. Elle n'est donc plus
  installée du tout.
- Conséquence : `AppModule` — et par extension l'application entière — crashe au chargement sur
  `Cannot find module 'ioredis'`. Ni `pnpm build` (tsc ne résout pas les imports runtime) ni
  `pnpm test` (aucun spec n'importe `app.module.ts`) ne le détectent. **Seul le démarrage réel le
  révèle** : c'est ce qui justifie l'exigence d'un e2e de boot dans le brief de toute tâche
  touchant `AppModule`.

Deux corrections possibles : ajouter `ioredis` en 8ᵉ dépendance directe, ou épingler `bullmq` sur
`^5`. **Décision : `^5`**, pour trois raisons.

1. Elle **n'ajoute aucun package** : le jeu de dépendances validé par l'utilisateur le 2026-08-07
   reste inchangé. `bullmq@5` embarque `ioredis` comme dépendance dure.
2. `5.81.3` a 81 versions mineures de durcissement derrière elle, contre 9 patches pour `6.0.x`.
   Or le changement structurant de v6 est précisément la refonte de la couche de connexion — le
   sous-système que §10 identifie déjà comme le risque principal des e2e (connexion Redis non
   refermée, `jest` qui ne rend pas la main). Prendre un majeur neuf sur exactement ce point est
   le mauvais pari.
3. `@nestjs/bullmq@11` et les exemples de l'écosystème NestJS sont écrits contre v5.

Coût assumé : le projet n'est pas sur le `latest` de `bullmq`. Réversible d'une ligne quand v6
aura mûri.

**Toute autre dépendance est interdite**, y compris — et ces refus sont délibérés :

| Package écarté | Pourquoi |
|---|---|
| `handlebars`, `pug`, `@nestjs-modules/mailer` | Les templates d'email sont des **fonctions TypeScript** rendant `{ subject, text, html }`. Typées, testables unitairement sans I/O, zéro moteur de rendu à sécuriser (pas de surface d'injection de template). |
| `@nestjs/schedule` | Rien à planifier dans P6 (voir §0, SLA hors périmètre). |
| `@socket.io/redis-adapter` | Différé, mono-instance. |
| `cache-manager`, `ioredis` en direct | Redis n'est utilisé que par BullMQ dans P6. |

## 3. Décisions figées

| # | Décision | Justification |
|---|---|---|
| **D1** | **Émission strictement après commit.** Un événement n'est jamais émis à l'intérieur d'un `manager.transaction(...)`. Dans `TicketsService.applyTransition` et `TicketsService.assign`, l'émission se fait dans le corps de la méthode, **après** le retour de la transaction et **après** le rechargement de l'entité. | Un listener persiste une notification et lit le ticket : émettre avant le COMMIT expose à lire un état non encore visible, ou à notifier un changement qui sera annulé par un rollback. |
| **D2** | **Pas de pattern outbox.** Dette assumée : si le process meurt entre le COMMIT et l'émission, l'événement est perdu. | Un outbox transactionnel (table + relais) coûte une migration, un poller et une gestion d'idempotence. Disproportionné à l'échelle du projet, et P6 n'a droit à aucune migration (§0). Le risque est une notification manquée, pas une incohérence de données. **Consigné comme dette dans le handoff.** |
| **D3** | **Un listener ne remonte jamais d'exception.** Le corps de chaque `@OnEvent` est intégralement enveloppé dans un `try/catch` qui journalise via Pino (`logger.error`) et retourne. | `EventEmitter2` appelle les listeners **de façon synchrone dans la pile d'appel de l'émetteur**. Un listener qui jette ferait échouer la requête HTTP métier qui a réussi. Une notification perdue ne doit jamais annuler une création de ticket réussie. |
| **D4** | **Le listener fait deux choses seulement : écrire les lignes `notifications` et enfiler les jobs email.** Aucun envoi SMTP, aucun rendu de template lourd, aucun appel réseau dans le chemin HTTP. | L'INSERT est rapide et donne au client une lecture immédiate après écriture. Le SMTP est lent et faillible : sa place est la file. |
| **D5** | **Le job BullMQ transporte le message DÉJÀ rendu** (`{ to, subject, text, html }`), pas des identifiants à re-résoudre. | Le worker n'accède ni à la base ni aux templates : il ne fait que du SMTP. Testable trivialement, insensible à une donnée qui changerait entre l'enfilement et la consommation, et un job rejoué envoie exactement le mail d'origine. |
| **D6** | **La charge utile de `ticket.commented` ne contient JAMAIS le corps du commentaire**, et le `body` de la notification produite non plus. La notification dit « Nouveau commentaire sur TCK-000123 », rien de plus. | Supprime par construction toute possibilité de fuite d'un commentaire `INTERNAL` vers un CLIENT, par notification in-app, par email ou par WebSocket. La confidentialité ne dépend alors plus d'un filtre correct, mais de l'absence de la donnée. |
| **D7** | **Filtre CLIENT dur sur les commentaires internes.** Pour `visibility === INTERNAL`, tout destinataire dont le `role` est `CLIENT` est retiré de la liste, **après** toute autre règle de destinataires. | Invariant de sécurité, formulé sur le rôle et non sur « le créateur du ticket », pour rester vrai même si un ADMIN crée un ticket au nom d'un client. Cible de mutation obligatoire (§9). |
| **D8** | **L'acteur n'est jamais destinataire de sa propre action.** Filtre appliqué à tous les événements. | — |
| **D9** | **`MAIL_SANDBOX_TO` est enfin honoré.** Quand elle est définie, `MailService` remplace le destinataire réel par cette adresse et ajoute l'en-tête `X-Original-To: <destinataire réel>`. La substitution a lieu dans `MailService`, **au plus près du transport**, pas chez l'appelant. | La variable existe et est validée depuis P1 sans aucun consommateur. Placer la garde au transport garantit qu'aucun chemin d'appel ne peut la contourner. |
| **D10** | **L'authentification SMTP est omise quand `MAIL_USERNAME` vaut la chaîne vide.** `MailService` ne passe l'option `auth` à Nodemailer que si `username` est non vide. | Mailpit n'exige aucune authentification et **rejette** une tentative d'AUTH. `@IsString()` accepte la chaîne vide, donc la validation d'environnement n'a pas besoin de bouger. |
| **D11** | **Le token de reset suit le pattern déjà établi pour les refresh tokens** : la valeur envoyée par email est `<id de ligne>.<secret>`, seul le **secret** est haché en argon2id dans `token_hash`. La recherche se fait par `id`, puis `verifyPassword(tokenHash, secret)`. | Un hash argon2 n'est pas interrogeable en base. `AuthService.issueTokenPair` résout déjà exactement ce problème avec le `jti`. Reproduire le pattern maison plutôt qu'en inventer un second. |
| **D12** | **Toutes les issues d'échec de `POST /auth/reset-password` renvoient le même `400`** avec le message `Invalid or expired token` : token malformé, ligne inexistante, déjà utilisée, expirée, secret invalide, compte désactivé. | Ne rien révéler sur l'existence ou l'état d'un token. |
| **D13** | **`POST /auth/forgot-password` renvoie toujours `202`**, avec le même corps, que l'email existe ou non. Il est décoré `@StrictLoginThrottle()`. | Anti-énumération de comptes. La réutilisation du throttler `login` existant partage volontairement son compteur : les deux routes sont des surfaces d'abus d'authentification, et cela n'ajoute aucune configuration. |
| **D13-bis** | **L'indistinguabilité de `forgot-password` doit aussi valoir dans le TEMPS.** La branche qui n'émet pas de token exécute un hash argon2 factice de coût comparable, exactement comme `login()` le fait déjà avec `DUMMY_PASSWORD_HASH`. | Ajouté le 2026-08-08, sur constat d'un validator. D13 tel qu'écrit ne parlait que du corps et du code de réponse — et il était respecté. Mais la branche « compte connu et actif » exécutait un `hashPassword` argon2id (`memoryCost: 19456`, `timeCost: 2`), deux écritures et un enqueue Redis, quand la branche « inconnu ou inactif » retournait après un seul `SELECT`. **Un écart de temps mesurable est un oracle d'existence de compte**, ce qui vide D13 de son objet. Le projet neutralise déjà ce canal sur `login()` : la même route d'authentification, deux traitements différents, c'est l'incohérence qui rend le défaut visible. Le throttler à 5 req/min limite l'exploitation depuis une IP, il ne l'élimine pas. |
| **D14** | **Un reset réussi révoque tous les refresh tokens actifs de l'utilisateur**, et l'écriture (mot de passe + `usedAt` + révocation) se fait dans **une seule transaction**. Émettre un nouveau token de reset marque `usedAt` sur tous les tokens non utilisés du même utilisateur. | Un mot de passe changé doit invalider les sessions ouvertes, sinon un attaquant déjà connecté survit au reset. Un seul token de reset vivant à la fois. |
| **D15** | **La politique de mot de passe devient un décorateur partagé unique**, `@IsStrongPassword()` dans `src/common/validation/strong-password.decorator.ts`, consommé par `RegisterDto`, `CreateTechnicianDto` **et** `ResetPasswordDto`. | Rejouer la politique une troisième fois à la main est exactement ce qui a produit le défaut de P5 (technicien à `Length(8,72)` sans complexité, plus faible qu'un client). La règle doit avoir un seul point de vérité. Décision d'orchestrateur : le contrat partagé change, et c'est moi qui le change. |
| **D16** | **Le scoping des notifications n'a aucune dérogation ADMIN** : toute lecture et toute écriture filtre sur `recipientId = currentUser.id`. | Une notification est un objet personnel, pas une ressource métier. Un ADMIN n'a pas à lire la boîte d'un autre. |
| **D21** | **Contrat de la gateway WebSocket.** Namespace `/notifications`. Authentification **au handshake** : token d'accès lu dans `handshake.auth.token` (chemin principal) ou dans l'en-tête `Authorization: Bearer`, vérifié avec `jwtConfig.accessSecret`. Succès → le socket rejoint la room `user:<sub>`. Échec, quelle qu'en soit la cause → `disconnect(true)`, sans mode dégradé. Événement serveur → client `notification.created`, portant **exactement** le `NotificationResponseDto` renvoyé par l'API REST. **Aucun** événement client → serveur. Aucun adapter Redis. | Numérotée le 2026-08-08, après coup. Ce comportement était décrit dans les briefs mais n'avait **jamais reçu de numéro** dans ce document : le code livré citait « P6 contract D10 », or D10 désigne ici l'authentification SMTP. Une citation qui pointe ailleurs induit en erreur avec l'autorité d'un document figé. **La room est l'invariant de sécurité** : un `emit` global laisserait tout client authentifié lire les notifications des autres, quoi que fasse le front. Une seule forme de notification (le DTO du REST) évite au front d'en gérer deux. L'en-tête `Authorization` a été **prouvé au niveau transport**, sur polling et websocket — les en-têtes ne survivent pas toujours au transport comme on l'imagine. |
| **D17** | **La gateway WebSocket ne connaît pas `NotificationsService`.** `NotificationsService` émet un événement interne `notification.created` ; la gateway s'y abonne. | Découple T6.4 et T6.6 : périmètres disjoints, parallélisables, et le module reste fonctionnel si la gateway est retirée. |
| **D18** | **`parseBooleanQuery` est promu en utilitaire partagé** : `src/common/utils/parse-boolean-query.util.ts`, avec son commentaire d'origine. `TechnicianQueryDto` l'importe désormais au lieu de le déclarer. | Le piège `enableImplicitConversion` (`Boolean('false') === true`) se reproduira sur `?unreadOnly=false`. La solution est déjà écrite et prouvée par `test/technicians.e2e-spec.ts` : elle doit être réutilisée, pas recopiée. |
| **D20** | **Tout `Worker` BullMQ doit avoir un gestionnaire d'événement `error`.** `MailProcessor` déclare `@OnWorkerEvent('error')` (et `'failed'` pour l'observabilité). C'est du code de production, corrigé pour une raison de production. | Voir ci-dessous : diagnostic établi le 2026-08-07, après une première hypothèse **fausse** de l'orchestrateur. |
| **D19** | **`APP_FRONTEND_URL` est optionnelle**, valeur de repli `http://localhost:3000`, avec un **avertissement journalisé une fois au démarrage** quand le repli s'applique. | La rendre obligatoire casserait le démarrage de tous les `.env` locaux existants, y compris pendant les e2e. La rendre silencieuse produirait des liens de reset cassés sans signal. |

## 4. Contrat des événements

Emplacement : `src/common/events/ticket-events.ts` et `src/common/events/notification-events.ts`.
Volontairement dans `common/` et non dans un module : l'émetteur (`TicketsModule`,
`TicketCommentsModule`) et le consommateur (`NotificationsModule`) l'importent tous deux sans
créer de dépendance entre eux.

```ts
export const TICKET_CREATED = 'ticket.created';
export const TICKET_ASSIGNED = 'ticket.assigned';
export const TICKET_STATUS_CHANGED = 'ticket.status-changed';
export const TICKET_COMMENTED = 'ticket.commented';

export interface TicketEventBase {
  ticketId: string;
  reference: string;        // 'TCK-000123'
  title: string;            // titre du ticket, jamais tronqué ici
  actorId: string;          // l'utilisateur à l'origine de l'action
  createdById: string;      // propriétaire du ticket
  assigneeId: string | null;
  occurredAt: string;       // ISO-8601, produit par l'émetteur
}

export interface TicketCreatedEvent extends TicketEventBase {}

export interface TicketAssignedEvent extends TicketEventBase {
  previousAssigneeId: string | null;
}

export interface TicketStatusChangedEvent extends TicketEventBase {
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
}

export interface TicketCommentedEvent extends TicketEventBase {
  commentId: string;
  visibility: CommentVisibility;
  authorId: string;
  // Aucun champ de contenu. Voir D6 — ce n'est pas un oubli.
}
```

```ts
export const NOTIFICATION_CREATED = 'notification.created';

export interface NotificationCreatedEvent {
  recipientId: string;
  notification: NotificationResponseDto;
}
```

### Points d'émission

Les positions sont décrites **structurellement**, sans numéro de ligne. Les numéros dérivent dès la
première modification du fichier, et un contrat qui pointe une ligne fausse envoie le prochain
agent au mauvais endroit avec l'autorité d'un document de référence.

| Événement | Émis par | Position exacte |
|---|---|---|
| `ticket.created` | `TicketsService.create` | Après le `getById` de rechargement, avant le `return`. Pas de transaction ici. |
| `ticket.assigned` | `TicketsService.assign` | **Après** le retour de `manager.transaction(...)` et après le rechargement. |
| `ticket.status-changed` | `TicketsService.applyTransition` | **Après** le retour de `manager.transaction(...)` et après le rechargement. |
| `ticket.commented` | `TicketCommentsService.create` | Après le `save` et le rechargement de l'auteur. Pas de transaction ici. |

Une affectation produit **`ticket.assigned` uniquement**, jamais aussi `ticket.status-changed`,
même si `assign()` écrit une ligne de `ticket_status_history`. Sinon toute affectation notifie deux
fois.

## 5. Matrice des destinataires

Ordre d'application : (1) liste de base, (2) retrait de l'acteur (D8), (3) filtre CLIENT si
`INTERNAL` (D7), (4) déduplication par `userId`, (5) retrait des comptes `isActive = false`.

| Événement | Destinataires in-app | Email |
|---|---|---|
| `ticket.created` | tous les ADMIN actifs | **non** (bruit : un admin reçoit chaque ticket créé) |
| `ticket.assigned` | nouveau `assigneeId`, plus `previousAssigneeId` s'il existe et diffère | **oui**, au nouvel assigné uniquement |
| `ticket.status-changed` | `createdById` + `assigneeId` | **oui**, aux deux |
| `ticket.commented` — `PUBLIC` | `createdById` + `assigneeId` | **oui** |
| `ticket.commented` — `INTERNAL` | `assigneeId` + tous les ADMIN actifs, **puis filtre CLIENT (D7)** | **non** (réduit la surface de fuite) |

Types de notification produits : `TICKET_CREATED`, `TICKET_ASSIGNED`, `TICKET_STATUS_CHANGED`,
`TICKET_COMMENTED`. `TICKET_SLA_BREACHED` n'est produit par rien (§0).

`NotificationsModule` résout rôles et emails en interrogeant `User` via
`TypeOrmModule.forFeature([Notification, User])`, en lecture seule. Il **n'importe pas**
`UsersModule` et n'ajoute aucune méthode à `UsersService` : aucun module livré en P2/P5 n'est
modifié pour ce besoin.

### Contenu des notifications

`title` ≤ 150 caractères (contrainte de colonne). `payload` jsonb reçoit les identifiants utiles
au front (`ticketId`, `reference`, et selon le type `fromStatus`/`toStatus`/`assigneeId`).

| Type | title | body |
|---|---|---|
| `TICKET_CREATED` | `Nouveau ticket TCK-000123` | `<titre du ticket>` (tronqué à 150 si besoin) |
| `TICKET_ASSIGNED` | `Ticket TCK-000123 affecté` | `Le ticket « <titre> » vous a été affecté.` |
| `TICKET_STATUS_CHANGED` | `Ticket TCK-000123 : <toStatus>` | `Statut passé de <fromStatus> à <toStatus>.` |
| `TICKET_COMMENTED` | `Nouveau commentaire sur TCK-000123` | `Un commentaire a été ajouté au ticket « <titre> ».` |

## 6. Contrat Mail

`src/modules/mail/` :

```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

class MailService {
  send(message: MailMessage): Promise<void>;   // applique D9 + D10, puis Nodemailer
}

class MailQueueService {
  enqueue(message: MailMessage): Promise<void>; // ajoute un job à la file, ne bloque jamais
}
```

Templates, un fichier par mail dans `src/modules/mail/templates/`, chacun exportant une fonction
pure `(params) => { subject, text, html }` :

- `ticketAssignedMail({ reference, title, appUrl })`
- `ticketStatusChangedMail({ reference, title, fromStatus, toStatus, appUrl })`
- `ticketCommentedMail({ reference, title, appUrl })`
- `passwordResetMail({ username, resetUrl, expiresInMinutes })`

Le `html` doit échapper toute valeur interpolée d'origine utilisateur (`title`, `username`) —
un titre de ticket contenant `<script>` ne doit pas produire de HTML actif dans le client mail.
Helper local `escapeHtml`, pas de dépendance.

### File

- Nom de file : `mail`. Nom de job : `send`.
- Options de job : `attempts: 5`, `backoff: { type: 'exponential', delay: 2000 }`,
  `removeOnComplete: true`, `removeOnFail: 500`.
- Préfixe BullMQ : `ticket-checker`. Base Redis : `REDIS_DB` (déjà en config, défaut `0`).
- Connexion BullMQ : `maxRetriesPerRequest: null` est **obligatoire** (BullMQ refuse de démarrer
  autrement avec ioredis).

## 7. Contrat REST — notifications

Toutes les routes : `@Auth()` (tous rôles authentifiés), scoping D16 sans dérogation.

| Méthode | Route | Réponse |
|---|---|---|
| `GET` | `/notifications?page&limit&unreadOnly` | `200` `{ data: NotificationResponseDto[], meta }`, tri `createdAt` DESC |
| `GET` | `/notifications/unread-count` | `200` `{ count: number }` |
| `PATCH` | `/notifications/read-all` | `204` |
| `PATCH` | `/notifications/:id/read` | `204` |

Ordre de déclaration dans le controller : `unread-count`, `read-all`, **puis** `:id/read`.

`PATCH /notifications/:id/read` renvoie **`404`** — jamais `403` — quand la notification existe
mais appartient à quelqu'un d'autre : un `403` révélerait son existence. Idempotent : une
notification déjà lue renvoie `204` sans réécrire `readAt`.

`unreadOnly` utilise `parseBooleanQuery` (D18). `?unreadOnly=false` **doit** se comporter comme
l'absence du paramètre — c'est le cas de test qui a démasqué le bug en P5.

```ts
class NotificationResponseDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown> | null;
  ticketId: string | null;
  ticketReference: string | null;   // via leftJoin sur tickets, pour le deep-link front
  readAt: string | null;            // ISO-8601
  createdAt: string;                // ISO-8601
  static fromEntity(entity: Notification): NotificationResponseDto;
}
```

## 8. Contrat REST — reset de mot de passe

| Méthode | Route | Corps | Réponse |
|---|---|---|---|
| `POST` | `/auth/forgot-password` | `{ email: string }` | **toujours** `202` `{ message: 'If the account exists, a reset link has been sent.' }` |
| `POST` | `/auth/reset-password` | `{ token: string, newPassword: string }` | `204` en succès, `400` `Invalid or expired token` sur **tout** échec (D12) |

- Routes publiques (`@Public()` / hors `@Auth()`), `@StrictLoginThrottle()` sur les deux.
- `newPassword` porte `@IsStrongPassword()` (D15) — la **même** politique que l'inscription.
- Secret : `randomBytes(32).toString('base64url')`. Token émis : `${row.id}.${secret}`.
- TTL : **1 heure** (cahier des charges §4.1, « expirant sous 1 heure »).
- Lien : `${APP_FRONTEND_URL}/reset-password?token=<token>`.
- L'email part **par la file** (cahier des charges §4.1, « via une file d'attente asynchrone »),
  jamais en synchrone dans la requête.
- Un compte `isActive = false` ne reçoit pas d'email et ne peut pas consommer de token.

## 9. Stratégie de test

### Unitaires (obligatoires, dans la même livraison)

- Résolution des destinataires, table par table du §5 — **y compris le cas `INTERNAL` + CLIENT**.
- `MailService` : redirection `sandboxTo` et en-tête `X-Original-To` ; `auth` absente quand
  `MAIL_USERNAME` est vide, présente sinon.
- Templates : sujet, présence du lien, **échappement HTML** d'un titre contenant `<script>`.
- Émission/consommation du token de reset : succès, expiré, déjà utilisé, secret faux, id inconnu.
- Un listener dont le corps jette ne propage pas (D3).

### e2e

| Suite | Fichier | Préfixe de fixtures |
|---|---|---|
| Notifications | `test/notifications.e2e-spec.ts` | `ntf_e2e_` |
| Reset de mot de passe | `test/password-reset.e2e-spec.ts` | `pwd_e2e_` |

Aucun préfixe ne commence par `e2e_` (purgé par `auth.e2e-spec.ts`). Ne jamais supprimer les
compétences ni les catégories seedées.

**Assertion email en e2e : à la frontière de la file, jamais par le réseau** (révision du
2026-08-07).

Ce contrat prévoyait initialement d'interroger l'API HTTP de Mailpit depuis
`password-reset.e2e-spec.ts`. Abandonné, sur constatation de la configuration réelle de la
machine : le `.env` local pointe un **SMTP de production** (`merguez.o2switch.net:587`, avec
identifiants). Sous cette configuration, l'assertion par Mailpit ne pourrait pas fonctionner, et
surtout **chaque exécution de la suite e2e enverrait de vrais emails**. Une suite de tests n'a pas
à produire d'effet de bord sortant.

À la place, toute suite e2e qui traverse un chemin d'envoi **doit** remplacer le producteur de
file par un double en mémoire, via `.overrideProvider(...)` — exactement le pattern déjà employé
par `attachments.e2e-spec.ts` avec `StorageService`. Le test assert alors sur le `MailMessage`
**rendu** qui a été enfilé : destinataire, sujet, et présence du lien de reset avec son token.
C'est plus fort qu'une assertion de livraison, parce que c'est le contenu qui est vérifié, et non
le fait qu'un serveur tiers ait accepté la connexion.

Ce qui reste prouvé, et par quoi :

| Ce qui est vérifié | Où |
|---|---|
| Le message rendu est correct (sujet, lien, échappement) | tests unitaires des templates |
| La redirection `MAIL_SANDBOX_TO` et l'omission d'`auth` | tests unitaires de `MailService` |
| Le bon message est enfilé au bon moment, avec le bon token | e2e, via le double du producteur |
| Le job est consommé et réessayé | tests unitaires du processor |
| La livraison SMTP elle-même | **non testée automatiquement** — c'est de l'infrastructure. Vérification manuelle via Mailpit, qui reste dans le `docker-compose` pour cet usage. |

### Mutation (bloquant pour la validation)

Chaque tâche livre la preuve d'au moins une mutation, en **nommant le test qui rougit** :

- Retirer le filtre CLIENT de D7 → un test doit prouver qu'un CLIENT reçoit une notification de
  commentaire interne.
- Retirer le filtre acteur de D8 → un test doit rougir.
- Déplacer une émission **dans** la transaction (D1) → documenter ce qui est observé.
- Rendre `parseBooleanQuery` naïf (`Boolean(value)`) → le cas `?unreadOnly=false` doit rougir.
- Accepter un token déjà utilisé → un test doit rougir.

## 10. Environnement

`docker-compose.yml` gagne un service :

```yaml
mailpit:
  image: axllent/mailpit:latest
  restart: unless-stopped
  ports:
    - '1025:1025'   # SMTP
    - '8025:8025'   # UI web + API HTTP
```

Pas de volume : les mails de développement sont jetables.

`.env.example` et `.env.production.example` : `APP_FRONTEND_URL` ajoutée, bloc `MAIL_*` réaligné
sur Mailpit en développement (`MAIL_HOST=localhost`, `MAIL_PORT=1025`, `MAIL_USERNAME=`,
`MAIL_PASSWORD=`, `MAIL_USE_TLS=false`, `MAIL_USE_SSL=false`).

**Aucun agent ne touche au fichier `.env` réel.** Il contient les identifiants de la machine et
n'est pas versionné : sa mise à jour est une action utilisateur, signalée par l'orchestrateur.

Les e2e exigent **Redis démarré** (`docker compose up -d redis`), en plus de PostgreSQL local.
Cohérent avec le choix déjà fait pour la base : les tests d'intégration s'exécutent contre de
vraies dépendances.

**Mailpit n'est PAS un prérequis des tests** (révision du 2026-08-07) : les suites e2e doublent le
producteur de file et n'ouvrent aucune connexion SMTP (§9). Mailpit sert à la vérification
manuelle en développement. Le `.env` de la machine peut donc pointer un SMTP réel sans qu'aucune
exécution de tests n'envoie quoi que ce soit.

### D20 en détail : l'événement `error` du worker, et un diagnostic d'orchestrateur qui était faux

La suite e2e complète est devenue **intermittente** juste après l'enregistrement de la file
(4 tests rouges sur un run, 0 sur le suivant).

**Première hypothèse de l'orchestrateur : fausse.** Ayant vu `x-ratelimit-remaining` décroître
dans les logs, il a conclu à une saturation du throttler `default` (100 requêtes / 60 s par IP,
toutes les suites émettant depuis `127.0.0.1`) et rédigé un D20 prescrivant d'élever la limite en
e2e. L'implementer a refusé d'implémenter et a réfuté, mesures à l'appui :

- `grep '"statusCode":429'` sur les runs rouges → **aucune occurrence**. Les seuls `429` observés
  sont ceux que `app.e2e-spec.ts` provoque **volontairement** sur le throttler `login`.
- `x-ratelimit-remaining` ne descend jamais sous **64/100**. Aucune suite n'approche le seuil
  (comptage réel : `technicians` 56 requêtes, `ticket-assignment` 55, `tickets` 47).
- Chaque fichier de spec instancie son propre `AppModule`, donc son propre `ThrottlerStorage` :
  **aucun cumul entre suites n'est possible**, contrairement à ce que supposait l'hypothèse.
- L'échec a été **reproduit en lançant `app.e2e-spec.ts` seul, en premier, dans un process neuf** —
  ce qui élimine définitivement toute théorie de quota consommé en amont.

**Cause réelle** : `Error: Unhandled error. (Error: Connection is closed …)` émis depuis
`Worker.emit` de BullMQ. `test/app.e2e-spec.ts` instancie `AppModule` plusieurs fois ; la fermeture
asynchrone des connexions Redis d'une instance n'est pas toujours terminée quand `app.close()` a
rendu la main et que l'instance suivante démarre. Le `Worker` émet alors `error` **sans listener**,
et Node traite un événement `error` non écouté comme **fatal**. Jest rattache ensuite cette erreur
asynchrone, de façon non déterministe, aux tests en cours — d'où des noms de tests rouges qui
changent d'un run à l'autre tout en restant toujours dans le même fichier.

**Ce n'est pas un défaut de test.** Un `Worker` sans gestionnaire `error` fait tomber le process
sur n'importe quelle coupure Redis, **en production comme en test**. La correction est donc dans
le code de production, et elle est justifiée par la production.

**Sur quoi repose réellement cette décision** (précision ajoutée après contre-expertise) :

Le symptôme `ERR_UNHANDLED_ERROR` est ce qui a été **observé au moment du diagnostic**. Il n'a
**pas été reproduit à l'identique** lors de la contre-expertise : sur deux runs, l'un était vert et
l'autre rouge pour une cause **différente** (collision de fixture `23505` due à deux processus e2e
concurrents sur la base partagée). Avec une intermittence autour de 1/3, deux runs ne concluent ni
dans un sens ni dans l'autre.

Ce qui porte la décision n'est donc **pas** la reproduction du symptôme, mais la preuve
**mécanistique**, vérifiée en lisant la source de `bullmq` :

- `redis-connection.js:41` pose `status = 'initializing'`.
- `:86-87` : `this.initializing = this.init(); this.initializing.catch(err => this.emit('error', err));`
- `close()` (`:414-456`) est **asymétrique** : la branche `status === 'ready'` fait `await this.initializing`
  (`:422-424`), la branche `initializing` fait `this.initializing?.catch(() => {})` **sans await**
  (`:427-433`).
- Le `finally` (`:452`) appelle `removeAllListeners()` de façon **synchrone et inconditionnelle**.
- Or `forwardConnectionError` (`utils/index.js:97-103`, posé par `worker.js:129`) est précisément
  le relais par lequel un `@OnWorkerEvent('error')` applicatif serait notifié. `removeAllListeners()`
  le retire.

Si le rejet de `this.initializing` survient après ce retrait, l'`emit('error', …)` s'exécute sur un
émetteur sans aucun listener : **aucun code applicatif ne peut l'intercepter.** C'est cette
asymétrie, indépendante de toute reproduction du symptôme, qui justifie de ne pas chercher de
correction applicative supplémentaire.

**Règle de méthode rappelée à la dure** : la contre-expertise a produit un faux rouge parce que
l'orchestrateur a lancé un validator sur la suite e2e complète **pendant** qu'un implementer y
lançait la sienne. La base e2e est réelle et partagée : **jamais deux suites complètes en
parallèle**, y compris entre un implementer et un validator.

**L'élévation du throttler en e2e est abandonnée** : le problème qu'elle prétendait résoudre
n'existe pas. Avec 36 % de marge sur le compteur et un compteur par suite, les suites de P6
n'atteindront pas le seuil. Si cela devait changer un jour, ce serait une décision à reprendre
**sur mesure**, pas par précaution.

**Leçon de méthode, à reconduire** : un implementer qui remonte un écart au lieu de l'implémenter
est un bon signal. C'est la deuxième erreur d'orchestrateur rattrapée comme ça sur ce contrat
(après `ioredis`/`bullmq@6`). Un log corrélé n'est pas une cause : ici, `x-ratelimit-remaining`
décroissait effectivement, et n'avait rien à voir.

### Arrêt du process de test : mesuré, borné, accepté

BullMQ maintient des connexions Redis ouvertes. `await app.close()` dans le `afterAll` de chaque
suite est **obligatoire** — **jamais** `forceExit`, qui masquerait une fuite réelle en production.

Coût mesuré le 2026-08-07, après enregistrement de la file : la suite e2e complète prenait **~23 s
de tests pour ~50 s de process**, soit ~27 s de pure fermeture de connexions. Le surcoût vient de
la fermeture des connexions Redis, analysée en lisant la source de `bullmq` :

- Le worker bloque sur `BZPOPMIN` de la clé marker, avec un timeout piloté par `drainDelay`
  (5 s par défaut).
- Chaque instanciation d'`AppModule` ouvre **trois** connexions Redis distinctes : celle de la
  `Queue`, celle du `Worker`, et la connexion bloquante dédiée du worker. Elles ne sont pas
  partagées, et NestJS ferme les `onApplicationShutdown` séquentiellement.
- `test/app.e2e-spec.ts` instancie `AppModule` trois fois, d'où un coût multiplié.

**Résolu le 2026-08-07 en réduisant la churn, pas en touchant la production.**

`test/app.e2e-spec.ts` reconstruisait l'application **entière avant chaque test** (`beforeEach` +
`afterEach`). C'est ce qui produisait en continu des connexions encore en `initializing` au moment
d'un `close()` — donc à la fois la lenteur **et** la course de D20. Le smoke test a rejoint la suite
de politique de mot de passe ; il en reste deux instanciations d'`AppModule` dans ce fichier.

Mesures (5 runs consécutifs, isolation stricte, aucun autre processus sur la base) :

| | Avant | Après |
|---|---|---|
| Process, suite complète | ~50 s | **~21 s** (min 20,1 — max 23,6) |
| Dont teardown | ~27 s | **~2 s** |
| `app.e2e-spec.ts` seul (A/B contrôlé) | ~35,8 s | **~6,9 s** |
| Runs verts | 2/3 | **5/5** |

**La suite `Login rate limiting` garde délibérément son instance dédiée.** La fusionner
polluerait son compteur de throttler avec les requêtes des autres tests : le test anti-force-brute
resterait **vert tout en ne testant plus rien**, ce qui est le pire résultat possible. Isolation
vérifiée structurellement *et* empiriquement (séquence `x-ratelimit-remaining-login` observée :
`4, 3, 2, 1, 0`, puis `429` — compteur neuf).

Les pistes touchant la production restent écartées, et le restent :

| Piste | Écartée parce que |
|---|---|
| `sharedConnection: true` | Change la topologie de connexion **en production** : une lecture bloquante d'une file pourrait affamer le trafic d'une autre. Pas neutre, pas pour gagner du temps de test. |
| `drainDelay` abaissé en test | Fait entrer une condition sur `NODE_ENV` dans le câblage de production pour un gain de confort en test. |

**À surveiller** : la taxe reste **linéaire** en (instanciations d'`AppModule` × files
enregistrées). Une deuxième file la fera croître. Et comme `main.ts` appelle
`enableShutdownHooks()`, **le même chemin s'exécute en production** au SIGTERM : c'est un délai de
grâce à garder en tête pour le `terminationGracePeriodSeconds` du déploiement. Ce n'est pas un
défaut de fermeture.
