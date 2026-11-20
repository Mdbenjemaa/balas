import { useCallback, useEffect, useMemo, useState } from 'react';
import { readAccesFile, snapAcces } from '../../lib/acces';
import { api, fmtCode, type AgentRow, type Chantier, type ChefRow, type RapportResume } from '../../lib/equipe/api';
import { choice, FONCTIONS, GRAVITES, NATURES, repereChoices } from '../../lib/equipe/catalog';
import { fmtDate, fmtDateHeure, shareFile, signalementsCsv } from '../../lib/equipe/exports';
import { newId } from '../../lib/equipe/store';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtLine, fmtPk } from '../../lib/format';
import type { LonLat } from '../../lib/geo';
import { parsePk } from '../../lib/pk';
import { adminCorrections, adminTraiter, refreshCorrections, type CorrectionAdmin } from '../../lib/corrections';
import { Modal } from '../Sheets';

const errText = (e: unknown) =>
  e instanceof Error ? (e.message === 'Pas de réseau' ? 'Pas de réseau : réessaie quand tu as du réseau.' : e.message) : 'Erreur';
const ROLE = { admin: 'Administrateur', chef: 'Chef de chantier', agent: 'Agent' } as const;

/* ---------- Petits éléments ---------- */

/** Code tout juste créé : affiché une seule fois, à partager tout de suite. */
function CodeReveal({ nom, code, onClose }: { nom: string; code: string; onClose: () => void }) {
  const text = `Repère Rail — ${nom}, ton code personnel : ${fmtCode(code)}\nOuvre ${location.origin}${location.pathname}, touche le bouton Chantier puis « Se connecter ».`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-reveal">
      <small>Code personnel de {nom}</small>
      <b className="code">{fmtCode(code)}</b>
      <p className="small">Note-le ou envoie-le maintenant : il ne sera plus affiché. Tu pourras en générer un nouveau.</p>
      <div className="btn-row">
        <button className="btn btn-small primary" onClick={() => void navigator.share?.({ text }).catch(() => undefined)} hidden={!navigator.share}>
          Envoyer
        </button>
        <button className="btn btn-small" onClick={() => void navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => undefined)}>
          {copied ? 'Copié' : 'Copier'}
        </button>
        <button className="btn btn-small" onClick={onClose}>J’ai noté</button>
      </div>
    </div>
  );
}

function FonctionChips({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="chips small-chips">
      {FONCTIONS.map((f) => (
        <button key={f} type="button" className={`chip ${value === f ? 'on' : ''}`} onClick={() => onChange(value === f ? '' : f)}>
          {f}
        </button>
      ))}
    </div>
  );
}

const lastSeen = (iso: string | null) => (iso ? `vu le ${fmtDateHeure(iso)}` : 'jamais connecté');

/* ---------- Connexion ---------- */

