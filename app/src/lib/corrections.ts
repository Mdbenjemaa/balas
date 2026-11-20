/**
 * Corrections de PK relevées sur le terrain devant une borne.
 * - validées par l'administrateur : appliquées par toutes les applis ;
 * - proposées depuis ce téléphone : appliquées tout de suite ici, en attendant la validation.
 *
 * Une correction dit : « à l'endroit où l'appli calculait pk_app, la borne indique pk_vrai ».
 * Entre deux corrections d'une même ligne, l'écart est interpolé. Au-delà de la dernière :
 * étendue « ligne » = même écart jusqu'au bout ; étendue « portion » = l'écart s'efface sur 1,5 km.
 */
import { SB_KEY, SB_URL } from './equipe/api';
import type { LonLat } from './geo';

export interface Correction {
  id: string;
  ligne: string;
  pk_app: number;
  pk_vrai: number;
  etendue: 'portion' | 'ligne';
  lon: number;
  lat: number;
  /** Date de validation (absente pour une proposition de ce téléphone). */
  le?: string | null;
  /** Proposition de ce téléphone, pas encore validée. */
  locale?: boolean;
}

const VALID_KEY = 'rr-corrections-v1';
const MINE_KEY = 'rr-mes-corrections-v1';
/** Distance sur laquelle une correction « portion » s'efface (km). */
export const TAPER_KM = 1.5;
/** Deux corrections plus proches que ça (km) sont reliées par interpolation. */
const LINK_KM = 6;

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* stockage plein ou refusé */
  }
};

let validated: Correction[] = read<Correction[]>(VALID_KEY, []);
let mine: (Correction & { envoyee?: boolean })[] = read(MINE_KEY, []);
let byLine = new Map<string, Correction[]>();
let version = 0;
const listeners = new Set<() => void>();

function rebuild() {
  byLine = new Map();
  const validIds = new Set(validated.map((c) => c.id));
  for (const c of [...validated, ...mine.filter((m) => !validIds.has(m.id))]) {
    const list = byLine.get(c.ligne) ?? [];
    list.push(c);
    byLine.set(c.ligne, list);
  }
  for (const list of byLine.values()) list.sort((a, b) => a.pk_app - b.pk_app);
  version++;
  listeners.forEach((l) => l());
}
rebuild();

export const correctionsVersion = () => version;
export const onCorrections = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const correctedLines = () => [...byLine.keys()];
export const correctionsOf = (code: string) => byLine.get(code) ?? [];
export const myCorrections = () => mine.slice();

/** Écart à ajouter (km) au PK calculé `pk` de la ligne `code`. */
export function deltaAt(code: string, pk: number): number {
  const list = byLine.get(code);
  if (!list?.length) return 0;
  let left: Correction | undefined;
  let right: Correction | undefined;
  for (const c of list) {
    if (c.pk_app <= pk) left = c;
    else {
      right = c;
      break;
    }
  }
  const d = (c: Correction) => c.pk_vrai - c.pk_app;
  if (left && right) {
    const linked = right.pk_app - left.pk_app <= LINK_KM || (left.etendue === 'ligne' && right.etendue === 'ligne');
    if (linked) return d(left) + ((d(right) - d(left)) * (pk - left.pk_app)) / (right.pk_app - left.pk_app);
  }
  // Correction la plus proche seule.
  const near = !left ? right! : !right ? left : pk - left.pk_app <= right.pk_app - pk ? left : right;
  if (near.etendue === 'ligne') return d(near);
  return d(near) * Math.max(0, 1 - Math.abs(pk - near.pk_app) / TAPER_KM);
}

/** PK corrigé. */
export const corrige = (code: string, pk: number) => pk + deltaAt(code, pk);

/* ---------- Serveur ---------- */

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error((data as { message?: string })?.message ?? `Erreur ${res.status}`);
  return data as T;
}

