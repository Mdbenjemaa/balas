import { useEffect, useMemo, useState } from 'react';
import { api, type Signalement, type Statut } from '../../lib/equipe/api';
import { choice, GRAVITES, NATURES, STATUTS, statutOf, trierSignalements } from '../../lib/equipe/catalog';
import { fmtDateHeure, shareFile, signalementsCsv } from '../../lib/equipe/exports';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtLine, fmtPk } from '../../lib/format';
import type { LonLat } from '../../lib/geo';
import { NavLinks } from '../TargetSheet';
import { Avatar, Empty, Icon, ilYa, Page, StatutBadge } from './ui';

export type Filtre = 'a_traiter' | 'nouveaux' | 'moi' | 'mes' | 'traites' | 'tous';
export interface SigIntent {
  filtre?: Filtre;
  open?: string;
}

type Sig = Equipe['view']['signalements'][number];

/** Photos d'un signalement (adresses temporaires signées). */
export function usePhotos(eq: Equipe, sig: Signalement | undefined) {
  const [urls, setUrls] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const code = eq.session?.code;
  const chantier = eq.session?.chantierId;
  useEffect(() => {
    setUrls([]);
    setErr(null);
    if (!sig?.photos.length || !code || !chantier) return;
    let cancelled = false;
    api
      .photosRead(code, chantier, sig.photos)
      .then((r) => !cancelled && setUrls(r.urls.map((u) => u.url)))
      .catch(() => !cancelled && setErr('Photos indisponibles sans réseau.'));
    return () => {
      cancelled = true;
    };
  }, [sig?.id, sig?.photos, code, chantier]);
  return { urls, err };
}

/** Peut faire avancer ce signalement : le chef, ou l'agent à qui il est confié. */
export const peutSuivre = (eq: Equipe, s: Signalement) => !!eq.etat?.gere || (!!s.assigne_id && s.assigne_id === eq.etat?.moi.id);

export function suivre(eq: Equipe, s: Signalement, patch: { statut?: Statut; assigne?: string; assigne_nom?: string | null }) {
  return eq.envoyer({ id: `suivi:${s.id}:${Date.now()}`, kind: 'suivi', payload: { id: s.id, ...patch } });
}

/* ---------- Liste ---------- */

function SigCard({ s, onOpen, moi }: { s: Sig; onOpen: () => void; moi: string | undefined }) {
  const g = choice(GRAVITES, s.gravite);
  const st = statutOf(s);
  return (
    <li>
      <button className={`sig-card ${st === 'traite' ? 'done' : ''}`} onClick={onOpen} style={{ borderLeftColor: g.color }}>
        <span className="sig-top">
          <b>{choice(NATURES, s.nature).label}</b>
          <StatutBadge statut={st} />
        </span>
        <span className="sig-line">
          <span className="grav" style={{ color: g.color }}>{g.label}</span>
          {s.pk !== null && <> · {s.ligne ? `L${fmtLine(s.ligne)} ` : ''}PK {fmtPk(s.pk)}</>}
          {s.voie && <> · voie {s.voie}</>}
          {s.photos.length > 0 && <> · {s.photos.length} photo{s.photos.length > 1 ? 's' : ''}</>}
        </span>
        {s.commentaire && <span className="sig-comment">{s.commentaire.split('\n')[0]}</span>}
        <span className="sig-meta">
          {s.auteur_nom} · {ilYa(s.cree_le)}
          {s.pending && ' · en attente d’envoi'}
          {s.assigne_nom && (
            <b className={`sig-assigne ${s.assigne_id === moi ? 'me' : ''}`}> → {s.assigne_id === moi ? 'pour toi' : s.assigne_nom}</b>
          )}
        </span>
      </button>
    </li>
  );
}

