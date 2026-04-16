# Salle Les Vennes — Agenda partagé

Application web pour réserver la salle de réunion des Vennes.

## Fonctionnalités

- Inscription libre (username + email + mot de passe)
- Vue calendrier hebdomadaire (Lun–Dim, 07:00–21:00, créneaux 30 min)
- Réservation à durée libre (début/fin au choix)
- Détection automatique des conflits (impossible de réserver un créneau chevauchant)
- Invitation calendrier (`.ics`) envoyée via Office365 SMTP à l'organisateur + invités
- Sauvegarde automatique (brouillon local + enregistrement serveur) + bouton manuel ↻ Rafraîchir
- Polling automatique toutes les 30s pour voir les réservations des autres
- Modification/suppression réservée au propriétaire de la réservation

## Installation locale

```bash
cd salle-vennes
npm install
cp .env.example .env
# Éditer .env avec tes identifiants Office365
npm start
```

Ouvrir http://localhost:3000

## Configuration Office365

Dans `.env` :

```
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_USER=ton.email@tondomaine.com
SMTP_PASS=mot-de-passe-application
SMTP_FROM=ton.email@tondomaine.com
```

Si l'authentification multifacteur est activée sur ton compte Microsoft 365, tu dois **générer un mot de passe d'application** :
1. Aller sur https://account.microsoft.com/security → options de sécurité avancées
2. Créer un nouveau "mot de passe d'application"
3. Coller la valeur dans `SMTP_PASS`

## Déploiement sur Render (gratuit)

1. Crée un compte sur https://render.com
2. Pousse ce dossier sur GitHub
3. Sur Render : "New +" → "Web Service" → connecte le repo
4. Render détecte `render.yaml` automatiquement
5. Renseigne les variables `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` dans le dashboard
6. Deploy

⚠️ Sur le plan gratuit de Render, le service s'endort après 15 min d'inactivité (premier accès peut prendre 30s). Pour un usage pro, passer en plan payant (~7$/mois).

## Déploiement sur Railway

1. Pousser sur GitHub
2. https://railway.app → "New Project" → "Deploy from GitHub"
3. Ajouter les variables d'environnement (voir `.env.example`)
4. Railway détecte Node.js automatiquement

## Base de données

SQLite (fichier `data.db` créé automatiquement). Pour backup, copier le fichier.
