import type { ReactNode } from 'react';
import { STATUTS, choice } from '../../lib/equipe/catalog';
import type { Statut } from '../../lib/equipe/api';
import type { Equipe } from '../../lib/equipe/useEquipe';

/* ---------- Icônes (traits simples, 24 × 24) ---------- */

const PATHS = {
  home: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  alert: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  users: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1m1-7a5 5 0 0 1 5 5v2',
  userPlus: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1M19 8v6M16 11h6',
  pin: 'M12 21s-7-6.2-7-12a7 7 0 0 1 14 0c0 5.8-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  sign: 'M12 2 22 12 12 22 2 12zM12 8v5M12 16h.01',
  layers: 'M12 3 2 8l10 5 10-5-10-5zM2 13l10 5 10-5M2 17l10 5 10-5',
  site: 'M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6',
  check: 'M5 12l5 5 9-10',
  ruler: 'M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  chevron: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  plus: 'M12 5v14M5 12h14',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  share: 'M12 3v12M8 7l4-4 4 4M6 11H5v9h14v-9h-1',
  chat: 'M4 5h16v11H9l-5 4z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  key: 'M14 10a4 4 0 1 0-3.9 4H11l2 2h2v2h2v2h3v-3l-6-6',
  clipboard: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M9 12h6M9 16h4',
  download: 'M12 3v12m0 0 4.5-4.5M12 15 7.5 10.5M4 17v3h16v-3',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 22, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className={className}>
      <path d={PATHS[name]} stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- Page plein écran (au-dessus de la carte) ---------- */

export function Page(p: {
  title: string;
  subtitle?: ReactNode;
  onBack?: () => void;
  backLabel?: string;
  action?: ReactNode;
  hero?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={`page ${p.hero ? 'page-hero' : ''}`}>
      <header className="page-head">
        {p.onBack && (
          <button className="page-back" onClick={p.onBack}>
            <Icon name="back" size={20} /> {p.backLabel ?? 'Retour'}
          </button>
        )}
        <div className="page-title-row">
          <div className="page-titles">
            <h1>{p.title}</h1>
            {p.subtitle && <div className="page-sub">{p.subtitle}</div>}
          </div>
          {p.action}
        </div>
      </header>
      <div className="page-body">{p.children}</div>
    </section>
  );
}

/* ---------- Tuile de l'accueil ---------- */

export function Tile(p: {
  icon: IconName;
  label: string;
  sub?: string;
  count?: number | null;
  tone?: 'navy' | 'orange' | 'danger' | 'ok' | 'plain';
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className={`tile tile-${p.tone ?? 'plain'}`} onClick={p.onClick} disabled={p.disabled}>
      <span className="tile-top">
        <span className="tile-ico"><Icon name={p.icon} /></span>
        {p.count != null && <span className="tile-count">{p.count}</span>}
      </span>
      <b>{p.label}</b>
      {p.sub && <small>{p.sub}</small>}
    </button>
  );
}

/* ---------- Petits éléments ---------- */

export function Avatar({ nom, off, tone }: { nom: string; off?: boolean; tone?: 'navy' | 'orange' | 'grey' }) {
  const ini = nom
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return <span className={`avatar avatar-${off ? 'off' : tone ?? 'navy'}`}>{ini || '?'}</span>;
}

export function StatutBadge({ statut }: { statut: Statut }) {
  const c = choice(STATUTS, statut);
  return <span className={`statut statut-${statut}`}>{c.label}</span>;
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ico"><Icon name={icon} size={28} /></span>
      <b>{title}</b>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** État de la synchronisation avec le serveur, et bouton pour actualiser. */
export function SyncLine({ eq }: { eq: Equipe }) {
  const text = eq.sync.busy
    ? 'Synchronisation…'
    : eq.sync.error
      ? eq.sync.error
      : eq.sync.offline
        ? `Hors-ligne${eq.pending.length ? ` · ${eq.pending.length} envoi(s) en attente` : ' · données gardées sur le téléphone'}`
        : eq.pending.length
          ? `${eq.pending.length} envoi(s) en attente`
          : eq.sync.last
            ? `À jour à ${new Date(eq.sync.last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
            : 'Chargement…';
  const tone = eq.sync.error ? 'error' : eq.sync.offline || eq.pending.length ? 'warn' : eq.sync.last ? 'ok' : '';
  return (
    <div className={`sync-line ${tone}`}>
      <span>{text}</span>
      <button className="icon-btn small-icon" onClick={() => void eq.refresh()} disabled={eq.sync.busy} aria-label="Actualiser">
        <Icon name="refresh" size={18} />
      </button>
    </div>
  );
}

/* ---------- Textes ---------- */

export const errText = (e: unknown) =>
  e instanceof Error ? (e.message === 'Pas de réseau' ? 'Pas de réseau : réessaie quand tu as du réseau.' : e.message) : 'Erreur';

export const ROLE = { admin: 'Administrateur', chef: 'Chef de chantier', agent: 'Agent' } as const;

export const prenom = (nom: string) => nom.trim().split(/\s+/)[0] ?? nom;

/** « il y a 5 min », « hier à 14:02 », « le 12/11 ». */
export function ilYa(iso: string | null): string {
  if (!iso) return 'jamais';
  const t = Date.parse(iso);
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  const d = new Date(t);
  const heure = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return h <= 3 ? `il y a ${h} h` : `aujourd’hui à ${heure}`;
  const hier = new Date(today);
  hier.setDate(today.getDate() - 1);
  if (d.toDateString() === hier.toDateString()) return `hier à ${heure}`;
  return `le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} à ${heure}`;
}

export const vuLe = (iso: string | null) => (iso ? `vu ${ilYa(iso)}` : 'jamais connecté');
