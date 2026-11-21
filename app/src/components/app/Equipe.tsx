import { useCallback, useEffect, useState } from 'react';
import { api, type AgentRow } from '../../lib/equipe/api';
import { FONCTIONS } from '../../lib/equipe/catalog';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { ShareCode } from './ShareCode';
import { Avatar, Empty, errText, Icon, Page, prenom, vuLe } from './ui';

export interface EquipeIntent {
  ajout?: boolean;
}

type Vue = { k: 'liste' } | { k: 'ajout' } | { k: 'agent'; id: string } | { k: 'code'; nom: string; code: string; renouvele?: boolean };

function FonctionChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="chips">
      {FONCTIONS.map((f) => (
        <button key={f} type="button" className={`chip ${value === f ? 'on' : ''}`} onClick={() => onChange(value === f ? '' : f)}>
          {f}
        </button>
      ))}
    </div>
  );
}

/** Onglet Équipe du chef : ses agents, l'ajout d'un agent et l'envoi de son code. */
export function EquipePage({ eq, intent }: { eq: Equipe; intent: EquipeIntent | null }) {
  const s = eq.session!;
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [vue, setVue] = useState<Vue>(intent?.ajout ? { k: 'ajout' } : { k: 'liste' });
  const [err, setErr] = useState<string | null>(null);
  const [showOff, setShowOff] = useState(false);
  const chantiers = s.chantiers.filter((c) => !c.archive);
  const courant = chantiers.find((c) => c.id === s.chantierId) ?? null;

  const load = useCallback(() => api.chefAgents(s.code).then(setAgents).catch((e) => setErr(errText(e))), [s.code]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await load();
      void eq.refresh();
      return true;
    } catch (e) {
      setErr(errText(e));
      return false;
    }
  };

  if (vue.k === 'code') {
    return (
      <Page title={vue.renouvele ? 'Nouveau code' : 'Agent ajouté'} onBack={() => setVue({ k: 'liste' })} backLabel="Équipe">
        <ShareCode nom={vue.nom} code={vue.code} role="agent" chantier={courant?.nom} renouvele={vue.renouvele} onDone={() => setVue({ k: 'liste' })} />
      </Page>
    );
  }

  if (vue.k === 'ajout') {
    return (
      <AjoutAgent
        chantiers={chantiers}
        courant={courant?.id ?? null}
        onBack={() => setVue({ k: 'liste' })}
        onCreate={async (nom, fonction, ids) => {
          let code = '';
          const ok = await act(async () => {
            const r = await api.chefCreerAgent(s.code, nom, fonction);
            code = r.code;
            for (const id of ids) await api.chefAffecter(s.code, id, r.id, true);
          });
          if (ok) setVue({ k: 'code', nom, code });
        }}
        err={err}
      />
    );
  }

  if (vue.k === 'agent') {
    const a = agents?.find((x) => x.id === vue.id);
    if (!a) return null;
    return (
      <Page title={a.nom} subtitle={`${a.fonction ?? 'Agent'} · ${a.actif ? vuLe(a.derniere_connexion) : 'désactivé'}`} onBack={() => setVue({ k: 'liste' })} backLabel="Équipe">
        <div className="field-label">Chantiers de {prenom(a.nom)}</div>
        <div className="toggle-list">
          {chantiers.map((c) => {
            const on = a.chantiers.includes(c.id);
            return (
              <label key={c.id} className="toggle">
                <span>
                  {c.nom}
                  <small>{c.ligne ? `Ligne ${c.ligne}` : ''}</small>
                </span>
                <input type="checkbox" checked={on} onChange={() => void act(() => api.chefAffecter(s.code, c.id, a.id, !on))} />
              </label>
            );
          })}
          {!chantiers.length && <p className="muted">Crée d’abord un chantier (Accueil › Mes chantiers).</p>}
        </div>
        {err && <p className="error">{err}</p>}
        <div className="field-label">Accès</div>
        <button
          className="btn wide"
          onClick={() => {
            if (window.confirm(`Créer un nouveau code pour ${a.nom} ? L’ancien ne marchera plus.`))
              void (async () => {
                let code = '';
                if (await act(async () => (code = (await api.compteMaj(s.code, a.id, { regenerer: true })).code!)))
                  setVue({ k: 'code', nom: a.nom, code, renouvele: true });
              })();
          }}
        >
          <Icon name="key" size={18} /> Envoyer un nouveau code
        </button>
        <button
          className={`btn wide ${a.actif ? 'btn-ghost' : ''}`}
          onClick={() => {
            if (!a.actif || window.confirm(`Désactiver ${a.nom} ? Il ne pourra plus se connecter.`))
              void act(() => api.compteMaj(s.code, a.id, { actif: !a.actif }));
          }}
        >
          {a.actif ? 'Désactiver le compte' : 'Réactiver le compte'}
        </button>
      </Page>
    );
  }

  const actifs = (agents ?? []).filter((a) => a.actif);
  const ici = courant ? actifs.filter((a) => a.chantiers.includes(courant.id)) : [];
  const autres = actifs.filter((a) => !courant || !a.chantiers.includes(courant.id));
  const off = (agents ?? []).filter((a) => !a.actif);

  const row = (a: AgentRow, extra?: React.ReactNode) => (
    <li key={a.id} className="person">
      <button className="person-main" onClick={() => setVue({ k: 'agent', id: a.id })}>
        <Avatar nom={a.nom} off={!a.actif} tone="orange" />
        <span>
          <b>{a.nom}</b>
          <small>{a.fonction ?? 'Agent'} · {a.actif ? vuLe(a.derniere_connexion) : 'désactivé'}</small>
        </span>
        {!extra && <Icon name="chevron" size={18} className="muted-ico" />}
      </button>
      {extra}
    </li>
  );

  return (
    <Page title="Équipe" subtitle={courant ? courant.nom : `${actifs.length} agent(s)`}>
      <button className="btn primary wide btn-big" onClick={() => setVue({ k: 'ajout' })}>
        <Icon name="userPlus" /> Ajouter un agent
      </button>
      {err && <p className="error">{err}</p>}
      {agents === null ? (
        <p className="muted">Chargement…</p>
      ) : !agents.length ? (
        <Empty icon="users" title="Pas encore d’agent">
          Ajoute ton premier agent : il reçoit son code par SMS ou WhatsApp et se connecte en un clic.
        </Empty>
      ) : (
        <>
          {courant && (
            <>
              <div className="field-label">Sur ce chantier ({ici.length})</div>
              {ici.length ? <ul className="people">{ici.map((a) => row(a))}</ul> : <p className="muted small">Aucun agent affecté à ce chantier.</p>}
            </>
          )}
          {autres.length > 0 && (
            <>
              <div className="field-label">{courant ? 'Mes autres agents' : 'Mes agents'} ({autres.length})</div>
              <ul className="people">
                {autres.map((a) =>
                  row(
                    a,
                    courant ? (
                      <button className="btn btn-small" onClick={() => void act(() => api.chefAffecter(s.code, courant.id, a.id, true))}>
                        <Icon name="plus" size={16} /> Ajouter
                      </button>
                    ) : undefined,
                  ),
                )}
              </ul>
            </>
          )}
          {off.length > 0 && (
            <>
              <button className="link-btn" onClick={() => setShowOff((v) => !v)}>
                {showOff ? 'Masquer' : 'Voir'} les comptes désactivés ({off.length})
              </button>
              {showOff && <ul className="people">{off.map((a) => row(a))}</ul>}
            </>
          )}
        </>
      )}
    </Page>
  );
}

