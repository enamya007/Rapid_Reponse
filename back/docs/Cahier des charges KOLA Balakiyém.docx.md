

SOMMAIRE 

#  {#heading}

[1\. Présentation, problématique et intérêt du sujet	1](#1.-présentation,-problématique-et-intérêt-du-sujet)

[1.1 Présentation du sujet	1](#1.1-présentation-du-sujet)

[1.2 Problématique du sujet	1](#1.2-problématique-du-sujet)

[1.3 Intérêt du sujet	2](#1.3-intérêt-du-sujet)

[2\. Cibles	4](#2.-cibles)

[3\. Utilisateurs	4](#3.-utilisateurs)

[4\. Fonctionnalités	5](#4.-fonctionnalités)

[5\. Exigences techniques	8](#5.-exigences-techniques)

[6\. Contraintes	10](#6.-contraintes)

[7\. Planning (2 mois — 8 semaines)	12](#7.-planning-\(2-mois-—-8-semaines\))

[8\. Critères de validation	14](#8.-critères-de-validation)

[9\. Glossaire technique	15](#9.-glossaire-technique)

[TABLE DES MATIERES	I](#table-des-matieres)

# 

# 1\. Présentation, problématique et intérêt du sujet {#1.-présentation,-problématique-et-intérêt-du-sujet}

## 1.1 Présentation du sujet {#1.1-présentation-du-sujet}

Dans un contexte où les entreprises de service (maintenance, SAV, support technique terrain) reçoivent un volume croissant de demandes d'intervention de la part de leurs clients, la capacité à traiter ces demandes rapidement et de manière traçable devient un enjeu opérationnel central. C'est dans cette optique que nous proposons, dans le cadre de notre stage, le thème : **« CONCEPTION ET DÉVELOPPEMENT D'UNE APPLICATION WEB DE GESTION DES INTERVENTIONS TECHNIQUES ET DE SUIVI DES DEMANDES DE SUPPORT CLIENT »**.

L'application couvre l'ensemble du cycle de vie d'une intervention : création d'un ticket par un client ou un administrateur, affectation à un technicien selon sa disponibilité et/ou sa compétence, suivi de l'état d'avancement, notification des parties prenantes à chaque changement d'état, et production de statistiques d'exploitation. Nous avons retenu une architecture découplée entièrement en JavaScript/TypeScript : un backend exposant une API REST (NestJS) et un frontend (Next.js), le tout appuyé sur une base de données PostgreSQL.

## 1.2 Problématique du sujet {#1.2-problématique-du-sujet}

Dans la majorité des structures de service qui n'ont pas encore d'outil dédié, la gestion des demandes d'intervention repose sur des processus non centralisés : appels téléphoniques, échanges d'emails dispersés, tableurs mis à jour manuellement par les responsables d'équipe. Cette approche présente plusieurs limites majeures :

* elle ne permet aucune traçabilité fiable de l'historique d'un ticket (qui a été affecté, quand, avec quel résultat) ;

* elle rend le suivi de l'état d'une intervention dépendant de la disponibilité humaine pour répondre à une simple question ("où en est mon ticket ?") ;

* elle est sujette à des oublis dans l'affectation ou la notification des techniciens et des clients ;

* elle ne permet aucune analyse consolidée des performances (délai moyen de résolution, charge par technicien, volume par période) ;

* elle expose l'entreprise à des risques de sécurité si les échanges contiennent des informations sensibles sans contrôle d'accès formalisé.

Face à ces constats, plusieurs questions fondamentales se posent :

* comment centraliser la création, l'affectation et le suivi des tickets dans un outil unique, accessible à trois profils d'utilisateurs aux permissions distinctes ?

* quelle architecture applicative permet de garantir qu'un ticket ne puisse jamais passer d'un état à un autre de façon incohérente (ex. passer directement de "ouvert" à "clôturé" sans intervention) ?

* comment notifier automatiquement les parties prenantes sans bloquer le temps de réponse de l'application ?

* quelle structuration technique permet de produire des statistiques fiables et exploitables sans traitement manuel a posteriori ?

* comment garantir la sécurité des accès (authentification, séparation stricte des rôles) et la protection des données dans une application exposée sur le web ?

Pour répondre à ces enjeux, le développement d'une application web dédiée à la gestion des interventions techniques s'avère indispensable.

## 1.3 Intérêt du sujet {#1.3-intérêt-du-sujet}

### 1.3.1 Objectifs

#### *a. Objectif général*

L'objectif principal de notre projet est de concevoir et développer une application web centralisant la création, l'affectation, le suivi et l'analyse statistique des interventions techniques, afin de réduire les délais de traitement, de fiabiliser le suivi des demandes et de sécuriser les échanges entre clients, techniciens et administrateurs.

#### *b. Objectifs spécifiques*

Plus concrètement, notre application vise à :

* centraliser la gestion des demandes d'intervention dans un outil unique, avec pour cible 100 % des tickets créés et suivis dans l'application (fin des échanges par mail/téléphone non tracés) ;

* réduire le délai de prise en charge des tickets, avec un délai moyen entre création et affectation inférieur ou égal à 30 minutes en heures ouvrées ;

* fournir une visibilité en temps réel sur l'état des interventions via un dashboard consultable par les trois profils d'utilisateurs ;

* automatiser l'information des parties prenantes, avec une notification envoyée dans un délai inférieur ou égal à 5 minutes après chaque changement d'état ;

* fournir un pilotage basé sur la donnée grâce à des statistiques exportables (CSV/PDF) sur une période donnée ;

* garantir la sécurité des accès et des données par une authentification JWT, un contrôle d'accès strict par rôle, et un chiffrement des mots de passe.

### 1.3.2 Résultats

À la fin de ce projet :

* la gestion des tickets d'intervention est entièrement centralisée dans une application unique ;

* les délais d'affectation et de traitement sont mesurables et réduits par rapport à un processus manuel ;

* une traçabilité complète de l'historique de chaque ticket est assurée (statuts, réaffectations, commentaires) ;

* des tableaux de bord par rôle offrent une visibilité en temps réel sur l'activité ;

* les parties prenantes sont notifiées automatiquement à chaque étape clé du cycle de vie d'un ticket ;

* des statistiques d'exploitation fiables et exportables sont mises à disposition des décideurs.

## 2\. Cibles {#2.-cibles}

* **PME et ETI de services techniques** : maintenance industrielle, dépannage électroménager/informatique, SAV, facility management, techniciens itinérants.

* **Structures ayant un volume de tickets suffisant** pour justifier un outil dédié (à partir d'une dizaine de tickets/semaine et de 2-3 techniciens), sans nécessiter la complexité d'un ERP/GMAO complet.

* **Contexte multi-sites ou mono-site** avec des techniciens mobiles nécessitant un accès depuis un smartphone ou une tablette (d'où l'exigence de responsive design plutôt qu'une application mobile native dans cette première version).

## 3\. Utilisateurs {#3.-utilisateurs}

Nous nous appuyons sur trois rôles distincts, avec une gestion des permissions par RBAC (Role-Based Access Control) implémentée via des **guards** NestJS côté API et des routes protégées côté Next.js (middleware \+ vérification du rôle en session).

| Rôle | Description | Permissions principales |
| :---- | :---- | :---- |
| **Admin** | Responsable de l'exploitation de l'application | Gestion des utilisateurs (création/désactivation), gestion des techniciens et de leurs compétences, affectation manuelle ou supervision de l'affectation automatique, accès à toutes les statistiques, configuration des notifications |
| **Technicien** | Exécute les interventions affectées | Consultation de ses tickets affectés, mise à jour de l'état d'un ticket, ajout de comptes-rendus/pièces jointes, consultation de son planning |
| **Client** | Émet les demandes d'intervention | Création de tickets, suivi de l'état de ses propres tickets, consultation de l'historique, réception de notifications, évaluation de l'intervention (optionnel) |

Chaque utilisateur est authentifié individuellement (pas de compte partagé) ; nous prévoyons que l'admin puisse désactiver un compte sans le supprimer (conservation de l'historique pour traçabilité).

# 4\. Fonctionnalités {#4.-fonctionnalités}

### 4.1 Authentification et gestion des comptes

* Connexion des utilisateurs via JSON Web Token (access token \+ refresh token), implémentée avec @nestjs/jwt et la stratégie passport-jwt.

* Rafraîchissement automatique du token côté frontend avant expiration (intercepteur Axios ou wrapper fetch dans Next.js).

* Déconnexion avec invalidation du refresh token (table refresh\_tokens en base, ou liste de révocation côté Redis).

* Réinitialisation de mot de passe par email (lien à usage unique, expirant sous 1 heure), envoyée via une file d'attente asynchrone.

* Gestion des rôles et permissions (Admin / Technicien / Client) via des **guards** et **decorators** personnalisés (@Roles(), RolesGuard) au niveau des contrôleurs NestJS.

### 4.2 Gestion des tickets (CRUD complet)

* Création d'un ticket : titre, description, catégorie, priorité, pièce jointe (photo du problème), site/adresse d'intervention.

* Lecture : liste filtrable (statut, priorité, technicien, date), détail du ticket avec historique des changements d'état.

* Modification : mise à jour du statut, réaffectation, ajout de commentaires internes (visibles uniquement Admin/Technicien) et commentaires publics.

* Suppression : soft delete (champ isDeleted \+ deletedAt géré nativement par Prisma via un middleware, ou par une convention de requêtes filtrées) plutôt que suppression physique, pour conserver la traçabilité et permettre un audit.

* Validation des données entrantes via des **DTO** (Data Transfer Objects) avec class-validator et class-transformer, appliqués automatiquement par le ValidationPipe global de NestJS.

### 4.3 Affectation des techniciens

* Affectation manuelle par l'Admin depuis le dashboard.

* Suggestion automatique basée sur la disponibilité déclarée et les compétences associées au technicien (relation many-to-many modélisée en Prisma).

* Historique des réaffectations conservé (qui, quand, pourquoi) dans une table dédiée.

### 4.4 Suivi d'état

* Machine à états finis pour le cycle de vie du ticket : ouvert → affecté → en\_cours → résolu → clôturé, avec possibilité de passage à annulé depuis les états non terminaux.

* Toute transition interdite par la machine à états est rejetée par l'API (validation dans la couche service NestJS, pas uniquement côté frontend).

* Nous formalisons cette machine à états avec **XState** : les états, les événements de transition et les gardes (conditions) sont définis dans une machine dédiée (ticketStatusMachine), utilisée côté backend pour valider chaque changement de statut avant écriture en base, et réutilisable côté frontend (Next.js) pour piloter l'affichage des actions disponibles selon l'état courant du ticket.

* Horodatage systématique de chaque transition pour le calcul des indicateurs de délai.

### 4.5 Notifications

* Notifications déclenchées par les **hooks du cycle de vie** des entités (intercepteurs NestJS ou événements internes via @nestjs/event-emitter) plutôt que par polling.

* Traitement asynchrone via **BullMQ** (file d'attente basée sur Redis), équivalent JavaScript de Celery, pour l'envoi d'emails sans bloquer la requête HTTP.

* Envoi d'emails via **Nodemailer**.

* Canaux : notification in-app (table notifications \+ badge non lu, rafraîchie en polling ou via WebSocket avec @nestjs/websockets) et email.

* Événements notifiés : création de ticket, affectation, changement de statut, ajout de commentaire.

### 4.6 Statistiques et dashboard

* Dashboard par rôle : 

  * Admin : nombre de tickets par statut, délai moyen de résolution, charge par technicien, taux de tickets résolus dans les délais contractuels (SLA).

  * Technicien : tickets en cours, tickets en retard, historique personnel.

  * Client : statut de ses tickets, historique.

* Graphiques générés côté Next.js (Recharts ou Chart.js) à partir d'endpoints d'agrégation NestJS (requêtes Prisma avec groupBy et aggregate, ou requêtes SQL brutes via $queryRaw si nécessaire).

* Export des statistiques en CSV (librairie json2csv ou csv-writer) et PDF (librairie Puppeteer en mode headless, ou pdfkit).

## 5\. Exigences techniques {#5.-exigences-techniques}

| Domaine | Choix technique | Justification |
| :---- | :---- | :---- |
| **Backend / Framework** | NestJS 10.x (Node.js, TypeScript) | Architecture modulaire proche de Django/DRF (modules, contrôleurs, services, guards), typage fort avec TypeScript, écosystème mature pour les API REST |
| **Machine à états** | XState | Modélisation explicite et testable du cycle de vie du ticket (états, transitions, gardes), partageable entre le backend (validation) et le frontend (pilotage de l'UI) |
| **ORM** | Prisma | Migrations versionnées, typage automatique des modèles, requêtes sûres (protection native contre l'injection SQL), équivalent JS de l'ORM Django |
| **Frontend** | Next.js 14 (React) | Structure par fichiers (App Router), rendu hybride possible (SSR/CSR selon les pages), écosystème React complet ; alternative possible : React \+ Vite en SPA pure si l'on ne souhaite pas de rendu serveur |
| **Style / UI** | Tailwind CSS | Développement rapide d'une interface cohérente, responsive par défaut via les classes utilitaires (sm:, md:, lg:) |
| **SGBD** | PostgreSQL 16.x | SGBD relationnel robuste, excellent support des contraintes et des types avancés (JSONB, enums natifs pour les statuts de ticket), bien intégré avec Prisma |
| **Authentification** | JWT (@nestjs/jwt \+ passport-jwt) | Stateless, adapté à une API consommée par un frontend séparé et potentiellement une future application mobile |
| **Tâches asynchrones** | BullMQ \+ Redis | Envoi de notifications/emails sans bloquer le thread de requête HTTP (équivalent JS de Celery \+ Redis) |
| **Interface** | Responsive (mobile-first) | Les techniciens interviennent sur le terrain ; l'interface doit rester utilisable dès 360 px de largeur (smartphone), avec des points de rupture à 640 px, 768 px et 1024 px |
| **Documentation API** | @nestjs/swagger (OpenAPI 3\) | Génération automatique de la documentation Swagger à partir des décorateurs sur les DTO et contrôleurs |
| **Tests backend** | Jest \+ Supertest | Suite de test livrée nativement avec NestJS, adaptée aux tests unitaires (services) et d'intégration (contrôleurs/endpoints) |

## 6\. Contraintes {#6.-contraintes}

### 6.1 Performance

* Temps de réponse des endpoints API : **≤ 500 ms** en conditions normales de charge (mesuré côté serveur, hors latence réseau).

* Temps de chargement complet d'une page côté client : **≤ 3 secondes sur une connexion 4G** (débit descendant simulé \~10-12 Mbps, throttling via Chrome DevTools ou Lighthouse pour validation).

* Pagination obligatoire sur toute liste (tickets, notifications) au-delà de 20 éléments, pour éviter les temps de réponse dégradés liés à des payloads volumineux (pagination gérée nativement via Prisma skip/take).

### 6.2 Disponibilité et sauvegarde

* Sauvegarde quotidienne automatisée de la base PostgreSQL (pg\_dump planifié via une tâche cron ou un job BullMQ récurrent), avec rétention de 30 jours glissants.

* Sauvegarde des fichiers uploadés (photos, pièces jointes) synchronisée quotidiennement vers un stockage distinct du serveur applicatif.

* Objectif de disponibilité cible : 99 % sur les heures ouvrées (hors fenêtre de maintenance planifiée et communiquée).

### 6.3 Sécurité

* Mots de passe hachés avec **Argon2** (librairie argon2 pour Node.js), et non en MD5/SHA1.

* Politique de mot de passe minimale : 10 caractères, validation appliquée via un DTO personnalisé (class-validator) et/ou une librairie de contrôle de robustesse comme zxcvbn.

* Contrôle d'accès strict par rôle sur chaque endpoint NestJS (guards personnalisés RolesGuard, OwnershipGuard), refusant par défaut (deny by default) plutôt que d'autoriser par défaut.

* Communication exclusivement en HTTPS (TLS 1.2 minimum) en production, avec redirection automatique HTTP → HTTPS (gérée au niveau du reverse proxy, ex. Nginx).

* Protection contre les attaques par force brute sur l'endpoint de connexion via @nestjs/throttler (ex. 5 tentatives/minute par IP).

* Access token JWT à durée de vie courte (15 minutes), refresh token à durée de vie plus longue (7 jours) avec rotation et invalidation en cas de déconnexion.

* Journalisation (logs) des actions sensibles : connexions, changements de rôle, suppressions (via un module Logger centralisé, type Winston ou Pino).

* Conformité RGPD : droit d'accès et de suppression des données personnelles des clients, minimisation des données collectées.

## 7\. Planning (2 mois — 8 semaines) {#7.-planning-(2-mois-—-8-semaines)}

Nous prévoyons une durée totale de **2 mois**, incluant une montée en compétence sur la stack (NestJS, Next.js, Prisma, XState, BullMQ) directement intégrée aux deux premières semaines plutôt que traitée comme une phase à part détachée du développement — chaque notion apprise est mise en pratique immédiatement sur le projet.

| Semaine | Phase | Livrables |
| :---- | :---- | :---- |
| **S1** | Cadrage, conception & prise en main de la stack | Spécifications fonctionnelles détaillées, modèle de données (schéma Prisma), maquettes UI (wireframes des écrans clés : login, dashboard, création de ticket), initialisation des dépôts Git, premiers tutoriels pratiques NestJS/Next.js appliqués à un mini-module du projet (ex. endpoint /health \+ page d'accueil) |
| **S2** | Socle technique & apprentissage ciblé | Configuration NestJS \+ Prisma \+ PostgreSQL (installation locale), mise en place de l'authentification JWT (stratégies passport-jwt), modèles de données (User, Ticket, Compétence, Notification), migrations initiales, prise en main de XState sur un cas simple (machine à deux/trois états) avant de l'appliquer au cycle de vie complet du ticket |
| **S3** | Backend — Gestion des tickets | Endpoints CRUD tickets, machine à états XState complète (ticketStatusMachine) intégrée à la couche service, guards de permissions par rôle, tests unitaires des services et contrôleurs (Jest) |
| **S4** | Backend — Affectation & notifications | Logique d'affectation (manuelle \+ suggestion automatique), événements internes NestJS pour déclenchement des notifications, intégration BullMQ \+ Redis pour l'envoi asynchrone, prise en main de Nodemailer |
| **S5** | Frontend — Socle & authentification | Setup Next.js \+ Tailwind, écrans de connexion/inscription, gestion du token (intercepteurs, refresh automatique), routes protégées par rôle (middleware Next.js), intégration de la machine XState côté client pour piloter l'affichage des actions selon le statut du ticket |
| **S6** | Frontend — Tickets & dashboard | Écrans de création/liste/détail de ticket, dashboard par rôle avec premiers graphiques (Recharts), intégration des notifications in-app |
| **S7** | Statistiques, exports & finitions UI | Endpoints d'agrégation pour les statistiques (Prisma groupBy), export CSV/PDF, responsive design finalisé (tests mobile/tablette), documentation API (Swagger via @nestjs/swagger) |
| **S8** | Tests, recette & mise en production | Tests d'intégration end-to-end, tests de charge, recette utilisateur (UAT), correction des anomalies, déploiement en environnement de production, rédaction du manuel utilisateur |

## 8\. Critères de validation {#8.-critères-de-validation}

### 8.1 Tests techniques

* **Tests unitaires backend** : couverture ≥ 80 % sur les services, guards et pipes de validation critiques (via Jest, intégré nativement à NestJS).

* **Tests d'intégration API** : validation des scénarios de bout en bout (création de ticket → affectation → changement de statut → notification) via Jest \+ Supertest.

* **Tests frontend** : tests de composants React/Next.js (React Testing Library) sur les formulaires critiques (connexion, création de ticket) et tests end-to-end (Cypress ou Playwright) sur les parcours principaux par rôle.

* **Tests de charge** : simulation de 50 utilisateurs simultanés (k6 ou Artillery) pour valider le respect du seuil de temps de réponse de 500 ms sur les endpoints les plus sollicités (liste des tickets, dashboard).

* **Tests de sécurité** : vérification de l'absence d'accès croisé entre rôles (un client ne peut pas accéder aux tickets d'un autre client), test des endpoints sans authentification (doivent renvoyer 401), test de la politique de verrouillage après tentatives de connexion échouées.

### 8.2 Recette fonctionnelle (UAT)

* Scénarios de recette rédigés pour chaque rôle (Admin, Technicien, Client), couvrant les cas nominaux et les cas d'erreur (ex. tentative de transition d'état invalide, upload de fichier trop volumineux).

* Validation par un panel représentatif d'utilisateurs (ou par le commanditaire du projet) sur environnement de pré-production, avec grille de recette formalisée (fonctionnalité / résultat attendu / résultat obtenu / statut).

* Nous considérons le projet validé lorsque 100 % des scénarios critiques (authentification, création/suivi de ticket, notifications) passent, et au moins 95 % des scénarios secondaires (statistiques, exports).

### 8.3 Critères de non-régression

* Suite de tests automatisés exécutée en intégration continue (CI, ex. GitHub Actions) à chaque merge, bloquant la fusion en cas d'échec.

* Aucune régression de performance tolérée : chaque nouvelle version doit rester sous les seuils définis en section 6.1, vérifié par un test de charge automatisé avant chaque mise en production.

## 9\. Glossaire technique {#9.-glossaire-technique}

Nous avons regroupé ici chaque technologie, framework ou librairie mentionné dans ce cahier des charges, avec son rôle exact dans le projet et une estimation indicative du temps nécessaire pour en acquérir une maîtrise suffisante (pas une expertise complète, mais un niveau opérationnel pour ce projet). Cela doit vous permettre d'arbitrer vous-même si le planning de 8 semaines reste tenable ou s'il faut simplifier certains choix.

### 9.1 Backend

| Techno | Définition | Rôle dans le projet | Temps d'apprentissage estimé |
| :---- | :---- | :---- | :---- |
| **NestJS** | Framework backend Node.js structuré autour de modules, contrôleurs et services, avec une architecture inspirée d'Angular (décorateurs, injection de dépendances) | Ossature de toute l'API : reçoit les requêtes HTTP, orchestre la logique métier (tickets, utilisateurs, notifications) | 3 à 5 jours pour les bases (module/contrôleur/service/DTO) si vous connaissez déjà TypeScript ; 1 à 2 semaines pour être à l'aise avec les guards, intercepteurs et pipes |
| **TypeScript** | Sur-ensemble de JavaScript qui ajoute le typage statique | Langage utilisé côté backend (NestJS) et frontend (Next.js) | Si vous connaissez déjà JavaScript, 2 à 4 jours pour les bases du typage (interfaces, types génériques) |
| **Prisma** | ORM (Object-Relational Mapper) : couche qui traduit vos modèles de données TypeScript en requêtes SQL, et inversement | Définit le schéma de la base (schema.prisma), génère les migrations, exécute les requêtes (create, findMany, update...) sans écrire de SQL à la main | 2 à 3 jours pour le CRUD de base ; \+2-3 jours pour les relations complexes (many-to-many, agrégations groupBy) |
| **PostgreSQL** | Système de gestion de base de données relationnelle (SGBD) | Stocke toutes les données de l'application (utilisateurs, tickets, notifications...) | Si vous connaissez déjà un SGBD relationnel (MySQL par ex.), quasi immédiat ; sinon 2-3 jours pour les bases (tables, clés étrangères, index) |
| **JWT (JSON Web Token)** | Format de jeton signé qui encode l'identité d'un utilisateur et une date d'expiration, sans nécessiter de session stockée côté serveur | Authentifie chaque requête API après connexion (access token \+ refresh token) | 1 à 2 jours pour comprendre le concept ; l'implémentation via @nestjs/jwt est rapide une fois le concept acquis |
| **@nestjs/jwt** | Module officiel NestJS pour signer et vérifier des JWT | Génère et valide les tokens d'accès et de rafraîchissement | Quelques heures, une fois JWT compris conceptuellement |
| **passport-jwt** | Stratégie d'authentification pour la librairie Passport.js, spécialisée dans la vérification de JWT | Middleware qui intercepte les requêtes, vérifie le token, et attache l'utilisateur authentifié à la requête | Quelques heures d'intégration, bien documentée dans NestJS |
| **Argon2** | Algorithme de hachage de mot de passe, vainqueur du concours *Password Hashing Competition* (2015), plus robuste que bcrypt face aux attaques par matériel dédié (GPU/ASIC) | Hache les mots de passe avant stockage en base ; jamais de mot de passe en clair | Quelques heures (2-3 fonctions à utiliser : hash(), verify()) |
| **class-validator** | Librairie qui permet de valider un objet en ajoutant des décorateurs sur ses propriétés (@IsEmail(), @IsNotEmpty(), etc.) | Valide les données entrantes (DTO) avant qu'elles n'atteignent la logique métier | 1 jour |
| **class-transformer** | Librairie complémentaire qui convertit des objets JSON bruts en instances de classes TypeScript | Transforme le corps des requêtes HTTP en objets DTO typés | Quelques heures, utilisé conjointement avec class-validator |
| **BullMQ** | Librairie de gestion de files d'attente (job queues) basée sur Redis | Traite les tâches asynchrones (envoi d'email, notifications) sans bloquer la réponse HTTP immédiate | 2 à 3 jours pour la mise en place de base (créer une queue, un worker, un job) |
| **Redis** | Base de données en mémoire, clé-valeur, très rapide | Sert de backend de stockage pour BullMQ (files d'attente) ; peut aussi stocker les tokens révoqués | 1 jour pour l'installation et les commandes de base ; vous ne l'utilisez presque jamais directement, c'est BullMQ qui l'exploite |
| **Nodemailer** | Librairie Node.js pour l'envoi d'emails via un serveur SMTP | Envoie les emails de réinitialisation de mot de passe et les notifications par email | Quelques heures, API simple |
| **XState** | Librairie de modélisation de machines à états finis et de statecharts | Formalise et sécurise les transitions du statut d'un ticket (ouvert → affecté → en\_cours...), en empêchant les transitions invalides | 3 à 5 jours pour les bases (états, événements, gardes) ; c'est la techno la plus conceptuellement nouvelle de la liste si vous n'avez jamais manipulé de machine à états |
| **@nestjs/event-emitter** | Module NestJS permettant d'émettre et d'écouter des événements internes à l'application (pattern observateur) | Déclenche les notifications quand un ticket change de statut, sans coupler directement les modules entre eux | 1 jour |
| **@nestjs/websockets** | Module NestJS pour gérer des connexions WebSocket (communication bidirectionnelle temps réel) | Optionnel : pousse les notifications in-app en temps réel sans que le frontend ait à interroger le serveur en boucle | 2-3 jours ; **peut être reporté** en V2 si le temps manque (le polling classique suffit pour un MVP) |
| **@nestjs/throttler** | Module NestJS de limitation de débit (rate limiting) | Bloque les tentatives de connexion répétées (protection anti brute-force) | Quelques heures, configuration déclarative |
| **@nestjs/swagger** | Module NestJS qui génère automatiquement une documentation API interactive (OpenAPI/Swagger) à partir des décorateurs déjà présents sur vos contrôleurs et DTO | Documentation consultable de l'API, utile aussi pour tester manuellement les endpoints pendant le développement | Quasi nul : génération automatique, juste quelques décorateurs à ajouter |
| **Winston / Pino** | Librairies de journalisation (logging) structurée pour Node.js | Enregistrent les actions sensibles (connexions, suppressions) dans des fichiers ou flux de logs | Quelques heures pour une configuration basique |
| **zxcvbn** | Librairie d'estimation de la robustesse d'un mot de passe (développée par Dropbox) | Vérifie qu'un mot de passe choisi par l'utilisateur n'est pas trop faible, au-delà de la simple longueur | Quelques heures ; **optionnel**, une validation de longueur/complexité simple peut suffire pour un premier rendu |

### 9.2 Frontend

| Techno | Définition | Rôle dans le projet | Temps d'apprentissage estimé |
| :---- | :---- | :---- | :---- |
| **Next.js** | Framework React qui ajoute le routage par fichiers, le rendu serveur (SSR) et d'autres optimisations | Structure toutes les pages de l'application (login, dashboard, tickets...) | 3 à 5 jours pour les bases (App Router, pages, layouts) si vous connaissez déjà React ; sinon ajoutez le temps d'apprentissage de React lui-même |
| **React** | Librairie JavaScript pour construire des interfaces utilisateur à base de composants | Base de tous les composants d'interface (formulaires, listes, dashboard) | Si déjà connu, rien à ajouter ; sinon 1-2 semaines pour les fondamentaux (composants, hooks, état) |
| **Tailwind CSS** | Framework CSS utilitaire (classes prêtes à l'emploi comme flex, p-4, text-lg) | Mise en forme responsive de toutes les pages | 2-3 jours pour être productif, la documentation est très visuelle |
| **Axios** | Client HTTP pour JavaScript, avec gestion des intercepteurs de requêtes/réponses | Effectue les appels vers l'API NestJS depuis le frontend, avec rafraîchissement automatique du token | Quelques heures |
| **Recharts / Chart.js** | Librairies de génération de graphiques en React | Affichent les statistiques du dashboard (courbes, barres) | 1-2 jours pour des graphiques simples |
| **XState (côté client)** | Même librairie que côté backend | Réutilisée pour piloter l'affichage des actions possibles selon le statut du ticket (ex. cacher le bouton "Résoudre" si le ticket est déjà clôturé) | Déjà compté côté backend ; l'intégration React (@xstate/react) ajoute une demi-journée |

### 

### 9.3 Tests

| Techno | Définition | Rôle dans le projet | Temps d'apprentissage estimé |
| :---- | :---- | :---- | :---- |
| **Jest** | Framework de test JavaScript (assertions, mocks, exécution) | Tests unitaires des services et contrôleurs NestJS | 1-2 jours pour les bases, déjà intégré par défaut dans un projet NestJS |
| **Supertest** | Librairie pour tester des endpoints HTTP (envoyer des requêtes simulées et vérifier les réponses) | Tests d'intégration de l'API (ex. vérifier qu'un endpoint protégé renvoie bien 401 sans token) | Quelques heures, s'utilise avec Jest |
| **React Testing Library** | Librairie de test de composants React centrée sur le comportement utilisateur plutôt que l'implémentation | Teste les formulaires critiques (connexion, création de ticket) | 1-2 jours |
| **Cypress / Playwright** | Frameworks de test end-to-end (simulent un vrai navigateur et un vrai parcours utilisateur) | Valide les parcours complets par rôle (ex. un client crée un ticket, un technicien le résout) | 2-3 jours pour les scénarios de base ; **à ne pas sous-estimer**, c'est souvent la partie qui déborde en fin de projet |
| **k6 / Artillery** | Outils de test de charge (simulent plusieurs utilisateurs simultanés) | Vérifie que l'API tient le seuil de 500 ms sous charge | 1 jour pour un script de base |

### 9.4 Export de données

| Techno | Définition | Rôle dans le projet | Temps d'apprentissage estimé |
| :---- | :---- | :---- | :---- |
| **json2csv / csv-writer** | Librairies de conversion d'objets JavaScript vers le format CSV | Export des statistiques en fichier CSV | Quelques heures |
| **Puppeteer** | Librairie qui pilote un navigateur Chrome headless (sans interface) depuis Node.js | Génère des PDF à partir d'une page HTML (ex. rapport de statistiques mis en forme) | 1 jour pour un cas simple |
| **pdfkit** | Librairie de génération de PDF "from scratch" (dessin de texte, formes) | Alternative plus légère à Puppeteer si vous n'avez pas besoin de mise en page HTML complexe | 1-2 jours (API plus bas niveau que Puppeteer) |

### 9.5 Synthèse : ce qui est prioritaire vs différable

Pour vous aider à arbitrer le temps disponible, nous distinguons :

**Cœur indispensable du projet** (ne peuvent pas être reportés) : NestJS, TypeScript, Prisma, PostgreSQL, JWT \+ @nestjs/jwt \+ passport-jwt, Argon2, class-validator, Next.js, React, Tailwind CSS, Axios, Jest, Supertest.

**Important mais avec une version simplifiée possible en cas de retard** :

* XState → à défaut, une validation de transition "à la main" (if/switch dans le service) fonctionne aussi, moins élégant mais fonctionnel.

* BullMQ \+ Redis → à défaut, un envoi d'email synchrone (bloquant) fonctionne pour un MVP, au prix d'un temps de réponse dégradé sur cette action précise.

* Cypress/Playwright → à défaut, des tests manuels documentés dans un tableau de recette peuvent remplacer les tests automatisés end-to-end pour la soutenance.

* Recharts/Chart.js → à défaut, un tableau de chiffres bruts sans graphique reste fonctionnel.

**Clairement différable / optionnel** :

* @nestjs/websockets (le polling classique suffit),

* Export PDF (le CSV seul peut suffire dans un premier temps),

* zxcvbn (une règle de longueur minimale suffit),

* k6/Artillery (les tests de charge peuvent être décrits comme "prévus en V2" si le temps manque).

*.*

# TABLE DES MATIERES {#table-des-matieres}

[SOMMAIRE	i](#heading)

[1\. Présentation, problématique et intérêt du sujet	1](#1.-présentation,-problématique-et-intérêt-du-sujet)

[1.1 Présentation du sujet	1](#1.1-présentation-du-sujet)

[1.2 Problématique du sujet	1](#1.2-problématique-du-sujet)

[1.3 Intérêt du sujet	2](#1.3-intérêt-du-sujet)

[2\. Cibles	4](#2.-cibles)

[3\. Utilisateurs	4](#3.-utilisateurs)

[4\. Fonctionnalités	5](#4.-fonctionnalités)

[5\. Exigences techniques	8](#5.-exigences-techniques)

[6\. Contraintes	10](#6.-contraintes)

[7\. Planning (2 mois — 8 semaines)	12](#7.-planning-\(2-mois-—-8-semaines\))

[8\. Critères de validation	14](#8.-critères-de-validation)

[9\. Glossaire technique	15](#9.-glossaire-technique)

[TABLE DES MATIERES	I](#table-des-matieres)

