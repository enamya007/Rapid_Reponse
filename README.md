# KOLA Balakiyém — Readme

Ce fichier est le **seul guide à suivre**. Ignorez le fichier `Backend/README.md` : c’est le modèle générique de NestJS, pas le mode d’emploi de ce projet.

Quand toutes les étapes ci-dessous sont terminées, vous ouvrez le navigateur à l’adresse **http://localhost:3000/login** et vous vous connectez avec le compte administrateur créé par le seed (A voir dans .env.example).

---

## 0. Ce que vous devez voir dans ce dossier

Le dossier que vous avez reçu doit contenir au moins ces trois éléments :

```
KOLA Balakiyém/
├── README.md          ← ce fichier
├── Backend/           ← API NestJS (base de données, authentification, tickets)
└── Frontend/          ← site Next.js (écrans login, dashboard, tickets)
```

Les deux dossiers `Backend` et `Frontend` sont **indépendants**. Il n’y a pas de fichier `package.json` à la racine de `KOLA Balakiyém`. Vous travaillez d’abord entièrement dans le dossier `Backend`, puis vous ouvrez un second terminal dans le dossier `Frontend`.

Le navigateur ne parle jamais directement à PostgreSQL. Il envoie toutes ses requêtes à l’API du Backend.


| Site web | `Frontend` | 3000 | http://localhost:3000/login |
| API | `Backend` | 4000 | http://localhost:4000/api |
| Documentation de l’API (Swagger) | `Backend` | 4000 | http://localhost:4000/docs |

---

## 1. Logiciels à installer

Si un outil est **déjà** installé sur la machine, ne le réinstallez pas. Exécutez seulement la commande de vérification indiquée sous chaque outil. Si la commande affiche un numéro de version, l’outil est prêt.

Dans ce guide, un bloc `bash` désigne une commande à coller dans un terminal. Sous Windows, ouvrez **PowerShell** (recherchez « PowerShell » dans le menu Démarrer). Vous pouvez aussi ouvrir l’invite de commandes avec **Windows + R**, puis **valider** .

### 1.1 Docker Desktop

Docker Desktop sert à lancer **Redis**, **MinIO** (stockage des pièces jointes) et **Mailpit** (boîte mail de test). PostgreSQL **n’est pas** démarré par Docker dans ce projet : vous l’installez à part, à la section 1.4.

