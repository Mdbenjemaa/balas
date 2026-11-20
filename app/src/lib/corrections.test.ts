import { describe, expect, it } from 'vitest';
import { corrige, deltaAt, setValidatedForTest, type Correction } from './corrections';

const c = (pk_app: number, pk_vrai: number, etendue: Correction['etendue'] = 'portion', ligne = '830000'): Correction => ({
  id: `${ligne}-${pk_app}`, ligne, pk_app, pk_vrai, etendue, lon: 2.4, lat: 48.8,
});

describe('corrections de PK', () => {
  it('portion : l’écart s’efface sur 1,5 km', () => {
    setValidatedForTest([c(10, 10.1)]);
    expect(deltaAt('830000', 10)).toBeCloseTo(0.1);
    expect(deltaAt('830000', 10.75)).toBeCloseTo(0.05);
    expect(deltaAt('830000', 9.25)).toBeCloseTo(0.05);
    expect(deltaAt('830000', 12)).toBe(0);
    expect(deltaAt('001000', 10)).toBe(0);
  });
  it('toute la ligne : même écart jusqu’au bout', () => {
    setValidatedForTest([c(10, 9.88, 'ligne')]);
    expect(deltaAt('830000', 300)).toBeCloseTo(-0.12);
    expect(corrige('830000', 0)).toBeCloseTo(-0.12);
  });
  it('deux bornes proches : interpolation entre elles', () => {
    setValidatedForTest([c(10, 10.1), c(13, 12.95)]);
    expect(deltaAt('830000', 11.5)).toBeCloseTo(0.025);
    expect(corrige('830000', 13)).toBeCloseTo(12.95);
  });
  it('le PK corrigé reste croissant', () => {
    setValidatedForTest([c(10, 10.15), c(11, 10.95)]);
    let prev = -Infinity;
    for (let pk = 8; pk <= 13; pk += 0.01) {
      const v = corrige('830000', pk);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
