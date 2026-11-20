import { useState } from 'react';
import type { AccesSet } from '../lib/acces';
import type { LineDoc, LinePoint, Manifest } from '../lib/data';
import { fmtDist, fmtLine, fmtPk } from '../lib/format';
import type { Fix } from '../lib/gps';
import { kindVisible, KIND_BADGE, type Filters } from '../lib/layers';
import type { LineCandidate, Match } from '../lib/locate';
import { aroundPk, sectionAt, statutAt, type AroundItem } from '../lib/nearby';

export type LocateState =
  | { phase: 'idle' }
  | { phase: 'acquiring'; fix: Fix | null; elapsed: number }
  | { phase: 'error'; message: string }
  | {
      phase: 'result';
      fix: Fix;
      mode: 'gps' | 'manuel' | 'suivi';
      radius: number;
      match: Match;
      chosen: LineCandidate | null;
      doc: LineDoc | null;
    };

export const DISTANCES: { value: number | null; label: string }[] = [
  { value: null, label: 'Je ne sais pas' },
  { value: 0, label: 'Sur la voie' },
  { value: 5, label: '5 m' },
  { value: 10, label: '10 m' },
  { value: 15, label: '15 m' },
  { value: 20, label: '20 m' },
];

interface Props {
  state: LocateState;
  manifest: Manifest | null;
  filters: Filters;
  declared: number | null;
  expanded: boolean;
  following: boolean;
  onToggleExpand: () => void;
  onDeclared: (d: number | null) => void;
  onChoose: (code: string) => void;
  onGoPk: (code: string, text: string) => void;
  acces: AccesSet[];
  onFocus: (at: [number, number]) => void;
  onStopAcquire: () => void;
  onClose: () => void;
}

function Badge({ kind }: { kind: string }) {
  const b = KIND_BADGE[kind] ?? { text: '?', color: '#6b7280', name: kind };
  return (
    <span className="badge" style={{ background: b.color }} title={b.name}>
      {b.text}
    </span>
  );
}

function ItemRow({ it, onFocus }: { it: AroundItem; onFocus: (at: [number, number]) => void }) {
  return (
    <li>
      <button className="item" onClick={() => onFocus(it.lonlat)}>
        <Badge kind={it.kind} />
        <span className="item-main">
          <b>{it.label}</b>
          {it.detail && <small>{it.detail}</small>}
        </span>
        <span className="item-side">
          <b>{fmtDist(it.dist)}</b>
          <small>PK {fmtPk(it.pk)}</small>
        </span>
      </button>
    </li>
  );
}

/** Saisie « Aller au PK » sur la ligne où l'on se trouve. */
function PkForm({ onGo }: { onGo: (text: string) => void }) {
  const [text, setText] = useState('');
  return (
    <form
      className="pk-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim()) onGo(text);
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <label htmlFor="go-pk">Aller au PK</label>
      <input
        id="go-pk"
        value={text}
        onChange={(e) => setText(e.target.value)}
        inputMode="decimal"
        placeholder="ex. 45,2 ou 45+200"
        enterKeyHint="go"
        autoComplete="off"
      />
      <button className="btn btn-small" type="submit" disabled={!text.trim()}>
        Go
      </button>
    </form>
  );
}

