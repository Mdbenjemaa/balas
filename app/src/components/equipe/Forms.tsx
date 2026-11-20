import { useEffect, useState } from 'react';
import type { Gravite } from '../../lib/equipe/api';
import { GRAVITES, NATURES, PANNEAU_TYPES, POINT_TYPES, ZONE_TYPES, type Choice } from '../../lib/equipe/catalog';
import type { PositionInfo } from '../../lib/equipe/position';
import { compressPhoto, newId, type NewItem } from '../../lib/equipe/store';
import { fmtLine, fmtPk } from '../../lib/format';
import { parsePk } from '../../lib/pk';
import { Modal } from '../Sheets';

/** Position qui sera enregistrée, avec le moyen de la refaire. */
export function PositionBox({ pos, busy, onLocate }: { pos: PositionInfo | null; busy: boolean; onLocate: () => void }) {
  return (
    <div className="pos-box">
      {pos ? (
        <div>
          <b>
            {pos.ligne ? `Ligne ${fmtLine(pos.ligne)} · PK ${fmtPk(pos.pk ?? 0)}` : 'Hors des lignes connues'}
            {pos.voie ? ` · voie ${pos.voie}` : ''}
          </b>
          <small>
            {pos.mode === 'manuel' ? 'Point choisi sur la carte' : `GPS ± ${pos.accuracy ?? '?'} m`}
            {pos.lineName ? ` · ${pos.lineName}` : ''}
          </small>
        </div>
      ) : (
        <div>
          <b>{busy ? 'Repérage GPS en cours…' : 'Position inconnue'}</b>
          <small>Ou ferme, puis appuie longuement sur la carte pour choisir l’endroit.</small>
        </div>
      )}
      <button className="btn btn-small" onClick={onLocate} disabled={busy}>
        {busy ? '…' : pos ? 'Refaire' : 'Me repérer'}
      </button>
    </div>
  );
}

