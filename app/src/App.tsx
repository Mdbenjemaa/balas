import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { LocatePanel, type LocateState } from './components/LocatePanel';
import { Disclaimer, FeatureCard, FilterSheet, InfoSheet, OfflineSheet, Search, type ImportStatus } from './components/Sheets';
import { TargetSheet, type Origin, type TargetState } from './components/TargetSheet';
import { accesFeatures, loadAcces, readAccesSource, saveAcces, snapAcces, type AccesSet } from './lib/acces';
import { fmtLine, fmtPk } from './lib/format';
import { parsePk, pkRange, positionsAtPk } from './lib/pk';
import { dataUpdate, loadCell, loadLine, loadManifest, type Manifest } from './lib/data';
import type { LonLat } from './lib/geo';
import { acquire, follow, geoErrorMessage, type Acquisition, type Fix } from './lib/gps';
import { PkFilter, type PkEstimate } from './lib/pkfilter';
import { keepScreenOn, type AwakeStatus } from './lib/wakelock';
import { DEFAULT_FILTERS, type FilterKey, type Filters } from './lib/layers';
import { cellsAround, matchInCells, pickFollowLine, pickLine, searchRadius, type LineCandidate } from './lib/locate';
import { loadPref, meFeatures, savePref } from './lib/me';
import { MapView, railSource, type FocusRequest } from './map/MapView';
import { PREVIEW } from './lib/env';
import { LoginScreen } from './components/app/LoginScreen';
import { TabBar, tabsFor, type Tab } from './components/app/TabBar';
import { HomePage } from './components/app/Home';
import { SignalementsPage, type SigIntent } from './components/app/Signalements';
import { EquipePage } from './components/app/Equipe';
import { ChefsPage, CorrectionsPage } from './components/app/Admin';
import { normCode } from './lib/equipe/api';
import { statutOf } from './lib/equipe/catalog';
import { RepereForm, SignalForm } from './components/equipe/Forms';
import { RapportForm } from './components/equipe/RapportForm';
import { TeamCard } from './components/equipe/TeamCard';
import type { RapportResume } from './lib/equipe/api';
import { teamFeatures } from './lib/equipe/features';
import { positionFrom } from './lib/equipe/position';
import type { NewItem } from './lib/equipe/store';
import { useEquipe } from './lib/equipe/useEquipe';
import { CorrectionForm, type CorrectionTarget } from './components/CorrectionForm';
import { InstallBanner } from './components/Install';
import { envoyerEnAttente, onCorrections, refreshCorrections } from './lib/corrections';
import { correctedPkMarks } from './lib/pkmarks';
import type { Basemap } from './map/style';

type Panel = 'none' | 'filters' | 'offline' | 'info' | 'signal' | 'repere' | 'rapport' | 'correction';
const TEAM_LAYERS = new Set(['u-sig', 'u-rep', 'u-zone']);