function AjoutAgent(p: {
  chantiers: { id: string; nom: string }[];
  courant: string | null;
  onBack: () => void;
  onCreate: (nom: string, fonction: string, chantiers: string[]) => Promise<void>;
  err: string | null;
}) {
  const [nom, setNom] = useState('');
  const [fonction, setFonction] = useState('');
  const [ids, setIds] = useState<string[]>(p.courant ? [p.courant] : []);
  const [busy, setBusy] = useState(false);
  return (
    <Page title="Ajouter un agent" onBack={p.onBack} backLabel="Équipe">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (nom.trim().length < 2) return;
          setBusy(true);
          void p.onCreate(nom.trim(), fonction, ids).finally(() => setBusy(false));
        }}
      >
        <div className="field-label">Prénom et nom</div>
        <input className="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Ex. Karim Benali" maxLength={80} autoFocus />
        <div className="field-label">Fonction</div>
        <FonctionChips value={fonction} onChange={setFonction} />
        {p.chantiers.length > 0 && (
          <>
            <div className="field-label">Chantier</div>
            <div className="chips">
              {p.chantiers.map((c) => {
                const on = ids.includes(c.id);
                return (
                  <button key={c.id} type="button" className={`chip ${on ? 'on' : ''}`} onClick={() => setIds(on ? ids.filter((x) => x !== c.id) : [...ids, c.id])}>
                    {on ? '✓ ' : ''}{c.nom}
                  </button>
                );
              })}
            </div>
          </>
        )}
        {p.err && <p className="error">{p.err}</p>}
        <button className="btn primary wide btn-big" type="submit" disabled={busy || nom.trim().length < 2}>
          {busy ? 'Création…' : 'Créer et envoyer son code'}
        </button>
        <p className="muted small">L’écran suivant te propose d’envoyer son accès par SMS ou WhatsApp.</p>
      </form>
    </Page>
  );
}
