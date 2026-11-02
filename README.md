# IMO SN

Site vitrine et catalogue immobilier de l’agence IMO SN. Les biens et campagnes publicitaires sont créés, validés et administrés exclusivement par l’équipe IMO SN. Aucun compte bailleur ni formulaire de publication publique n’est proposé.

## Développement local

Prérequis : Node.js 18 ou ultérieur.

1. Installer les dépendances : `npm install`
2. Copier `.env.example` vers `.env`.
3. Renseigner `JWT_SECRET` avec au moins 32 caractères aléatoires, ainsi que `ADMIN_EMAIL` et un `ADMIN_PASSWORD` unique d’au moins 12 caractères.
4. Démarrer le serveur : `npm start`
5. Ouvrir `http://localhost:10000` et accéder à `http://localhost:10000/admin.html` pour administrer le site.

La première exécution crée le seul compte administrateur à partir de `ADMIN_EMAIL` et `ADMIN_PASSWORD`. Il n’existe aucune route d’inscription. Les réinitialisations de mot de passe nécessitent les variables SMTP.

Pour générer un secret JWT localement avec Node.js :

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Les photos d’un bien sont limitées à 10 fichiers JPEG, PNG ou WebP de 2 Mo maximum chacun.

## Données et déploiement

L’application actuellement en place persiste les annonces, demandes, campagnes, comptes et réglages dans `data/db.json`. La variable `DATA_FILE` permet de choisir un autre chemin. Le fichier de données est exclu des ressources statiques et ne peut pas être téléchargé depuis le site.

### Supabase (PostgreSQL)

1. Créez un projet Supabase et exécutez `supabase-schema.sql` dans le SQL Editor du projet.
2. Copiez le Project URL et créez une clé secrète serveur (`sb_secret_...`) depuis les paramètres API du projet.
3. En local, ajoutez `SUPABASE_URL` et `SUPABASE_SECRET_KEY` à `.env`. Sur Render, ajoutez les mêmes variables dans **Environment**.
4. Redémarrez le serveur. Au premier démarrage, le contenu de `data/db.json` est importé dans Supabase si la table est vide. Ensuite, Supabase devient la source de vérité.

La clé publishable (`sb_publishable_...`) est publique et ne permet pas à elle seule au serveur d’écrire les données. Elle ne remplace jamais la clé secrète serveur, qui doit rester dans les variables d’environnement privées et ne doit pas être ajoutée au frontend, au dépôt ou à cette conversation. Si les deux variables Supabase sont absentes, l’application conserve le mode `data/db.json`; si une seule est renseignée, le serveur refuse de démarrer.

La persistance Supabase conserve l’état complet actuel de l’application, y compris les annonces, les comptes administrateurs, les demandes, les publicités, la configuration et les messages. Le backend continue à appliquer l’authentification existante et utilise exclusivement la clé secrète serveur. N’accordez pas d’accès direct `anon`/`authenticated` à la table. Le modèle actuel charge l’état en mémoire : déployez une seule instance du serveur pour éviter les écritures concurrentes entre instances.

Le système de fichiers du plan Render gratuit est éphémère, mais les données de Supabase survivent aux redéploiements. Sur Render, configurez également `JWT_SECRET`, `ADMIN_EMAIL` et `ADMIN_PASSWORD` dans les variables privées du service. N’ajoutez aucun secret au code ou au frontend. `FRONTEND_URL` doit correspondre à l’origine du site lorsque l’API est appelée depuis un domaine distinct.
