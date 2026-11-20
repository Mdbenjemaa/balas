# Repère Rail

Appli web installable (PWA) pour se repérer le long des voies en France : **ligne, PK, voie la plus
proche**, et ce qu'il y a autour (gares, quais, PN, tunnels, sous-stations, carrés, pancartes de
vitesse…). Elle marche sur iPhone et Android, **même sans réseau** une fois les données téléchargées.

> **Aide au repérage uniquement.** Ne remplace jamais les documents officiels (renseignements
> techniques, consignes, avis), l'annonce, la protection ou les échanges avec l'agent circulation.
> PK et signaux viennent de données ouvertes : ils peuvent être approximatifs, incomplets ou périmés.

## Ce que fait l'appli

| Fonction | Détail |
| --- | --- |
| Me repérer | Écoute le GPS jusqu'à 12 s, combine les mesures, rattache la position à la ligne la plus proche et affiche le PK en gros, la distance à l'axe, la précision GPS |
| Distance aux voies | « Sur la voie / 5 / 10 / 15 / 20 m » : sert à choisir la bonne ligne quand deux lignes sont proches |
| Voie la plus proche | Nom SNCF des voies proches (V1, V2, 1, 2BIS…), à titre indicatif (le GPS d'un téléphone se trompe souvent de 5 à 10 m) |
| Autour de moi | Éléments vers les PK croissants et décroissants, avec distance et PK ; « vous êtes dans » pour un tunnel ou un quai |
| Caractéristiques au PK | Statut, vitesse nominale, électrification, cantonnement, KVB, écartement |
| Aller au PK | Depuis ma position (« Aller au PK » sous le PK affiché) ou par la recherche (« 830000 45+200 ») : le PK sur la carte, la distance le long de la ligne et le sens, ce qu'il y a autour, et un itinéraire en voiture (Plans, Google Maps, Waze) |
| Mes accès | Import d'une carte d'accès exportée de Google My Maps (KML ou KMZ) ou en GeoJSON. Chaque accès reçoit sa ligne et son PK, apparaît sur la carte et dans les listes, et peut servir de destination. Les accès restent dans le téléphone : ils ne sont ni envoyés ni publiés |
| Espace chantier (comptes) | Bouton « Chantier » : connexion par code personnel. L'administrateur crée les chefs ; le chef crée ses chantiers et ses agents (un code chacun), les affecte, prépare la carte (zone entre deux PK, points, accès, panneaux, import KML) et a le tableau de bord (signalements avec photos, rapports de fin de poste signés en PDF, export Excel). L'agent voit son chantier et signale des anomalies, même sans réseau. Sur ordinateur, la carte et le panneau sont côte à côte |
| Suivre en marchant | Met à jour le PK en continu (écran allumé) |
| Me placer ici | Appui long sur la carte : repérage sans GPS (préparer une intervention, GPS mauvais) |
| Carte et filtres | PK tous les 100 m, bornes OSM, gares, quais, voies et numéros, PN, tunnels, ponts, sous-stations, carrés et sémaphores, avertissements, TIV et pancartes Z/R, signaux électriques, vitesses et électrification en couleurs ; fond plan ou photo aérienne IGN |
| Hors-ligne | Un bouton télécharge toute la France (≈ 45 Mo) ; le fond de carte n'est gardé que pour les zones déjà affichées |

## Précision des PK

Les PK le long des lignes sont recalés sur environ 63 000 repères dont SNCF Réseau publie à la fois
le PK et la position (PN, gares, ponts-route, quais, extrémités de voies et de sections).

| Contrôle | Résultat |
| --- | --- |
| Repère masqué ainsi que tous ses voisins à moins de 200 m (7 372 essais) | écart médian 0,8 m ; 75 % sous 7 m ; 90 % sous 29 m |
| 13 124 bornes kilométriques réelles relevées dans OpenStreetMap (source indépendante) | écart médian 2 m ; 75 % sous 8 m ; 90 % sous 55 m |
| Sans recalage (interpolation entre début et fin de tronçon) | écart médian 22 m ; 90 % sous 188 m |

S'y ajoute l'erreur du GPS du téléphone. Les données SNCF Réseau datent de 2020 à 2022 : une
modification récente du réseau peut manquer.

## Installer sur iPhone

1. Ouvrir l'adresse de l'appli dans **Safari** (pas Chrome).
2. Bouton Partager › **Sur l'écran d'accueil**.
3. Ouvrir l'appli depuis l'icône, toucher « Me repérer » et **autoriser la localisation** avec
   « Position exacte » activée (Réglages › Confidentialité › Service de localisation).
4. Bouton de téléchargement (flèche) › « Télécharger toute la France » pour l'usage sans réseau.

Limite d'une appli web sur iPhone : pas de suivi de position écran éteint.

## Mettre en ligne

Le GPS et l'installation exigent une adresse en **HTTPS**. L'appli est publiée sur **GitHub Pages**
depuis la branche `gh-pages` : `scripts/deploy_pages.sh` teste, construit et publie
(adresse `https://<compte>.github.io/<dépôt>/`). Réglage GitHub une seule fois : Settings › Pages ›
Source « Deploy from a branch », branche `gh-pages`, dossier `/ (root)`.

Autre hébergeur statique (Netlify…) : `cd app && npm ci && npm run build`, puis publier `app/dist`.
Les hébergeurs qui limitent les fichiers à 25 Mo (Cloudflare Pages) ne conviennent pas : la carte des
voies fait 38 Mo.

Version d'essai sans GPS (page claude.ai) : `npm run build:preview` dans `app`.

## Développer

```sh
cd app
npm install
npm run dev        # http://localhost:5173 (le GPS marche en localhost)
npm test           # tests, dont des contrôles sur les vraies données
npm run build      # version de production dans app/dist
```

Code : React 19, TypeScript, Vite, MapLibre GL 6, PMTiles, vite-plugin-pwa.

| Fichier | Rôle |
| --- | --- |
| `app/src/lib/locate.ts` | Rattachement d'une position aux lignes et voies, calcul du PK |
| `app/src/lib/gps.ts` | Repérage précis (moyenne pondérée des mesures), suivi |
| `app/src/lib/nearby.ts` | Éléments autour d'un PK, caractéristiques de la ligne |
| `app/src/lib/data.ts` | Chargement des données, cache hors-ligne, tuiles depuis le cache |
| `app/src/map/style.ts` | Style de la carte et des couches |
| `app/public/data/` | Données générées : `rail.pmtiles` (carte), `cells/` (géométrie avec PK, par case de 0,25°), `lines/` (fiche de chaque ligne) |

## Chantier partagé (serveur)

Les données d'équipe sont sur un projet Supabase hébergé à Paris : voir `supabase/README.md`
(tables, fonctions, règles de sécurité, fonction des photos). Seules les positions des signalements
et des repères sont enregistrées, jamais la position des agents en continu.

## Mettre à jour les données

`data-pipeline/run.sh` refait tout (≈ 15 min, 8 Go de disque) : téléchargement des jeux SNCF Réseau
et d'OpenStreetMap France, recalage des PK, rattachement des éléments OSM aux lignes, tuiles.

## Sources et licences

- **SNCF Réseau** (ressources.data.sncf.com) : lignes, voies, gares, PN, ponts-route, passerelles,
  passages souterrains, traversées, quais, vitesses, électrification, cantonnement, KVB, écartement.
- **OpenStreetMap** (© contributeurs OpenStreetMap, ODbL) : signaux, pancartes, bornes
  kilométriques, tunnels, sous-stations. Couverture variable selon les secteurs.
- Fond plan : OpenFreeMap © OpenMapTiles, données OpenStreetMap. Photo aérienne : © IGN.

Les données dérivées de `app/public/data` combinent ces sources : elles sont diffusées sous
**ODbL**, avec mention des sources ci-dessus.

Projet personnel, indépendant de la SNCF.