export function SignalementsPage(p: {
  eq: Equipe;
  intent: SigIntent | null;
  onSignal: () => void;
  onMap: (id: string, at: LonLat) => void;
}) {
  const { eq } = p;
  const gere = !!eq.etat?.gere;
  const moi = eq.etat?.moi.id;
  const [filtre, setFiltre] = useState<Filtre>(p.intent?.filtre ?? (gere ? 'a_traiter' : 'a_traiter'));
  const [grav, setGrav] = useState<string>('toutes');
  const [open, setOpen] = useState<string | null>(p.intent?.open ?? null);

  const all = eq.view.signalements;
  const tests: Record<Filtre, (s: Sig) => boolean> = {
    a_traiter: (s) => statutOf(s) !== 'traite',
    nouveaux: (s) => statutOf(s) === 'nouveau',
    moi: (s) => s.assigne_id === moi && statutOf(s) !== 'traite',
    mes: (s) => s.auteur_id === moi,
    traites: (s) => statutOf(s) === 'traite',
    tous: () => true,
  };
  const segments: { key: Filtre; label: string }[] = gere
    ? [
        { key: 'a_traiter', label: 'À traiter' },
        { key: 'nouveaux', label: 'Nouveaux' },
        { key: 'traites', label: 'Traités' },
        { key: 'tous', label: 'Tous' },
      ]
    : [
        { key: 'a_traiter', label: 'À traiter' },
        { key: 'moi', label: 'Pour moi' },
        { key: 'mes', label: 'Les miens' },
        { key: 'tous', label: 'Tous' },
      ];
  const list = useMemo(
    () => trierSignalements(all.filter((s) => tests[filtre](s) && (grav === 'toutes' || s.gravite === grav))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, filtre, grav, moi],
  );

  if (open) {
    return <SignalementDetail eq={eq} id={open} onBack={() => setOpen(null)} onMap={p.onMap} />;
  }

  const c = eq.etat?.chantier;
  return (
    <Page
      title="Signalements"
      subtitle={c ? c.nom : 'Aucun chantier ouvert'}
      action={
        <button className="btn primary btn-small head-btn" onClick={p.onSignal}>
          <Icon name="plus" size={18} /> Signaler
        </button>
      }
    >
      <div className="seg">
        {segments.map((s) => {
          const n = all.filter(tests[s.key]).length;
          return (
            <button key={s.key} className={filtre === s.key ? 'on' : ''} onClick={() => setFiltre(s.key)}>
              {s.label}
              <small>{n}</small>
            </button>
          );
        })}
      </div>
      <div className="chips small-chips filter-chips">
        {[{ key: 'toutes', label: 'Toutes gravités', color: '' }, ...GRAVITES].map((g) => (
          <button key={g.key} className={`chip ${grav === g.key ? 'on' : ''}`} onClick={() => setGrav(g.key)}>
            {g.color && <span className="dot" style={{ background: g.color }} />} {g.label}
          </button>
        ))}
      </div>

      {!eq.etat ? (
        <Empty icon="alert" title={eq.session?.chantierId ? 'Chargement…' : 'Choisis d’abord un chantier'}>
          {!eq.session?.chantierId && 'Depuis l’onglet Accueil.'}
        </Empty>
      ) : list.length ? (
        <ul className="sig-list">
          {list.map((s) => (
            <SigCard key={s.id} s={s} moi={moi} onOpen={() => setOpen(s.id)} />
          ))}
        </ul>
      ) : (
        <Empty icon="check" title={filtre === 'a_traiter' || filtre === 'moi' ? 'Rien à traiter' : 'Aucun signalement'}>
          {filtre === 'moi' ? 'Ton chef ne t’a rien confié pour l’instant.' : grav !== 'toutes' ? 'Avec cette gravité.' : null}
        </Empty>
      )}

      {gere && eq.etat && list.length > 0 && (
        <button
          className="btn wide"
          onClick={() =>
            void shareFile(signalementsCsv(eq.etat!.chantier, list), `signalements-${eq.etat!.chantier.nom.replace(/[^\w-]+/g, '_')}.csv`)
          }
        >
          <Icon name="download" size={18} /> Exporter ces {list.length} signalements (Excel)
        </button>
      )}
    </Page>
  );
}

/* ---------- Fiche d'un signalement ---------- */

