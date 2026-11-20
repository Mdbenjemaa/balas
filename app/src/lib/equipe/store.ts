import { get, set, del } from 'idb-keyval';
import { api, ApiError, type Chantier, type Compte, type Etat, type Repere, type Signalement } from './api';

/* ---------- Session : le code personnel reste sur le téléphone ---------- */

export interface Session {
  code: string;
  compte: Compte;
  chantiers: Chantier[];
  /** Chantier ouvert (null : à choisir, ou administrateur). */
  chantierId: string | null;
}

const SESSION_KEY = 'rr-session-v2';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* stockage refusé : la session durera le temps de l'ouverture */
  }
}

export const etatKey = (chantierId: string) => `rr-etat-${chantierId}`;
export const loadCachedEtat = (chantierId: string) => get<Etat>(etatKey(chantierId)).catch(() => undefined);
export const cacheEtat = (e: Etat) => set(etatKey(e.chantier.id), e).catch(() => undefined);

/* ---------- File d'envoi : tout ce qui est créé part d'ici, réseau ou pas ---------- */

interface OutBase {
  id: string;
  /** Chantier concerné (un agent peut en avoir plusieurs). */
  chantier: string;
  error?: string;
}
export type OutItem =
  | (OutBase & { kind: 'signalement'; payload: Record<string, unknown>; photos: Blob[] })
  | (OutBase & { kind: 'repere'; payload: Record<string, unknown> })
  | (OutBase & { kind: 'rapport'; payload: Record<string, unknown> });

type DistOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
/** Élément créé par un formulaire : le chantier est ajouté à l'envoi. */
export type NewItem = DistOmit<OutItem, 'chantier'> & { chantier?: string };

const OUTBOX = 'rr-outbox-v2';

export async function loadOutbox(): Promise<OutItem[]> {
  return ((await get<OutItem[]>(OUTBOX).catch(() => undefined)) ?? []).slice();
}

async function saveOutbox(items: OutItem[]): Promise<void> {
  if (items.length) await set(OUTBOX, items);
  else await del(OUTBOX);
}

export async function enqueue(item: OutItem): Promise<OutItem[]> {
  const items = await loadOutbox();
  items.push(item);
  await saveOutbox(items);
  return items;
}

export async function dropItem(id: string): Promise<OutItem[]> {
  const items = (await loadOutbox()).filter((i) => i.id !== id);
  await saveOutbox(items);
  return items;
}

export const clearOutbox = () => saveOutbox([]);

/**
 * Envoie la file dans l'ordre. S'arrête sans rien perdre si le réseau manque ;
 * une donnée refusée par le serveur reste dans la file avec son message d'erreur.
 */
export async function flushOutbox(code: string): Promise<{ items: OutItem[]; offline: boolean; denied: boolean }> {
  let items = await loadOutbox();
  for (const item of items.slice()) {
    if (item.error) continue;
    try {
      if (item.kind === 'signalement') {
        const p = item.payload;
        if (item.photos.length && !(Array.isArray(p.photos) && p.photos.length)) {
          const { uploads } = await api.photosUpload(code, item.chantier, String(p.id), item.photos.length);
          for (let i = 0; i < uploads.length; i++) await api.putPhoto(uploads[i].signedUrl, item.photos[i]);
          p.photos = uploads.map((u) => u.path);
          await saveOutbox(items); // photos déjà envoyées : on ne les renverra pas
        }
        await api.signaler(code, item.chantier, p);
      } else if (item.kind === 'repere') {
        await api.repere(code, item.chantier, item.payload);
      } else {
        await api.rapport(code, item.chantier, item.payload);
      }
      items = items.filter((i) => i.id !== item.id);
      await saveOutbox(items);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
      if (err.offline || err.status >= 500 || err.status === 0) return { items, offline: true, denied: false };
      item.error = err.message;
      await saveOutbox(items);
    }
  }
  return { items, offline: false, denied: false };
}

/* ---------- Affichage : état du serveur + ce qui attend dans la file ---------- */

export interface View {
  signalements: (Signalement & { pending?: boolean })[];
  reperes: (Repere & { pending?: boolean })[];
}

export function mergePending(etat: Etat | null, all: OutItem[]): View {
  const items = etat ? all.filter((i) => i.chantier === etat.chantier.id) : [];
  const signalements: View['signalements'] = etat ? etat.signalements.slice() : [];
  let reperes: View['reperes'] = etat ? etat.reperes.slice() : [];
  const moi = etat?.moi;
  for (const it of items) {
    if (it.kind === 'signalement' && !signalements.some((s) => s.id === it.payload.id)) {
      const p = it.payload as Record<string, unknown>;
      signalements.unshift({
        id: String(p.id), auteur_id: moi?.id ?? null, auteur_nom: moi?.nom ?? 'Moi', cree_le: String(p.cree_le),
        lon: Number(p.lon), lat: Number(p.lat), precision_m: (p.precision_m as number) ?? null,
        ligne: (p.ligne as string) ?? null, pk: (p.pk as number) ?? null, voie: (p.voie as string) ?? null,
        nature: String(p.nature), gravite: p.gravite as Signalement['gravite'], commentaire: (p.commentaire as string) ?? null,
        photos: [], pending: true,
      });
    }
    if (it.kind === 'repere') {
      const p = it.payload as Record<string, unknown>;
      const existing = reperes.find((r) => r.id === p.id);
      if (existing) {
        if (p.supprime) reperes = reperes.filter((r) => r.id !== p.id);
        else
          reperes = reperes.map((r) =>
            r.id === p.id
              ? { ...r, etat: (p.etat as Repere['etat']) ?? r.etat, retire_par: p.etat === 'retire' ? (moi?.nom ?? null) : r.retire_par, pending: true }
              : r,
          );
      } else if (p.categorie) {
        reperes.push({
          id: String(p.id), auteur_id: moi?.id ?? null, auteur_nom: moi?.nom ?? 'Moi', cree_le: String(p.cree_le),
          categorie: p.categorie as Repere['categorie'], type: String(p.type), nom: (p.nom as string) ?? null,
          commentaire: (p.commentaire as string) ?? null, lon: (p.lon as number) ?? null, lat: (p.lat as number) ?? null,
          ligne: (p.ligne as string) ?? null, pk: (p.pk as number) ?? null, pk_fin: (p.pk_fin as number) ?? null,
          voie: (p.voie as string) ?? null, etat: p.categorie === 'panneau' ? 'pose' : null, retire_le: null, retire_par: null,
          pending: true,
        });
      }
    }
  }
  return { signalements, reperes };
}

/** Identifiant unique créé sur le téléphone (permet de renvoyer sans créer de doublon). */
export function newId(): string {
  const c = globalThis.crypto as Crypto;
  if (typeof c.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Réduit une photo (1600 px, JPEG) avant de la garder et de l'envoyer. */
export function compressPhoto(file: File, max = 1600, quality = 0.78): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * s);
      canvas.height = Math.round(img.naturalHeight * s);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Photo illisible'))), 'image/jpeg', quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Photo illisible'));
    };
    img.src = url;
  });
}
