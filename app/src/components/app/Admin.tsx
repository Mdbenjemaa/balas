import { useCallback, useEffect, useState } from 'react';
import { adminCorrections, adminTraiter, refreshCorrections, type CorrectionAdmin } from '../../lib/corrections';
import { api, type ChefRow } from '../../lib/equipe/api';
import { fmtDateHeure } from '../../lib/equipe/exports';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtLine, fmtPk } from '../../lib/format';
import type { LonLat } from '../../lib/geo';
import { ShareCode } from './ShareCode';
import { Avatar, Empty, errText, Icon, Page, vuLe } from './ui';

type Vue = { k: 'liste' } | { k: 'ajout' } | { k: 'chef'; id: string } | { k: 'code'; nom: string; code: string; renouvele?: boolean };

/** Administrateur : les chefs de chantier. */
export function ChefsPage({ eq, intent }: { eq: Equipe; intent: { ajout?: boolean } | null }) {
  const code = eq.session!.code;
  const [chefs, setChefs] = useState<ChefRow[] | null>(null);
  const [vue, setVue] = useState<Vue>(intent?.ajout ? { k: 'ajout' } : { k: 'liste' });
  const [err, setErr] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const [entreprise, setEntreprise] = useState(eq.session?.compte.entreprise ?? '');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.adminChefs(code).then(setChefs).catch((e) => setErr(errText(e))), [code]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    }
  };

  if (vue.k === 'code') {
    return (
      <Page title={vue.renouvele ? 'Nouveau code' : 'Chef ajouté'} onBack={() => setVue({ k: 'liste' })} backLabel="Chefs">
        <ShareCode nom={vue.nom} code={vue.code} role="chef" renouvele={vue.renouvele} onDone={() => setVue({ k: 'liste' })} />
      </Page>
    );
  }

  if (vue.k === 'ajout') {
    return (
      <Page title="Ajouter un chef" onBack={() => setVue({ k: 'liste' })} backLabel="Chefs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (nom.trim().length < 2) return;
            setBusy(true);
            let c = '';
            void act(async () => (c = (await api.adminCreerChef(code, nom.trim(), entreprise.trim())).code))
              .then((ok) => {
                if (ok) {
                  setVue({ k: 'code', nom: nom.trim(), code: c });
                  setNom('');
                }
              })
              .finally(() => setBusy(false));
          }}
        >
          <div className="field-label">Prénom et nom</div>
          <input className="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Medi Haddad" maxLength={80} autoFocus />
          <div className="field-label">Entreprise</div>
          <input className="text" value={entreprise} onChange={(e) => setEntreprise(e.target.value)} placeholder="Ex. ETF Services" maxLength={120} />
          {err && <p className="error">{err}</p>}
          <button className="btn primary wide btn-big" type="submit" disabled={busy || nom.trim().length < 2}>
            {busy ? 'Création…' : 'Créer et envoyer son code'}
          </button>
          <p className="muted small">Le chef crée ensuite ses chantiers et ajoute ses agents lui-même.</p>
        </form>
      </Page>
    );
  }

  if (vue.k === 'chef') {
    const c = chefs?.find((x) => x.id === vue.id);
    if (!c) return null;
    return (
      <Page title={c.nom} subtitle={`${c.entreprise ?? '—'} · ${c.actif ? vuLe(c.derniere_connexion) : 'désactivé'}`} onBack={() => setVue({ k: 'liste' })} backLabel="Chefs">
        <div className="detail-card">
          <div className="detail-row"><span>Chantiers</span><b>{c.nb_chantiers}</b></div>
          <div className="detail-row"><span>Agents</span><b>{c.nb_agents}</b></div>
          <div className="detail-row"><span>Créé le</span><b>{fmtDateHeure(c.cree_le)}</b></div>
        </div>
        {err && <p className="error">{err}</p>}
        <button
          className="btn wide"
          onClick={() => {
            if (window.confirm(`Créer un nouveau code pour ${c.nom} ? L’ancien ne marchera plus.`))
              void (async () => {
                let k = '';
                if (await act(async () => (k = (await api.compteMaj(code, c.id, { regenerer: true })).code!)))
                  setVue({ k: 'code', nom: c.nom, code: k, renouvele: true });
              })();
          }}
        >
          <Icon name="key" size={18} /> Envoyer un nouveau code
        </button>
        <button
          className={`btn wide ${c.actif ? 'btn-ghost' : ''}`}
          onClick={() => {
            if (!c.actif || window.confirm(`Désactiver ${c.nom} ? Il ne pourra plus se connecter.`))
              void act(() => api.compteMaj(code, c.id, { actif: !c.actif }));
          }}
        >
          {c.actif ? 'Désactiver le compte' : 'Réactiver le compte'}
        </button>
      </Page>
    );
  }

  return (
    <Page title="Chefs de chantier" subtitle={chefs ? `${chefs.filter((c) => c.actif).length} actif(s)` : undefined}>
      <button className="btn primary wide btn-big" onClick={() => setVue({ k: 'ajout' })}>
        <Icon name="userPlus" /> Ajouter un chef
      </button>
      {err && <p className="error">{err}</p>}
      {chefs === null ? (
        <p className="muted">Chargement…</p>
      ) : !chefs.length ? (
        <Empty icon="users" title="Aucun chef pour l’instant" />
      ) : (
        <ul className="people">
          {chefs.map((c) => (
            <li key={c.id} className="person">
              <button className="person-main" onClick={() => setVue({ k: 'chef', id: c.id })}>
                <Avatar nom={c.nom} off={!c.actif} />
                <span>
                  <b>{c.nom}</b>
                  <small>
                    {c.entreprise ?? '—'} · {c.nb_chantiers} chantier(s) · {c.nb_agents} agent(s)
                  </small>
                  <small>{c.actif ? vuLe(c.derniere_connexion) : 'désactivé'}</small>
                </span>
                <Icon name="chevron" size={18} className="muted-ico" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** Administrateur : corrections de PK proposées sur le terrain. */
export function CorrectionsPage({ eq, onFocusAt }: { eq: Equipe; onFocusAt: (at: LonLat) => void }) {
  const code = eq.session!.code;
  const [list, setList] = useState<CorrectionAdmin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [voir, setVoir] = useState<'proposee' | 'toutes'>('proposee');
  const load = useCallback(() => adminCorrections(code).then(setList).catch((e) => setErr(errText(e))), [code]);
  useEffect(() => void load(), [load]);
  const act = async (c: CorrectionAdmin, statut: CorrectionAdmin['statut'], etendue: CorrectionAdmin['etendue']) => {
    setErr(null);
    try {
      await adminTraiter(code, c.id, statut, etendue);
      await load();
      await refreshCorrections(true);
    } catch (e) {
      setErr(errText(e));
    }
  };
  const label = { proposee: 'À valider', validee: 'Validée', refusee: 'Refusée' } as const;
  const shown = (list ?? []).filter((c) => voir === 'toutes' || c.statut === 'proposee');
  const n = (list ?? []).filter((c) => c.statut === 'proposee').length;
  return (
    <Page title="Corrections PK" subtitle="Bornes relevées sur le terrain">
      <div className="seg">
        <button className={voir === 'proposee' ? 'on' : ''} onClick={() => setVoir('proposee')}>À valider<small>{n}</small></button>
        <button className={voir === 'toutes' ? 'on' : ''} onClick={() => setVoir('toutes')}>Toutes<small>{list?.length ?? 0}</small></button>
      </div>
      <p className="muted small">
        « Portion » : la correction s’efface sur 1,5 km de chaque côté (ou jusqu’à la correction voisine). « Toute la ligne » :
        même écart jusqu’au bout de la ligne, à réserver aux lignes dont tous les PK sont décalés.
      </p>
      {err && <p className="error">{err}</p>}
      {list && !shown.length && <Empty icon="check" title={voir === 'proposee' ? 'Rien à valider' : 'Aucune correction'} />}
      <ul className="sig-list">
        {shown.map((c) => {
          const ecart = Math.round((c.pk_vrai - c.pk_app) * 1000);
          return (
            <li key={c.id} className={`corr-card ${c.statut}`}>
              <div className="sig-top">
                <b>L{fmtLine(c.ligne)} · borne PK {fmtPk(c.pk_vrai)}</b>
                <span className={`statut statut-${c.statut === 'validee' ? 'traite' : c.statut === 'refusee' ? 'refuse' : 'nouveau'}`}>{label[c.statut]}</span>
              </div>
              <span className="sig-line">
                Appli : PK {fmtPk(c.pk_app)} · écart {ecart > 0 ? '+' : ''}{ecart} m{c.precision_m ? ` · GPS ± ${Math.round(c.precision_m)} m` : ''}
              </span>
              <span className="sig-meta">
                {c.auteur_nom || 'Anonyme'} · {fmtDateHeure(c.cree_le)}{c.commentaire ? ` · ${c.commentaire}` : ''}
                {c.statut === 'validee' && ` · ${c.etendue === 'ligne' ? 'toute la ligne' : 'portion'}`}{c.traite_par ? ` · par ${c.traite_par}` : ''}
              </span>
              <div className="btn-row">
                <button className="btn btn-small" onClick={() => onFocusAt([c.lon, c.lat])}>
                  <Icon name="map" size={16} /> Voir
                </button>
                {c.statut !== 'validee' && <button className="btn btn-small primary" onClick={() => void act(c, 'validee', 'portion')}>Valider (portion)</button>}
                {c.statut !== 'validee' && <button className="btn btn-small" onClick={() => void act(c, 'validee', 'ligne')}>Toute la ligne</button>}
                {c.statut !== 'refusee' && (
                  <button className="btn btn-small btn-ghost" onClick={() => void act(c, 'refusee', c.etendue)}>{c.statut === 'validee' ? 'Retirer' : 'Refuser'}</button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
