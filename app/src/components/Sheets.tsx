import { PREVIEW } from '../lib/env';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Point } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import {
  clearOffline,
  downloadOffline,
  loadGares,
  offlineState,
  storageEstimate,
  type GareEntry,
  type Manifest,
  type OfflineState,
} from '../lib/data';
import type { Acces, AccesSet } from '../lib/acces';
import { fmtLine, fmtPk } from '../lib/format';
import { parsePk, parsePkQuery } from '../lib/pk';
import { NavLinks } from './TargetSheet';
import { bestIndexes, normName, searchAcces } from '../lib/search';
import { RFN_CREDIT, RFN_URL, signalImage, SIGNAL_ICONS } from '../lib/signaux';
import { InstallSteps } from './Install';
import { MyMapsLink } from './MyMapsLink';
import { installMode } from '../lib/install';
import type { LonLat } from '../lib/geo';
import { FILTERS, type FilterKey, type Filters } from '../lib/layers';
import type { Basemap } from '../map/style';

export function Modal({ title, onClose, children, side }: { title: string; onClose: () => void; children: React.ReactNode; side?: boolean }) {
  return (
    <div className={`modal-back ${side ? 'side' : ''}`} onClick={onClose}>
      <div className="modal" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/* ---------- Filtres et fond de carte ---------- */

export interface ImportStatus {
  busy: boolean;
  text: string;
  error?: boolean;
}

/** Import d'une carte d'accès : fichier KML/KMZ ou lien Google My Maps. */
function AccesImport(p: { status: ImportStatus | null; onImport: (src: File | string) => void; first: boolean }) {
  return (
    <div className="acces-box">
      <div className="field-label">{p.first ? 'Importer mes accès' : 'Ajouter d’autres accès'}</div>
      <p className="muted small">
        Fichier KML ou KMZ (Google My Maps : menu ⋮ › « Télécharger KML »), ou directement le lien de la carte Google My
        Maps. Chaque accès reçoit sa ligne et son PK. La carte reste uniquement sur ce téléphone.
      </p>
      <label className={`btn file-btn ${p.status?.busy ? 'disabled' : ''}`}>
        {p.status?.busy ? 'Import en cours…' : 'Importer un fichier KML ou KMZ'}
        <input
          type="file"
          disabled={p.status?.busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) p.onImport(f);
            e.target.value = '';
          }}
        />
      </label>
      <MyMapsLink busy={p.status?.busy} onSubmit={p.onImport} />
      {p.status && !p.status.busy && <p className={p.status.error ? 'error small' : 'ok small'}>{p.status.text}</p>}
    </div>
  );
}

function DoorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M3 21h18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="14.5" cy="12.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

/** Accès d'un fichier rangés par ligne puis par PK (dans l'ordre du terrain), les autres par nom. */
function sortAcces(items: Acces[]): Acces[] {
  return [...items].sort(
    (x, y) =>
      Number(!x.code) - Number(!y.code) ||
      (x.code ?? '').localeCompare(y.code ?? '') ||
      (x.pk ?? Infinity) - (y.pk ?? Infinity) ||
      x.name.localeCompare(y.name, 'fr', { numeric: true }),
  );
}

const accesLine = (a: Acces) => (a.code ? `Ligne ${fmtLine(a.code)}` : 'Pas rattaché à une ligne');

function AccesRow({ a, sub, onPick }: { a: Acces; sub: string; onPick: (at: LonLat) => void }) {
  return (
    <li>
      <button className="acces-row" onClick={() => onPick(a.lonlat)}>
        <span className="acces-ico">
          <DoorIcon />
        </span>
        <span className="acces-main">
          <b>{a.name || 'Accès sans nom'}</b>
          <small>{sub}</small>
        </span>
        {a.pk !== undefined && <span className="acces-pk">PK {fmtPk(a.pk)}</span>}
      </button>
    </li>
  );
}

