# Journal des évolutions

Toutes les évolutions notables de l'extension sont listées ici, de la plus récente à la plus ancienne.
Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/) et la numérotation suit
[Semantic Versioning](https://semver.org/lang/fr/) :

- **correctif** (`1.0.0` → `1.0.1`) : correction de bug, sans changement visible attendu ;
- **mineure** (`1.0.0` → `1.1.0`) : nouvelle fonctionnalité ;
- **majeure** (`1.0.0` → `2.0.0`) : changement qui modifie le comportement existant (ex. nouvelles permissions).

Ajoutez chaque évolution sous « Non publié » au fil de l'eau (rubriques _Ajouté_, _Modifié_, _Corrigé_,
_Supprimé_) ; `npm run release` transforme ensuite cette section en nouvelle version.

## [Non publié]

### Corrigé

- Zoom : sur un diagramme très large, le zoom maximal permet désormais d'atteindre au moins deux fois la taille
  réelle du diagramme (il pouvait rester en dessous de sa taille réelle).

## [1.0.0] - 2026-10-27

Première publication sur le Chrome Web Store et addons.mozilla.org.

### Ajouté

- Détection des blocs de code Mermaid (Jira, Confluence, GitLab…), par indication de langage ou par contenu.
- Icône dans le coin supérieur droit des blocs Mermaid et aperçu du diagramme au survol, épinglable d'un clic.
- Aperçu mis à jour pendant l'édition du code, thème clair/sombre suivant celui de la page.
- Zoom et déplacement dans l'aperçu (loupes, `Ctrl` + molette, double‑clic, glisser, clavier).
- Prise en charge de Chrome et de Firefox.
