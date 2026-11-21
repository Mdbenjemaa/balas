/**
 * Accès au serveur du chantier (Supabase). L'appli n'utilise que des fonctions rr_* :
 * chacune vérifie le jeton du membre et ne donne accès qu'à SON chantier.
 * La clé « publishable » est publique par nature : la sécurité est côté serveur.
 */
export const SB_URL = 'https://rlywthlidnrykiacfudz.supabase.co';
export const SB_KEY = 'sb_publishable_HYRXnCPVXNCEkGlf3WxQ1g_0BUyMCLe';

export type Role = 'admin' | 'chef' | 'agent';
export type Gravite = 'info' | 'a_traiter' | 'urgent';
export type Statut = 'nouveau' | 'en_cours' | 'traite';

export interface Compte {
  id: string;
  nom: string;
  role: Role;
  entreprise: string | null;
  fonction: string | null;
}

export interface Chantier {
  id: string;
  nom: string;
  entreprise: string | null;
  ligne: string | null;
  pk_debut: number | null;
  pk_fin: number | null;
  date_debut: string | null;
  date_fin: string | null;
  archive: boolean;
  chef_nom: string | null;
  nb_agents: number;
}

export interface Connexion {
  compte: Compte;
  chantiers: Chantier[];
}

/** Chef vu par l'administrateur. */
export interface ChefRow {
  id: string;
  nom: string;
  entreprise: string | null;
  actif: boolean;
  cree_le: string;
  derniere_connexion: string | null;
  nb_chantiers: number;
  nb_agents: number;
}

/** Agent vu par son chef. */
export interface AgentRow {
  id: string;
  nom: string;
  fonction: string | null;
  actif: boolean;
  cree_le: string;
  derniere_connexion: string | null;
  chantiers: string[];
}

export interface Membre {
  id: string;
  nom: string;
  role: Role;
  fonction: string | null;
  actif?: boolean;
  rejoint_le?: string;
}

export interface Signalement {
  id: string;
  auteur_id: string | null;
  auteur_nom: string;
  cree_le: string;
  lon: number;
  lat: number;
  precision_m: number | null;
  ligne: string | null;
  pk: number | null;
  voie: string | null;
  nature: string;
  gravite: Gravite;
  commentaire: string | null;
  photos: string[];
  /** Suivi : nouveau, en cours, traité. */
  statut: Statut;
  /** Personne à qui le chef l'a confié. */
  assigne_id: string | null;
  assigne_nom: string | null;
  statut_le: string | null;
  statut_par: string | null;
}

export interface Repere {
  id: string;
  auteur_id: string | null;
  auteur_nom: string;
  cree_le: string;
  categorie: 'point' | 'zone' | 'panneau';
  type: string;
  nom: string | null;
  commentaire: string | null;
  lon: number | null;
  lat: number | null;
  ligne: string | null;
  pk: number | null;
  pk_fin: number | null;
  voie: string | null;
  etat: 'pose' | 'retire' | null;
  retire_le: string | null;
  retire_par: string | null;
}

export interface RapportResume {
  id: string;
  auteur_nom: string;
  date_poste: string;
  contenu: RapportContenu;
  cree_le: string;
  modifie_le: string;
}

export interface Rapport extends RapportResume {
  signature: string | null;
}

export interface RapportContenu {
  poste: 'jour' | 'nuit';
  debut: string;
  fin: string;
  pk_debut: string;
  pk_fin: string;
  equipe: { nom: string; fonction: string }[];
  externes: string;
  travaux: string;
  securite: string;
  evenements: string;
  observations: string;
  signalements: string[];
  panneaux: string[];
}

export interface Etat {
  chantier: Chantier;
  moi: Membre;
  /** Vrai pour le chef du chantier : préparation de la carte, rapports, export. */
  gere: boolean;
  membres: Membre[];
  signalements: Signalement[];
  reperes: Repere[];
  rapports: RapportResume[];
}