/** Un fichier importé, en menu déroulant (fermé au départ) : ses accès, puis « Voir sur la carte » et « Supprimer ». */
function AccesFile(p: {
  set: AccesSet;
  onToggle: (id: string) => void;
  onShowSet: (set: AccesSet) => void;
  onDeleteSet: (id: string) => void;
  onPick: (at: LonLat) => void;
}) {
  const [open, setOpen] = useState(false);
  const { set } = p;
  return (
    <section className={`acces-file ${open ? 'open' : ''} ${set.hidden ? 'off' : ''}`}>
      <div className="acces-file-top">
      <button className="acces-file-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="acces-file-ico">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="acces-file-name">
          <b>{set.name}</b>
          <small>
            {set.hidden
              ? `Désactivée · ${set.items.length} accès cachés`
              : `${set.items.length} accès · ${set.items.filter((a) => a.code).length} rattachés à une ligne`}
          </small>
        </span>
        <svg className="acces-chev" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <label className="acces-switch" title={set.hidden ? 'Activer cette liste' : 'Désactiver cette liste'}>
        <input type="checkbox" checked={!set.hidden} onChange={() => p.onToggle(set.id)} aria-label={`Liste « ${set.name} » activée`} />
        <span className="switch-ui" aria-hidden="true" />
      </label>
      </div>
      {open && (
        <div className="acces-file-body">
          <ul className="acces-list">
            {sortAcces(set.items).map((a, i) => (
              <AccesRow key={i} a={a} sub={accesLine(a)} onPick={p.onPick} />
            ))}
          </ul>
          <div className="acces-file-actions">
            <button className="btn btn-small" onClick={() => p.onShowSet(set)} disabled={!set.items.length}>
              Voir tout sur la carte
            </button>
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (window.confirm(`Supprimer « ${set.name} » de ce téléphone ?`)) p.onDeleteSet(set.id);
              }}
            >
              Supprimer le fichier
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Bouton « Accès » : afficher ou cacher mes accès, les retrouver dans une liste, en importer, en supprimer. */
export function AccesSheet(p: {
  sets: AccesSet[];
  shown: boolean;
  onToggleShown: () => void;
  status: ImportStatus | null;
  onImport: (src: File | string) => void;
  onDeleteSet: (id: string) => void;
  onShowSet: (set: AccesSet) => void;
  /** Active ou désactive une liste (un fichier importé). */
  onToggleSet: (id: string) => void;
  onPick: (at: LonLat) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const total = p.sets.reduce((n, s) => n + s.items.length, 0);
  const found = q.trim().length >= 2 ? searchAcces(q, p.sets, 500) : null;
  return (
    <Modal title="Mes accès" onClose={p.onClose}>
      <label className="toggle">
        <span>
          Afficher mes accès sur la carte
          <small>Points verts avec leur nom. Chaque liste s’active ou se désactive avec son bouton.</small>
        </span>
        <input type="checkbox" checked={p.shown} onChange={p.onToggleShown} />
      </label>
      {total > 0 && (
        <>
          <input
            className="acces-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Chercher parmi tes ${total} accès`}
            aria-label="Chercher un accès par son nom, son détail ou son fichier"
            enterKeyHint="search"
          />
          {found ? (
            found.hits.length ? (
              <ul className="acces-list">
                {found.hits.map(({ set, a }, i) => (
                  <AccesRow key={i} a={a} sub={`${accesLine(a)} · ${set.name}`} onPick={p.onPick} />
                ))}
              </ul>
            ) : (
              <p className="muted">Aucun accès ne correspond à « {q.trim()} ».</p>
            )
          ) : (
            p.sets.map((set) => <AccesFile key={set.id} set={set} onToggle={p.onToggleSet} onShowSet={p.onShowSet} onDeleteSet={p.onDeleteSet} onPick={p.onPick} />)
          )}
        </>
      )}
      {PREVIEW ? (
        <p className="muted small">L’import d’accès n’est pas disponible dans cet aperçu.</p>
      ) : (
        <AccesImport status={p.status} onImport={p.onImport} first={total === 0} />
      )}
    </Modal>
  );
}

export function FilterSheet(p: {
  filters: Filters;
  basemap: Basemap;
  onToggle: (k: FilterKey) => void;
  onBasemap: (b: Basemap) => void;
  /** Ouvre « Mes accès » (liste, import, suppression). */
  onOpenAcces: () => void;
  onClose: () => void;
}) {
  const groups = [...new Set(FILTERS.map((f) => f.group))];
  return (
    <Modal title="Couches" onClose={p.onClose}>
      <div className="field-label">Fond de carte</div>
      <div className="chips">
        {(
          [
            ['plan', PREVIEW ? 'Plan simplifié' : 'Plan'],
            ['photo', 'Photo aérienne IGN'],
            ['aucun', 'Aucun (hors-ligne)'],
          ] as [Basemap, string][]
        ).filter(([v]) => !PREVIEW || v !== 'photo').map(([v, l]) => (
          <button key={v} className={`chip ${p.basemap === v ? 'on' : ''}`} onClick={() => p.onBasemap(v)}>
            {l}
          </button>
        ))}
      </div>
      {groups.map((g) => (
        <div key={g}>
          <div className="field-label">{g}</div>
          {FILTERS.filter((f) => f.group === g).map((f) => (
            <label key={f.key} className="toggle">
              <span>
                {f.label}
                {f.hint && <small>{f.hint}</small>}
              </span>
              <input type="checkbox" checked={p.filters[f.key]} onChange={() => p.onToggle(f.key)} />
            </label>
          ))}
        </div>
      ))}
      <p className="muted small">
        Les signaux viennent d’OpenStreetMap : couverture partielle selon les secteurs, et pas toujours à jour.
      </p>
      {!PREVIEW && (
        <button className="btn wide" onClick={p.onOpenAcces}>
          Mes accès : liste, import et suppression
        </button>
      )}
    </Modal>
  );
}

/* ---------- Hors-ligne ---------- */

export function OfflineSheet(p: { manifest: Manifest | null; onChanged: () => void; onClose: () => void }) {
  const [state, setState] = useState<OfflineState | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [usage, setUsage] = useState<number | null>(null);
  const abort = useRef<AbortController | null>(null);

  const refresh = async () => {
    if (!p.manifest) return;
    setState(await offlineState(p.manifest));
    setUsage((await storageEstimate())?.usage ?? null);
  };
  useEffect(() => {
    void refresh();
    return () => abort.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.manifest]);

  const start = async () => {
    if (!p.manifest) return;
    setError(null);
    abort.current = new AbortController();
    try {
      // Demande au navigateur de ne pas effacer ces données en cas de manque de place.
      await navigator.storage?.persist?.();
      await downloadOffline(p.manifest, (done, total, label) => setProgress({ done, total, label }), abort.current.signal);
      p.onChanged();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setProgress(null);
      void refresh();
    }
  };

  const complete = state && state.pmtiles && state.files === state.total;
  return (
    <Modal title="Hors-ligne" onClose={p.onClose}>
      <p>
        Télécharge toutes les données ferroviaires de France sur le téléphone : la carte des voies, les PK et le repérage
        marcheront sans réseau.
      </p>
      {state && (
        <p className={complete ? 'ok' : 'muted'}>
          {complete
            ? 'Toutes les données sont sur le téléphone.'
            : `Sur le téléphone : ${state.files} fichiers sur ${state.total}${state.pmtiles ? ', carte des voies incluse' : ', carte des voies non téléchargée'}.`}
        </p>
      )}
      {progress ? (
        <div>
          <div className="progress">
            <div style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }} />
          </div>
          <p className="muted small">
            {progress.label} {Math.round((progress.done / progress.total) * 100)} %
          </p>
          <button className="btn" onClick={() => abort.current?.abort()}>
            Annuler
          </button>
        </div>
      ) : (
        <div className="row">
          <button className="btn primary" onClick={start} disabled={!p.manifest}>
            {complete ? 'Mettre à jour' : 'Télécharger toute la France (≈ 45 Mo)'}
          </button>
          {state && state.files > 0 && (
            <button
              className="btn"
              onClick={async () => {
                await clearOffline();
                p.onChanged();
                void refresh();
              }}
            >
              Effacer
            </button>
          )}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {usage !== null && <p className="muted small">Espace utilisé par l’appli : {(usage / 1e6).toFixed(0)} Mo.</p>}
      <p className="muted small">
        Le fond de carte (plan, photo) n’est gardé que pour les zones déjà affichées avec du réseau. Sans lui, les voies, PK et
        éléments restent visibles sur fond uni.
      </p>
    </Modal>
  );
}

/* ---------- Informations ---------- */

export function InfoSheet(p: { manifest: Manifest | null; onClose: () => void }) {
  const q = p.manifest?.quality;
  return (
    <Modal title="À propos" onClose={p.onClose}>
      <div className="warn-box">
        <b>Aide au repérage uniquement.</b> Ne remplace jamais les documents officiels (renseignements techniques, consignes,
        avis), l’annonce, la protection ou les échanges avec l’agent circulation. Positions, PK et signaux peuvent être
        approximatifs, incomplets ou périmés.
      </div>
      <h3>Installer sur l’écran d’accueil</h3>
      <InstallSteps mode={installMode()} />
      <h3>Version</h3>
      <p className="small">
        Appli du {new Date(__BUILD__).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · données PK du{' '}
        {p.manifest ? new Date(`${p.manifest.version.slice(0, 10)}T12:00:00`).toLocaleDateString('fr-FR') : '…'}
      </p>
      <button
        className="btn wide"
        onClick={async () => {
          // Dépannage : on jette l'appli et les données gardées, puis on recharge depuis le site.
          try {
            if ('caches' in globalThis) for (const k of await caches.keys()) if (k !== 'fond-plan' && k !== 'fond-photo') await caches.delete(k);
            localStorage.removeItem('rr-data-version');
            const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
            await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
          } finally {
            location.reload();
          }
        }}
      >
        Recharger l’appli et les données
      </button>
      <p className="muted small">À utiliser si les PK ou l’appli semblent anciens. Il faut du réseau ; le téléchargement hors-ligne sera à refaire.</p>
      <h3>Comment le PK est calculé</h3>
      <p>
        Le GPS donne ta position ; l’appli la rattache à la ligne SNCF la plus proche (ou à celle qui correspond à la distance
        indiquée) et lit le PK à cet endroit. Les PK le long des lignes sont recalés sur les quelque 63 000 repères dont SNCF
        Réseau publie à la fois le PK et la position : PN, gares, ponts-route, quais, extrémités de voies et de sections.
      </p>
      {q && (
        <ul className="small">
          <li>
            Contrôle sur {q.pk_recalage.validation_points?.toLocaleString('fr-FR')} repères masqués : écart médian{' '}
            {q.pk_recalage.erreur_mediane_m} m, 90 % sous {q.pk_recalage.erreur_p90_m} m.
          </li>
          {q.controle_bornes_osm.bornes ? (
            <li>
              Recalage aussi sur {q.reperes.borne?.toLocaleString('fr-FR')} bornes kilométriques relevées dans OpenStreetMap.
              Contrôle sur {q.controle_bornes_osm.bornes.toLocaleString('fr-FR')} bornes mises de côté : 90 % sous{' '}
              {String(q.controle_bornes_osm.apres_p90_m).replace('.', ',')} m (avant : {String(q.controle_bornes_osm.avant_p90_m).replace('.', ',')} m).
              Là où aucune borne n’est relevée, l’écart peut dépasser 100 m : corrige-le devant une borne.
            </li>
          ) : (
            <li>
              Contrôle sur {q.controle_bornes_osm.bornes_comparees?.toLocaleString('fr-FR')} bornes kilométriques relevées dans
              OpenStreetMap : écart médian {q.controle_bornes_osm.ecart_median_m} m, 75 % sous {q.controle_bornes_osm.ecart_p75_m} m.
            </li>
          )}
          <li>À cela s’ajoute l’imprécision du GPS du téléphone (souvent 5 à 15 m).</li>
        </ul>
      )}
      <h3>Astuces</h3>
      <ul className="small">
        <li>« Me repérer » écoute le GPS jusqu’à 12 s et combine les mesures : reste immobile, à découvert.</li>
        <li>Deux lignes proches : si ce n’est pas la bonne, touche la tienne dans « Autres lignes proches ».</li>
        <li>Appui long sur la carte : « me placer ici » (utile si le GPS est mauvais, ou pour préparer une intervention).</li>
        <li>Touche un élément de la carte pour voir son PK et sa ligne.</li>
      </ul>
      <h3>Sources</h3>
      <ul className="small">
        {p.manifest?.sources.map((s) => (
          <li key={s.name}>
            {s.name} — {s.license}
            {s.date ? ` (extrait du ${s.date})` : ''} —{' '}
            <a href={s.url} target="_blank" rel="noreferrer">
              {s.url.replace(/^https?:\/\//, '')}
            </a>
          </li>
        ))}
        <li>Fond plan : OpenFreeMap © OpenMapTiles, données © OpenStreetMap. Photo aérienne : © IGN (Licence Ouverte).</li>
        <li>
          {RFN_CREDIT} —{' '}
          <a href={RFN_URL} target="_blank" rel="noreferrer">
            {RFN_URL.replace(/^https?:\/\//, '')}
          </a>
          . L’appli est elle aussi sous licence GPL-3.0.
        </li>
      </ul>
      <p className="muted small">
        Données SNCF Réseau publiées entre 2020 et 2022 : des modifications récentes du réseau peuvent manquer. Version des
        données : {p.manifest?.version ?? '—'}. Projet personnel, indépendant de la SNCF.
      </p>
    </Modal>
  );
}

/* ---------- Premier lancement ---------- */

export function Disclaimer({ onAccept }: { onAccept: () => void }) {
  return (
    <div className="modal-back">
      <div className="modal">
        <div className="modal-body">
          <h2>Repère Rail</h2>
          <p>Pour savoir où tu es sur le réseau : ligne, PK, gares, PN, tunnels, signaux autour de toi.</p>
          {PREVIEW && (
            <p>
              <b>Version d’essai :</b> ici le GPS et les fonds plan et photo sont bloqués. Cherche une gare, puis appuie
              longuement sur la carte près des voies pour te placer.
            </p>
          )}
          <div className="warn-box">
            <b>Aide au repérage, jamais une référence de sécurité.</b> PK et signaux calculés à partir de données ouvertes (SNCF
            Réseau, OpenStreetMap) : ils peuvent être faux, incomplets ou périmés. Ne t’en sers pas pour une annonce, une
            protection de chantier ou une manœuvre ; vérifie toujours sur le terrain et dans les documents officiels.
          </div>
          <button className="btn primary wide" onClick={onAccept}>
            J’ai compris
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Fiche d'un élément touché sur la carte ---------- */

const LAYER_TITLE: Record<string, string> = {
  'r-gares': 'Gare', 'r-pn': 'Passage à niveau', 'r-sst': 'Sous-station', 'r-ouvrages': 'Ouvrage',
  'r-bornes': 'Borne kilométrique (OpenStreetMap)', 'r-pk-km': 'PK calculé', 'r-pk-hm': 'PK calculé',
  'r-sig-carre': 'Signal (OpenStreetMap)', 'r-sig-avert': 'Signal (OpenStreetMap)', 'r-sig-vitesse': 'Pancarte (OpenStreetMap)',
  'r-sig-elec': 'Signal électrique (OpenStreetMap)', 'r-sig-autre': 'Signal (OpenStreetMap)', 'r-quais': 'Quai',
  'r-voies': 'Voie', 'r-tunnels': 'Tunnel (OpenStreetMap)', 'r-lignes': 'Ligne', 'r-lignes-autres': 'Ligne',
  'u-acces': 'Accès (importé)', 'u-target': 'Destination',
};

export function FeatureCard(p: {
  feature: MapGeoJSONFeature;
  at: LonLat;
  manifest: Manifest | null;
  onPlaceHere: (at: LonLat) => void;
  onClose: () => void;
}) {
  const f = p.feature;
  const pr = f.properties as Record<string, string | undefined>;
  const layer = f.layer.id;
  // « -ic » : même couche, signaux dessinés.
  const title = LAYER_TITLE[layer.replace(/-ic$/, '')] ?? 'Élément';
  let name = pr.n ?? pr.l ?? '';
  if (layer.startsWith('r-pk')) name = `PK ${pr.p}`;
  if (layer === 'r-bornes') name = `Borne ${pr.p}`;
  if (layer === 'r-voies') name = pr.n ? `Voie ${pr.n}` : 'Voie sans nom';
  if (layer.startsWith('r-lignes')) name = `Ligne ${fmtLine(pr.c ?? '')}`;
  const lineName = pr.c ? p.manifest?.lines[pr.c]?.n : null;
  const point = f.geometry.type === 'Point' ? ((f.geometry as Point).coordinates as LonLat) : p.at;
  const dessin = SIGNAL_ICONS && pr.ic ? pr.ic : null;

  return (
    <section className="card">
      <div className="sheet-head">
        <div>
          <div className="eyebrow">{title}</div>
          <div className="card-title">{name}</div>
        </div>
        <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
          ×
        </button>
      </div>
      {dessin && (
        <figure className="sig-figure">
          <img src={signalImage(dessin)} alt={`Dessin du signal : ${name}`} />
          <figcaption>
            Dessin type de ce signal. Le signal réel peut différer : vérifie toujours sur le terrain.
          </figcaption>
        </figure>
      )}
      <dl className="facts">
        {pr.pk && (
          <>
            <dt>PK</dt>
            <dd>{pr.pk}</dd>
          </>
        )}
        {pr.c && (
          <>
            <dt>Ligne</dt>
            <dd>
              {fmtLine(pr.c)}
              {lineName ? ` — ${lineName}` : ''}
            </dd>
          </>
        )}
        {pr.d && (
          <>
            <dt>Détail</dt>
            <dd>{pr.d}</dd>
          </>
        )}
        {pr.g && (
          <>
            <dt>Gare</dt>
            <dd>{pr.g}</dd>
          </>
        )}
        {layer === 'r-voies' && pr.t && (
          <>
            <dt>Type SNCF</dt>
            <dd>{pr.t}</dd>
          </>
        )}
        {layer === 'r-gares' && (
          <>
            <dt>Service</dt>
            <dd>{pr.k === 'V' ? 'Voyageurs' : 'Fret / service'}</dd>
          </>
        )}
        {pr.set && (
          <>
            <dt>Carte</dt>
            <dd>{pr.set}</dd>
          </>
        )}
      </dl>
      {f.geometry.type === 'Point' && (
        <>
          <div className="field-label">Itinéraire en voiture</div>
          <NavLinks at={point} />
        </>
      )}
      <button className="btn" onClick={() => p.onPlaceHere(point)}>
        Me placer ici
      </button>
    </section>
  );
}

/* ---------- Recherche ---------- */

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

interface SearchResult {
  label: string;
  sub: string;
  at?: LonLat;
  zoom?: number;
  pk?: { code: string; pk: number };
  /** Un de « mes accès » : on ouvre sa fiche. */
  acces?: boolean;
}

const RECENTS_KEY = 'rr-recherches';
function loadRecents(): SearchResult[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, 6) : [];
  } catch {
    return [];
  }
}
function saveRecents(list: SearchResult[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* stockage plein ou bloqué */
  }
}

export function Search(p: {
  manifest: Manifest | null;
  /** Ligne où l'on se trouve (ou celle du chantier) : un PK tapé seul s'y rapporte. */
  currentLine: string | null;
  acces: AccesSet[];
  /** Recherche déjà tapée à l'ouverture (le nom d'un fichier d'accès, pour voir sa liste). */
  initialQuery?: string;
  onGo: (at: LonLat, zoom: number) => void;
  onPk: (code: string, pk: number) => void;
  onAcces: (at: LonLat) => void;
}) {
  const [q, setQ] = useState(p.initialQuery ?? '');
  const [gares, setGares] = useState<GareEntry[] | null>(null);
  const [open, setOpen] = useState(!!p.initialQuery);
  const [allAcces, setAllAcces] = useState(!!p.initialQuery);
  const [recents, setRecents] = useState<SearchResult[]>(() => loadRecents());
  // Noms de gares préparés une fois (accents, « Saint » → « St ») pour chercher vite à chaque lettre.
  const garesNorm = useMemo(() => (gares ?? []).map((g) => normName(g[0])), [gares]);

  useEffect(() => {
    if (open && !gares) loadGares().then(setGares).catch(() => setGares([]));
  }, [open, gares]);

  const nq = norm(q);
  const pkResults: SearchResult[] = [];
  const pkq = parsePkQuery(q);
  if (pkq && p.manifest?.lines[pkq.code]) {
    pkResults.push({
      label: `PK ${fmtPk(pkq.pk)} · ligne ${fmtLine(pkq.code)}`,
      sub: p.manifest.lines[pkq.code].n ?? 'Aller à ce PK',
      pk: pkq,
    });
  }
  // PK tapé seul (« 45+200 », « 45,2 », « PK 45 ») : sur la ligne où l'on est.
  const pkAlone = !pkq && /^\s*(pk\s*)?-?\d{1,4}(\s*[+,.]\s*\d{1,3})?\s*$/i.test(q) && (/[+,.]|pk/i.test(q) || q.trim().length <= 3);
  const alonePk = pkAlone ? parsePk(q) : null;
  if (alonePk !== null) {
    if (p.currentLine && p.manifest?.lines[p.currentLine]) {
      pkResults.push({
        label: `PK ${fmtPk(alonePk)} · ligne ${fmtLine(p.currentLine)}`,
        sub: `${p.manifest.lines[p.currentLine].n ?? ''} (ta ligne)`,
        pk: { code: p.currentLine, pk: alonePk },
      });
    } else {
      pkResults.push({ label: `PK ${fmtPk(alonePk)} : sur quelle ligne ?`, sub: 'Repère-toi d’abord, ou tape la ligne puis le PK : 830000 45+200' });
    }
  }
  const textQuery = nq.length >= 2 && !pkq && !(alonePk !== null && /[+,.]|pk/i.test(q));
  // Mes accès : par leur nom, leur description ou le nom du fichier importé.
  const found = textQuery ? searchAcces(q, p.acces, allAcces ? 300 : 6) : { hits: [], total: 0, exact: false };
  const accesResults: SearchResult[] = found.hits.map(({ set, a }) => ({
    label: a.name || 'Accès sans nom',
    // Espaces insécables : « ligne 830 000 » et « PK 28+790 » ne se coupent pas en fin de ligne.
    sub: [`Accès · ${set.name}`, a.code ? `ligne\u00a0${fmtLine(a.code).replace(/ /g, '\u00a0')}` : '', a.pk !== undefined ? `PK\u00a0${fmtPk(a.pk)}` : ''].filter(Boolean).join(' · '),
    at: a.lonlat,
    zoom: 17,
    acces: true,
  }));
  const placeResults: SearchResult[] = [];
  if (textQuery) {
    const digits = nq.replace(/\s/g, '');
    if (/^\d{3,6}$/.test(digits) && p.manifest) {
      for (const [code, info] of Object.entries(p.manifest.lines)) {
        if (code.startsWith(digits) && placeResults.length < 3) {
          const g = gares?.find((x) => x[3] === code);
          if (g) placeResults.push({ label: `Ligne ${fmtLine(code)}`, sub: info.n ?? '', at: [g[1], g[2]], zoom: 11 });
        }
      }
    }
    // Gares : début du nom ou d'un mot d'abord, puis noms approchants (fautes de frappe tolérées),
    // sauf si un de mes accès porte déjà ce nom : pas de gares « approchantes » qui encombrent.
    for (const i of bestIndexes(q, garesNorm, 6, found.exact ? 1 : Infinity)) {
      const g = gares![i];
      placeResults.push({ label: g[0], sub: `Gare · ligne ${fmtLine(g[3])}`, at: [g[1], g[2]], zoom: 15 });
    }
  }
  const results = [...pkResults, ...accesResults, ...placeResults];

  const choose = (r: SearchResult) => {
    if (r.pk) p.onPk(r.pk.code, r.pk.pk);
    else if (r.acces && r.at) p.onAcces(r.at);
    else if (r.at) p.onGo(r.at, r.zoom ?? 15);
    else return;
    const next = [r, ...recents.filter((x) => x.label !== r.label || x.sub !== r.sub)].slice(0, 6);
    setRecents(next);
    saveRecents(next);
    setQ('');
    setOpen(false);
    (document.activeElement as HTMLElement | null)?.blur();
  };
  const showRecents = open && !q.trim() && recents.length > 0;

  return (
    <div className="search">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={p.acces.length ? 'Gare, ligne, PK, accès…' : 'Gare, ligne, PK…'}
        aria-label="Rechercher une gare, une ligne, un PK ou un de mes accès"
        autoFocus={!!p.initialQuery}
        enterKeyHint="search"
      />
      {showRecents && (
        <ul className="results">
          <li className="results-head">
            <span>Récents</span>
            <button
              className="link-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setRecents([]);
                saveRecents([]);
              }}
            >
              Effacer
            </button>
          </li>
          {recents.map((r, i) => (
            <li key={`r-${i}`}>
              <button onClick={() => choose(r)}>
                <b>{r.label}</b>
                <small>{r.sub}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && results.length > 0 && (
        <ul className="results">
          {pkResults.map((r, i) => (
            <li key={`pk-${i}`}>
              <button disabled={!r.at && !r.pk} onClick={() => choose(r)}>
                <b>{r.label}</b>
                <small>{r.sub}</small>
              </button>
            </li>
          ))}
          {accesResults.length > 0 && (
            <li className="results-head">
              <span>Mes accès · {found.total}</span>
            </li>
          )}
          {accesResults.map((r, i) => (
            <li key={`a-${i}`}>
              <button className="acces-res" onClick={() => choose(r)}>
                <b>{r.label}</b>
                <small>{r.sub}</small>
              </button>
            </li>
          ))}
          {found.total > accesResults.length && (
            <li>
              {allAcces ? (
                <p className="muted small more-note">Et {found.total - accesResults.length} autres : précise ta recherche.</p>
              ) : (
                <button className="more-res" onMouseDown={(e) => e.preventDefault()} onClick={() => setAllAcces(true)}>
                  <b>Voir les {found.total} accès</b>
                </button>
              )}
            </li>
          )}
          {placeResults.length > 0 && accesResults.length > 0 && (
            <li className="results-head">
              <span>Gares et lignes</span>
            </li>
          )}
          {placeResults.map((r, i) => (
            <li key={`g-${i}`}>
              <button onClick={() => choose(r)}>
                <b>{r.label}</b>
                <small>{r.sub}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
