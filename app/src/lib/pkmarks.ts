import type { Feature, FeatureCollection } from 'geojson';
import { correctedLines } from './corrections';
import { loadLine } from './data';
import { fmtPk } from './format';
import { decodeGeom } from './pk';

/**
 * Repères PK (tous les 100 m) recalculés pour les lignes qui ont des corrections de bornes.
 * Sur ces lignes, la carte masque les repères d'origine et affiche ceux-ci à la place.
 */
export async function correctedPkMarks(): Promise<{ codes: string[]; fc: FeatureCollection }> {
  const codes = correctedLines();
  const features: Feature[] = [];
  for (const code of codes) {
    let doc;
    try {
      doc = await loadLine(code);
    } catch {
      continue;
    }
    for (const t of doc.troncons) {
      if (!t.g) continue;
      const v = decodeGeom(t.g);
      for (let i = 0; i + 1 < v.length; i++) {
        const [ax, ay, ap] = v[i];
        const [bx, by, bp] = v[i + 1];
        if (ap === bp) continue;
        const lo = Math.min(ap, bp);
        const hi = Math.max(ap, bp);
        // Hectomètres rencontrés sur ce segment (le premier sommet compte, le dernier non : pas de doublon).
        for (let k = Math.ceil(lo * 10 - 1e-9); k / 10 < hi - 1e-9 || (k / 10 <= hi && i + 2 === v.length); k++) {
          const pk = k / 10;
          if (pk === bp && i + 2 !== v.length) continue;
          const f = (pk - ap) / (bp - ap);
          const km = k % 10 === 0;
          features.push({
            type: 'Feature',
            properties: { c: code, km: km ? 1 : 0, p: km ? String(pk) : fmtPk(pk) },
            geometry: { type: 'Point', coordinates: [ax + (bx - ax) * f, ay + (by - ay) * f] },
          });
        }
      }
    }
  }
  return { codes, fc: { type: 'FeatureCollection', features } };
}
