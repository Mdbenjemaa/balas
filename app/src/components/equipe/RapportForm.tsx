import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type RapportContenu, type RapportResume } from '../../lib/equipe/api';
import { choice, GRAVITES, NATURES, PANNEAU_TYPES } from '../../lib/equipe/catalog';
import { fmtDate, fmtHeure, rapportPdf, shareFile } from '../../lib/equipe/exports';
import { newId } from '../../lib/equipe/store';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtPk } from '../../lib/format';
import { Modal } from '../Sheets';

const today = () => {
  const d = new Date();
  // Un poste de nuit commencé la veille : avant 8 h, on propose la date d'hier.
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Signature au doigt. */
function SignaturePad({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
      img.src = value;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * ref.current!.width, ((e.clientY - r.top) / r.height) * ref.current!.height];
  };
  return (
    <div className="sign">
      <canvas
        ref={ref}
        width={600}
        height={200}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.beginPath();
          ctx.moveTo(x, y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = ref.current!.getContext('2d')!;
          const [x, y] = pos(e);
          ctx.lineWidth = 3.5;
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#111827';
          ctx.lineTo(x, y);
          ctx.stroke();
        }}
        onPointerUp={() => {
          drawing.current = false;
          onChange(ref.current!.toDataURL('image/png'));
        }}
      />
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          const c = ref.current!;
          const ctx = c.getContext('2d')!;
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, c.width, c.height);
          onChange(null);
        }}
      >
        Effacer la signature
      </button>
    </div>
  );
}