export function SignalementDetail(p: { eq: Equipe; id: string; onBack: () => void; onMap: (id: string, at: LonLat) => void }) {
  const { eq } = p;
  const s = eq.view.signalements.find((x) => x.id === p.id);
  const { urls, err } = usePhotos(eq, s);
  const [zoom, setZoom] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  if (!s) {
    return (
      <Page title="Signalement" onBack={p.onBack} backLabel="Signalements">
        <Empty icon="alert" title="Signalement introuvable" />
      </Page>
    );
  }
  const g = choice(GRAVITES, s.gravite);
  const st = statutOf(s);
  const gere = !!eq.etat?.gere;
  const moi = eq.etat?.moi.id;
  const can = peutSuivre(eq, s);
  const steps: Statut[] = ['nouveau', 'en_cours', 'traite'];
  const idx = steps.indexOf(st);
  const membres = eq.etat?.membres ?? [];

  return (
    <Page title={choice(NATURES, s.nature).label} onBack={p.onBack} backLabel="Signalements"
      subtitle={<span className="grav-pill" style={{ background: g.color }}>{g.label}</span>}>
      <div className="steps">
        {steps.map((k, i) => (
          <div key={k} className={`step ${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}`}>
            <span className="step-dot">{i < idx || (i === idx && k === 'traite') ? <Icon name="check" size={14} /> : i + 1}</span>
            <small>{choice(STATUTS, k).label}</small>
          </div>
        ))}
      </div>
      {s.statut_par && st !== 'nouveau' && (
        <p className="muted small center">
          {choice(STATUTS, st).label} · {s.statut_par}{s.statut_le ? ` · ${ilYa(s.statut_le)}` : ''}
        </p>
      )}
      {s.pending && <p className="warn small center">Modification en attente d’envoi.</p>}

      {can && (
        <div className="btn-row">
          {st === 'nouveau' && (
            <button className="btn" onClick={() => void suivre(eq, s, { statut: 'en_cours' })}>Prendre en charge</button>
          )}
          {st !== 'traite' && (
            <button className="btn primary" onClick={() => void suivre(eq, s, { statut: 'traite' })}>
              <Icon name="check" size={18} /> Marquer traité
            </button>
          )}
          {st === 'traite' && (
            <button className="btn" onClick={() => void suivre(eq, s, { statut: 'en_cours' })}>Rouvrir</button>
          )}
        </div>
      )}

      <div className="detail-card">
        <div className="detail-row">
          <span>Confié à</span>
          <b>{s.assigne_nom ? (s.assigne_id === moi ? `${s.assigne_nom} (toi)` : s.assigne_nom) : 'Personne'}</b>
          {gere && (
            <button className="link-btn" onClick={() => setChoosing((v) => !v)}>{choosing ? 'Fermer' : s.assigne_id ? 'Changer' : 'Confier'}</button>
          )}
        </div>
        {choosing && (
          <div className="assign-list">
            {membres.map((m) => (
              <button
                key={m.id}
                className={`assign ${s.assigne_id === m.id ? 'on' : ''}`}
                onClick={() => {
                  setChoosing(false);
                  void suivre(eq, s, { assigne: m.id, assigne_nom: m.nom });
                }}
              >
                <Avatar nom={m.nom} tone={m.role === 'chef' ? 'navy' : 'orange'} />
                <span>
                  <b>{m.nom}{m.id === moi ? ' (toi)' : ''}</b>
                  <small>{m.fonction ?? (m.role === 'chef' ? 'Chef de chantier' : 'Agent')}</small>
                </span>
                {s.assigne_id === m.id && <Icon name="check" size={18} />}
              </button>
            ))}
            {s.assigne_id && (
              <button className="assign" onClick={() => { setChoosing(false); void suivre(eq, s, { assigne: '' }); }}>
                <span className="avatar avatar-off">—</span>
                <span><b>Personne</b><small>Retirer la désignation</small></span>
              </button>
            )}
            {membres.length <= 1 && <p className="muted small">Ajoute des agents au chantier depuis l’onglet Équipe.</p>}
          </div>
        )}
        <div className="detail-row"><span>Signalé par</span><b>{s.auteur_nom}</b></div>
        <div className="detail-row"><span>Le</span><b>{fmtDateHeure(s.cree_le)}</b></div>
        {s.pk !== null && (
          <div className="detail-row">
            <span>Position</span>
            <b>{s.ligne ? `L${fmtLine(s.ligne)} · ` : ''}PK {fmtPk(s.pk)}{s.voie ? ` · voie ${s.voie}` : ''}</b>
          </div>
        )}
        {s.precision_m != null && <div className="detail-row"><span>Précision GPS</span><b>± {Math.round(s.precision_m)} m</b></div>}
      </div>

      {s.commentaire && <p className="comment">{s.commentaire}</p>}
      {s.photos.length > 0 && (
        <div className="photo-row">
          {urls.length
            ? urls.map((u, i) => (
                <button key={u} className="thumb" onClick={() => setZoom(u)}>
                  <img src={u} alt={`Photo ${i + 1}`} />
                </button>
              ))
            : <span className="muted small">{err ?? `${s.photos.length} photo(s), chargement…`}</span>}
        </div>
      )}

      <button className="btn wide" onClick={() => p.onMap(s.id, [s.lon, s.lat])}>
        <Icon name="map" size={18} /> Voir sur la carte
      </button>
      <div className="field-label">Itinéraire en voiture</div>
      <NavLinks at={[s.lon, s.lat]} />

      {zoom && (
        <div className="photo-zoom" onClick={() => setZoom(null)}>
          <img src={zoom} alt="Photo en grand" />
        </div>
      )}
    </Page>
  );
}
