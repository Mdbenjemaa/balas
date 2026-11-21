import { useEffect, useState } from 'react';
import { adminCorrections } from '../../lib/corrections';
import { api, type RapportResume } from '../../lib/equipe/api';
import { statutOf } from '../../lib/equipe/catalog';
import { fmtDate } from '../../lib/equipe/exports';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { fmtLine, fmtPk } from '../../lib/format';
import type { LonLat } from '../../lib/geo';
import { InstallSteps, useInstallMode } from '../Install';
import { ChantierForm, ChantiersPage } from './Chantiers';
import { RapportsPage, ReperesPage } from './Reperes';
import type { SigIntent } from './Signalements';
import type { Tab } from './TabBar';
import { Empty, Icon, Page, prenom, ROLE, SyncLine, Tile } from './ui';

export interface HomeProps {
  eq: Equipe;
  currentLine: { code: string; pk: number } | null;
  onGo: (tab: Tab, intent?: SigIntent | { ajout?: boolean }) => void;
  onSignal: () => void;
  onRepere: () => void;
  onRapport: (r: RapportResume | null) => void;
  onShowChantier: () => void;
  onLocate: () => void;
  onOpenItem: (id: string, at: LonLat | null) => void;
  onLogout: () => void;
}

type Sub = null | 'chantiers' | 'reperes' | 'rapports';

/** Accueil après connexion : le chantier, les actions principales et les compteurs. */
export function HomePage(p: HomeProps) {
  const [sub, setSub] = useState<Sub>(null);
  const role = p.eq.session!.compte.role;
  if (sub === 'chantiers') return <ChantiersPage eq={p.eq} currentLine={p.currentLine} onBack={() => setSub(null)} onOpened={() => setSub(null)} />;
  if (sub === 'reperes') return <ReperesPage eq={p.eq} onBack={() => setSub(null)} onOpen={p.onOpenItem} onNew={p.onRepere} />;
  if (sub === 'rapports') return <RapportsPage eq={p.eq} onBack={() => setSub(null)} onOpen={p.onRapport} />;
  if (role === 'admin') return <AdminHome {...p} />;
  return <TeamHome {...p} onSub={setSub} />;
}

function Hello({ eq, children }: { eq: Equipe; children: React.ReactNode }) {
  const c = eq.session!.compte;
  return (
    <Page hero title={`Bonjour ${prenom(c.nom)}`} subtitle={`${ROLE[c.role]}${c.entreprise ? ` · ${c.entreprise}` : ''}`}>
      {children}
    </Page>
  );
}

function Footer({ eq, onLogout }: { eq: Equipe; onLogout: () => void }) {
  const mode = useInstallMode();
  return (
    <div className="home-foot">
      {mode !== 'installed' && mode !== 'desktop-menu' && (
        <details className="install-card">
          <summary>
            <Icon name="download" size={18} /> Installer Repère Rail sur ce téléphone
          </summary>
          <InstallSteps mode={mode} />
        </details>
      )}
      <div className="account">
        <span>
          Connecté : <b>{eq.session!.compte.nom}</b>
        </span>
        <button className="link-btn" onClick={onLogout}>
          <Icon name="logout" size={16} /> Se déconnecter
        </button>
      </div>
    </div>
  );
}

/** Carte du chantier ouvert, avec le changement de chantier. */
function ChantierCard({ eq, onMap, onChange }: { eq: Equipe; onMap: () => void; onChange?: () => void }) {
  const s = eq.session!;
  const c = eq.etat?.chantier ?? s.chantiers.find((x) => x.id === s.chantierId);
  if (!c) return null;
  return (
    <div className="site-hero">
      <div className="site-hero-top">
        <span className="site-ico"><Icon name="site" /></span>
        <div>
          <small>Chantier ouvert</small>
          <b>{c.nom}</b>
        </div>
        {onChange && (
          <button className="link-btn light" onClick={onChange}>Changer</button>
        )}
      </div>
      <div className="site-facts">
        <span>{c.ligne ? `Ligne ${fmtLine(c.ligne)}` : 'Ligne à préciser'}</span>
        {c.pk_debut != null && <span>PK {fmtPk(c.pk_debut)} → {fmtPk(c.pk_fin ?? c.pk_debut)}</span>}
        {c.date_debut && <span>depuis le {fmtDate(c.date_debut)}</span>}
        {s.compte.role === 'agent' && c.chef_nom && <span>chef : {c.chef_nom}</span>}
      </div>
      <button className="btn btn-light" onClick={onMap} disabled={!c.ligne || c.pk_debut == null}>
        <Icon name="map" size={18} /> Voir sur la carte
      </button>
    </div>
  );
}

