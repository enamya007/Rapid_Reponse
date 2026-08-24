# Rapid Response — Guide d’utilisation

**Application de gestion des interventions techniques**  
Version du guide : août 2026

Ce document explique comment utiliser Rapid Response au quotidien : connexion, création et suivi des tickets, rôles, et actions disponibles selon votre profil.

---

## 1. À quoi sert Rapid Response ?

Rapid Response permet de **signaler un problème technique**, de **l’assigner à un technicien**, de **suivre l’intervention** et de **clôturer le ticket** une fois le problème réglé.

Trois types de comptes existent :

| Rôle | Qui est-ce ? | Accès principal |
| --- | --- | --- |
| **Client** | Personne qui signale un incident | Ses tickets, tableau de bord, paramètres |
| **Technicien** | Intervenant terrain | Tickets qui lui sont affectés, tableau de bord, paramètres |
| **Administrateur** | Gestionnaire de la plateforme | Tous les tickets, utilisateurs, techniciens, statistiques |

---

## 2. Premiers pas

### 2.1 Se connecter

1. Ouvrez l’application (adresse fournie par votre organisation, souvent `http://localhost:3000` en local).
2. Saisissez votre **identifiant** (nom d’utilisateur ou e-mail) et votre **mot de passe**.
3. Cliquez sur **Se connecter**.

Vous arrivez ensuite sur le **tableau de bord**.

### 2.2 Créer un compte (client)

Sur l’écran de connexion, passez en mode **Créer un compte**. Renseignez :

- nom complet ;
- e-mail ;
- numéro de téléphone (obligatoire) ;
- mot de passe (au moins 10 caractères) ;
- confirmation du mot de passe.

Le compte créé est un compte **client**. Les comptes **technicien** et **administrateur** sont créés par un administrateur.

### 2.3 Mot de passe oublié

1. Cliquez sur **Mot de passe oublié**.
2. Saisissez l’e-mail du compte.
3. Ouvrez le lien reçu par e-mail (page **Réinitialiser le mot de passe**).
4. Choisissez un nouveau mot de passe.

> Il n’est pas possible de changer le mot de passe depuis l’application une fois connecté. Utilisez toujours **Mot de passe oublié**.

---

## 3. L’écran principal

Après connexion, l’interface se compose de :

- **Barre latérale gauche** : navigation et bouton **Se déconnecter**.
- **Barre du haut** : fil d’Ariane (rôle / page) et **cloche de notifications**.
- **Zone centrale** : contenu de la page.

### 3.1 Notifications

La cloche affiche les alertes liées à vos tickets (affectation, commentaires, etc.).  
Cliquez sur une notification pour ouvrir le ticket concerné. **Tout lu** marque toutes les notifications comme lues.

### 3.2 Menu selon le rôle

| Menu | Client | Technicien | Administrateur |
| --- | :---: | :---: | :---: |
| Tableau de bord | Oui | Oui | Oui |
| Tickets | Oui | Oui | Oui |
| Techniciens | — | — | Oui |
| Utilisateurs | — | — | Oui |
| Statistiques | — | — | Oui |
| Paramètres | Oui | Oui | Oui |

---

## 4. Cycle de vie d’un ticket

Un ticket passe par des **statuts**. On ne choisit pas le statut librement : on déclenche une **action**.

```
Ouvert → Affecté → En cours → Résolu → Fermé
                ↘ Annulé (depuis Ouvert, Affecté ou En cours selon le rôle)
```

| Statut à l’écran | Signification |
| --- | --- |
| **Ouvert** | Ticket créé, pas encore affecté |
| **Affecté** | Un technicien a été désigné |
| **En cours** | Le technicien a pris en charge l’intervention |
| **Résolu** | Le technicien a marqué le problème comme réglé |
| **Fermé** | Le client (ou l’admin) a validé la clôture |
| **Annulé** | Le ticket n’est plus traité |

**Priorités** : Basse, Moyenne, Haute, Urgente.

---

## 5. Guide client

Le client voit **ses propres tickets**.

### 5.1 Tableau de bord

Vue d’ensemble : tickets ouverts, en cours, urgents, résolus, et les 5 derniers tickets.

### 5.2 Créer un ticket

