import { useState } from 'react';
import { api, type Chantier } from '../../lib/equipe/api';
import { fmtDate } from '../../lib/equipe/exports';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtLine, fmtPk } from '../../lib/format';
import { parsePk } from '../../lib/pk';
import { Empty, errText, Icon, Page } from './ui';

export function ChantierForm({ initial, currentLine, onSave, onCancel }: {
  initial: Chantier | null;
  currentLine: { code: string; pk: number } | null;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onCancel?: () => void;
}) {
  const [f, setF] = useState({
    nom: initial?.nom ?? '', entreprise: initial?.entreprise ?? '', ligne: initial?.ligne ?? currentLine?.code ?? '',
    pkA: initial?.pk_debut != null ? fmtPk(initial.pk_debut) : currentLine ? fmtPk(currentLine.pk) : '',
    pkB: initial?.pk_fin != null ? fmtPk(initial.pk_fin) : '',
    debut: initial?.date_debut ?? new Date().toISOString().slice(0, 10), fin: initial?.date_fin ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const a = parsePk(f.pkA);
      const b = parsePk(f.pkB);
      const ligne = f.ligne.replace(/\s/g, '');
      if (ligne && !/^\d{6}$/.test(ligne)) throw new Error('Le code de ligne a 6 chiffres (ex. 830000).');
      await onSave({
        ...(initial ? { id: initial.id } : {}), nom: f.nom.trim(), entreprise: f.entreprise.trim(), ligne,
        pk_debut: a === null || b === null ? a : Math.min(a, b), pk_fin: a === null || b === null ? b : Math.max(a, b),
        date_debut: f.debut, date_fin: f.fin,
      });
    } catch (e) {
      setErr(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="field-label">Nom du chantier</div>
      <input className="text" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder="Ex. RVB PSE04 phase 2" maxLength={120} />
      <div className="field-label">Ligne et PK</div>
      <input className="text" value={f.ligne} onChange={(e) => setF({ ...f, ligne: e.target.value })} inputMode="numeric" placeholder="Code ligne (ex. 830000)" />
      <div className="row-inputs">
        <input className="text" value={f.pkA} onChange={(e) => setF({ ...f, pkA: e.target.value })} inputMode="decimal" placeholder="PK début (45,2)" />
        <input className="text" value={f.pkB} onChange={(e) => setF({ ...f, pkB: e.target.value })} inputMode="decimal" placeholder="PK fin (47)" />
      </div>
      <div className="field-label">Dates</div>
      <div className="row-inputs">
        <label className="date-field">Début<input type="date" className="text" value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} /></label>
        <label className="date-field">Fin<input type="date" className="text" value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></label>
      </div>
      <div className="field-label">Entreprise</div>
      <input className="text" value={f.entreprise} onChange={(e) => setF({ ...f, entreprise: e.target.value })} placeholder="Par défaut la tienne" maxLength={120} />
      {err && <p className="error">{err}</p>}
      <button className="btn primary wide btn-big" type="submit" disabled={busy || f.nom.trim().length < 2}>{busy ? '…' : initial ? 'Enregistrer' : 'Créer le chantier'}</button>
      {onCancel && <button type="button" className="btn wide" onClick={onCancel}>Annuler</button>}
    </form>
  );
}

/** Chef : ses chantiers (ouvrir, créer, modifier, archiver). */
export function ChantiersPage({ eq, currentLine, onBack, onOpened }: {
  eq: Equipe;
  currentLine: { code: string; pk: number } | null;
  onBack: () => void;
  onOpened: () => void;
}) {
  const s = eq.session!;
  const [edit, setEdit] = useState<Chantier | 'new' | null>(null);
  const [showArchives, setShowArchives] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = s.chantiers.filter((c) => showArchives || !c.archive);

  if (edit) {
    return (
      <Page title={edit === 'new' ? 'Nouveau chantier' : 'Modifier le chantier'} onBack={() => setEdit(null)} backLabel="Mes chantiers">
        <ChantierForm
          initial={edit === 'new' ? null : edit}
          currentLine={currentLine}
          onCancel={() => setEdit(null)}
          onSave={async (p) => {
            const c = await api.chefChantier(s.code, p);
            setEdit(null);
            if (!p.id) eq.choisir(c.id);
            await eq.refresh();
            if (!p.id) onOpened();
          }}
        />
      </Page>
    );
  }

  return (
    <Page title="Mes chantiers" onBack={onBack} backLabel="Accueil">
      <button className="btn primary wide btn-big" onClick={() => setEdit('new')}>
        <Icon name="plus" /> Nouveau chantier
      </button>
      {err && <p className="error">{err}</p>}
      {!list.length && <Empty icon="site" title="Aucun chantier" />}
      <ul className="site-list">
        {list.map((c) => {
          const on = c.id === s.chantierId;
          return (
            <li key={c.id} className={`site-card ${on ? 'on' : ''} ${c.archive ? 'off' : ''}`}>
              <button className="site-main" onClick={() => { eq.choisir(c.id); onOpened(); }} disabled={c.archive}>
                <b>{c.nom}{c.archive ? ' (archivé)' : ''}</b>
                <small>{c.ligne ? `Ligne ${fmtLine(c.ligne)}` : 'Ligne à préciser'}{c.pk_debut != null ? ` · PK ${fmtPk(c.pk_debut)} → ${fmtPk(c.pk_fin ?? c.pk_debut)}` : ''}</small>
                <small>{c.nb_agents} agent(s){c.date_debut ? ` · depuis le ${fmtDate(c.date_debut)}` : ''}</small>
                {on && <span className="site-on">Ouvert</span>}
              </button>
              <div className="site-actions">
                <button className="btn btn-small" onClick={() => setEdit(c)}>Modifier</button>
                <button className="btn btn-small btn-ghost" onClick={() => {
                  if (c.archive || window.confirm(`Archiver « ${c.nom} » ? Les agents ne le verront plus.`))
                    void api.chefChantier(s.code, { id: c.id, archive: !c.archive }).then(() => eq.refresh()).catch((e) => setErr(errText(e)));
                }}>{c.archive ? 'Désarchiver' : 'Archiver'}</button>
              </div>
            </li>
          );
        })}
      </ul>
      {s.chantiers.some((c) => c.archive) && (
        <button className="link-btn" onClick={() => setShowArchives((v) => !v)}>{showArchives ? 'Masquer les archives' : 'Voir les chantiers archivés'}</button>
      )}
    </Page>
  );
}