let lastFetch = 0;
/** Récupère les corrections validées (au démarrage, puis toutes les 6 h au plus). */
export async function refreshCorrections(force = false): Promise<void> {
  if (!force && Date.now() - lastFetch < 6 * 3600e3) return;
  try {
    const list = await rpc<Correction[]>('rr_corrections', {});
    lastFetch = Date.now();
    validated = list.map((c) => ({ ...c, pk_app: Number(c.pk_app), pk_vrai: Number(c.pk_vrai) }));
    write(VALID_KEY, validated);
    // Une proposition validée ou traitée depuis plus de 30 jours n'a plus à rester en local.
    const ids = new Set(validated.map((c) => c.id));
    mine = mine.filter((m) => !ids.has(m.id));
    write(MINE_KEY, mine);
    rebuild();
  } catch {
    /* hors-ligne : on garde la copie locale */
  }
}

export interface Proposition {
  ligne: string;
  at: LonLat;
  precision: number | null;
  pkApp: number;
  pkVrai: number;
  commentaire: string;
  auteur: string;
  code?: string | null;
}

/** Propose une correction : appliquée tout de suite sur ce téléphone, envoyée pour validation. */
export async function proposer(p: Proposition, id: string): Promise<{ envoyee: boolean }> {
  const c: Correction & { envoyee?: boolean; commentaire?: string; auteur?: string; precision?: number | null } = {
    id, ligne: p.ligne, pk_app: p.pkApp, pk_vrai: p.pkVrai, etendue: 'portion', lon: p.at[0], lat: p.at[1], locale: true,
    commentaire: p.commentaire, auteur: p.auteur, precision: p.precision,
  };
  mine = [...mine.filter((m) => m.id !== id), c];
  write(MINE_KEY, mine);
  rebuild();
  return { envoyee: await envoyerEnAttente(p.code ?? null) };
}

/** Renvoie les propositions pas encore parties (réseau revenu). */
export async function envoyerEnAttente(code: string | null = null): Promise<boolean> {
  let ok = true;
  for (const m of mine.filter((x) => !x.envoyee) as (Correction & { envoyee?: boolean; commentaire?: string; auteur?: string; precision?: number | null })[]) {
    try {
      await rpc('rr_correction_proposer', {
        p: { id: m.id, ligne: m.ligne, lon: m.lon, lat: m.lat, precision_m: m.precision ?? '', pk_app: m.pk_app, pk_vrai: m.pk_vrai, commentaire: m.commentaire ?? '', auteur_nom: m.auteur ?? '' },
        p_code: code ?? '',
      });
      m.envoyee = true;
    } catch {
      ok = false;
    }
  }
  write(MINE_KEY, mine);
  return ok;
}

/** Retire une proposition de ce téléphone (par exemple saisie par erreur). */
export function oublier(id: string) {
  mine = mine.filter((m) => m.id !== id);
  write(MINE_KEY, mine);
  rebuild();
}

/* ---------- Administrateur ---------- */

export interface CorrectionAdmin extends Correction {
  statut: 'proposee' | 'validee' | 'refusee';
  precision_m: number | null;
  commentaire: string | null;
  auteur_nom: string | null;
  cree_le: string;
  traite_le: string | null;
  traite_par: string | null;
}

export const adminCorrections = (code: string) =>
  rpc<CorrectionAdmin[]>('rr_admin_corrections', { p_code: code }).then((l) =>
    l.map((c) => ({ ...c, pk_app: Number(c.pk_app), pk_vrai: Number(c.pk_vrai) })),
  );
export const adminTraiter = (code: string, id: string, statut: CorrectionAdmin['statut'], etendue: Correction['etendue']) =>
  rpc<null>('rr_admin_correction_traiter', { p_code: code, p_id: id, p_statut: statut, p_etendue: etendue });

/** Pour les tests : remplace les corrections validées. */
export function setValidatedForTest(list: Correction[]) {
  validated = list;
  mine = [];
  rebuild();
}