1. Allez dans **Tickets**.
2. Cliquez sur **Créer un ticket**.
3. Remplissez :
   - **Titre**
   - **Site / lieu d’intervention** (obligatoire)
   - **Catégorie**
   - **Priorité**
   - **Description**
4. Cliquez sur **Créer le ticket**.

Le ticket apparaît avec une référence du type `TCK-000004`, au statut **Ouvert**.

### 5.3 Suivre un ticket

Dans la liste, cliquez sur le titre ou **Voir**. Vous trouvez :

- la description et le lieu ;
- le statut, la priorité, le technicien (s’il y en a un) ;
- les **commentaires** ;
- les **pièces jointes**.

Vous pouvez modifier le titre, la description, la catégorie, la priorité et le lieu **uniquement tant que le ticket est Ouvert**.

### 5.4 Actions du client

| Situation | Action | Effet |
| --- | --- | --- |
| Ticket **Ouvert** | **Annuler** | Le ticket passe à Annulé (motif optionnel) |
| Ticket **Résolu** | **Réouvrir** | Le ticket reprend un traitement (motif obligatoire) |
| Ticket **Résolu** | **Clôturer** | Le ticket passe à Fermé |

Le client **ne peut pas** affecter un technicien, démarrer l’intervention, ni marquer le ticket comme résolu.

### 5.5 Commentaires et fichiers

- Ajoutez un commentaire public pour échanger avec le support.
- Ajoutez une photo ou un document via **Ajouter un fichier**.

### 5.6 Paramètres

La fiche profil est en **lecture seule**. Pour le mot de passe, utilisez **Mot de passe oublié**.

---

## 6. Guide technicien

Le technicien voit **uniquement les tickets qui lui sont affectés**. Il ne crée pas de tickets et n’accède pas aux pages Utilisateurs, Techniciens et Statistiques.

### 6.1 Tableau de bord

- Indicateurs de charge (ex. `2/5` tickets en parallèle).
- Bouton **Disponible / Indisponible** : indique si vous pouvez recevoir de nouveaux tickets.

### 6.2 Prendre en charge un ticket

Quand un ticket vous est affecté, son statut est **Affecté**.

1. Ouvrez le ticket.
2. Cliquez sur **Prendre en charge**.
3. Le statut passe à **En cours**.

### 6.3 Marquer comme résolu

1. Une fois l’intervention terminée, cliquez sur **Marquer résolu**.
2. Saisissez une **note de résolution** (obligatoire).
3. Le statut passe à **Résolu**. Le client (ou l’admin) pourra ensuite clôturer ou réouvrir.

Le technicien **ne peut pas** modifier les champs du ticket (titre, priorité, etc.) ni l’affecter à un collègue.

### 6.4 Commentaires internes

Administrateurs et techniciens peuvent publier un commentaire **interne** (non visible du client) ou **public**.

---

## 7. Guide administrateur

L’administrateur gère la plateforme : tickets, comptes, techniciens et statistiques.

### 7.1 Tickets

L’admin voit **tous** les tickets. Il peut :

- **créer** un ticket (comme un client) ;
- **filtrer** par statut, priorité, technicien ;
- **rechercher** (barre de la page Tickets) ;
- **affecter** ou **réaffecter** un technicien (statuts Ouvert ou Affecté) ;
- **prendre en charge** un ticket déjà affecté ;
- **annuler** un ticket Ouvert, Affecté ou En cours ;
- **réouvrir** ou **clôturer** un ticket Résolu ;
- **modifier** les informations du ticket.

> Seul le **technicien assigné** peut cliquer sur **Marquer résolu**. L’admin affecte et suit, mais ne clôture pas l’intervention à la place du technicien.

#### Affecter un technicien

1. Dans la liste ou le détail, cliquez sur **Affecter**.
2. Choisissez un technicien parmi les **suggestions** (charge, compétences).
3. En cas de **réaffectation**, un **motif** est obligatoire.
4. Confirmez. Le ticket passe à **Affecté**.

### 7.2 Utilisateurs

Page réservée à l’admin. Elle gère les comptes **clients** et **administrateurs**.

