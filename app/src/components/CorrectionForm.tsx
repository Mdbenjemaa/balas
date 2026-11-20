import { useState } from 'react';
import { proposer } from '../lib/corrections';
import { newId } from '../lib/equipe/store';
import { fmtLine, fmtPk } from '../lib/format';
import type { LonLat } from '../lib/geo';
import { parsePk } from '../lib/pk';
import { Modal } from './Sheets';

export interface CorrectionTarget {
  ligne: string;
  lineName: string | null;
  at: LonLat;
  accuracy: number | null;
  manual: boolean;
  /** PK calculé sans correction à cet endroit. */
  pkRaw: number;
  /** PK affiché (corrections déjà comprises). */
  pkShown: number;
}

/**
 * « Corriger le PK ici » : devant une borne, on tape le PK qu'elle indique. La correction s'applique
 * tout de suite sur ce téléphone et part à l'administrateur, qui la valide pour tout le monde.
 */
export function CorrectionForm(p: {
  target: CorrectionTarget;
  auteur: string;
  code: string | null;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const t = p.target;
  const [km, setKm] = useState(String(Math.floor(t.pkShown)));
  const [m, setM] = useState('');
  const [nom, setNom] = useState(p.auteur);
  const [commentaire, setCommentaire] = useState('');
  const [busy, setBusy] = useState(false);
  const decimal = /[.,]/.test(km);
  const pk = parsePk(!decimal && m.trim() ? `${km.trim()}+${m.trim().padStart(3, '0')}` : km.trim());
  const ecart = pk === null ? null : Math.round((pk - t.pkShown) * 1000);
  const tooFar = pk !== null && Math.abs(pk - t.pkRaw) > 2;
  const imprecise = !t.manual && (t.accuracy ?? 99) > 15;

  const submit = async () => {
    if (pk === null || tooFar) return;
    setBusy(true);
    const { envoyee } = await proposer(
      { ligne: t.ligne, at: t.at, precision: t.manual ? null : t.accuracy, pkApp: t.pkRaw, pkVrai: pk, commentaire: commentaire.trim(), auteur: nom.trim(), code: p.code },
      newId(),
    );
    setBusy(false);
    p.onDone(envoyee
      ? 'Correction appliquée sur ton téléphone et envoyée pour validation.'
      : 'Correction appliquée sur ton téléphone. Elle partira pour validation au retour du réseau.');
  };

  return (
    <Modal title="Corriger le PK ici" onClose={p.onClose}>
      <p>
        Ligne <b>{fmtLine(t.ligne)}</b>{t.lineName ? ` · ${t.lineName}` : ''}
        <br />
        L’appli indique ici <b>PK {fmtPk(t.pkShown)}</b>
        {t.manual ? ' (point choisi sur la carte)' : ` (GPS ± ${t.accuracy ?? '?'} m)`}.
      </p>
      <div className="warn-box">
        Place-toi <b>au pied de la borne ou de la pancarte PK</b>, attends que le GPS soit précis, puis tape le PK qu’elle
        indique. Sur la carte, tu peux aussi appuyer longuement sur l’emplacement exact de la borne.
      </div>
      {imprecise && <p className="error small">GPS peu précis (± {t.accuracy} m) : refais « Me repérer » à découvert avant de corriger.</p>}
      <div className="field-label">PK lu sur la borne</div>
      <div className="pk-form">
        <input className="pk-km" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d.,-]/g, ''))} inputMode="decimal" aria-label="Kilomètres" />
        <span className="pk-plus" aria-hidden="true">+</span>
        <input className="pk-m" value={m} onChange={(e) => setM(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" placeholder="000" aria-label="Mètres" disabled={decimal} />
      </div>
      {ecart !== null && !tooFar && (
        <p className="small">
          Écart avec l’appli : <b>{ecart > 0 ? '+' : ''}{ecart} m</b>
          {Math.abs(ecart) < 10 && ' — c’est dans la précision du GPS, une correction n’est sans doute pas utile.'}
        </p>
      )}
      {tooFar && <p className="error small">Plus de 2 km d’écart : vérifie la ligne (une autre ligne passe peut-être ici) et le PK tapé.</p>}
      <div className="field-label">Ton nom (facultatif)</div>
      <input className="text" value={nom} onChange={(e) => setNom(e.target.value)} maxLength={80} placeholder="Pour que l’administrateur sache qui a relevé la borne" />
      <div className="field-label">Commentaire (facultatif)</div>
      <input className="text" value={commentaire} onChange={(e) => setCommentaire(e.target.value)} maxLength={500} placeholder="ex. borne côté voie 2, pancarte hectométrique" />
      <button className="btn primary wide" disabled={busy || pk === null || tooFar} onClick={() => void submit()}>
        {busy ? 'Envoi…' : 'Corriger'}
      </button>
      <p className="muted small">
        La correction recale les PK de cette ligne autour de la borne (sur environ 1,5 km, ou jusqu’à la correction
        suivante). Elle s’applique tout de suite sur ce téléphone ; l’administrateur la valide pour tous.
      </p>
    </Modal>
  );
}