function LoginForm({ eq }: { eq: Equipe }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      await eq.connecter(code);
    } catch (e) {
      setErr(e instanceof Error && /Accès refusé/.test(e.message) ? 'Code inconnu ou compte désactivé.' : errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p>Connecte-toi avec ton <b>code personnel</b> pour retrouver ton chantier : sa zone et ses PK, les accès, les repères et les signalements de l’équipe.</p>
      {eq.sync.error && !err && <p className="warn-box">{eq.sync.error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <input className="text code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX" autoCapitalize="characters" autoComplete="one-time-code" maxLength={16} aria-label="Code personnel" />
        {err && <p className="error">{err}</p>}
        <button className="btn primary wide" type="submit" disabled={busy || code.replace(/[^A-Za-z0-9]/g, '').length < 8}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
      </form>
      <p className="muted small">Agents : le code vous est donné par votre chef de chantier. Chefs : par l’administrateur. Le code reste sur ce téléphone jusqu’à la déconnexion.</p>
    </>
  );
}

/* ---------- Administrateur : les chefs ---------- */

function AdminPanel({ eq }: { eq: Equipe }) {
  const code = eq.session!.code;
  const [chefs, setChefs] = useState<ChefRow[] | null>(null);
  const [nom, setNom] = useState('');
  const [entreprise, setEntreprise] = useState('');
  const [reveal, setReveal] = useState<{ nom: string; code: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.adminChefs(code).then(setChefs).catch((e) => setErr(errText(e))), [code]);
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <>
      {reveal && <CodeReveal {...reveal} onClose={() => setReveal(null)} />}
      <div className="field-label">Nouveau chef de chantier</div>
      <input className="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Prénom Nom" maxLength={80} />
      <input className="text" value={entreprise} onChange={(e) => setEntreprise(e.target.value)} placeholder="Entreprise (ex. ETF Services)" maxLength={120} />
      <button className="btn primary wide" disabled={nom.trim().length < 2} onClick={() => void act(async () => {
        const r = await api.adminCreerChef(code, nom.trim(), entreprise.trim());
        setReveal({ nom: nom.trim(), code: r.code });
        setNom('');
      })}>Créer le chef et son code</button>
      {err && <p className="error">{err}</p>}
      <div className="field-label">Chefs ({chefs?.length ?? '…'})</div>
      <ul className="items">
        {(chefs ?? []).map((c) => (
          <li key={c.id} className={`item ${c.actif ? '' : 'off'}`}>
            <span className="badge" style={{ background: '#112f54' }}>C</span>
            <span className="item-main">
              <b>{c.nom}</b>
              <small>{c.entreprise ?? '—'} · {c.nb_chantiers} chantier(s) · {c.nb_agents} agent(s)</small>
              <small>{c.actif ? lastSeen(c.derniere_connexion) : 'désactivé'}</small>
            </span>
            <span className="item-actions">
              <button className="btn btn-small" onClick={() => {
                if (window.confirm(`Nouveau code pour ${c.nom} ? L’ancien ne marchera plus.`))
                  void act(async () => setReveal({ nom: c.nom, code: (await api.compteMaj(code, c.id, { regenerer: true })).code! }));
              }}>Nouveau code</button>
              <button className="btn btn-small btn-ghost" onClick={() => {
                if (!c.actif || window.confirm(`Désactiver ${c.nom} ? Il ne pourra plus se connecter.`))
                  void act(() => api.compteMaj(code, c.id, { actif: !c.actif }));
              }}>{c.actif ? 'Désactiver' : 'Réactiver'}</button>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Administrateur : corrections de PK ---------- */

function AdminCorrections({ eq, onFocusAt }: { eq: Equipe; onFocusAt: (at: LonLat) => void }) {
  const code = eq.session!.code;
  const [list, setList] = useState<CorrectionAdmin[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
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
  return (
    <>
      <p className="muted small">
        Bornes relevées sur le terrain. « Portion » : la correction s’efface sur 1,5 km de chaque côté (ou jusqu’à la
        correction voisine). « Toute la ligne » : même écart jusqu’au bout de la ligne, à réserver aux lignes dont tous les
        PK sont décalés.
      </p>
      {err && <p className="error">{err}</p>}
      <ul className="items">
        {(list ?? []).map((c) => {
          const ecart = Math.round((c.pk_vrai - c.pk_app) * 1000);
          return (
            <li key={c.id} className={`corr ${c.statut}`}>
              <div className="item-main">
                <b>L{fmtLine(c.ligne)} · borne PK {fmtPk(c.pk_vrai)}</b>
                <small>Appli : PK {fmtPk(c.pk_app)} · écart {ecart > 0 ? '+' : ''}{ecart} m{c.precision_m ? ` · GPS ± ${Math.round(c.precision_m)} m` : ''}</small>
                <small>{c.auteur_nom || 'Anonyme'} · {fmtDateHeure(c.cree_le)}{c.commentaire ? ` · ${c.commentaire}` : ''}</small>
                <small><b>{label[c.statut]}</b>{c.statut === 'validee' ? ` (${c.etendue === 'ligne' ? 'toute la ligne' : 'portion'})` : ''}{c.traite_par ? ` par ${c.traite_par}` : ''}</small>
              </div>
              <div className="btn-row">
                <button className="btn btn-small" onClick={() => onFocusAt([c.lon, c.lat])}>Voir</button>
                {c.statut !== 'validee' && <button className="btn btn-small primary" onClick={() => void act(c, 'validee', 'portion')}>Valider (portion)</button>}
                {c.statut !== 'validee' && <button className="btn btn-small" onClick={() => void act(c, 'validee', 'ligne')}>Valider (toute la ligne)</button>}
                {c.statut !== 'refusee' && <button className="btn btn-small btn-ghost" onClick={() => void act(c, 'refusee', c.etendue)}>{c.statut === 'validee' ? 'Retirer' : 'Refuser'}</button>}
              </div>
            </li>
          );
        })}
        {list && !list.length && <p className="muted">Aucune correction proposée pour l’instant.</p>}
      </ul>
    </>
  );
}

/* ---------- Chef : chantiers ---------- */

function ChantierForm({ initial, currentLine, onSave, onCancel }: {
  initial: Chantier | null;
  currentLine: { code: string; pk: number } | null;
  onSave: (p: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
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
    <div className="form-box">
      <div className="field-label">{initial ? 'Modifier le chantier' : 'Nouveau chantier'}</div>
      <input className="text" value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} placeholder="Nom (ex. RVB PSE04 phase 2)" maxLength={120} />
      <input className="text" value={f.entreprise} onChange={(e) => setF({ ...f, entreprise: e.target.value })} placeholder="Entreprise (par défaut la tienne)" maxLength={120} />
      <div className="row-inputs">
        <input className="text" value={f.ligne} onChange={(e) => setF({ ...f, ligne: e.target.value })} inputMode="numeric" placeholder="Ligne (830000)" />
      </div>
      <div className="row-inputs">
        <input className="text" value={f.pkA} onChange={(e) => setF({ ...f, pkA: e.target.value })} inputMode="decimal" placeholder="PK début (45,2)" />
        <input className="text" value={f.pkB} onChange={(e) => setF({ ...f, pkB: e.target.value })} inputMode="decimal" placeholder="PK fin (47)" />
      </div>
      <div className="row-inputs">
        <label className="date-field">Début<input type="date" className="text" value={f.debut} onChange={(e) => setF({ ...f, debut: e.target.value })} /></label>
        <label className="date-field">Fin<input type="date" className="text" value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></label>
      </div>
      {err && <p className="error">{err}</p>}
      <div className="btn-row">
        <button className="btn primary" disabled={busy || f.nom.trim().length < 2} onClick={() => void save()}>{busy ? '…' : 'Enregistrer'}</button>
        <button className="btn" onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

function ChefChantiers({ eq, currentLine, onOpen }: { eq: Equipe; currentLine: { code: string; pk: number } | null; onOpen: (id: string) => void }) {
  const s = eq.session!;
  const [edit, setEdit] = useState<Chantier | 'new' | null>(s.chantiers.length ? null : 'new');
  const [showArchives, setShowArchives] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = s.chantiers.filter((c) => showArchives || !c.archive);
  const save = async (p: Record<string, unknown>) => {
    const c = await api.chefChantier(s.code, p);
    setEdit(null);
    await eq.refresh();
    if (!p.id) onOpen(c.id);
  };
  return (
    <>
      {edit ? (
        <ChantierForm initial={edit === 'new' ? null : edit} currentLine={currentLine} onSave={save} onCancel={() => setEdit(null)} />
      ) : (
        <button className="btn primary wide" onClick={() => setEdit('new')}>+ Nouveau chantier</button>
      )}
      {err && <p className="error">{err}</p>}
      <ul className="items">
        {list.map((c) => (
          <li key={c.id} className={`item ${c.archive ? 'off' : ''} ${c.id === s.chantierId ? 'item-on' : ''}`}>
            <button className="item-main as-btn" onClick={() => onOpen(c.id)}>
              <b>{c.nom}{c.archive ? ' (archivé)' : ''}</b>
              <small>{c.ligne ? `Ligne ${fmtLine(c.ligne)}` : 'Ligne ?'}{c.pk_debut != null ? ` · PK ${fmtPk(c.pk_debut)} → ${fmtPk(c.pk_fin ?? c.pk_debut)}` : ''}</small>
              <small>{c.nb_agents} agent(s){c.date_debut ? ` · depuis le ${fmtDate(c.date_debut)}` : ''}</small>
            </button>
            <span className="item-actions">
              <button className="btn btn-small" onClick={() => setEdit(c)}>Modifier</button>
              <button className="btn btn-small btn-ghost" onClick={() => {
                if (c.archive || window.confirm(`Archiver « ${c.nom} » ? Les agents ne le verront plus.`))
                  void api.chefChantier(s.code, { id: c.id, archive: !c.archive }).then(() => eq.refresh()).catch((e) => setErr(errText(e)));
              }}>{c.archive ? 'Désarchiver' : 'Archiver'}</button>
            </span>
          </li>
        ))}
      </ul>
      {s.chantiers.some((c) => c.archive) && (
        <button className="link-btn" onClick={() => setShowArchives((v) => !v)}>{showArchives ? 'Masquer les archives' : 'Voir les chantiers archivés'}</button>
      )}
    </>
  );
}

/* ---------- Chef : agents ---------- */

function ChefAgents({ eq }: { eq: Equipe }) {
  const s = eq.session!;
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [nom, setNom] = useState('');
  const [fonction, setFonction] = useState('');
  const [reveal, setReveal] = useState<{ nom: string; code: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const chantiers = s.chantiers.filter((c) => !c.archive);
  const load = useCallback(() => api.chefAgents(s.code).then(setAgents).catch((e) => setErr(errText(e))), [s.code]);
  useEffect(() => void load(), [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      await load();
      void eq.refresh();
    } catch (e) {
      setErr(errText(e));
    }
  };

  return (
    <>
      {reveal && <CodeReveal {...reveal} onClose={() => setReveal(null)} />}
      <div className="field-label">Nouvel agent</div>
      <input className="text" value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Prénom Nom" maxLength={80} />
      <FonctionChips value={fonction} onChange={setFonction} />
      <button className="btn primary wide" disabled={nom.trim().length < 2} onClick={() => void act(async () => {
        const r = await api.chefCreerAgent(s.code, nom.trim(), fonction);
        if (s.chantierId) await api.chefAffecter(s.code, s.chantierId, r.id, true);
        setReveal({ nom: nom.trim(), code: r.code });
        setOpen(r.id);
        setNom('');
        setFonction('');
      })}>
        Créer l’agent et son code{s.chantierId ? ' (affecté au chantier ouvert)' : ''}
      </button>
      {err && <p className="error">{err}</p>}
      <div className="field-label">Mes agents ({agents?.length ?? '…'})</div>
      <ul className="items">
        {(agents ?? []).map((a) => (
          <li key={a.id} className={`agent ${a.actif ? '' : 'off'}`}>
            <button className="item" onClick={() => setOpen(open === a.id ? null : a.id)}>
              <span className="badge" style={{ background: a.actif ? '#6b7280' : '#d1d5db' }}>A</span>
              <span className="item-main">
                <b>{a.nom}</b>
                <small>{a.fonction ?? 'Agent'} · {a.chantiers.length} chantier(s) · {a.actif ? lastSeen(a.derniere_connexion) : 'désactivé'}</small>
              </span>
              <span className="item-side"><small>{open === a.id ? '▲' : '▼'}</small></span>
            </button>
            {open === a.id && (
              <div className="agent-more">
                <div className="field-label">Chantiers de {a.nom}</div>
                <div className="chips small-chips">
                  {chantiers.map((c) => {
                    const on = a.chantiers.includes(c.id);
                    return (
                      <button key={c.id} className={`chip ${on ? 'on' : ''}`} onClick={() => void act(() => api.chefAffecter(s.code, c.id, a.id, !on))}>
                        {on ? '✓ ' : ''}{c.nom}
                      </button>
                    );
                  })}
                  {!chantiers.length && <span className="muted small">Crée d’abord un chantier.</span>}
                </div>
                <div className="btn-row">
                  <button className="btn btn-small" onClick={() => {
                    if (window.confirm(`Nouveau code pour ${a.nom} ? L’ancien ne marchera plus.`))
                      void act(async () => setReveal({ nom: a.nom, code: (await api.compteMaj(s.code, a.id, { regenerer: true })).code! }));
                  }}>Nouveau code</button>
                  <button className="btn btn-small btn-ghost" onClick={() => {
                    if (!a.actif || window.confirm(`Désactiver ${a.nom} ? Il ne pourra plus se connecter.`))
                      void act(() => api.compteMaj(s.code, a.id, { actif: !a.actif }));
                  }}>{a.actif ? 'Désactiver' : 'Réactiver'}</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---------- Tableau de bord d'un chantier (chef et agents) ---------- */

type Tab = 'signalements' | 'reperes' | 'rapports' | 'equipe';

function ChantierDashboard(p: {
  eq: Equipe;
  onOpenItem: (id: string, at: LonLat | null) => void;
  onShowChantier: () => void;
  onNewRepere: () => void;
  onNewSignal: () => void;
  onRapport: (r: RapportResume | null) => void;
}) {
  const { eq } = p;
  const etat = eq.etat;
  const gere = !!etat?.gere;
  const [tab, setTab] = useState<Tab>('signalements');
  const [grav, setGrav] = useState<string>('toutes');
  const [periode, setPeriode] = useState<'jour' | 'semaine' | 'tout'>('tout');
  const [importMsg, setImportMsg] = useState<{ text: string; error?: boolean; busy?: boolean } | null>(null);

  const sigs = useMemo(() => {
    const since = periode === 'jour' ? new Date().setHours(0, 0, 0, 0) : periode === 'semaine' ? Date.now() - 7 * 86400e3 : 0;
    return eq.view.signalements.filter((s) => (grav === 'toutes' || s.gravite === grav) && Date.parse(s.cree_le) >= since);
  }, [eq.view.signalements, grav, periode]);
  const reps = eq.view.reperes;
  const aRetirer = reps.filter((r) => r.categorie === 'panneau' && r.etat !== 'retire');
  const errors = eq.pending.filter((i) => i.error && i.chantier === eq.session?.chantierId);
  const c = etat?.chantier ?? eq.session?.chantiers.find((x) => x.id === eq.session?.chantierId);

  const importKml = async (file: File) => {
    const s = eq.session!;
    setImportMsg({ text: 'Import en cours…', busy: true });
    try {
      const { points } = await readAccesFile(file);
      if (!points.length) throw new Error('Aucun point dans ce fichier.');
      const snapped = await snapAcces(points);
      let n = 0;
      for (let i = 0; i < snapped.length; i += 400) {
        n += await api.reperesImport(s.code, s.chantierId!, snapped.slice(i, i + 400).map((a) => ({
          id: newId(), type: 'acces', nom: a.name, commentaire: a.desc, lon: a.lonlat[0], lat: a.lonlat[1], ligne: a.code ?? '', pk: a.pk ?? '',
        })));
      }
      await eq.refresh();
      setImportMsg({ text: `${n} accès ajoutés au chantier, visibles par toute l’équipe.` });
    } catch (e) {
      setImportMsg({ text: errText(e), error: true });
    }
  };

  const syncText = eq.sync.busy ? 'Synchronisation…' : eq.sync.error ? eq.sync.error
    : eq.sync.offline ? `Hors-ligne${eq.pending.length ? ` · ${eq.pending.length} envoi(s) en attente` : ''}`
    : eq.pending.length ? `${eq.pending.length} envoi(s) en attente`
    : eq.sync.last ? `À jour à ${new Date(eq.sync.last).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Chargement…';

  return (
    <>
      <div className="chantier-head">
        <b>{c?.nom ?? 'Chantier'}</b>
        <small>
          {c?.entreprise && `${c.entreprise} · `}{c?.ligne ? `Ligne ${fmtLine(c.ligne)}` : ''}
          {c?.pk_debut != null && ` · PK ${fmtPk(c.pk_debut)} → ${fmtPk(c.pk_fin ?? c.pk_debut)}`}
          {c?.chef_nom && eq.session?.compte.role === 'agent' && ` · chef : ${c.chef_nom}`}
        </small>
      </div>
      <div className={`sync-line ${eq.sync.error ? 'error' : eq.sync.offline || eq.pending.length ? 'warn' : eq.sync.last ? 'ok' : ''}`}>
        <span>{syncText}</span>
        <button className="btn btn-small" onClick={() => void eq.refresh()} disabled={eq.sync.busy}>Actualiser</button>
      </div>

      <div className="btn-row">
        <button className="btn btn-signal" onClick={p.onNewSignal}>⚠ Signaler</button>
        <button className="btn" onClick={p.onShowChantier} disabled={!c?.ligne || c.pk_debut == null}>Voir sur la carte</button>
      </div>
      {gere && (
        <div className="btn-row">
          <button className="btn" onClick={p.onNewRepere}>Poser un repère</button>
          <label className="btn file-btn-plain">
            Importer accès (KML)
            <input type="file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importKml(f); e.target.value = ''; }} />
          </label>
          <button className="btn" onClick={() => p.onRapport(null)}>Rapport de poste</button>
        </div>
      )}
      {importMsg && <p className={importMsg.error ? 'error small' : importMsg.busy ? 'muted small' : 'ok small import-ok'}>{importMsg.text}</p>}

      {errors.length > 0 && (
        <div className="warn-box">
          <b>Envois refusés par le serveur</b>
          {errors.map((i) => (
            <div key={i.id} className="err-item">
              <span>{i.kind} : {i.error}</span>
              <button className="link-btn" onClick={() => void eq.abandonner(i.id)}>Supprimer</button>
            </div>
          ))}
        </div>
      )}

      <div className="chips seg tabs">
        <button className={`chip ${tab === 'signalements' ? 'on' : ''}`} onClick={() => setTab('signalements')}>Signalements ({eq.view.signalements.length})</button>
        <button className={`chip ${tab === 'reperes' ? 'on' : ''}`} onClick={() => setTab('reperes')}>Carte ({reps.length})</button>
        {gere && <button className={`chip ${tab === 'rapports' ? 'on' : ''}`} onClick={() => setTab('rapports')}>Rapports ({etat?.rapports.length ?? 0})</button>}
        <button className={`chip ${tab === 'equipe' ? 'on' : ''}`} onClick={() => setTab('equipe')}>Équipe ({etat?.membres.length ?? 0})</button>
      </div>

      {tab === 'signalements' && (
        <>
          <div className="chips small-chips">
            {[{ key: 'toutes', label: 'Toutes', color: '#111827' }, ...GRAVITES].map((g) => (
              <button key={g.key} className={`chip ${grav === g.key ? 'on' : ''}`} onClick={() => setGrav(g.key)}>{g.label}</button>
            ))}
            {(['jour', 'semaine', 'tout'] as const).map((k) => (
              <button key={k} className={`chip ${periode === k ? 'on' : ''}`} onClick={() => setPeriode(k)}>
                {k === 'jour' ? 'Aujourd’hui' : k === 'semaine' ? '7 jours' : 'Tout'}
              </button>
            ))}
          </div>
          <ul className="items">
            {sigs.map((s) => {
              const g = choice(GRAVITES, s.gravite);
              return (
                <li key={s.id}>
                  <button className="item" onClick={() => p.onOpenItem(s.id, [s.lon, s.lat])}>
                    <span className="badge" style={{ background: g.color }}>!</span>
                    <span className="item-main">
                      <b>{choice(NATURES, s.nature).label}</b>
                      <small>{s.commentaire?.split('\n')[0] || g.label}{s.photos.length ? ` · ${s.photos.length} photo(s)` : ''}</small>
                      <small>{s.auteur_nom} · {fmtDateHeure(s.cree_le)}{s.pending ? ' · en attente' : ''}</small>
                    </span>
                    <span className="item-side">
                      {s.pk !== null && <b>PK {fmtPk(s.pk)}</b>}
                      {s.voie && <small>{s.voie}</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!sigs.length && <p className="muted">{!etat ? 'Chargement…' : 'Aucun signalement'}{grav !== 'toutes' || periode !== 'tout' ? ' avec ces filtres' : ''}.</p>}
          {gere && etat && sigs.length > 0 && (
            <button className="btn wide" onClick={() => void shareFile(signalementsCsv(etat.chantier, sigs), `signalements-${etat.chantier.nom.replace(/[^\w-]+/g, '_')}.csv`)}>
              Exporter ces {sigs.length} signalements (Excel)
            </button>
          )}
        </>
      )}

      {tab === 'reperes' && (
        <>
          {aRetirer.length > 0 && <div className="field-label">Panneaux à retirer ({aRetirer.length})</div>}
          <RepereList items={aRetirer} onOpen={p.onOpenItem} />
          {(['zone', 'point'] as const).map((cat) => {
            const list = reps.filter((r) => r.categorie === cat);
            return list.length ? (
              <div key={cat}>
                <div className="field-label">{cat === 'zone' ? 'Zones' : 'Points et accès'} ({list.length})</div>
                <RepereList items={list} onOpen={p.onOpenItem} />
              </div>
            ) : null;
          })}
          {reps.some((r) => r.categorie === 'panneau' && r.etat === 'retire') && (
            <>
              <div className="field-label">Panneaux retirés</div>
              <RepereList items={reps.filter((r) => r.categorie === 'panneau' && r.etat === 'retire')} onOpen={p.onOpenItem} />
            </>
          )}
          {!reps.length && <p className="muted">{!etat ? 'Chargement…' : gere ? 'Prépare la carte : zone entre deux PK, accès, points de rendez-vous, panneaux.' : 'Le chef n’a encore rien préparé sur la carte.'}</p>}
        </>
      )}

      {tab === 'rapports' && gere && (
        <ul className="items">
          {(etat?.rapports ?? []).map((r) => (
            <li key={r.id}>
              <button className="item" onClick={() => p.onRapport(r)}>
                <span className="badge" style={{ background: '#112f54' }}>R</span>
                <span className="item-main">
                  <b>Poste du {fmtDate(r.date_poste)} ({r.contenu.poste === 'nuit' ? 'nuit' : 'jour'})</b>
                  <small>{r.contenu.debut}–{r.contenu.fin} · {r.contenu.equipe.length} personne(s) · {r.auteur_nom}</small>
                </span>
              </button>
            </li>
          ))}
          {!etat?.rapports.length && <p className="muted">Aucun rapport. Touche « Rapport de poste » à la fin du poste.</p>}
        </ul>
      )}

      {tab === 'equipe' && etat && (
        <ul className="items">
          {etat.membres.map((m) => (
            <li key={m.id} className="item">
              <span className="badge" style={{ background: m.role === 'chef' ? '#112f54' : '#6b7280' }}>{m.role === 'chef' ? 'C' : 'A'}</span>
              <span className="item-main">
                <b>{m.nom}{m.id === etat.moi.id ? ' (toi)' : ''}</b>
                <small>{m.fonction ?? (m.role === 'chef' ? 'Chef de chantier' : 'Agent')}</small>
              </span>
            </li>
          ))}
          {gere && <p className="muted small">Pour ajouter ou retirer des agents de ce chantier : onglet « Agents ».</p>}
        </ul>
      )}
    </>
  );
}

function RepereList({ items, onOpen }: { items: Equipe['view']['reperes']; onOpen: (id: string, at: LonLat | null) => void }) {
  return (
    <ul className="items">
      {items.map((r) => {
        const c = choice(repereChoices(r.categorie), r.type);
        return (
          <li key={r.id}>
            <button className="item" onClick={() => onOpen(r.id, r.lon !== null && r.lat !== null ? [r.lon, r.lat] : null)}>
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

/* ---------- Écran principal ---------- */

type ChefTab = 'chantier' | 'chantiers' | 'agents';

export function EspaceSheet(p: {
  eq: Equipe;
  onFocusAt: (at: LonLat) => void;
  currentLine: { code: string; pk: number } | null;
  onOpenItem: (id: string, at: LonLat | null) => void;
  onShowChantier: () => void;
  onNewRepere: () => void;
  onNewSignal: () => void;
  onRapport: (r: RapportResume | null) => void;
  onClose: () => void;
}) {
  const { eq } = p;
  const s = eq.session;
  const [chefTab, setChefTab] = useState<ChefTab>(s?.chantierId ? 'chantier' : 'chantiers');
  const [adminTab, setAdminTab] = useState<'chefs' | 'corrections'>('chefs');

  if (!s) {
    return (
      <Modal title="Espace chantier" onClose={p.onClose} side>
        <LoginForm eq={eq} />
      </Modal>
    );
  }

  const role = s.compte.role;
  const actifs = s.chantiers.filter((c) => !c.archive);
  const dashboard = (
    <ChantierDashboard eq={eq} onOpenItem={p.onOpenItem} onShowChantier={p.onShowChantier} onNewRepere={p.onNewRepere}
      onNewSignal={p.onNewSignal} onRapport={p.onRapport} />
  );

  return (
    <Modal title={role === 'admin' ? 'Administration' : role === 'chef' ? 'Espace chef' : 'Mon chantier'} onClose={p.onClose} side>
      <div className="who">
        <span><b>{s.compte.nom}</b> · {ROLE[role]}{s.compte.entreprise ? ` · ${s.compte.entreprise}` : ''}</span>
        <button className="link-btn" onClick={() => {
          const warn = eq.pending.length ? `\n${eq.pending.length} envoi(s) en attente seront perdus.` : '';
          if (window.confirm(`Se déconnecter de ce téléphone ?${warn}`)) eq.deconnecter();
        }}>Se déconnecter</button>
      </div>

      {role === 'admin' && (
        <>
          <div className="chips seg tabs">
            <button className={`chip ${adminTab === 'chefs' ? 'on' : ''}`} onClick={() => setAdminTab('chefs')}>Chefs</button>
            <button className={`chip ${adminTab === 'corrections' ? 'on' : ''}`} onClick={() => setAdminTab('corrections')}>Corrections PK</button>
          </div>
          {adminTab === 'chefs' ? <AdminPanel eq={eq} /> : <AdminCorrections eq={eq} onFocusAt={p.onFocusAt} />}
        </>
      )}

      {role === 'agent' && (
        <>
          {actifs.length > 1 && (
            <div className="chips seg">
              {actifs.map((c) => (
                <button key={c.id} className={`chip ${c.id === s.chantierId ? 'on' : ''}`} onClick={() => eq.choisir(c.id)}>{c.nom}</button>
              ))}
            </div>
          )}
          {!actifs.length && <p className="warn-box">Ton chef ne t’a encore affecté à aucun chantier. Demande-lui, puis touche « Actualiser ».<br /><button className="btn btn-small" onClick={() => void eq.refresh()}>Actualiser</button></p>}
          {actifs.length > 1 && !s.chantierId && <p className="muted">Choisis ton chantier.</p>}
          {s.chantierId && dashboard}
        </>
      )}

      {role === 'chef' && (
        <>
          <div className="chips seg tabs">
            <button className={`chip ${chefTab === 'chantier' ? 'on' : ''}`} disabled={!s.chantierId} onClick={() => setChefTab('chantier')}>
              {s.chantiers.find((c) => c.id === s.chantierId)?.nom ?? 'Chantier ouvert'}
            </button>
            <button className={`chip ${chefTab === 'chantiers' ? 'on' : ''}`} onClick={() => setChefTab('chantiers')}>Chantiers ({actifs.length})</button>
            <button className={`chip ${chefTab === 'agents' ? 'on' : ''}`} onClick={() => setChefTab('agents')}>Agents</button>
          </div>
          {chefTab === 'chantier' && s.chantierId && dashboard}
          {chefTab === 'chantiers' && (
            <ChefChantiers eq={eq} currentLine={p.currentLine} onOpen={(id) => { eq.choisir(id); setChefTab('chantier'); }} />
          )}
          {chefTab === 'agents' && <ChefAgents eq={eq} />}
        </>
      )}
    </Modal>
  );
}
