import type { LocateState } from '../../components/LocatePanel';
import type { LonLat } from '../geo';

/** Position utilisée pour un signalement ou un repère : la dernière localisation de l'appli. */
export interface PositionInfo {
  lonlat: LonLat;
  accuracy: number | null;
  ligne: string | null;
  pk: number | null;
  voie: string | null;
  mode: 'gps' | 'manuel' | 'suivi';
  lineName: string | null;
}

export function positionFrom(loc: LocateState): PositionInfo | null {
  if (loc.phase !== 'result') return null;
  const code = loc.chosen?.code ?? null;
  const track = code ? loc.match.tracks.filter((t) => t.code === code).sort((a, b) => a.dist - b.dist)[0] : undefined;
  return {
    lonlat: loc.fix.lonlat,
    accuracy: loc.mode === 'manuel' ? null : Math.round(loc.fix.accuracy),
    ligne: code,
    pk: loc.chosen ? Math.round(loc.chosen.pk * 1000) / 1000 : null,
    voie: track && track.dist < 25 ? track.name : null,
    mode: loc.mode,
    lineName: loc.doc?.name ?? null,
  };
}