- **Ajouter un utilisateur** : identifiant, e-mail, prénom, nom, téléphone (obligatoire), mot de passe (10 caractères, majuscule, minuscule, chiffre), rôle Client ou Administrateur.
- **Modifier** : informations, rôle (sauf votre propre compte), **statut Actif / Désactivé**.
- **Désactiver** : la personne ne peut plus se connecter.
- **Réactiver** : bouton **Réactiver** dans le tableau, ou **Statut → Actif** dans Modifier.
- **Supprimer** : suppression logique. Impossible sur votre propre compte, et parfois bloquée s’il reste des tickets ouverts.

Les **techniciens ne se créent pas ici** : utilisez la page **Techniciens**.

Vous ne pouvez pas désactiver ni supprimer **votre propre compte**.

### 7.3 Techniciens

- Consulter la liste, la disponibilité et la charge (`actuel / maximum`).
- **Gérer les compétences** (créer un skill, ex. « Réseau », « Climatisation »).
- **Ajouter un technicien** : identifiant, e-mail, mot de passe, téléphone, charge maximale, compétences.

La disponibilité du technicien se règle sur **son** tableau de bord (`PATCH` de sa propre disponibilité).

### 7.4 Statistiques

Indicateurs calculés à partir des tickets :

- total, en cours, résolus, urgents ;
- répartition par statut ;
- tendance (tickets créés par jour) ;
- charge des techniciens.

Filtres de période : **7 jours**, **30 jours**, **Tout**.  
Bouton **Exporter CSV** pour télécharger les tickets de la période.

### 7.5 Paramètres

L’administrateur peut **modifier son profil** (identifiant, e-mail, nom, téléphone).  
Le rôle et l’activation ne se changent pas ici.

---

## 8. Tableau récapitulatif des actions sur un ticket

| Action | Client (son ticket) | Technicien (ticket assigné) | Admin |
| --- | --- | --- | --- |
| Créer | Oui | Non | Oui |
| Modifier les infos | Oui, si **Ouvert** | Non | Oui |
| Affecter / réaffecter | Non | Non | Oui (Ouvert ou Affecté) |
| Prendre en charge | Non | Oui si **Affecté** | Oui si **Affecté** |
| Marquer résolu | Non | Oui si **En cours** | Non |
| Annuler | Oui si **Ouvert** | Non | Oui si Ouvert, Affecté ou En cours |
| Réouvrir | Oui si **Résolu** | Non | Oui si **Résolu** |
| Clôturer | Oui si **Résolu** | Non | Oui si **Résolu** |
| Commenter / joindre un fichier | Oui | Oui | Oui |

---

## 9. Questions fréquentes

**Je ne vois pas le menu Techniciens / Utilisateurs / Statistiques.**  
Ces pages sont réservées à l’administrateur.

**Pourquoi je ne peux pas changer le statut dans une liste déroulante ?**  
Le statut avance uniquement via les boutons (Affecter, Prendre en charge, Marquer résolu, etc.). Cela évite les incohérences.

**Mon ticket reste « Résolu » et n’est jamais fermé.**  
Après résolution, le **client** (ou l’admin) doit cliquer sur **Clôturer**.

**Je ne peux pas modifier mon nom ou mon téléphone (client / technicien).**  
Seuls les administrateurs peuvent modifier un compte. Demandez à un admin, ou utilisez **Mot de passe oublié** pour le mot de passe.

**Le bouton Créer un ticket est grisé.**  
Vérifiez que le titre, la description, la catégorie et le **site / lieu d’intervention** sont remplis.

**Impossible de créer un technicien depuis Utilisateurs.**  
C’est normal. Allez dans **Techniciens → Ajouter**.

**Un compte désactivé ne peut plus se connecter.**  
Un administrateur le réactive via **Réactiver** ou **Modifier → Statut → Actif**.

---

## 10. Bonnes pratiques

- Décrivez clairement le problème et le **lieu exact** d’intervention.
- Choisissez la bonne **priorité** (Urgente seulement en cas d’impact fort).
- Joignez une photo si cela aide le diagnostic.
- Techniciens : passez **Indisponible** si vous ne pouvez plus prendre de tickets.
- Clients : **clôturez** le ticket une fois le service rendu, ou **réouvrez** s’il reste un problème (avec un motif).

---

*Document destiné aux utilisateurs de Rapid Response. Pour l’installation technique (API, variables d’environnement), se reporter à la documentation projet.*