export default function App() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [dataError, setDataError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(() => ({ ...DEFAULT_FILTERS, ...loadPref<Partial<Filters>>('rr-filters', {}) }));
  const [basemap, setBasemap] = useState<Basemap>(() => loadPref<Basemap>('rr-basemap', 'plan'));
  const [declared, setDeclared] = useState<number | null>(() => loadPref<number | null>('rr-distance', null));
  const [ack, setAck] = useState(() => loadPref('rr-ack-v1', false));
  const [panel, setPanel] = useState<Panel>('none');
  const [loc, setLoc] = useState<LocateState>({ phase: 'idle' });
  const [expanded, setExpanded] = useState(false);
  const [following, setFollowing] = useState(false);
  const [followPk, setFollowPk] = useState<PkEstimate | null>(null);
  const [followAt, setFollowAt] = useState<LonLat | null>(null);
  const [mapFree, setMapFree] = useState(false);
  const [awake, setAwake] = useState<AwakeStatus | null>(null);
  const [me, setMe] = useState<FeatureCollection | null>(null);
  const [focus, setFocus] = useState<FocusRequest | null>(null);
  const [picked, setPicked] = useState<{ f: MapGeoJSONFeature; at: LonLat } | null>(null);
  const [mapKey, setMapKey] = useState(0);
  const [target, setTarget] = useState<TargetState | null>(null);
  const [targetExpanded, setTargetExpanded] = useState(false);
  const [acces, setAcces] = useState<AccesSet[]>(() => loadAcces());
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eq = useEquipe();
  // Écran de connexion au démarrage (sauf compte déjà connecté) ; lien reçu par SMS : « …#code=XXXX ».
  const [entered, setEntered] = useState(PREVIEW);
  const [linkCode, setLinkCode] = useState<string | null>(() => {
    const m = /[#&]code=([A-Za-z0-9-]{8,16})/.exec(location.hash);
    return m ? normCode(m[1]) : null;
  });
  useEffect(() => {
    if (location.hash.includes('code=')) history.replaceState(null, '', location.pathname + location.search);
  }, []);
  const [tab, setTab] = useState<Tab>('accueil');
  const [intent, setIntent] = useState<{ data: SigIntent | { ajout?: boolean }; n: number } | null>(null);
  const [teamFC, setTeamFC] = useState<FeatureCollection | null>(null);
  const [teamPick, setTeamPick] = useState<string | null>(null);
  const [rapport, setRapport] = useState<RapportResume | null>(null);
  const [corrTarget, setCorrTarget] = useState<CorrectionTarget | null>(null);
  const [corrVersion, setCorrVersion] = useState(0);
  const [pkfix, setPkfix] = useState<Awaited<ReturnType<typeof correctedPkMarks>> | null>(null);

  // Corrections de PK validées : au démarrage, au retour du réseau ; propositions en attente renvoyées.
  useEffect(() => {
    const sync = () => {
      void refreshCorrections(true);
      void envoyerEnAttente(null);
    };
    sync();
    window.addEventListener('online', sync);
    const off = onCorrections(() => setCorrVersion((v) => v + 1));
    return () => {
      window.removeEventListener('online', sync);
      off();
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void correctedPkMarks().then((r) => !cancelled && setPkfix(r.codes.length ? r : null));
    return () => {
      cancelled = true;
    };
  }, [corrVersion]);

  useEffect(() => {
    let cancelled = false;
    void teamFeatures(eq.view).then((fc) => !cancelled && setTeamFC(fc));
    return () => {
      cancelled = true;
    };
  }, [eq.view, corrVersion]);
  const acquisition = useRef<Acquisition | null>(null);
  const stopFollow = useRef<(() => void) | null>(null);
  const busy = useRef(false);
  const pendingFix = useRef<Fix | null>(null);
  const pkFilter = useRef(new PkFilter());
  const followLine = useRef<string | null>(null);
  const releaseAwake = useRef<(() => void) | null>(null);
  const lastFix = useRef<{ fix: Fix; mode: 'gps' | 'manuel' | 'suivi'; forced?: string } | null>(null);

  useEffect(() => {
    loadManifest().then((m) => {
      setManifest(m);
      if (dataUpdate.hadOffline) {
        // La carte hors-ligne téléchargée est périmée : on repart des nouvelles données.
        railSource.reset();
        setMapKey((k) => k + 1);
        showToast('Nouvelles données PK : pour le mode sans réseau, retélécharge la France (bouton flèche).');
      }
    }, (e: Error) => setDataError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => savePref('rr-filters', filters), [filters]);
  useEffect(() => savePref('rr-basemap', basemap), [basemap]);
  useEffect(() => savePref('rr-distance', declared), [declared]);

  const focusOn = useCallback((center: LonLat, zoom?: number) => setFocus((f) => ({ center, zoom, seq: (f?.seq ?? 0) + 1 })), []);

  /** Rattache une position aux lignes proches et prépare l'affichage. */
  const analyse = useCallback(
    async (fix: Fix, mode: 'gps' | 'manuel' | 'suivi', forcedCode?: string, recenter = true, prefer?: string | null): Promise<LineCandidate | null> => {
      const m = manifest ?? (await loadManifest());
      lastFix.current = { fix, mode, forced: forcedCode };
      const radius = searchRadius(fix.accuracy, declared);
      const known = new Set(m.cells);
      const cells = (
        await Promise.all(cellsAround(fix.lonlat, radius, m.cellsPerDegree).map((k) => loadCell(k, known)))
      ).filter((c) => c !== null);
      const match = matchInCells(cells, fix.lonlat, radius);
      const chosen =
        (forcedCode && match.lines.find((l) => l.code === forcedCode)) ||
        (mode === 'suivi' ? pickFollowLine(match.lines, prefer, declared, fix.accuracy) : pickLine(match.lines, declared));
      const doc = chosen ? await loadLine(chosen.code).catch(() => null) : null;
      setLoc({ phase: 'result', fix, mode, radius, match, chosen: chosen ?? null, doc });
      setMe(meFeatures(fix.lonlat, fix.accuracy, chosen?.point ?? null));
      if (recenter) focusOn(fix.lonlat, mode === 'suivi' ? undefined : 17);
      return chosen ?? null;
    },
    [manifest, declared, focusOn],
  );

  // Changer la distance déclarée relance le calcul sur la même position.
  useEffect(() => {
    if (lastFix.current && loc.phase === 'result') {
      void analyse(lastFix.current.fix, lastFix.current.mode, undefined, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [declared]);

  // Nouvelle correction de PK : on recalcule le PK affiché à la même position.
  useEffect(() => {
    if (lastFix.current && loc.phase === 'result') {
      void analyse(lastFix.current.fix, lastFix.current.mode, loc.chosen?.code, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [corrVersion]);

  const locate = () => {
    if (PREVIEW) {
      setLoc({ phase: 'error', message: 'Le GPS est bloqué dans cet aperçu. Cherche une gare ou zoome sur une ligne, puis appuie longuement sur la carte à côté des voies : l’appli calcule le PK de ce point.' });
      return;
    }
    stopFollowing();
    setPicked(null);
    setExpanded(false);
    setLoc({ phase: 'acquiring', fix: null, elapsed: 0 });
    const acq = acquire((fix, elapsed) => {
      setLoc({ phase: 'acquiring', fix, elapsed });
      setMe(meFeatures(fix.lonlat, fix.accuracy, null));
    });
    acquisition.current = acq;
    acq.promise
      .then((fix) => analyse(fix, 'gps'))
      .catch((e) => setLoc({ phase: 'error', message: geoErrorMessage(e) }))
      .finally(() => {
        acquisition.current = null;
      });
  };

  const analyseRef = useRef(analyse);
  analyseRef.current = analyse;

  const stopFollowing = () => {
    stopFollow.current?.();
    stopFollow.current = null;
    pendingFix.current = null;
    releaseAwake.current?.();
    releaseAwake.current = null;
    followLine.current = null;
    setFollowing(false);
    setFollowPk(null);
    setFollowAt(null);
    setMapFree(false);
    setAwake(null);
  };

  /**
   * Suivi en direct : chaque position GPS est rattachée à la ligne en cours, le PK est lissé
   * puis affiché au mètre. La carte reste libre ; elle ne bouge que si le point va sortir de l'écran.
   */
  const startFollowing = () => {
    if (!('geolocation' in navigator)) return;
    stopFollowing();
    setFollowing(true);
    setExpanded(false);
    pkFilter.current.reset();
    followLine.current = loc.phase === 'result' ? (loc.chosen?.code ?? null) : null;
    if (lastFix.current) focusOn(lastFix.current.fix.lonlat);
    releaseAwake.current = keepScreenOn(setAwake);
    // Les positions arrivent plus vite que le calcul parfois : on traite toujours la plus récente.
    const run = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        while (pendingFix.current && stopFollow.current) {
          const fix = pendingFix.current;
          pendingFix.current = null;
          const chosen = await analyseRef.current(fix, 'suivi', lastFix.current?.forced, false, followLine.current);
          if (!stopFollow.current) break;
          followLine.current = chosen?.code ?? null;
          setFollowPk(chosen ? pkFilter.current.update(chosen.code, chosen.pk, fix.accuracy, fix.time) : null);
          setFollowAt(fix.lonlat);
        }
      } finally {
        busy.current = false;
      }
    };
    stopFollow.current = follow(
      (fix) => {
        pendingFix.current = fix;
        void run();
      },
      (e) => {
        // Tunnel, tranchée : le GPS se tait un moment, le suivi continue. Seul un refus l'arrête.
        if (e.code === e.PERMISSION_DENIED) {
          setLoc({ phase: 'error', message: geoErrorMessage(e) });
          stopFollowing();
        }
      },
    );
  };

  const toggleFollow = () => (following ? stopFollowing() : startFollowing());

  const recenter = () => {
    setMapFree(false);
    const at = followAt ?? lastFix.current?.fix.lonlat;
    if (at) focusOn(at);
  };

  const placeHere = (at: LonLat) => {
    stopFollowing();
    setPicked(null);
    void analyse({ lonlat: at, accuracy: 5, samples: 1, time: Date.now() }, 'manuel');
  };

  const closeLocate = () => {
    acquisition.current?.cancel();
    stopFollowing();
    setLoc({ phase: 'idle' });
    setMe(null);
    lastFix.current = null;
  };

  const toggleFilter = (k: FilterKey) => setFilters((f) => ({ ...f, [k]: !f[k] }));

  const showToast = (text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = setTimeout(() => setToast(null), 6000);
  };

  /** « Aller au PK » : position du PK sur la ligne, distance depuis ma position, accès proches. */
  const goToPk = async (code: string, input: number | string) => {
    const pk = typeof input === 'number' ? input : parsePk(input);
    if (pk === null) return showToast('PK non reconnu : écris par exemple 45,2 ou 45+200.');
    try {
      const doc = await loadLine(code);
      const positions = positionsAtPk(doc, pk);
      if (!positions.length) {
        const [lo, hi] = pkRange(doc);
        return showToast(`Le PK ${fmtPk(pk)} n’est pas sur la ligne ${fmtLine(code)} (PK ${fmtPk(lo)} à ${fmtPk(hi)}).`);
      }
      setPicked(null);
      setTargetExpanded(false);
      setTarget({ code, pk, doc, positions, idx: 0, dest: { name: `PK ${fmtPk(pk)}`, lonlat: positions[0].lonlat } });
      focusOn(positions[0].lonlat, 15);
    } catch {
      showToast('Ligne indisponible pour le moment (pas de réseau ?).');
    }
  };

  /** Envoi d'un signalement ou d'un repère créé sur ce téléphone. */
  const submitTeam = (item: NewItem) => {
    void eq.envoyer(item);
    setPanel('none');
    showToast(navigator.onLine ? 'Enregistré, envoi en cours…' : 'Enregistré sur le téléphone : envoi au retour du réseau.');
  };

  /** Sur ordinateur, le panneau du chantier reste ouvert à côté de la carte. */
  const wide = () => window.matchMedia('(min-width: 900px)').matches;

  /** Change d'onglet ; « intent » prépare la page (filtre, ajout, fiche à ouvrir). */
  const go = (t: Tab, data?: SigIntent | { ajout?: boolean }) => {
    setTab(t);
    setIntent(data ? { data, n: Date.now() } : null);
    setPicked(null);
    if (t !== 'carte') setTeamPick(null);
  };

  /** Ouvre la fiche d'un signalement ou d'un repère et centre la carte dessus. */
  const openTeamItem = async (id: string, at: LonLat | null) => {
    setPanel('none');
    if (!wide()) setTab('carte');
    setPicked(null);
    setTeamPick(id);
    if (at) return focusOn(at, 16);
    const r = eq.view.reperes.find((x) => x.id === id);
    if (r?.ligne && r.pk !== null) {
      try {
        const doc = await loadLine(r.ligne);
        const mid = positionsAtPk(doc, (r.pk + (r.pk_fin ?? r.pk)) / 2)[0];
        if (mid) focusOn(mid.lonlat, 14);
      } catch {
        /* ligne indisponible */
      }
    }
  };

  const openSignal = () => {
    setPicked(null);
    if (!eq.session?.chantierId) return go('accueil');
    setPanel('signal');
    if (loc.phase !== 'result') locate();
  };

  /** Centre la carte sur la zone du chantier (milieu entre ses PK de début et de fin). */
  const showChantier = async (keepPanel = false) => {
    const c = eq.etat?.chantier ?? eq.session?.chantiers.find((x) => x.id === eq.session?.chantierId);
    if (!c?.ligne || c.pk_debut === null) return;
    try {
      const doc = await loadLine(c.ligne);
      const mid = positionsAtPk(doc, (c.pk_debut + (c.pk_fin ?? c.pk_debut)) / 2)[0];
      if (!mid) return showToast('PK du chantier introuvables sur la ligne.');
      if (!keepPanel && !wide()) {
        setPanel('none');
        setTab('carte');
      }
      focusOn(mid.lonlat, Math.abs((c.pk_fin ?? c.pk_debut) - c.pk_debut) > 3 ? 12 : 14);
    } catch {
      showToast('Ligne indisponible pour le moment (pas de réseau ?).');
    }
  };
  const inChantier = !!eq.session?.chantierId && eq.session.compte.role !== 'admin';

  // Chantier ouvert (connexion, changement) : la carte se place sur sa zone si on ne s'est pas encore repéré.
  const openedChantier = eq.session?.chantierId ?? null;
  const locIdle = loc.phase === 'idle';
  useEffect(() => {
    if (openedChantier && locIdle) void showChantier(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedChantier]);

  const position = positionFrom(loc);

  const origin: Origin | null =
    loc.phase === 'result' && loc.chosen ? { code: loc.chosen.code, pk: loc.chosen.pk, lonlat: loc.fix.lonlat } : null;

  const targetFC = useMemo<FeatureCollection | null>(() => {
    if (!target) return null;
    const at = target.positions[target.idx].lonlat;
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { label: `PK ${fmtPk(target.pk)}`, n: `PK ${fmtPk(target.pk)}`, c: target.code }, geometry: { type: 'Point', coordinates: at } }],
    };
  }, [target]);
  const accesFC = useMemo(() => accesFeatures(acces), [acces]);

  const importAcces = async (src: File | string) => {
    setImportStatus({ busy: true, text: '' });
    try {
      const { title, points } = await readAccesSource(src);
      if (!points.length) throw new Error('Aucun point trouvé dans ce fichier.');
      const items = await snapAcces(points);
      const name = title || (typeof src === 'string' ? 'Carte Google My Maps' : src.name.replace(/\.(kml|kmz|geojson|json)$/i, ''));
      const next = [...acces, { id: String(Date.now()), name, imported: Date.now(), items }];
      if (!saveAcces(next)) throw new Error('Le téléphone a refusé l’enregistrement (stockage plein ?).');
      setAcces(next);
      setFilters((f) => ({ ...f, acces: true }));
      const snapped = items.filter((a) => a.code).length;
      setImportStatus({ busy: false, text: `${items.length} accès importés, dont ${snapped} rattachés à une ligne avec leur PK.` });
    } catch (e) {
      setImportStatus({ busy: false, error: true, text: e instanceof Error ? e.message : 'Import impossible.' });
    }
  };

  const deleteSet = (id: string) => {
    const next = acces.filter((s) => s.id !== id);
    saveAcces(next);
    setAcces(next);
    setImportStatus(null);
  };

  const showSet = (set: AccesSet) => {
    if (!set.items.length) return;
    const lon = set.items.reduce((a, x) => a + x.lonlat[0], 0) / set.items.length;
    const lat = set.items.reduce((a, x) => a + x.lonlat[1], 0) / set.items.length;
    setPanel('none');
    focusOn([lon, lat], 11);
  };

  const acknowledge = () => {
    savePref('rr-ack-v1', true);
    setAck(true);
  };
  const role = eq.session?.compte.role ?? null;
  const showLogin = !PREVIEW && ((!eq.session && !entered) || (!!linkCode && eq.session?.code !== linkCode));
  const tabs = !!role && !showLogin;
  // Onglet inconnu pour ce rôle (changement de compte) : retour à l'accueil.
  const curTab: Tab = role && tabsFor(role).includes(tab) ? tab : 'accueil';
  const moiId = eq.etat?.moi.id;
  const badges = {
    signalements: eq.etat?.gere
      ? eq.view.signalements.filter((x) => statutOf(x) === 'nouveau').length
      : eq.view.signalements.filter((x) => x.assigne_id === moiId && statutOf(x) !== 'traite').length,
  };
  const pageKey = `${curTab}-${intent?.n ?? 0}`;
  const currentLine = loc.phase === 'result' && loc.chosen ? { code: loc.chosen.code, pk: loc.chosen.pk } : null;
  const pages =
    tabs && curTab !== 'carte' ? (
      <div className="pages">
        {curTab === 'accueil' && (
          <HomePage
            key={pageKey}
            eq={eq}
            currentLine={currentLine}
            onGo={go}
            onSignal={openSignal}
            onRepere={() => setPanel('repere')}
            onRapport={(r) => {
              setRapport(r);
              setPanel('rapport');
            }}
            onShowChantier={() => void showChantier()}
            onLocate={() => {
              go('carte');
              locate();
            }}
            onOpenItem={(id, at) => void openTeamItem(id, at)}
            onLogout={() => {
              const warn = eq.pending.length ? `\n${eq.pending.length} envoi(s) en attente seront perdus.` : '';
              if (window.confirm(`Se déconnecter de ce téléphone ?${warn}`)) {
                eq.deconnecter();
                setEntered(false);
                setTab('accueil');
              }
            }}
          />
        )}
        {curTab === 'signalements' && (
          <SignalementsPage
            key={pageKey}
            eq={eq}
            intent={(intent?.data as SigIntent) ?? null}
            onSignal={openSignal}
            onMap={(id, at) => void openTeamItem(id, at)}
          />
        )}
        {curTab === 'equipe' && <EquipePage key={pageKey} eq={eq} intent={(intent?.data as { ajout?: boolean }) ?? null} />}
        {curTab === 'chefs' && <ChefsPage key={pageKey} eq={eq} intent={(intent?.data as { ajout?: boolean }) ?? null} />}
        {curTab === 'corrections' && (
          <CorrectionsPage
            eq={eq}
            onFocusAt={(at) => {
              if (!wide()) setTab('carte');
              focusOn(at, 17);
            }}
          />
        )}
      </div>
    ) : null;

  return (
    <div className={`app ${tabs ? 'with-tabs' : ''} ${tabs && curTab !== 'carte' ? 'page-open' : ''}`}>
      <MapView
        key={mapKey}
        basemap={basemap}
        filters={filters}
        me={me}
        target={targetFC}
        acces={accesFC}
        team={teamFC}
        pkfix={pkfix}
        focus={focus}
        keepInView={following && !mapFree ? followAt : null}
        onUserMove={() => {
          if (stopFollow.current) setMapFree(true);
        }}
        onFeature={(f, at) => {
          if (TEAM_LAYERS.has(f.layer.id) && f.properties?.id) {
            setPicked(null);
            setTeamPick(String(f.properties.id));
          } else {
            setTeamPick(null);
            setPicked({ f, at });
          }
        }}
        onLongPress={(at) => placeHere(at)}
        onMapTap={() => setPicked(null)}
      />

      <header className="topbar">
        <Search
          manifest={manifest}
          currentLine={(loc.phase === 'result' && loc.chosen?.code) || eq.etat?.chantier.ligne || null}
          onGo={focusOn}
          onPk={(code, pk) => void goToPk(code, pk)}
        />
        <button className="icon-btn raised" onClick={() => setPanel('filters')} aria-label="Couches et fond de carte">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 3 2 8l10 5 10-5-10-5Zm-8.4 9L2 13l10 5 10-5-1.6-1-8.4 4.2L3.6 12Zm0 4L2 17l10 5 10-5-1.6-1-8.4 4.2L3.6 16Z" fill="currentColor" />
          </svg>
        </button>
        {!PREVIEW && <button className="icon-btn raised" onClick={() => setPanel('offline')} aria-label="Hors-ligne">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
            <path d="M12 3v11m0 0 4.5-4.5M12 14 7.5 9.5M4 17v3h16v-3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
        </button>}
        {!PREVIEW && !eq.session && (
          <button className="icon-btn raised team-btn" onClick={() => setEntered(false)} aria-label="Se connecter">
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm7 0a3 3 0 1 0 0-6M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1m1-7a5 5 0 0 1 5 5v2" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
            </svg>
            {eq.pending.length > 0 && <span className="badge-count">{eq.pending.length}</span>}
          </button>
        )}
        <button className="icon-btn raised" onClick={() => setPanel('info')} aria-label="À propos et sources">
          <b>i</b>
        </button>
      </header>

      {dataError && <div className="toast error">Données indisponibles : {dataError}</div>}
      {toast && (
        <div className="toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}

      <div className="fab-zone">
        {PREVIEW && loc.phase === 'idle' && !picked && <div className="hint">Aperçu sans GPS : appui long sur la carte = me placer ici</div>}
        {inChantier && (
          <button className="fab fab-signal" onClick={openSignal}>
            ⚠ Signaler
          </button>
        )}
        <button className="fab" onClick={locate} disabled={loc.phase === 'acquiring'}>
          {loc.phase === 'acquiring' ? 'GPS…' : 'Me repérer'}
        </button>
      </div>

      {teamPick && (
        <TeamCard
          eq={eq}
          id={teamPick}
          onClose={() => setTeamPick(null)}
          onOpenSig={eq.session ? (id) => go('signalements', { open: id }) : undefined}
        />
      )}

      {picked && loc.phase !== 'acquiring' && (
        <FeatureCard feature={picked.f} at={picked.at} manifest={manifest} onPlaceHere={placeHere} onClose={() => setPicked(null)} />
      )}

      {target ? (
        <TargetSheet
          target={target}
          origin={origin}
          acces={acces}
          filters={filters}
          expanded={targetExpanded}
          onToggleExpand={() => setTargetExpanded((e) => !e)}
          onPosition={(idx) =>
            setTarget((t) => t && { ...t, idx, dest: { name: `PK ${fmtPk(t.pk)}`, lonlat: t.positions[idx].lonlat } })
          }
          onDest={(dest) => setTarget((t) => t && { ...t, dest })}
          onFocus={(at) => focusOn(at, 16)}
          onClose={() => setTarget(null)}
        />
      ) : (
      <LocatePanel
        state={loc}
        manifest={manifest}
        filters={filters}
        declared={declared}
        expanded={expanded}
        following={following}
        followPk={followPk}
        awake={awake}
        mapFree={mapFree}
        onToggleFollow={PREVIEW ? undefined : toggleFollow}
        onRecenter={recenter}
        onToggleExpand={() => setExpanded((e) => !e)}
        onDeclared={setDeclared}
        onChoose={(code) => lastFix.current && void analyse(lastFix.current.fix, lastFix.current.mode, code, false)}
        onGoPk={(code, text) => void goToPk(code, text)}
        acces={acces}
        onCorrect={() => {
          if (loc.phase !== 'result' || !loc.chosen) return;
          setCorrTarget({
            ligne: loc.chosen.code, lineName: loc.doc?.name ?? null, at: loc.fix.lonlat,
            accuracy: loc.mode === 'manuel' ? null : Math.round(loc.fix.accuracy), manual: loc.mode === 'manuel',
            pkRaw: loc.chosen.pkRaw, pkShown: loc.chosen.pk,
          });
          setPanel('correction');
        }}
        onSignal={inChantier ? openSignal : undefined}
        onRepere={eq.etat?.gere ? () => setPanel('repere') : undefined}
        onFocus={(at) => focusOn(at, 17)}
        onStopAcquire={() => acquisition.current?.cancel()}
        onClose={closeLocate}
      />
      )}

      {panel === 'filters' && (
        <FilterSheet
          filters={filters}
          basemap={basemap}
          onToggle={toggleFilter}
          onBasemap={setBasemap}
          acces={acces}
          importStatus={importStatus}
          onImport={(src) => void importAcces(src)}
          onDeleteSet={deleteSet}
          onShowSet={showSet}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'offline' && (
        <OfflineSheet
          manifest={manifest}
          onChanged={() => {
            railSource.reset();
            setMapKey((k) => k + 1);
          }}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'info' && <InfoSheet manifest={manifest} onClose={() => setPanel('none')} />}
      {panel === 'correction' && corrTarget && (
        <CorrectionForm
          target={corrTarget}
          auteur={eq.session?.compte.nom ?? ''}
          code={eq.session?.code ?? null}
          onDone={(msg) => {
            setPanel('none');
            showToast(msg);
          }}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'signal' && (
        <SignalForm pos={position} locating={loc.phase === 'acquiring'} onLocate={locate} onSubmit={submitTeam} onClose={() => setPanel('none')} />
      )}
      {panel === 'repere' && (
        <RepereForm
          pos={position}
          locating={loc.phase === 'acquiring'}
          defaultLine={eq.etat?.chantier.ligne ?? null}
          onLocate={locate}
          onSubmit={submitTeam}
          onClose={() => setPanel('none')}
        />
      )}
      {panel === 'rapport' && eq.etat && <RapportForm eq={eq} existing={rapport} onClose={() => setPanel('none')} />}
      {pages}
      {tabs && <TabBar role={role!} tab={curTab} onTab={(t) => go(t)} badges={badges} />}
      {ack && !PREVIEW && panel === 'none' && !showLogin && (!eq.session || tab === 'carte') && <InstallBanner />}
      {showLogin && (
        <LoginScreen
          eq={eq}
          linkCode={linkCode}
          onSkip={() => {
            acknowledge();
            setLinkCode(null);
            setEntered(true);
          }}
          onConnected={() => {
            acknowledge();
            setLinkCode(null);
            setEntered(true);
            go('accueil');
          }}
        />
      )}
      {PREVIEW && !ack && (
        <Disclaimer
          onAccept={() => {
            savePref('rr-ack-v1', true);
            setAck(true);
          }}
        />
      )}
    </div>
  );
}
