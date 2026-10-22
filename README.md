# Mermaid Preview — extension Chrome

Affiche un aperçu des diagrammes [Mermaid](https://mermaid.js.org/) écrits dans des blocs de code
(issues Jira, Confluence, GitLab, wikis…).

- L'extension repère les blocs de code de la page (`<pre>`, `<code>` multi‑lignes, y compris dans l'éditeur Jira).
- Si le bloc contient du Mermaid, une icône apparaît dans son coin supérieur droit.
- Au survol de l'icône, une infobulle affiche le diagramme rendu.
  - Un clic sur l'icône épingle l'infobulle ; `Échap` ou un clic ailleurs la ferme.
  - L'aperçu se met à jour si le code est modifié pendant qu'il est ouvert.
  - Le thème clair/sombre suit celui de la page.

## Installation (mode développeur)

1. Ouvrir `chrome://extensions`.
2. Activer le **mode développeur** (en haut à droite).
3. Cliquer sur **Charger l'extension non empaquetée** et sélectionner ce dossier.

Aucune étape de build n'est nécessaire : la bibliothèque Mermaid est fournie dans `vendor/`.

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
| `vendor/mermaid.min.js` | Mermaid (licence MIT), embarqué car les extensions MV3 ne peuvent pas charger de code distant. |

Le rendu se fait dans une iframe de l'extension plutôt que dans la page : la CSP de Jira (ou de tout autre site)
ne peut pas le bloquer, et le bundle Mermaid (~5 Mo) n'est chargé qu'au premier survol. Mermaid tourne avec
`securityLevel: 'strict'`, et l'extension ne demande aucune permission particulière.

## Développement

```bash
npm test                 # tests unitaires de la détection
npm install              # puis, pour mettre à jour Mermaid :
npm run update-mermaid   # copie node_modules/mermaid/dist/mermaid.min.js dans vendor/
```

Après une modification, cliquer sur ↻ dans `chrome://extensions` puis recharger l'onglet.