export function LocatePanel(p: Props) {
  const { state } = p;
  if (state.phase === 'idle') return null;

  if (state.phase === 'acquiring') {
    return (
      <section className="sheet sheet-peek" aria-live="polite">
        <div className="sheet-head">
          <div>
            <div className="eyebrow">Repérage GPS en cours…</div>
            <div className="big">{state.fix ? `± ${Math.round(state.fix.accuracy)} m` : 'Recherche des satellites'}</div>
            <div className="muted">
              {state.fix ? `${state.fix.samples} mesure(s) · ${Math.round(state.elapsed / 1000)} s` : 'Reste immobile, téléphone vers le ciel.'}
            </div>
          </div>
          <button className="btn" onClick={p.onStopAcquire}>
            Utiliser
          </button>
        </div>
      </section>
    );
  }

  if (state.phase === 'error') {
    return (
      <section className="sheet sheet-peek">
        <div className="sheet-head">
          <div className="error">{state.message}</div>
          <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
            ×
          </button>
        </div>
      </section>
    );
  }

  const { fix, match, chosen, doc, mode, radius } = state;
  const name = chosen ? (p.manifest?.lines[chosen.code]?.n ?? doc?.name) : null;
  const tracks = chosen ? match.tracks.filter((t) => t.code === chosen.code).slice(0, 3) : [];
  const accesHere: LinePoint[] = chosen
    ? p.acces.flatMap((set) =>
        set.items
          .filter((a) => a.code === chosen.code && a.pk !== undefined)
          .map((a): LinePoint => [a.pk!, 'acces', a.name, a.desc.split('\n')[0] ?? '', a.lonlat[0], a.lonlat[1]]),
      )
    : [];
  const around =
    doc && chosen ? aroundPk({ ...doc, points: doc.points.concat(accesHere) }, chosen.pk, (k) => kindVisible(p.filters, k)) : null;
  const vmax = doc && chosen ? sectionAt(doc, 'vmax', chosen.pk) : null;
  const elec = doc && chosen ? sectionAt(doc, 'elec', chosen.pk) : null;
  const cant = doc && chosen ? sectionAt(doc, 'cant', chosen.pk) : null;
  const kvb = doc && chosen ? sectionAt(doc, 'kvb', chosen.pk) : null;
  const ecart = doc && chosen ? sectionAt(doc, 'ecart', chosen.pk) : null;
  const statut = doc && chosen ? statutAt(doc, chosen.pk) : null;
  const others = match.lines.filter((l) => l.code !== chosen?.code);
  const declaredMismatch =
    chosen && p.declared !== null && Math.abs(chosen.dist - p.declared) > Math.max(10, fix.accuracy * 1.5);

  return (
    <section className={`sheet ${p.expanded ? 'sheet-full' : 'sheet-peek'}`} aria-live="polite">
      <button className="grab" onClick={p.onToggleExpand} aria-label={p.expanded ? 'Réduire' : 'Agrandir'} />
      <div className="sheet-head">
        {chosen ? (
          <div className="pk-block" onClick={p.onToggleExpand}>
            <div className="eyebrow">
              Ligne {fmtLine(chosen.code)}
              {mode === 'manuel' ? ' · position placée à la main' : mode === 'suivi' ? ' · suivi en continu' : ''}
            </div>
            <div className="pk">PK {fmtPk(chosen.pk)}</div>
            <div className="muted">
              {name ?? 'Ligne sans nom'} · à {Math.round(chosen.dist)} m de l’axe{mode !== 'manuel' && ` · GPS ± ${Math.round(fix.accuracy)} m`}
            </div>
          </div>
        ) : (
          <div>
            <div className="eyebrow">Aucune ligne trouvée</div>
            <div className="muted">
              Pas de ligne SNCF à moins de {radius} m (GPS ± {Math.round(fix.accuracy)} m). Rapproche-toi des voies ou indique une
              distance plus grande.
            </div>
          </div>
        )}
        <button className="icon-btn" onClick={p.onClose} aria-label="Fermer">
          ×
        </button>
      </div>

      <div className="sheet-body">
        {chosen && <PkForm onGo={(text) => p.onGoPk(chosen.code, text)} />}
        <div className="field-label">Ma distance aux voies</div>
        <div className="chips">
          {DISTANCES.map((d) => (
            <button key={String(d.value)} className={`chip ${p.declared === d.value ? 'on' : ''}`} onClick={() => p.onDeclared(d.value)}>
              {d.label}
            </button>
          ))}
        </div>
        {declaredMismatch && (
          <p className="warn">
            La ligne est mesurée à {Math.round(chosen!.dist)} m, loin des {p.declared} m indiqués : vérifie la ligne ci-dessous.
          </p>
        )}

        {tracks.length > 0 && (
          <p className="muted small">
            Voie la plus proche (indicatif) :{' '}
            {tracks.map((t, i) => (
              <span key={t.name}>
                {i > 0 && ' · '}
                <b>{t.name}</b> {Math.round(t.dist)} m
              </span>
            ))}
          </p>
        )}

        {others.length > 0 && (
          <>
            <div className="field-label">Autres lignes proches</div>
            <div className="chips">
              {others.slice(0, 5).map((l) => (
                <button key={l.code} className="chip" onClick={() => p.onChoose(l.code)}>
                  {fmtLine(l.code)} · {Math.round(l.dist)} m · PK {fmtPk(l.pk)}
                </button>
              ))}
            </div>
          </>
        )}

        {chosen && (
          <dl className="facts">
            {statut && (
              <>
                <dt>Statut</dt>
                <dd>{statut}</dd>
              </>
            )}
            {vmax && (
              <>
                <dt>Vitesse nominale</dt>
                <dd>{vmax} km/h</dd>
              </>
            )}
            <dt>Électrification</dt>
            <dd>{elec ?? 'Non électrifiée (ou non renseigné)'}</dd>
            {cant && (
              <>
                <dt>Cantonnement</dt>
                <dd>{cant}</dd>
              </>
            )}
            <dt>KVB</dt>
            <dd>{kvb ? 'Ligne équipée' : 'Non renseigné'}</dd>
            {ecart && (
              <>
                <dt>Écartement</dt>
                <dd>{ecart}</dd>
              </>
            )}
          </dl>
        )}

        {around && around.inside.length > 0 && (
          <>
            <div className="field-label">Vous êtes dans</div>
            <ul className="items">
              {around.inside.map((it, i) => (
                <ItemRow key={`in-${i}`} it={it} onFocus={p.onFocus} />
              ))}
            </ul>
          </>
        )}
        {around && (
          <div className="sides">
            <div>
              <div className="field-label">↑ Vers les PK croissants</div>
              {around.ahead.length ? (
                <ul className="items">
                  {around.ahead.map((it, i) => (
                    <ItemRow key={`a-${i}`} it={it} onFocus={p.onFocus} />
                  ))}
                </ul>
              ) : (
                <p className="muted small">Rien dans les 15 km (selon les filtres).</p>
              )}
            </div>
            <div>
              <div className="field-label">↓ Vers les PK décroissants</div>
              {around.behind.length ? (
                <ul className="items">
                  {around.behind.map((it, i) => (
                    <ItemRow key={`b-${i}`} it={it} onFocus={p.onFocus} />
                  ))}
                </ul>
              ) : (
                <p className="muted small">Rien dans les 15 km (selon les filtres).</p>
              )}
            </div>
          </div>
        )}
        <p className="disclaimer">
          Aide au repérage, à vérifier sur le terrain (bornes, pancartes). Jamais pour l’annonce, la protection ou une manœuvre :
          seuls les documents et consignes officiels font foi.
        </p>
      </div>
    </section>
  );
}