export class ApiError extends Error {
  readonly status: number;
  /** Le jeton n'est plus valable (membre retiré du chantier). */
  readonly denied: boolean;
  /** Le serveur n'a pas pu être joint (pas de réseau). */
  readonly offline: boolean;
  constructor(message: string, status: number, denied = false, offline = false) {
    super(message);
    this.status = status;
    this.denied = denied;
    this.offline = offline;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${SB_URL}${path}`, {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Pas de réseau', 0, false, true);
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const d = (data ?? {}) as { message?: string; error?: string };
    const msg = d.message ?? d.error ?? `Erreur ${res.status}`;
    const denied = msg === 'acces_refuse';
    throw new ApiError(denied ? 'Accès refusé : code inconnu, compte désactivé ou chantier non accessible.' : msg, res.status, denied);
  }
  return data as T;
}

const rpc = <T>(fn: string, args: Record<string, unknown>) => post<T>(`/rest/v1/rpc/${fn}`, args);

export const normCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** « ABCD2345 » → « ABCD-2345 » pour la lecture. */
export const fmtCode = (code: string) => {
  const c = normCode(code);
  const h = Math.ceil(c.length / 2);
  return `${c.slice(0, h)}-${c.slice(h)}`;
};

export const api = {
  connexion: (code: string) => rpc<Connexion>('rr_connexion', { p_code: code }),

  adminChefs: (code: string) => rpc<ChefRow[]>('rr_admin_chefs', { p_code: code }),
  adminCreerChef: (code: string, nom: string, entreprise: string) =>
    rpc<{ id: string; code: string }>('rr_admin_creer_chef', { p_code: code, p_nom: nom, p_entreprise: entreprise }),
  compteMaj: (code: string, compte: string, p: Record<string, unknown>) =>
    rpc<{ code?: string }>('rr_compte_maj', { p_code: code, p_compte: compte, p }),

  chefAgents: (code: string) => rpc<AgentRow[]>('rr_chef_agents', { p_code: code }),
  chefCreerAgent: (code: string, nom: string, fonction: string) =>
    rpc<{ id: string; code: string }>('rr_chef_creer_agent', { p_code: code, p_nom: nom, p_fonction: fonction }),
  chefChantier: (code: string, p: Record<string, unknown>) => rpc<Chantier>('rr_chef_chantier', { p_code: code, p }),
  chefAffecter: (code: string, chantier: string, agent: string, oui: boolean) =>
    rpc<null>('rr_chef_affecter', { p_code: code, p_chantier: chantier, p_agent: agent, p_oui: oui }),

  etat: (code: string, chantier: string) => rpc<Etat>('rr_etat', { p_code: code, p_chantier: chantier }),
  signaler: (code: string, chantier: string, p: Record<string, unknown>) =>
    rpc<null>('rr_signaler', { p_code: code, p_chantier: chantier, p }),
  /** Statut et/ou personne désignée : { id, statut? , assigne? } (assigne vide = personne). */
  signalementSuivi: (code: string, chantier: string, p: Record<string, unknown>) =>
    rpc<null>('rr_signalement_suivi', { p_code: code, p_chantier: chantier, p }),
  repere: (code: string, chantier: string, p: Record<string, unknown>) =>
    rpc<null>('rr_repere', { p_code: code, p_chantier: chantier, p }),
  reperesImport: (code: string, chantier: string, items: Record<string, unknown>[]) =>
    rpc<number>('rr_reperes_import', { p_code: code, p_chantier: chantier, p_items: items }),
  rapport: (code: string, chantier: string, p: Record<string, unknown>) =>
    rpc<null>('rr_rapport', { p_code: code, p_chantier: chantier, p }),
  rapportLire: (code: string, chantier: string, id: string) =>
    rpc<Rapport>('rr_rapport_lire', { p_code: code, p_chantier: chantier, p_id: id }),

  photosUpload: (code: string, chantier: string, signalement: string, n: number) =>
    post<{ uploads: { path: string; signedUrl: string }[] }>('/functions/v1/photos', { code, chantier, op: 'upload', signalement, n }),
  photosRead: (code: string, chantier: string, paths: string[]) =>
    post<{ urls: { path: string; url: string }[] }>('/functions/v1/photos', { code, chantier, op: 'read', paths }),

  async putPhoto(signedUrl: string, blob: Blob): Promise<void> {
    let res: Response;
    try {
      res = await fetch(signedUrl, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: blob });
    } catch {
      throw new ApiError('Pas de réseau', 0, false, true);
    }
    if (!res.ok) throw new ApiError(`Envoi de la photo refusé (${res.status})`, res.status);
  },
};