function ChoiceChips({ list, value, onChange }: { list: Choice[]; value: string | null; onChange: (k: string) => void }) {
  return (
    <div className="chips">
      {list.map((c) => (
        <button
          key={c.key}
          type="button"
          className={`chip ${value === c.key ? 'on' : ''}`}
          style={value === c.key ? { background: c.color, borderColor: c.color } : { borderColor: c.color + '66' }}
          onClick={() => onChange(c.key)}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

/* ---------- Signaler une anomalie ---------- */

export function SignalForm(p: {
  pos: PositionInfo | null;
  locating: boolean;
  onLocate: () => void;
  onSubmit: (item: NewItem) => void;
  onClose: () => void;
}) {
  const [nature, setNature] = useState<string | null>(null);
  const [gravite, setGravite] = useState<Gravite | null>(null);
  const [commentaire, setCommentaire] = useState('');
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => () => photos.forEach((ph) => URL.revokeObjectURL(ph.url)), [photos]);

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setErr(null);
    try {
      const room = 6 - photos.length;
      const added: { blob: Blob; url: string }[] = [];
      for (const f of Array.from(files).slice(0, room)) {
        const blob = await compressPhoto(f);
        added.push({ blob, url: URL.createObjectURL(blob) });
      }
      setPhotos((cur) => [...cur, ...added]);
      if (files.length > room) setErr('6 photos au maximum par signalement.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Photo illisible');
    } finally {
      setBusy(false);
    }
  };

  const ready = p.pos && nature && gravite && !busy;
  const submit = () => {
    if (!p.pos || !nature || !gravite) return;
    const id = newId();
    p.onSubmit({
      id,
      kind: 'signalement',
      photos: photos.map((ph) => ph.blob),
      payload: {
        id, cree_le: new Date().toISOString(), lon: p.pos.lonlat[0], lat: p.pos.lonlat[1], precision_m: p.pos.accuracy,
        ligne: p.pos.ligne, pk: p.pos.pk, voie: p.pos.voie, nature, gravite, commentaire: commentaire.trim(),
      },
    });
  };

  return (
    <Modal title="Signaler une anomalie" onClose={p.onClose}>
      <PositionBox pos={p.pos} busy={p.locating} onLocate={p.onLocate} />
      <div className={`warn-box ${gravite === 'urgent' ? 'warn-strong' : ''}`}>
        <b>Danger immédiat pour les circulations ?</b> Applique d’abord la procédure prévue (alerte, appel du responsable
        ou de l’agent circulation). Ce signalement sert à la traçabilité, il n’arrête aucun train.
      </div>
      <div className="field-label">Nature</div>
      <ChoiceChips list={NATURES} value={nature} onChange={setNature} />
      <div className="field-label">Gravité</div>
      <ChoiceChips list={GRAVITES} value={gravite} onChange={(k) => setGravite(k as Gravite)} />
      <div className="field-label">Photos ({photos.length}/6)</div>
      <div className="photo-row">
        {photos.map((ph, i) => (
          <div key={ph.url} className="thumb">
            <img src={ph.url} alt={`Photo ${i + 1}`} />
            <button type="button" aria-label="Retirer la photo" onClick={() => setPhotos((cur) => cur.filter((x) => x !== ph))}>
              ×
            </button>
          </div>
        ))}
        {photos.length < 6 && (
          <label className="thumb add">
            <span>{busy ? '…' : '+ Photo'}</span>
            <input type="file" accept="image/*" multiple onChange={(e) => void addPhotos(e.target.files).then(() => (e.target.value = ''))} />
          </label>
        )}
      </div>
      <div className="field-label">Commentaire</div>
      <textarea className="text" rows={3} maxLength={2000} value={commentaire} onChange={(e) => setCommentaire(e.target.value)}
        placeholder="Ce que tu as vu, où exactement, ce qui a été fait…" />
      {err && <p className="error small">{err}</p>}
      <button className="btn primary wide" disabled={!ready} onClick={submit}>
        {!p.pos ? 'Position nécessaire' : !nature || !gravite ? 'Choisis la nature et la gravité' : 'Envoyer le signalement'}
      </button>
      <p className="muted small">Sans réseau, le signalement attend dans le téléphone et part tout seul au retour du réseau.</p>
    </Modal>
  );
}

/* ---------- Poser un repère ---------- */

type Categorie = 'point' | 'zone' | 'panneau';

export function RepereForm(p: {
  pos: PositionInfo | null;
  locating: boolean;
  defaultLine: string | null;
  onLocate: () => void;
  onSubmit: (item: NewItem) => void;
  onClose: () => void;
}) {
  const [cat, setCat] = useState<Categorie>('point');
  const [type, setType] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [ligne, setLigne] = useState(p.pos?.ligne ?? p.defaultLine ?? '');
  const [pkA, setPkA] = useState(p.pos?.pk !== null && p.pos?.pk !== undefined ? fmtPk(p.pos.pk) : '');
  const [pkB, setPkB] = useState('');
  const [voie, setVoie] = useState('');
  const list = cat === 'point' ? POINT_TYPES : cat === 'zone' ? ZONE_TYPES : PANNEAU_TYPES;

  const a = parsePk(pkA);
  const b = parsePk(pkB);
  const lineOk = /^\d{6}$/.test(ligne.replace(/\s/g, ''));
  const ready = type && (cat === 'zone' ? lineOk && a !== null && b !== null && a !== b : !!p.pos);

  const submit = () => {
    if (!type) return;
    const id = newId();
    const base = { id, cree_le: new Date().toISOString(), categorie: cat, type, nom: nom.trim(), commentaire: commentaire.trim() };
    const payload =
      cat === 'zone'
        ? { ...base, ligne: ligne.replace(/\s/g, ''), pk: Math.min(a!, b!), pk_fin: Math.max(a!, b!), voie: voie.trim() }
        : { ...base, lon: p.pos!.lonlat[0], lat: p.pos!.lonlat[1], ligne: p.pos!.ligne, pk: p.pos!.pk, voie: p.pos!.voie };
    p.onSubmit({ id, kind: 'repere', payload });
  };

  return (
    <Modal title="Poser un repère" onClose={p.onClose}>
      <div className="chips seg">
        {(
          [
            ['point', 'Point'],
            ['zone', 'Zone entre 2 PK'],
            ['panneau', 'Panneau posé'],
          ] as [Categorie, string][]
        ).map(([k, label]) => (
          <button key={k} className={`chip ${cat === k ? 'on' : ''}`} onClick={() => { setCat(k); setType(null); }}>
            {label}
          </button>
        ))}
      </div>
      <div className="field-label">Type</div>
      <ChoiceChips list={list} value={type} onChange={setType} />
      {cat === 'zone' ? (
        <>
          <div className="field-label">Ligne et PK</div>
          <div className="row-inputs">
            <input className="text" value={ligne} onChange={(e) => setLigne(e.target.value)} inputMode="numeric" placeholder="Ligne (830000)" />
            <input className="text" value={voie} onChange={(e) => setVoie(e.target.value)} placeholder="Voie (facultatif)" />
          </div>
          <div className="row-inputs">
            <input className="text" value={pkA} onChange={(e) => setPkA(e.target.value)} inputMode="decimal" placeholder="PK début (45,2)" />
            <input className="text" value={pkB} onChange={(e) => setPkB(e.target.value)} inputMode="decimal" placeholder="PK fin (46,1)" />
          </div>
          {a !== null && b !== null && <p className="muted small">De PK {fmtPk(Math.min(a, b))} à PK {fmtPk(Math.max(a, b))}, soit {Math.round(Math.abs(b - a) * 1000)} m.</p>}
        </>
      ) : (
        <>
          <div className="field-label">Emplacement</div>
          <PositionBox pos={p.pos} busy={p.locating} onLocate={p.onLocate} />
        </>
      )}
      <div className="field-label">Nom (facultatif)</div>
      <input className="text" value={nom} maxLength={120} onChange={(e) => setNom(e.target.value)}
        placeholder={cat === 'panneau' ? 'ex. TIV 40 côté Paris' : cat === 'zone' ? 'ex. Zone RVB phase 2' : 'ex. Portail nord'} />
      <div className="field-label">Commentaire</div>
      <textarea className="text" rows={2} maxLength={1000} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} />
      <button className="btn primary wide" disabled={!ready} onClick={submit}>
        Enregistrer le repère
      </button>
      {cat === 'panneau' && <p className="muted small">Le panneau est marqué « posé ». Il apparaîtra dans « À retirer » jusqu’à ce qu’on le marque retiré.</p>}
    </Modal>
  );
}
