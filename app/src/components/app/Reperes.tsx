import { useState } from 'react';
import { readAccesSource, snapAcces } from '../../lib/acces';
import { api, type RapportResume } from '../../lib/equipe/api';
import { choice, repereChoices } from '../../lib/equipe/catalog';
import { fmtDate } from '../../lib/equipe/exports';
import { newId } from '../../lib/equipe/store';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtPk } from '../../lib/format';
import type { LonLat } from '../../lib/geo';
import { MyMapsLink } from '../MyMapsLink';
import { Empty, errText, Icon, Page } from './ui';

type Rep = Equipe['view']['reperes'][number];

function RepereList({ items, onOpen }: { items: Rep[]; onOpen: (id: string, at: LonLat | null) => void }) {
  return (
    <ul className="rep-list">
      {items.map((r) => {
        const c = choice(repereChoices(r.categorie), r.type);
        return (
          <li key={r.id}>
            <button className="rep-row" onClick={() => onOpen(r.id, r.lon !== null && r.lat !== null ? [r.lon, r.lat] : null)}>
              <span className="badge" style={{ background: r.etat === 'retire' ? '#9ca3af' : c.color }}>
                {r.categorie === 'zone' ? 'Z' : r.categorie === 'panneau' ? 'P' : '•'}
              </span>
              <span className="item-main">
                <b>{r.nom || c.label}</b>
                <small>{c.label}{r.pending ? ' · en attente' : ''}</small>
              </span>
              <span className="item-side">
                {r.pk !== null && <b>PK {fmtPk(r.pk)}</b>}
                {r.categorie === 'zone' && r.pk_fin !== null && <small>→ {fmtPk(r.pk_fin)}</small>}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Repères, zones, panneaux et accès du chantier (le chef les prépare, l'équipe les consulte). */
export function ReperesPage(p: { eq: Equipe; onBack: () => void; onOpen: (id: string, at: LonLat | null) => void; onNew: () => void }) {
  const { eq } = p;
  const gere = !!eq.etat?.gere;
  const reps = eq.view.reperes;
  const aRetirer = reps.filter((r) => r.categorie === 'panneau' && r.etat !== 'retire');
  const retires = reps.filter((r) => r.categorie === 'panneau' && r.etat === 'retire');
  const [msg, setMsg] = useState<{ text: string; error?: boolean; busy?: boolean } | null>(null);

  const importer = async (src: File | string) => {
    const s = eq.session!;
    setMsg({ text: 'Import en cours…', busy: true });
    try {
      const { points } = await readAccesSource(src);
      if (!points.length) throw new Error('Aucun point dans ce fichier.');
      const snapped = await snapAcces(points);
      let n = 0;
      for (let i = 0; i < snapped.length; i += 400) {
        n += await api.reperesImport(s.code, s.chantierId!, snapped.slice(i, i + 400).map((a) => ({
          id: newId(), type: 'acces', nom: a.name, commentaire: a.desc, lon: a.lonlat[0], lat: a.lonlat[1], ligne: a.code ?? '', pk: a.pk ?? '',
        })));
      }
      await eq.refresh();
      setMsg({ text: `${n} accès ajoutés au chantier, visibles par toute l’équipe.` });
    } catch (e) {
      setMsg({ text: errText(e), error: true });
    }
  };

  return (
    <Page title="Repères et accès" subtitle={eq.etat?.chantier.nom} onBack={p.onBack} backLabel="Accueil">
      {gere && (
        <>
          <button className="btn primary wide btn-big" onClick={p.onNew}>
            <Icon name="flag" /> Poser un repère
          </button>
          <label className={`btn wide file-btn-plain ${msg?.busy ? 'disabled' : ''}`}>
            <Icon name="download" size={18} /> Importer des accès (KML, KMZ)
            <input type="file" disabled={msg?.busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void importer(f); e.target.value = ''; }} />
          </label>
          <MyMapsLink busy={msg?.busy} onSubmit={(link) => void importer(link)} />
          {msg && <p className={msg.error ? 'error small' : msg.busy ? 'muted small' : 'ok small'}>{msg.text}</p>}
        </>
      )}
      {aRetirer.length > 0 && (
        <>
          <div className="field-label warn-label">Panneaux à retirer ({aRetirer.length})</div>
          <RepereList items={aRetirer} onOpen={p.onOpen} />
        </>
      )}
      {(['zone', 'point'] as const).map((cat) => {
        const list = reps.filter((r) => r.categorie === cat);
        return list.length ? (
          <div key={cat}>
            <div className="field-label">{cat === 'zone' ? 'Zones' : 'Points et accès'} ({list.length})</div>
            <RepereList items={list} onOpen={p.onOpen} />
          </div>
        ) : null;
      })}
      {retires.length > 0 && (
        <>
          <div className="field-label">Panneaux retirés ({retires.length})</div>
          <RepereList items={retires} onOpen={p.onOpen} />
        </>
      )}
      {!reps.length && (
        <Empty icon="flag" title="Rien sur la carte du chantier">
          {gere ? 'Pose les zones entre deux PK, les accès, les points de rendez-vous et les panneaux.' : 'Le chef n’a encore rien préparé.'}
        </Empty>
      )}
    </Page>
  );
}

/** Rapports de fin de poste (chef). */
export function RapportsPage(p: { eq: Equipe; onBack: () => void; onOpen: (r: RapportResume | null) => void }) {
  const list = p.eq.etat?.rapports ?? [];
  return (
    <Page title="Rapports de poste" subtitle={p.eq.etat?.chantier.nom} onBack={p.onBack} backLabel="Accueil">
      <button className="btn primary wide btn-big" onClick={() => p.onOpen(null)}>
        <Icon name="doc" /> Nouveau rapport de poste
      </button>
      {!list.length && <Empty icon="doc" title="Aucun rapport">À la fin du poste : équipe, travaux, sécurité, panneaux, signature, puis PDF.</Empty>}
      <ul className="rep-list">
        {list.map((r) => (
          <li key={r.id}>
            <button className="rep-row" onClick={() => p.onOpen(r)}>
              <span className="badge" style={{ background: '#12305a' }}>R</span>
              <span className="item-main">
                <b>Poste du {fmtDate(r.date_poste)} ({r.contenu.poste === 'nuit' ? 'nuit' : 'jour'})</b>
                <small>{r.contenu.debut}–{r.contenu.fin} · {r.contenu.equipe.length} personne(s) · {r.auteur_nom}</small>
              </span>
              <Icon name="chevron" size={18} className="muted-ico" />
            </button>
          </li>
        ))}
      </ul>
    </Page>
  );
}
