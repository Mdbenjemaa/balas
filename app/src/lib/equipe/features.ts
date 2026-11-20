import type { FeatureCollection, Feature } from 'geojson';
import { loadLine } from '../data';
import { fmtPk } from '../format';
import { lineBetween } from '../pk';
import { choice, GRAVITES, NATURES, repereChoices } from './catalog';
import type { View } from './store';

/** Couche de carte du chantier : zones, repères, panneaux, signalements. */
export async function teamFeatures(view: View): Promise<FeatureCollection> {
  const features: Feature[] = [];
  for (const r of view.reperes) {
    const c = choice(repereChoices(r.categorie), r.type);
    const props = {
      k: r.categorie, id: r.id, n: r.nom || c.label, col: r.etat === 'retire' ? '#9ca3af' : c.color,
      ret: r.etat === 'retire' ? 1 : 0, pend: r.pending ? 1 : 0,
    };
    if (r.categorie === 'zone' && r.ligne && r.pk !== null && r.pk_fin !== null) {
      try {
        const doc = await loadLine(r.ligne);
        const parts = lineBetween(doc, r.pk, r.pk_fin);
        if (parts.length) {
          features.push({
            type: 'Feature',
            properties: { ...props, n: `${r.nom || c.label} · PK ${fmtPk(r.pk)} → ${fmtPk(r.pk_fin)}` },
            geometry: { type: 'MultiLineString', coordinates: parts },
          });
        }
      } catch {
        /* ligne indisponible hors-ligne : la zone reste dans la liste */
      }
    } else if (r.lon !== null && r.lat !== null) {
      features.push({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } });
    }
  }
  for (const s of view.signalements) {
    features.push({
      type: 'Feature',
      properties: {
        k: 'sig', id: s.id, n: choice(NATURES, s.nature).label, col: choice(GRAVITES, s.gravite).color,
        urg: s.gravite === 'urgent' ? 1 : 0, pend: s.pending ? 1 : 0,
      },
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    });
  }
  return { type: 'FeatureCollection', features };
}