1. Téléchargez et installez [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Lancez l’application Docker Desktop et attendez que le moteur indique qu’il est prêt (icône baleine stable, sans message d’erreur).

Vérifiez l’installation en collant ces deux commandes dans PowerShell :

```bash
docker --version
docker compose version
```

Si Docker Desktop n’est pas ouvert, la commande `pnpm db:up` de la section 5.3 échouera.

### 1.2 Node.js

Téléchargez et installez [Node.js LTS](https://nodejs.org/), version **20** ou **22**. Pendant l’installation, laissez l’option **npm** cochée.

Vérifiez l’installation :

```bash
node --version
npm --version
```

### 1.3 pnpm

Les dossiers `Backend` et `Frontend` utilisent **pnpm** pour installer les paquets. N’utilisez pas `npm install` ni `yarn` dans ces dossiers.

Activez pnpm avec les commandes suivantes :

```bash
corepack enable
corepack prepare pnpm@10 --activate
pnpm --version
```

Si Windows répond que `corepack` n’existe pas, installez pnpm ainsi :

```bash
npm install -g pnpm
```

### 1.4 PostgreSQL

L’API a besoin d’une base **PostgreSQL locale** qui écoute sur le port **5432**.

1. Téléchargez et installez [PostgreSQL](https://www.postgresql.org/download/) en version **16** ou **17**.
2. Pendant l’installation, notez le mot de passe du superutilisateur `postgres`. Vous en aurez besoin une fois pour vous connecter à l’outil d’administration et créer la base de donnée du projet.
3. Laissez le port proposé par l’installateur, c’est-à-dire **5432**.

Vérifiez que la commande `psql` est disponible à travers :

```bash
psql --version
```

Si Windows répond que `psql` n’est pas reconnu, le dossier `bin` de PostgreSQL n’est pas encore dans la variable d’environnement **Path**. Suivez alors la section 1.4.1 ci-dessous. En attendant, vous pouvez aussi ouvrir **SQL Shell (psql)** depuis le menu Démarrer : ce raccourci fonctionne même sans Path.

### 1.4.1 Comment ajouter le dossier `bin` de PostgreSQL aux variables d’environnement (Windows)

Cette étape permet d’utiliser `psql` dans n’importe quel terminal. Faites-la une seule fois.

**Étape A — Repérer le dossier `bin`.**  
Ouvrez l’Explorateur de fichiers et allez dans `C:\Program Files\PostgreSQL\`. Vous verrez un sous-dossier au nom de la version, par exemple `17` ou `16`. Entrez dedans, puis ouvrez le dossier `bin`. Le chemin complet ressemble à l’un de ces deux exemples :

- `C:\Program Files\PostgreSQL\17\bin`
- `C:\Program Files\PostgreSQL\16\bin`

Vérifiez que ce dossier contient bien le fichier `psql.exe`. Copiez le chemin complet (barre d’adresse de l’Explorateur, ou clic droit sur le dossier `bin` → Propriétés).

**Étape B — Ouvrir les variables d’environnement.**  
Dans la recherche Windows (touche Windows, puis tapez du texte), saisissez **variables d'environnement**. Cliquez sur **Modifier les variables d'environnement système**. Dans la fenêtre **Propriétés système**, cliquez sur le bouton **Variables d'environnement…** en bas.

**Étape C — Modifier Path.**  
Dans le cadre **Variables utilisateur** (haut de la fenêtre) ou **Variables système** (bas de la fenêtre), sélectionnez la ligne nommée `Path`, puis cliquez sur **Modifier…**. Cliquez sur **Nouveau**. Collez le chemin du dossier `bin` recopié à l’étape A, par exemple `C:\Program Files\PostgreSQL\17\bin`. Cliquez sur **OK** dans chaque fenêtre jusqu’à tout fermer.

**Étape D — Prendre en compte le changement.**  
Fermez **tous** les terminaux PowerShell déjà ouverts, puis ouvrez-en un **nouveau**. Un terminal déjà ouvert avant la modification ne voit pas encore le nouveau Path.

**Étape E — Vérifier.**  
Dans le nouveau terminal, exécutez :

```bash
psql --version
```

Si un numéro de version s’affiche, le Path est correct. Si le message d’erreur revient, recommencez l’étape A : le numéro de version dans le chemin (`16` ou `17`) doit correspondre au dossier réellement présent sur le disque.

---

## 2. Fichiers de configuration que vous devez créer

Vous ne créez **aucun nouveau dossier**. Vous créez seulement **deux fichiers** qui n’existent pas encore, parce qu’ils contiennent des réglages locaux.

Le dossier `Backend` contient déjà un modèle nommé `Backend/.env.example`.  
Le dossier `Frontend` contient déjà un modèle nommé `Frontend/.env.example`.

Vous allez :

1. créer un fichier nommé `.env` dans `Backend`, puis y coller le contenu de `Backend/.env.example` ;
2. créer un fichier nommé `.env.local` dans `Frontend`, puis y coller le contenu de `Frontend/.env.example`.

| Fichier à créer | Modèle dont vous copiez le contenu | Rôle |
-------------------------------------------------------------------------------------- 
| `Backend/.env` | `Backend/.env.example` | Ports, PostgreSQL, Redis, MinIO, mails, compte admin du seed |
| `Frontend/.env.local` | `Frontend/.env.example` | URL de l’API et secret NextAuth |


Les instructions détaillées sont aux sections 5.2 (Backend) et 6.2 (Frontend).

---

## 3. Où mettre `true` ou `false`

Tous les booléens se règlent dans le fichier **`Backend/.env`**, une fois que vous l’avez créé et rempli. Écrivez exactement `true` ou `false` en minuscules. N’écrivez pas `True`, `1`, `yes` ni `oui` : l’API refuserait de démarrer.

Le fichier `Backend/.env.example` contient déjà les bonnes valeurs pour un ordinateur local. Si vous n’êtes pas sûr, recopiez-les telles quelles :

| Variable | Fichier | Valeur à laisser en local | Ce qui se passe si vous mettez l’autre valeur |
| --- | --- | --- | --- |
| `SWAGGER_ENABLED` | `Backend/.env` | mettre `true` |
| `S3_FORCE_PATH_STYLE` | `Backend/.env` | mettre  **`true`** | 
| `DB_LOGGING` | `Backend/.env` | mettre `false` | car `true` affichera chaque requête SQL dans le terminal de l’API |
| `MAIL_USE_TLS` | `Backend/.env` | mettre `false` |  car `true` sert uniquement si vous branchez un vrai serveur SMTP qui exige STARTTLS comme BREVO|
| `MAIL_USE_SSL` | `Backend/.env` | mettre `false` | `true` uniquement si vous branchez un vrai SMTP en SSL (souvent le port 465) |

Dans `Frontend/.env.local`, il n’y a **aucun** `true` ni `false` à régler.

Deux pièges fréquents, qui ne sont pas des booléens :

- Les lignes `MAIL_USERNAME=` et `MAIL_PASSWORD=` doivent **exister** et rester **vides** : vous écrivez le nom de la variable, le signe égal, et rien derrière. Ne supprimez pas ces lignes. L’API exige leur présence. Elles sont vides parce que Mailpit, en local, n’accepte pas d’identifiant.
- La ligne `MAIL_SANDBOX_TO=sandbox@example.com` n’est pas un booléen. Tant qu’elle est remplie, tous les e-mails partent vers cette adresse au lieu du vrai destinataire. 
En local, Mailpit les affiche quand même sur http://localhost:8025. Vous pouvez laisser l’exemple tel quel.

---

## 4. Ports à ne pas mélanger

Le fichier `Backend/.env.example` contient déjà la ligne `PORT=4000`. Quand vous copierez son contenu dans `Backend/.env`, **laissez 4000**. Le Frontend utilise déjà le port **3000** ; si l’API prenait aussi 3000, les deux programmes se bloqueraient.

| Service | Port | Qui le démarre |
| --- | --- | --- |
| Frontend Next.js | 3000 | la commande `pnpm dev` dans `Frontend` |
| API NestJS | 4000 | la commande `pnpm start:dev` dans `Backend` |
| PostgreSQL | 5432 | le service PostgreSQL installé sur Windows (pas Docker) |
| Redis | 6380 | Docker, via `pnpm db:up` |
| MinIO (fichiers) | 9002 pour l’API, 9003 pour la console web | Docker, via `pnpm db:up` |
| Mailpit | 1025 pour le SMTP, 8025 pour la page web | Docker, via `pnpm db:up` |

Après copie des modèles, ces cinq lignes doivent correspondre. Ne les changez que si vous savez pourquoi.

- Dans `Backend/.env`, la ligne `PORT=4000` doit rester `4000`.
- Dans `Backend/.env`, la ligne `CORS_ORIGINS` doit contenir `http://localhost:3000`.
- Dans `Backend/.env`, la ligne `APP_FRONTEND_URL=http://localhost:3000` doit rester cette URL.
- Dans `Frontend/.env.local`, la ligne `NEXT_PUBLIC_API_URL=http://localhost:4000/api` doit se terminer par `/api`.
- Dans `Frontend/.env.local`, la ligne `NEXTAUTH_URL=http://localhost:3000` doit rester l’URL du site.

---

## 5. Backend — première mise en route

Ouvrez PowerShell et placez-vous dans le dossier `Backend`. Le nom du dossier parent contient un **espace** et un **é** : entourez le chemin de guillemets.

```powershell
cd "C:\chemin\vers\KOLA Balakiyém\Backend"
```

Remplacez `C:\chemin\vers\` par l’emplacement réel du dossier `KOLA Balakiyém` sur votre disque. Pour le connaître, ouvrez l’Explorateur de fichiers, cliquez une fois sur le dossier `Backend`, cliquez dans la barre d’adresse, et copiez le chemin affiché.

### 5.1 Installer les paquets Node du Backend

Toujours dans le dossier `Backend`, exécutez :

```bash
pnpm install
```

Attendez que la commande se termine sans message d’erreur rouge. Un dossier nommé `node_modules` doit alors apparaître à l’intérieur de `Backend`.

### 5.2 Créer le fichier `Backend/.env` puis y copier le contenu de `Backend/.env.example`

Restez dans le dossier `Backend`.

1. Créez un fichier **nouveau** nommé exactement `.env` (point au début, pas d’extension `.txt`). Vous pouvez le faire dans l’Explorateur de fichiers (affichage → extensions de noms de fichiers, puis « Nouveau » → « Document texte », et renommez `Nouveau Document texte.txt` en `.env`) ou avec PowerShell :

```powershell
New-Item -Path .env -ItemType File
```

2. Ouvrez le fichier `Backend/.env.example` avec un éditeur de texte (Bloc-notes, VS Code, Cursor). Sélectionnez **tout** son contenu (Ctrl + A) et copiez-le (Ctrl + C).

3. Ouvrez le fichier `Backend/.env` que vous venez de créer. Collez le contenu (Ctrl + V) et enregistrez le fichier.

Vous pouvez aussi faire les trois étapes d’un coup dans PowerShell, toujours depuis `Backend` :

```powershell
Copy-Item .env.example .env
```

Sous macOS ou Linux, la commande équivalente est :

```bash
cp .env.example .env
```

4. Rouvrez `Backend/.env` et vérifiez, sans tout réécrire, que les lignes suivantes sont présentes :

- `PORT=4000`
- les cinq booléens de la section 3 (`SWAGGER_ENABLED=true`, `S3_FORCE_PATH_STYLE=true`, `DB_LOGGING=false`, `MAIL_USE_TLS=false`, `MAIL_USE_SSL=false`)
- `DB_USERNAME=ticket_checker`
- `DB_PASSWORD=ticket_checker`
- `DB_NAME=ticket_checker`
- `DB_PORT=5432`

Si votre PostgreSQL utilise **d’autres** identifiants que `ticket_checker`, ne changez que les lignes `DB_*` pour qu’elles correspondent à **votre** serveur. Laissez le reste tel quel.

Les lignes `JWT_ACCESS_SECRET` et `JWT_REFRESH_SECRET` de l’exemple font plus de 32 caractères. C’est suffisant pour travailler en local.

### 5.3 Démarrer Redis, MinIO et Mailpit

Ouvrez Docker Desktop et attendez que le moteur soit prêt.

Toujours dans le dossier `Backend`, exécutez :

```bash
pnpm db:up
```

Cette commande est équivalente à `docker compose up -d`. La première fois, Docker télécharge les images : cela peut durer plusieurs minutes. Les fois suivantes, le démarrage est beaucoup plus court.

Quand la commande a réussi, vous pouvez contrôler :

- la console MinIO à l’adresse http://localhost:9003, avec l’identifiant `minioadmin` et le mot de passe `minioadmin12345` ;
- Mailpit (les e-mails de test) à l’adresse http://localhost:8025.

Pour arrêter plus tard Redis, MinIO et Mailpit **sans** arrêter PostgreSQL, exécutez, toujours dans `Backend` :

```bash
pnpm db:down
```

### 5.4 Créer l’utilisateur et la base PostgreSQL

Le service PostgreSQL doit être démarré (icône dans la barre des tâches, ou service Windows « postgresql »).

Ouvrez **SQL Shell (psql)** depuis le menu Démarrer, ou tapez `psql -U postgres` dans un terminal. Connectez-vous avec le mot de passe du superutilisateur `postgres` noté à l’installation. Puis exécutez ces trois commandes SQL, une après l’autre :

```sql
CREATE USER ticket_checker WITH PASSWORD 'ticket_checker';
CREATE DATABASE ticket_checker OWNER ticket_checker;
GRANT ALL PRIVILEGES ON DATABASE ticket_checker TO ticket_checker;
```

Si psql répond que l’utilisateur ou la base existe déjà, ce n’est pas une erreur bloquante : passez à la section suivante.

Si vous avez choisi un mot de passe, un nom de base ou un port **différents** de ceux de l’exemple, n’exécutez pas ces trois commandes telles quelles. Créez plutôt l’utilisateur et la base que vous voulez, puis ouvrez `Backend/.env` et alignez les lignes `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD` et `DB_NAME` sur ce que vous venez de créer.

### 5.5 Créer les tables (migrations)

Restez dans le dossier `Backend`. Le fichier `.env` doit exister, et PostgreSQL doit accepter la connexion. Exécutez :

```bash
pnpm migration:run
```

Sans cette commande, l’API peut démarrer mais les tables n’existent pas : le login et le reste de l’application échoueront.

### 5.6 Remplir les données de départ (seed)

Toujours dans `Backend`, exécutez :

```bash
pnpm seed
```

Cette commande crée, uniquement s’ils n’existent pas déjà :

- un compte **administrateur**, dont l’identifiant et le mot de passe sont les valeurs `SEED_ADMIN_USERNAME`, `SEED_ADMIN_EMAIL` et `SEED_ADMIN_PASSWORD` de `Backend/.env` ;
- les délais SLA par priorité ;
- des compétences (Électricité, Plomberie, et d’autres) ;
- des catégories de tickets liées à ces compétences.

Vous pouvez relancer `pnpm seed` sans danger : ce qui existe déjà n’est pas recopié une seconde fois.

Si vous n’avez pas modifié les lignes `SEED_ADMIN_*` après la copie de `.env.example`, le compte administrateur est :

| Champ | Valeur |
| --- | --- |
| Identifiant | `admin` ou `admin@ticket-checker.local` |
| Mot de passe | `Admin@1234` |

### 5.7 Lancer l’API

Toujours dans `Backend`, exécutez :

```bash
pnpm start:dev
```

**Laissez ce terminal ouvert.** Vous devez y lire un message indiquant que l’application écoute, avec le chemin `/api`.

Vérifiez ensuite dans le navigateur :

- http://localhost:4000/docs affiche la documentation Swagger ;
- http://localhost:4000/api répond (une page JSON, même avec un message d’erreur, prouve que le serveur est vivant).

Ne commencez le Frontend que lorsque cette étape fonctionne.

---

## 6. Frontend — première mise en route

Ouvrez un **deuxième** terminal PowerShell. Ne fermez pas le premier : l’API doit continuer à tourner.

Placez-vous dans le dossier `Frontend` :

```powershell
cd "C:\chemin\vers\KOLA Balakiyém\Frontend"
```

Remplacez encore une fois `C:\chemin\vers\` par le chemin réel sur votre machine.

### 6.1 Installer les paquets Node du Frontend

Toujours dans le dossier `Frontend`, exécutez :

```bash
pnpm install
```

Attendez la fin sans erreur. Un dossier `node_modules` doit apparaître dans `Frontend`.

### 6.2 Créer le fichier `Frontend/.env.local` puis y copier le contenu de `Frontend/.env.example`

Restez dans le dossier `Frontend`. Le fichier à créer s’appelle **`.env.local`**, pas `.env`. Next.js lit `.env.local` en priorité pour la machine de développement. Placez-le à la racine de `Frontend`, à côté du fichier `package.json`.

1. Créez un fichier **nouveau** nommé exactement `.env.local` (point au début, pas d’extension `.txt`). Dans PowerShell, depuis `Frontend` :

```powershell
New-Item -Path .env.local -ItemType File
```

2. Ouvrez le fichier `Frontend/.env.example`. Sélectionnez **tout** son contenu (Ctrl + A) et copiez-le (Ctrl + C).

3. Ouvrez le fichier `Frontend/.env.local` que vous venez de créer. Collez le contenu (Ctrl + V) et enregistrez.

Vous pouvez aussi copier le fichier d’un coup, toujours depuis `Frontend` :

```powershell
Copy-Item .env.example .env.local
```

Sous macOS ou Linux :

```bash
cp .env.example .env.local
```

4. Ouvrez `Frontend/.env.local` et remplacez la valeur de `NEXTAUTH_SECRET`. Ce n’est pas un mot de passe de compte : c’est une clé que NextAuth utilise pour signer la session. Dans un terminal, générez une valeur avec :

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Copiez la ligne affichée. Dans `Frontend/.env.local`, remplacez `remplacez-moi-par-une-longue-chaine-secrete` par cette ligne. Enregistrez le fichier.

Les deux autres lignes doivent rester :

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXTAUTH_URL=http://localhost:3000
```

La première ligne **doit** se terminer par `/api`. Si vous changez `.env.local` plus tard, arrêtez `pnpm dev` avec Ctrl + C puis relancez-le : Next.js ne relit pas toujours ces variables tant que le serveur tourne.

### 6.3 Lancer le site

Toujours dans `Frontend`, exécutez :

```bash
pnpm run
```ensuite```
pnpm dev
```

Ouvrez ensuite **http://localhost:3000/login**.  
La page http://localhost:3000/ n’est pas l’entrée de l’application : allez bien sur `/login`.

---

## 7. Connexion

Avant d’ouvrir le navigateur, vérifiez que les deux terminaux tournent encore :

1. Dans le terminal **Backend**, la commande `pnpm start:dev` n’a pas été arrêtée.
2. Dans le terminal **Frontend**, la commande `pnpm dev` n’a pas été arrêtée.
3. Le navigateur est ouvert sur http://localhost:3000/login.
4. Vous vous connectez avec le compte du seed : identifiant **admin** et mot de passe **Admin@1234** (sauf si vous avez modifié `SEED_ADMIN_*` dans `Backend/.env`).

La page `/register` crée un compte **client**, pas un administrateur.  
Les comptes **technicien** se créent ensuite dans l’interface, une fois connecté en administrateur, via le menu Techniciens.

Le mode d’emploi des écrans, une fois l’application lancée, se trouve dans le fichier `Frontend/docs/MANUEL_UTILISATEUR.md`.

---

## 8. Les jours suivants (quand tout est déjà installé)

Vous n’avez plus à recréer `.env`, ni à relancer `pnpm install`, ni à rejouer les migrations, sauf si on vous donne une nouvelle version du projet avec des fichiers de migration en plus.

À chaque session de travail, dans cet ordre :

1. Démarrez **Docker Desktop** et attendez que le moteur soit prêt.
2. Démarrez **PostgreSQL** (service Windows, ou l’application PostgreSQL).
3. Ouvrez un premier terminal, allez dans `Backend`, puis lancez Redis / MinIO / Mailpit et l’API :

```powershell
cd "C:\chemin\vers\KOLA Balakiyém\Backend"
pnpm db:up
pnpm start:dev
```

4. Ouvrez un second terminal, allez dans `Frontend`, puis lancez le site :

```powershell
cd "C:\chemin\vers\KOLA Balakiyém\Frontend"
pnpm dev
```

5. Ouvrez http://localhost:3000/login.

---

## 9. Commandes utiles (en dehors du chemin principal)

### Dans le dossier `Backend`

| Commande | Ce qu’elle fait |
| --- | --- |
| `pnpm db:up` | Démarre Redis, MinIO et Mailpit |
| `pnpm db:down` | Arrête Redis, MinIO et Mailpit |
| `pnpm migration:run` | Crée ou met à jour les tables PostgreSQL |
| `pnpm seed` | Crée l’administrateur et les données de référence |
| `pnpm start:dev` | Lance l’API et la recharge à chaque modification du code |
| `pnpm build` | Compile l’API pour un usage type production |
| `pnpm test` | Lance les tests unitaires |
| `pnpm test:e2e` | Lance les tests de bout en bout (PostgreSQL et Redis doivent déjà tourner) |

Ne lancez pas `pnpm migration:generate`. Les fichiers de migration sont déjà présents dans `Backend/src/database/migrations`.

### Dans le dossier `Frontend`

| Commande | Ce qu’elle fait |
| --- | --- |
| `pnpm dev` | Lance le site en développement (commande habituelle) |
| `pnpm dev:turbo` | Lance le site avec Turbopack au lieu de webpack |
| `pnpm dev:clean` | Supprime le cache `.next` puis relance `pnpm dev` |
| `pnpm build` | Prépare le site pour la production |
| `pnpm start` | Sert le site déjà construit par `pnpm build` |
| `pnpm lint` | Vérifie le code avec ESLint |

---

## 10. Si ça ne marche pas

| Ce que vous voyez | Cause fréquente | Que faire |
| --- | --- | --- |
| `pnpm db:up` échoue | Docker Desktop n’est pas démarré | Ouvrez Docker Desktop, attendez le moteur, relancez `pnpm db:up` dans `Backend` |
| L’API parle de Redis ou affiche `ECONNREFUSED` sur le port 6380 | Redis n’est pas lancé | Dans `Backend`, exécutez `pnpm db:up` |
| `Environment validation failed` | Le fichier `Backend/.env` n’existe pas, est incomplet, ou un booléen n’est pas écrit `true` / `false` | Recréez `Backend/.env` en y collant le contenu de `Backend/.env.example`, puis relisez la section 3 |
| Erreur de connexion Postgres sur le port 5432 | PostgreSQL est arrêté, ou les lignes `DB_*` ne correspondent pas à votre serveur | Démarrez PostgreSQL, puis alignez `Backend/.env` |
| `psql` n’est pas reconnu | Le dossier `bin` de PostgreSQL n’est pas dans Path | Suivez la section 1.4.1, fermez le terminal, ouvrez-en un nouveau |
| Tables introuvables, ou erreur SQL au login | Les migrations n’ont pas été jouées | Dans `Backend`, exécutez `pnpm migration:run`, puis éventuellement `pnpm seed` |
| Login refusé pour le compte admin | Le seed n’a pas été lancé, ou le mot de passe n’est plus celui de l’exemple | Dans `Backend`, exécutez `pnpm seed`, puis vérifiez `SEED_ADMIN_*` dans `Backend/.env` |
| Le site affiche une erreur réseau ou CORS | L’API est arrêtée, ou les ports / URL ne correspondent pas | Relancez `pnpm start:dev`, puis vérifiez la section 4 |
| Le site n’appelle pas la bonne URL | `Frontend/.env.local` n’existe pas, la ligne API n’a pas `/api`, ou `pnpm dev` n’a pas été relancé | Recréez `Frontend/.env.local` à partir de `Frontend/.env.example`, puis relancez `pnpm dev` |
| Message « port already in use » | Un ancien `pnpm dev` ou `pnpm start:dev` tourne encore | Fermez le terminal concerné, ou arrêtez le processus, puis relancez |
| http://localhost:4000/docs répond 404 | `SWAGGER_ENABLED` vaut `false` dans `Backend/.env` | Remettez `SWAGGER_ENABLED=true`, enregistrez, relancez `pnpm start:dev` |
| L’envoi d’un fichier échoue | MinIO est arrêté, ou `S3_FORCE_PATH_STYLE` vaut `false` | Exécutez `pnpm db:up` et gardez `S3_FORCE_PATH_STYLE=true` |
| « Mot de passe oublié » : aucun mail | Mailpit n’est pas lancé | Ouvrez http://localhost:8025 et, si la page ne charge pas, relancez `pnpm db:up` |

---

## 11. Rappel de l’ordre (première fois)

1. Installez Docker Desktop, Node.js, pnpm et PostgreSQL. Si `psql` n’est pas reconnu, ajoutez le dossier `bin` de PostgreSQL au Path (section 1.4.1).
2. Dans **`Backend`** : exécutez `pnpm install`. Créez le fichier `.env`, puis copiez dedans tout le contenu de `.env.example`. Exécutez `pnpm db:up`. Créez l’utilisateur et la base PostgreSQL. Exécutez `pnpm migration:run`, puis `pnpm seed`, puis `pnpm start:dev`.
3. Dans **`Frontend`** : exécutez `pnpm install`. Créez le fichier `.env.local`, puis copiez dedans tout le contenu de `.env.example`. Remplacez `NEXTAUTH_SECRET`. Exécutez `pnpm dev`.
4. Ouvrez http://localhost:3000/login et connectez-vous avec **admin** / **Admin@1234**.
