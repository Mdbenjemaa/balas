# Serveur du chantier partagé (Supabase)

Projet Supabase `repere-rail`, région Paris (eu-west-3).

- `migrations/` : tables et fonctions, dans l'ordre où elles ont été appliquées.
- `functions/photos/` : fonction edge qui donne les adresses signées des photos.

## Sécurité

- L'appli n'accède jamais aux tables directement : RLS activée sans politique, droits retirés à `anon`
  et `authenticated`. Les avertissements « RLS Enabled No Policy » sont donc voulus.
- Tout passe par les fonctions `rr_*` (SECURITY DEFINER). Chacune vérifie le **code personnel**
  (seule son empreinte SHA-256 est stockée) et les droits du compte. Les avertissements
  « Public Can Execute SECURITY DEFINER Function » portent sur ces fonctions publiques, c'est voulu.
- Comptes et rôles :
  - **administrateur** : crée les chefs, renouvelle leur code, les désactive ;
  - **chef** : crée ses chantiers et ses agents, affecte les agents aux chantiers, prépare la carte
    (zones, points, accès, panneaux, import KML), rapports de fin de poste, export ;
  - **agent** : voit les chantiers où il est affecté (sauf archivés), leur carte et leurs signalements,
    et signale des anomalies.
- Codes personnels : administrateur 12 caractères, chef 10, agent 8, sans caractères ambigus.
  Renouveler un code ou désactiver un compte coupe l'accès aussitôt. Un mauvais code est ralenti.
- Photos : bucket `photos` privé (JPEG, 6 Mo maximum). La fonction `photos` vérifie le code et
  l'accès au chantier, et ne signe que les chemins de ce chantier.

- Corrections de PK (`corrections_pk`) : n'importe qui peut proposer (200 propositions par heure au plus),
  seul l'administrateur valide ; seules les corrections validées sont lues par toutes les applis.

## Tester

`python3 test_api.py <code administrateur>` : scénario administrateur, chef, agents, et tous les
refus attendus (crée des comptes de test : à supprimer ensuite).

La clé « publishable » écrite dans `app/src/lib/equipe/api.ts` est publique par nature.

## Fonction `mymaps`

Récupère le KML complet d'une carte Google My Maps à partir de son identifiant (`mid`), pour l'import des accès :
les KMZ exportés avec « Conserver les données à jour avec un lien réseau KML » ne contiennent qu'un lien, et le
navigateur ne peut pas lire Google directement. Elle ne relaie que `www.google.com/maps/d/kml` (pas d'autre site).
La carte doit être partagée « Tous les utilisateurs disposant du lien ». Déployée avec `verify_jwt = false`.
