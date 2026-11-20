import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { MapGeoJSONFeature } from 'maplibre-gl';
import { LocatePanel, type LocateState } from './components/LocatePanel';
import { Disclaimer, FeatureCard, FilterSheet, InfoSheet, OfflineSheet, Search, type ImportStatus } from './components/Sheets';
import { TargetSheet, type Origin, type TargetState } from './components/TargetSheet';
import { accesFeatures, loadAcces, readAccesFile, saveAcces, snapAcces, type AccesSet } from './lib/acces';
import { fmtLine, fmtPk } from './lib/format';
import { parsePk, pkRange, positionsAtPk } from './lib/pk';
import { loadCell, loadLine, loadManifest, type Manifest } from './lib/data';
import type { LonLat } from './lib/geo';
import { acquire, follow, geoErrorMessage, type Acquisition, type Fix } from './lib/gps';
import { DEFAULT_FILTERS, type FilterKey, type Filters } from './lib/layers';
import { cellsAround, matchInCells, pickLine, searchRadius } from './lib/locate';
import { loadPref, meFeatures, savePref } from './lib/me';
import { MapView, railSource, type FocusRequest } from './map/MapView';
import { PREVIEW } from './lib/env';
import type { Basemap } from './map/style';

type Panel = 'none' | 'filters' | 'offline' | 'info';

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
  const acquisition = useRef<Acquisition | null>(null);
  const stopFollow = useRef<(() => void) | null>(null);
  const busy = useRef(false);
  const lastFix = useRef<{ fix: Fix; mode: 'gps' | 'manuel' | 'suivi'; forced?: string } | null>(null);

  useEffect(() => {
    loadManifest().then(setManifest, (e: Error) => setDataError(e.message));
  }, []);
  useEffect(() => savePref('rr-filters', filters), [filters]);
  useEffect(() => savePref('rr-basemap', basemap), [basemap]);
  useEffect(() => savePref('rr-distance', declared), [declared]);

  const focusOn = useCallback((center: LonLat, zoom?: number) => setFocus((f) => ({ center, zoom, seq: (f?.seq ?? 0) + 1 })), []);

  /** Rattache une position aux lignes proches et prépare l'affichage. */
  const analyse = useCallback(
    async (fix: Fix, mode: 'gps' | 'manuel' | 'suivi', forcedCode?: string, recenter = true) => {
      const m = manifest ?? (await loadManifest());
      lastFix.current = { fix, mode, forced: forcedCode };
      const radius = searchRadius(fix.accuracy, declared);
      const known = new Set(m.cells);
      const cells = (
        await Promise.all(cellsAround(fix.lonlat, radius, m.cellsPerDegree).map((k) => loadCell(k, known)))
      ).filter((c) => c !== null);
      const match = matchInCells(cells, fix.lonlat, radius);
      const chosen = (forcedCode && match.lines.find((l) => l.code === forcedCode)) || pickLine(match.lines, declared);
      const doc = chosen ? await loadLine(chosen.code).catch(() => null) : null;
      setLoc({ phase: 'result', fix, mode, radius, match, chosen: chosen ?? null, doc });
      setMe(meFeatures(fix.lonlat, fix.accuracy, chosen?.point ?? null));
      if (recenter) focusOn(fix.lonlat, mode === 'suivi' ? undefined : 17);
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

  const stopFollowing = () => {
    stopFollow.current?.();
    stopFollow.current = null;
    setFollowing(false);
  };

  const toggleFollow = () => {
    if (following) return stopFollowing();
    if (!('geolocation' in navigator)) return;
    setFollowing(true);
    stopFollow.current = follow(
      async (fix) => {
        if (busy.current) return;
        busy.current = true;
        try {
          await analyse(fix, 'suivi', lastFix.current?.forced, true);
        } finally {
          busy.current = false;
        }
      },
      (e) => {
        setLoc({ phase: 'error', message: geoErrorMessage(e) });
        stopFollowing();
      },
    );
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

  const importAcces = async (file: File) => {
    setImportStatus({ busy: true, text: '' });
    try {
      const { title, points } = await readAccesFile(file);
      if (!points.length) throw new Error('Aucun point trouvé dans ce fichier.');
      const items = await snapAcces(points);
      const name = title || file.name.replace(/\.(kml|kmz|geojson|json)$/i, '');
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

  return (
    <div className="app">
      <MapView
        key={mapKey}
        basemap={basemap}
        filters={filters}
        me={me}
        target={targetFC}
        acces={accesFC}
        focus={focus}
        onFeature={(f, at) => setPicked({ f, at })}
        onLongPress={(at) => placeHere(at)}
        onMapTap={() => setPicked(null)}
      />

      <header className="topbar">
        <Search manifest={manifest} onGo={focusOn} onPk={(code, pk) => void goToPk(code, pk)} />
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
        {loc.phase === 'result' && loc.mode !== 'manuel' && (
          <button className={`pill ${following ? 'on' : ''}`} onClick={toggleFollow}>
            {following ? '● Suivi actif' : 'Suivre en marchant'}
          </button>
        )}
        <button className="fab" onClick={locate} disabled={loc.phase === 'acquiring'}>
          {loc.phase === 'acquiring' ? 'GPS…' : 'Me repérer'}
        </button>
      </div>

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
        onToggleExpand={() => setExpanded((e) => !e)}
        onDeclared={setDeclared}
        onChoose={(code) => lastFix.current && void analyse(lastFix.current.fix, lastFix.current.mode, code, false)}
        onGoPk={(code, text) => void goToPk(code, text)}
        acces={acces}
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
          onImport={(f) => void importAcces(f)}
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
      {!ack && (
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
