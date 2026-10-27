# Mermaid Preview — extension Chrome et Firefox

Affiche un aperçu des diagrammes [Mermaid](https://mermaid.js.org/) écrits dans des blocs de code
(issues Jira, Confluence, GitLab, wikis…).

- L'extension repère les blocs de code de la page (`<pre>`, `<code>` multi‑lignes, y compris dans l'éditeur Jira).
- Si le bloc contient du Mermaid, une icône apparaît dans son coin supérieur droit.
- Au survol de l'icône, une infobulle affiche le diagramme rendu.
  - Un clic sur l'icône épingle l'infobulle ; `Échap` ou un clic ailleurs la ferme.
  - L'aperçu se met à jour si le code est modifié pendant qu'il est ouvert.
  - Pour les grands diagrammes, des loupes **+** / **−** permettent de zoomer (le pourcentage, au milieu, réinitialise
    la vue). On peut aussi zoomer avec `Ctrl` + molette (ou le pincement du trackpad), un double‑clic (`Maj` +
    double‑clic pour dézoomer) ou les touches `+` / `-` / `0`, et se déplacer en faisant glisser le diagramme, avec la
    molette ou avec les flèches. Dès qu'on zoome ou qu'on se déplace, l'infobulle reste ouverte jusqu'à `Échap` ou un
    clic ailleurs.
  - Le thème clair/sombre suit celui de la page.

## Installation (mode développeur)

Aucune étape de build n'est nécessaire : la bibliothèque Mermaid est fournie dans `vendor/`.

**Chrome / Edge**

1. Ouvrir `chrome://extensions`.
2. Activer le **mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner ce dossier.

**Firefox** (version 140 ou plus récente)

1. Générer le paquet Firefox : `npm run package:firefox`.
2. Ouvrir `about:debugging#/runtime/this-firefox`.
3. Cliquer sur **Charger un module complémentaire temporaire…** et choisir `dist/mermaid-preview-<version>-firefox.zip`.

Le module reste chargé jusqu'au redémarrage de Firefox. Si les icônes n'apparaissent pas, vérifier dans
`about:addons` → Mermaid Preview → **Permissions** que l'accès aux sites est autorisé.

## Détection

Un bloc est considéré comme Mermaid si :

- il porte une indication de langage `mermaid` (`class="language-mermaid"`, `data-language="mermaid"`, …), **ou**
- sa première ligne utile (après un éventuel front matter `---`, les directives `%%{init}%%` et les commentaires `%%`)
  est un en-tête de diagramme : `graph TD`, `flowchart LR`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`,
  `erDiagram`, `gantt`, `pie`, `gitGraph`, `mindmap`, `timeline`, `C4Context`, `xychart-beta`, etc.

Jira ne proposant pas « mermaid » dans sa liste de langages, la détection par contenu permet de laisser le langage
du bloc sur « aucun » (ou n'importe quel autre).

## Fonctionnement

| Fichier | Rôle |
| --- | --- |
| `src/detect.js` | Heuristiques de détection (testées dans `tests/`). |
| `src/content.js` | Parcourt la page (et ses mises à jour via `MutationObserver`), place les icônes et gère l'infobulle. Icônes et infobulle vivent dans un Shadow DOM pour ne pas subir le CSS de la page. |
| `preview/preview.html` | Page de l'extension chargée dans une iframe de l'infobulle : c'est elle qui exécute Mermaid. |
| `vendor/mermaid/` | Mermaid (licence MIT, version dans `VERSION`), embarqué car les extensions MV3 ne peuvent pas charger de code distant. C'est la version ESM découpée, non modifiée : addons.mozilla.org refuse les fichiers JS trop gros (le `mermaid.min.js` monolithique fait 5 Mo), et seuls les types de diagrammes utilisés sont chargés. |

Le rendu se fait dans une iframe de l'extension plutôt que dans la page : la CSP de Jira (ou de tout autre site)
ne peut pas le bloquer, et Mermaid n'est chargé qu'au premier survol. Mermaid tourne avec
`securityLevel: 'strict'`, et l'extension ne demande aucune permission particulière.

## Développement

```bash
npm test                 # tests unitaires de la détection
npm install              # puis, pour mettre à jour Mermaid :
npm run update-mermaid   # copie le build ESM de node_modules/mermaid dans vendor/mermaid/
npm run package          # crée les zips Chrome et Firefox dans dist/
npm run package:chrome   # dist/mermaid-preview-<version>-chrome.zip  → Chrome Web Store
npm run package:firefox  # dist/mermaid-preview-<version>-firefox.zip → addons.mozilla.org
```

Les zips ne contiennent que les fichiers utiles à l'extension (`manifest.json`, `icons/`, `src/`, `preview/`,
`vendor/`). Le script vérifie que tous les fichiers cités dans le manifest sont présents et nomme l'archive d'après
la `version` du manifest : pensez à l'incrémenter avant chaque nouvelle soumission.

`manifest.json` est celui de Chrome. Pour Firefox, le script y ajoute `browser_specific_settings` : l'identifiant
`mermaid-preview@maximebuguel` (définitif une fois l'extension publiée), la version minimale de Firefox et la
déclaration « aucune donnée collectée » exigée par addons.mozilla.org.

Pour valider le paquet Firefox comme le fera addons.mozilla.org : `npx addons-linter dist/*-firefox.zip`. Les
avertissements restants concernent uniquement le code de Mermaid (`eval`, `innerHTML`), bibliothèque tierce non
modifiée : le préciser dans les notes destinées aux relecteurs lors de la soumission.

Après une modification, cliquer sur ↻ dans `chrome://extensions` (ou **Recharger** dans `about:debugging`) puis
recharger l'onglet.

## Publier une nouvelle version

Les évolutions sont tenues à jour dans [`CHANGELOG.md`](CHANGELOG.md), sous « Non publié », au fil des
modifications. Pour publier :

1. Préparer la version, en choisissant le type de montée (voir l'en-tête du changelog) :

   ```bash
   npm run release -- patch   # 1.0.0 → 1.0.1 : corrections
   npm run release -- minor   # 1.0.0 → 1.1.0 : nouvelles fonctionnalités
   npm run release -- major   # 1.0.0 → 2.0.0 : changement de comportement, nouvelles permissions…
   ```

   Le script date la section « Non publié » du changelog sous le nouveau numéro, met à jour la version dans
   `manifest.json` et `package.json`, génère les deux zips dans `dist/` et affiche les notes de version. Il refuse
   une version qui ne serait pas supérieure à l'actuelle (les stores la rejetteraient) ou un changelog vide.
2. Commiter (« Release x.y.z »), faire valider la pull request et la merger dans `main`.
3. Tagger le commit publié : `git tag vx.y.z && git push origin vx.y.z`.
4. Envoyer les zips :
   - **Chrome Web Store** : console développeur → l'extension → **Package** → **Importer un nouveau package** avec
     `dist/mermaid-preview-x.y.z-chrome.zip`, puis **Envoyer pour examen**. Les utilisateurs reçoivent la mise à jour
     automatiquement après validation.
   - **addons.mozilla.org** : **Gérer les versions** → **Envoyer une nouvelle version** avec
     `dist/mermaid-preview-x.y.z-firefox.zip`, et coller les notes de version affichées par le script.

`npm test` vérifie que `manifest.json` et `package.json` ont la même version et que le changelog la documente.
