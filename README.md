# Grist — Widget Recherche Avancée

Widget de recherche multi-colonnes avec syntaxe avancée pour Grist.

## Fichiers

```
grist-widget-package/
├── index.html      ← Widget principal
├── manifest.json   ← Métadonnées Grist Custom Gallery
└── README.md       ← Ce fichier
```

## Installation dans Grist

### Option A — Hébergement externe (recommandé)

1. Hébergez les deux fichiers (`index.html` + `manifest.json`) sur un serveur web ou GitHub Pages.
2. Dans Grist, ajoutez une section **Widget personnalisé**.
3. Dans les paramètres du widget, collez l'URL de votre `index.html`.
4. Choisissez l'accès **"Lire la table"**.
5. Liez la section à votre table de données.

### Option B — Grist Custom Widget Gallery (auto-hébergé)

Si vous gérez votre propre instance Grist, ajoutez dans votre `config.json` :

```json
{
  "widgets": [
    {
      "name": "Recherche avancée",
      "url": "https://votre-domaine.com/grist-widgets/search/index.html",
      "description": "Recherche avancée multi-colonnes avec filtrage live",
      "icon": "search",
      "accessLevel": "read table"
    }
  ]
}
```

### Option C — GitHub Pages (gratuit)

1. Créez un dépôt GitHub public.
2. Placez `index.html` et `manifest.json` dedans.
3. Activez GitHub Pages (branche `main`, dossier `/root`).
4. URL du widget : `https://votre-user.github.io/votre-repo/index.html`

---

## Syntaxe de recherche

| Syntaxe | Effet |
|---------|-------|
| `mot1 mot2` | OR — au moins un mot présent |
| `& mot1 mot2` | AND — tous les mots dans la ligne |
| `&& mot1 mot2` | AND — tous les mots dans la même colonne |
| `!mot` | Négation — le mot ne doit pas être présent |
| `=mot` | Égalité exacte (espaces → `\s`) |
| `<mot` | La cellule commence par ce mot |
| `>mot` | La cellule finit par ce mot |
| `"mot clé"` | Expression entre guillemets = un seul mot |
| `'mot` | Mot indépendant (`ok` ne correspond pas à `books`) |
| `mot@Col1,Col2` | Cherche ce mot dans Col1 et Col2 seulement |
| `@Col1,Col2` | Restreint tous les mots à ces colonnes |
| `/regex/` | Expression régulière (`\s` = espace) |

---

## Partage entre widgets (Session ID)

Pour synchroniser deux widgets de recherche sur la même page :
1. Activez **"Sauvegarder la recherche"** dans les deux widgets.
2. Donnez le **même Session ID** aux deux (ex: `search-main`).
3. Les deux widgets partageront leur état via `sessionStorage` + broadcast.

---

## Comportement si la recherche est vide

Par défaut : **0 lignes affichées** (aucune ligne sélectionnée).
