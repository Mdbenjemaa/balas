import type { Gravite } from './api';

export interface Choice {
  key: string;
  label: string;
  color: string;
}

/** Nature d'une anomalie. */
export const NATURES: Choice[] = [
  { key: 'voie', label: 'Voie et ballast', color: '#7c2d12' },
  { key: 'signalisation', label: 'Signalisation', color: '#b91c1c' },
  { key: 'catenaire', label: 'Caténaire et électricité', color: '#a16207' },
  { key: 'pn_ouvrage', label: 'PN et ouvrages', color: '#4338ca' },
  { key: 'cloture', label: 'Clôture, portail, accès', color: '#0f766e' },
  { key: 'vegetation', label: 'Végétation ou obstacle', color: '#15803d' },
  { key: 'intrusion', label: 'Intrusion ou vandalisme', color: '#9d174d' },
  { key: 'securite', label: 'Sécurité du chantier', color: '#c2410c' },
  { key: 'dechets', label: 'Déchets et pollution', color: '#57534e' },
  { key: 'autre', label: 'Autre', color: '#4b5563' },
];

export const GRAVITES: (Choice & { key: Gravite })[] = [
  { key: 'info', label: 'Information', color: '#2563eb' },
  { key: 'a_traiter', label: 'À traiter', color: '#ea580c' },
  { key: 'urgent', label: 'Urgent', color: '#dc2626' },
];

/** Repères ponctuels. */
export const POINT_TYPES: Choice[] = [
  { key: 'rdv', label: 'Point de rendez-vous', color: '#2563eb' },
  { key: 'acces', label: 'Accès', color: '#047857' },
  { key: 'stockage', label: 'Stockage matériel', color: '#92400e' },
  { key: 'base_vie', label: 'Base vie', color: '#7c3aed' },
  { key: 'vehicules', label: 'Véhicules', color: '#0e7490' },
  { key: 'vigilance', label: 'Point de vigilance', color: '#dc2626' },
  { key: 'autre', label: 'Autre', color: '#4b5563' },
];

/** Zones entre deux PK. */
export const ZONE_TYPES: Choice[] = [
  { key: 'chantier', label: 'Limite de chantier', color: '#2563eb' },
  { key: 'travaux', label: 'Zone de travaux', color: '#ea580c' },
  { key: 'interdite', label: 'Zone interdite ou danger', color: '#dc2626' },
];

/** Panneaux et balisages posés (suivi posé / retiré). */
export const PANNEAU_TYPES: Choice[] = [
  { key: 'tiv', label: 'TIV provisoire', color: '#ca8a04' },
  { key: 'pancarte', label: 'Pancarte de chantier', color: '#ea580c' },
  { key: 'balisage', label: 'Balisage ou barrière', color: '#dc2626' },
  { key: 'autre', label: 'Autre', color: '#4b5563' },
];

export const FONCTIONS = ['Annonceur', 'Sentinelle', 'ASP', 'Chef d’équipe', 'Chef de chantier', 'Opérateur', 'Autre'];

export const choice = (list: Choice[], key: string): Choice =>
  list.find((c) => c.key === key) ?? { key, label: key, color: '#4b5563' };

export const repereChoices = (categorie: 'point' | 'zone' | 'panneau') =>
  categorie === 'point' ? POINT_TYPES : categorie === 'zone' ? ZONE_TYPES : PANNEAU_TYPES;
