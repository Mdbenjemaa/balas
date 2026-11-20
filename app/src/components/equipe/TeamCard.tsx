import { useEffect, useState } from 'react';
import { api } from '../../lib/equipe/api';
import { choice, GRAVITES, NATURES, repereChoices } from '../../lib/equipe/catalog';
import { fmtDateHeure } from '../../lib/equipe/exports';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtLine, fmtPk } from '../../lib/format';
import { NavLinks } from '../TargetSheet';

/** Fiche d'un signalement ou d'un repère du chantier (touché sur la carte ou dans une liste). */
export function TeamCard({ eq, id, onClose }: { eq: Equipe; id: string; onClose: () => void }) {
  const sig = eq.view.signalements.find((s) => s.id === id);
  const rep = eq.view.reperes.find((r) => r.id === id);
  const [photos, setPhotos] = useState<string[]>([]);
  const [zoom, setZoom] = useState<string | null>(null);
  const [photoErr, setPhotoErr] = useState<string | null>(null);
  const code = eq.session?.code;
  const chantier = eq.session?.chantierId;

  useEffect(() => {
    setPhotos([]);
    setPhotoErr(null);
    if (!sig?.photos.length || !code || !chantier) return;
    let cancelled = false;
    api
      .photosRead(code, chantier, sig.photos)
      .then((r) => !cancelled && setPhotos(r.urls.map((u) => u.url)))
      .catch(() => !cancelled && setPhotoErr('Photos indisponibles sans réseau.'));
    return () => {
      cancelled = true;
    };
  }, [sig?.id, sig?.photos, code, chantier]);

  if (!sig && !rep) return null;
  const gere = !!eq.etat?.gere;
  const update = (patch: Record<string, unknown>) => void eq.envoyer({ id: `${rep!.id}:${Date.now()}`, kind: 'repere', payload: { id: rep!.id, ...patch } });

  if (sig) {
    const g = choice(GRAVITES, sig.gravite);
    return (
      <section className="card team-card">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">
              <span className="dot" style={{ background: g.color }} /> {g.label}
              {sig.pending && ' · en attente d’envoi'}
            </div>
            <div className="card-title">{choice(NATURES, sig.nature).label}</div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">×</button>
        </div>
        <div className="card-scroll">
          <p className="muted small">
            {sig.auteur_nom} · {fmtDateHeure(sig.cree_le)}
            {sig.ligne && <> · L{fmtLine(sig.ligne)} PK {fmtPk(sig.pk ?? 0)}</>}
            {sig.voie && ` · voie ${sig.voie}`}
          </p>
          {sig.commentaire && <p className="comment">{sig.commentaire}</p>}
          {sig.photos.length > 0 && (
            <div className="photo-row">
              {photos.length
                ? photos.map((u, i) => (
                    <button key={u} className="thumb" onClick={() => setZoom(u)}>
                      <img src={u} alt={`Photo ${i + 1}`} />
                    </button>
                  ))
                : <span className="muted small">{photoErr ?? `${sig.photos.length} photo(s), chargement…`}</span>}
            </div>
          )}
          <div className="field-label">Itinéraire en voiture</div>
          <NavLinks at={[sig.lon, sig.lat]} />
        </div>
        {zoom && (
          <div className="photo-zoom" onClick={() => setZoom(null)}>
            <img src={zoom} alt="Photo en grand" />
          </div>
        )}
      </section>
    );
  }

  const r = rep!;
  const c = choice(repereChoices(r.categorie), r.type);
  return (
    <section className="card team-card">
      <div className="sheet-head">
        <div>
          <div className="eyebrow">
            <span className="dot" style={{ background: c.color }} />{' '}
            {r.categorie === 'zone' ? 'Zone' : r.categorie === 'panneau' ? 'Panneau posé' : 'Repère'} · {c.label}
            {r.pending && ' · en attente d’envoi'}
          </div>
          <div className="card-title">{r.nom || c.label}</div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Fermer">×</button>
      </div>
      <div className="card-scroll">
        <p className="muted small">
          {r.auteur_nom} · {fmtDateHeure(r.cree_le)}
          {r.ligne && <> · L{fmtLine(r.ligne)}</>}
          {r.pk !== null && (r.categorie === 'zone' ? ` PK ${fmtPk(r.pk)} → ${fmtPk(r.pk_fin ?? r.pk)}` : ` PK ${fmtPk(r.pk)}`)}
          {r.voie && ` · voie ${r.voie}`}
        </p>
        {r.commentaire && <p className="comment">{r.commentaire}</p>}
        {r.categorie === 'panneau' && (
          <p className={r.etat === 'retire' ? 'ok small' : 'warn-inline'}>
            {r.etat === 'retire' ? `Retiré${r.retire_par ? ` par ${r.retire_par}` : ''}${r.retire_le ? ` le ${fmtDateHeure(r.retire_le)}` : ''}` : 'En place : à retirer en fin de chantier'}
          </p>
        )}
        {gere && <div className="btn-row">
          {r.categorie === 'panneau' &&
            (r.etat === 'retire' ? (
              <button className="btn btn-small" onClick={() => update({ etat: 'pose' })}>Remettre « posé »</button>
            ) : (
              <button className="btn btn-small primary" onClick={() => update({ etat: 'retire' })}>Marquer retiré</button>
            ))}
          {(
            <button
              className="btn btn-small btn-ghost"
              onClick={() => {
                if (window.confirm('Supprimer ce repère pour toute l’équipe ?')) {
                  update({ supprime: true });
                  onClose();
                }
              }}
            >
              Supprimer
            </button>
          )}
        </div>}
        {r.lon !== null && r.lat !== null && (
          <>
            <div className="field-label">Itinéraire en voiture</div>
            <NavLinks at={[r.lon, r.lat]} />
          </>
        )}
      </div>
    </section>
  );
}