/** Rapport de fin de poste (chef d'équipe) : pré-rempli, signé, enregistré pour le tableau de bord, en PDF. */
export function RapportForm({ eq, existing, onClose }: { eq: Equipe; existing: RapportResume | null; onClose: () => void }) {
  const etat = eq.etat!;
  const c = etat.chantier;
  const [date, setDate] = useState(existing?.date_poste ?? today());
  const [signature, setSignature] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!existing);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const id = useRef(existing?.id ?? newId());
  const now = new Date();
  const [r, setR] = useState<RapportContenu>(
    existing?.contenu ?? {
      poste: now.getHours() >= 19 || now.getHours() < 8 ? 'nuit' : 'jour',
      debut: '', fin: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
      pk_debut: c.pk_debut !== null ? fmtPk(c.pk_debut) : '', pk_fin: c.pk_fin !== null ? fmtPk(c.pk_fin) : '',
      equipe: etat.membres.filter((m) => m.actif !== false).map((m) => ({ nom: m.nom, fonction: m.fonction ?? '' })),
      externes: '', travaux: '', securite: '', evenements: '', observations: '', signalements: [], panneaux: [],
    },
  );

  // Rapport existant : la signature n'est pas dans la liste, on la charge.
  useEffect(() => {
    if (!existing || !eq.session?.chantierId) return;
    api.rapportLire(eq.session.code, eq.session.chantierId, existing.id)
      .then((full) => {
        setSignature(full.signature);
        setLoaded(true);
      })
      .catch(() => {
        setLoaded(true);
        setMsg({ text: 'Signature non chargée (pas de réseau ?).', error: true });
      });
  }, [existing, eq.session]);

  // Signalements et panneaux du jour du poste (pour un poste de nuit : jusqu'au lendemain 8 h).
  const window_ = useMemo(() => {
    const start = new Date(`${date}T00:00:00`).getTime() + (r.poste === 'nuit' ? 12 * 3600e3 : 0);
    return [start, start + (r.poste === 'nuit' ? 21 : 24) * 3600e3];
  }, [date, r.poste]);
  const inWindow = (iso: string | null) => !!iso && Date.parse(iso) >= window_[0] && Date.parse(iso) < window_[1];
  const daySigs = eq.view.signalements.filter((s) => inWindow(s.cree_le));
  const dayPans = eq.view.reperes.filter((p) => p.categorie === 'panneau' && (inWindow(p.cree_le) || inWindow(p.retire_le)));

  // Nouveau rapport : tout ce qui s'est passé pendant le poste est coché d'office (tant qu'on n'a rien décoché).
  const touched = useRef(false);
  const autoKey = `${window_[0]}:${daySigs.map((s) => s.id).join()}:${dayPans.map((p) => p.id).join()}`;
  useEffect(() => {
    if (existing || touched.current) return;
    setR((x) => ({ ...x, signalements: daySigs.map((s) => s.id), panneaux: dayPans.map((p) => p.id) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey]);

  const set = <K extends keyof RapportContenu>(k: K, v: RapportContenu[K]) => setR((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'signalements' | 'panneaux', v: string) => {
    touched.current = true;
    set(k, r[k].includes(v) ? r[k].filter((x) => x !== v) : [...r[k], v]);
  };

  const save = async () => {
    await eq.envoyer({ id: `${id.current}:${Date.now()}`, kind: 'rapport', payload: { id: id.current, date_poste: date, contenu: r, signature } });
    setMsg({ text: eq.sync.offline ? 'Rapport enregistré : il partira au retour du réseau.' : 'Rapport enregistré pour le tableau de bord.' });
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const blob = await rapportPdf(c, { date_poste: date, auteur_nom: existing?.auteur_nom ?? etat.moi.nom, contenu: r, signature }, eq.view.signalements, eq.view.reperes);
      await shareFile(blob, `rapport-${date}-${c.nom.replace(/[^\w-]+/g, '_')}.pdf`);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'PDF impossible', error: true });
    } finally {
      setBusy(false);
    }
  };

  const area = (k: 'travaux' | 'securite' | 'evenements' | 'observations', label: string, ph: string) => (
    <>
      <div className="field-label">{label}</div>
      <textarea className="text" rows={3} value={r[k]} onChange={(e) => set(k, e.target.value)} placeholder={ph} />
    </>
  );

  return (
    <Modal title="Rapport de fin de poste" onClose={onClose}>
      <p className="muted small">{c.nom}{c.ligne ? ` · ligne ${c.ligne}` : ''} · chef : {existing?.auteur_nom ?? etat.moi.nom}</p>
      <div className="row-inputs">
        <label className="date-field">Date du poste<input type="date" className="text" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="chips seg">
          {(['jour', 'nuit'] as const).map((k) => (
            <button key={k} className={`chip ${r.poste === k ? 'on' : ''}`} onClick={() => set('poste', k)}>{k === 'jour' ? 'Jour' : 'Nuit'}</button>
          ))}
        </div>
      </div>
      <div className="row-inputs">
        <label className="date-field">Début<input type="time" className="text" value={r.debut} onChange={(e) => set('debut', e.target.value)} /></label>
        <label className="date-field">Fin<input type="time" className="text" value={r.fin} onChange={(e) => set('fin', e.target.value)} /></label>
      </div>
      <div className="row-inputs">
        <input className="text" value={r.pk_debut} onChange={(e) => set('pk_debut', e.target.value)} inputMode="decimal" placeholder="PK début" />
        <input className="text" value={r.pk_fin} onChange={(e) => set('pk_fin', e.target.value)} inputMode="decimal" placeholder="PK fin" />
      </div>

      <div className="field-label">Équipe présente</div>
      {etat.membres.filter((m) => m.actif !== false).map((m) => {
        const on = r.equipe.find((x) => x.nom === m.nom);
        return (
          <label key={m.id} className="check-row">
            <input type="checkbox" checked={!!on} onChange={() =>
              set('equipe', on ? r.equipe.filter((x) => x.nom !== m.nom) : [...r.equipe, { nom: m.nom, fonction: m.fonction ?? '' }])} />
            <span>{m.nom}</span>
            {on && <input className="text small-input" value={on.fonction} placeholder="Fonction"
              onChange={(e) => set('equipe', r.equipe.map((x) => (x.nom === m.nom ? { ...x, fonction: e.target.value } : x)))} />}
          </label>
        );
      })}
      <input className="text" value={r.externes} onChange={(e) => set('externes', e.target.value)} placeholder="Personnes extérieures (noms, entreprise)" />

      {area('travaux', 'Travaux réalisés', 'Nature des travaux, PK, avancement')}
      {area('securite', 'Dispositif de sécurité', 'Mode de protection, annonceurs, sentinelles, horaires d’interception…')}

      <div className="field-label">Signalements du poste ({daySigs.length})</div>
      {daySigs.map((s) => (
        <label key={s.id} className="check-row">
          <input type="checkbox" checked={r.signalements.includes(s.id)} onChange={() => toggle('signalements', s.id)} />
          <span>
            {fmtHeure(s.cree_le)} · {choice(NATURES, s.nature).label} ({choice(GRAVITES, s.gravite).label}){s.pk !== null ? ` · PK ${fmtPk(s.pk)}` : ''} · {s.auteur_nom}
          </span>
        </label>
      ))}
      {!daySigs.length && <p className="muted small">Aucun signalement pendant ce poste.</p>}
      {area('evenements', 'Autres événements', 'Ce qui s’est passé et n’a pas été signalé dans l’appli')}

      <div className="field-label">Panneaux posés ou retirés ({dayPans.length})</div>
      {dayPans.map((p) => (
        <label key={p.id} className="check-row">
          <input type="checkbox" checked={r.panneaux.includes(p.id)} onChange={() => toggle('panneaux', p.id)} />
          <span>{choice(PANNEAU_TYPES, p.type).label}{p.nom ? ` « ${p.nom} »` : ''}{p.pk !== null ? ` · PK ${fmtPk(p.pk)}` : ''} · {p.etat === 'retire' ? 'retiré' : 'en place'}</span>
        </label>
      ))}
      {!dayPans.length && <p className="muted small">Aucun panneau posé ou retiré pendant ce poste.</p>}

      {area('observations', 'Observations, à prévoir pour le poste suivant', 'Matériel laissé, points d’attention, reste à faire…')}

      <div className="field-label">Signature du chef d’équipe</div>
      {loaded ? <SignaturePad value={signature} onChange={setSignature} /> : <p className="muted small">Chargement…</p>}

      {msg && <p className={msg.error ? 'error small' : 'ok small'}>{msg.text}</p>}
      <div className="btn-row">
        <button className="btn primary" onClick={() => void save()} disabled={!loaded}>Enregistrer</button>
        <button className="btn" onClick={() => void pdf()} disabled={busy || !loaded}>{busy ? 'PDF…' : 'PDF'}</button>
      </div>
      <p className="muted small">Poste du {fmtDate(date)}. Le PDF reprend le rapport tel qu’il est affiché.</p>
    </Modal>
  );
}