function TeamHome(p: HomeProps & { onSub: (s: Sub) => void }) {
  const { eq } = p;
  const s = eq.session!;
  const chef = s.compte.role === 'chef';
  const actifs = s.chantiers.filter((c) => !c.archive);
  const etat = eq.etat;
  const moi = etat?.moi.id;
  const sigs = eq.view.signalements;
  const ouverts = sigs.filter((x) => statutOf(x) !== 'traite');
  const urgents = ouverts.filter((x) => x.gravite === 'urgent').length;
  const pourMoi = ouverts.filter((x) => x.assigne_id && x.assigne_id === moi).length;
  const nouveaux = sigs.filter((x) => statutOf(x) === 'nouveau').length;
  const mes = sigs.filter((x) => x.auteur_id === moi).length;
  const agents = etat?.membres.filter((m) => m.role === 'agent').length ?? 0;
  const reps = eq.view.reperes;
  const aRetirer = reps.filter((r) => r.categorie === 'panneau' && r.etat !== 'retire').length;
  const errors = eq.pending.filter((i) => i.error && i.chantier === s.chantierId);

  // Chef sans chantier : on commence par en créer un.
  if (chef && !actifs.length) {
    return (
      <Hello eq={eq}>
        <div className="onboard">
          <b>Crée ton premier chantier</b>
          <p className="muted small">Un nom, la ligne et les PK : ton équipe verra la zone sur la carte.</p>
        </div>
        <ChantierForm
          initial={null}
          currentLine={p.currentLine}
          onSave={async (x) => {
            const c = await api.chefChantier(s.code, x);
            eq.choisir(c.id);
            await eq.refresh();
          }}
        />
        <Footer eq={eq} onLogout={p.onLogout} />
      </Hello>
    );
  }

  // Plusieurs chantiers et aucun d'ouvert : on choisit.
  if (!s.chantierId) {
    return (
      <Hello eq={eq}>
        {actifs.length ? (
          <>
            <div className="field-label">Choisis ton chantier</div>
            <ul className="site-list">
              {actifs.map((c) => (
                <li key={c.id} className="site-card">
                  <button className="site-main" onClick={() => eq.choisir(c.id)}>
                    <b>{c.nom}</b>
                    <small>{c.ligne ? `Ligne ${fmtLine(c.ligne)}` : ''}{c.pk_debut != null ? ` · PK ${fmtPk(c.pk_debut)} → ${fmtPk(c.pk_fin ?? c.pk_debut)}` : ''}</small>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <Empty icon="site" title="Pas encore de chantier">
            Ton chef ne t’a encore affecté à aucun chantier. Demande-lui, puis actualise.
            <br />
            <button className="btn btn-small" onClick={() => void eq.refresh()}>Actualiser</button>
          </Empty>
        )}
        <Footer eq={eq} onLogout={p.onLogout} />
      </Hello>
    );
  }

  const changer = chef ? () => p.onSub('chantiers') : actifs.length > 1 ? () => eq.choisir(null) : undefined;

  return (
    <Hello eq={eq}>
      <ChantierCard eq={eq} onMap={p.onShowChantier} onChange={changer} />
      <SyncLine eq={eq} />
      {errors.length > 0 && (
        <div className="warn-box small">
          <b>Envois refusés par le serveur</b>
          {errors.map((i) => (
            <div key={i.id} className="err-item">
              <span>{i.error}</span>
              <button className="link-btn" onClick={() => void eq.abandonner(i.id)}>Supprimer</button>
            </div>
          ))}
        </div>
      )}

      <button className="cta-signal" onClick={p.onSignal}>
        <Icon name="alert" size={26} />
        <span>
          <b>Signaler une anomalie</b>
          <small>Photo, nature, gravité : ton PK est ajouté tout seul</small>
        </span>
      </button>

      <div className="tiles">
        {chef ? (
          <>
            <Tile icon="alert" label="Signalements à traiter" count={ouverts.length} tone={urgents ? 'danger' : ouverts.length ? 'navy' : 'ok'}
              sub={urgents ? `dont ${urgents} urgent${urgents > 1 ? 's' : ''}` : nouveaux ? `${nouveaux} nouveau(x) à confier` : 'Tout est traité'}
              onClick={() => p.onGo('signalements', { filtre: 'a_traiter' })} />
            <Tile icon="users" label="Mon équipe" count={agents} sub="agents sur ce chantier" onClick={() => p.onGo('equipe')} />
            <Tile icon="userPlus" label="Ajouter un agent" sub="Code envoyé par SMS" tone="orange" onClick={() => p.onGo('equipe', { ajout: true })} />
            <Tile icon="pin" label="Me repérer" sub="Ligne et PK ici" onClick={p.onLocate} />
            <Tile icon="flag" label="Poser un repère" sub="Zone, accès, panneau" onClick={p.onRepere} />
            <Tile icon="doc" label="Rapport de poste" count={etat?.rapports.length ?? null} sub="Fin de poste, PDF signé" onClick={() => p.onSub('rapports')} />
            <Tile icon={aRetirer ? 'sign' : 'layers'} label={aRetirer ? 'Panneaux à retirer' : 'Repères et accès'} count={aRetirer || reps.length}
              tone={aRetirer ? 'orange' : 'plain'} sub={aRetirer ? 'avant la fin du chantier' : 'Préparer la carte, importer'} onClick={() => p.onSub('reperes')} />
            <Tile icon="site" label="Mes chantiers" count={actifs.length} sub="Créer, modifier, archiver" onClick={() => p.onSub('chantiers')} />
          </>
        ) : (
          <>
            <Tile icon="check" label="À faire pour moi" count={pourMoi} tone={pourMoi ? 'orange' : 'ok'}
              sub={pourMoi ? 'confiés par ton chef' : 'Rien pour l’instant'} onClick={() => p.onGo('signalements', { filtre: 'moi' })} />
            <Tile icon="alert" label="Signalements" count={ouverts.length} tone={urgents ? 'danger' : 'navy'}
              sub={urgents ? `dont ${urgents} urgent${urgents > 1 ? 's' : ''}` : 'à traiter sur le chantier'} onClick={() => p.onGo('signalements', { filtre: 'a_traiter' })} />
            <Tile icon="clipboard" label="Mes signalements" count={mes} sub="avec leur statut" onClick={() => p.onGo('signalements', { filtre: 'mes' })} />
            <Tile icon="pin" label="Me repérer" sub="Ligne et PK ici" onClick={p.onLocate} />
            <Tile icon={aRetirer ? 'sign' : 'layers'} label="Repères du chantier" count={reps.length} sub={aRetirer ? `${aRetirer} panneau(x) posé(s)` : 'Zones, accès, points'} onClick={() => p.onSub('reperes')} />
            <Tile icon="map" label="Carte" sub="PK, gares, PN, accès" onClick={() => p.onGo('carte')} />
          </>
        )}
      </div>
      <Footer eq={eq} onLogout={p.onLogout} />
    </Hello>
  );
}

function AdminHome(p: HomeProps) {
  const code = p.eq.session!.code;
  const [chefs, setChefs] = useState<number | null>(null);
  const [aValider, setAValider] = useState<number | null>(null);
  useEffect(() => {
    void api.adminChefs(code).then((l) => setChefs(l.filter((c) => c.actif).length)).catch(() => undefined);
    void adminCorrections(code).then((l) => setAValider(l.filter((c) => c.statut === 'proposee').length)).catch(() => undefined);
  }, [code]);
  return (
    <Hello eq={p.eq}>
      <div className="tiles">
        <Tile icon="users" label="Chefs de chantier" count={chefs} sub="Comptes, codes" onClick={() => p.onGo('chefs')} />
        <Tile icon="userPlus" label="Ajouter un chef" sub="Code envoyé par SMS" tone="orange" onClick={() => p.onGo('chefs', { ajout: true })} />
        <Tile icon="ruler" label="Corrections PK" count={aValider} tone={aValider ? 'danger' : 'ok'} sub={aValider ? 'à valider' : 'Rien à valider'} onClick={() => p.onGo('corrections')} />
        <Tile icon="pin" label="Me repérer" sub="Ligne et PK ici" onClick={p.onLocate} />
      </div>
      <Footer eq={p.eq} onLogout={p.onLogout} />
    </Hello>
  );
}
