import { describe, expect, it } from 'vitest';
import { myMapsId } from './mymaps';

describe('myMapsId', () => {
  const mid = '1oeyXu-CaX1E22M5pai0_5YWSs0QeXzU';
  it('trouve la carte dans le lien réseau d’un KMZ My Maps', () => {
    expect(myMapsId(`<Link><href>https://www.google.fr/maps/d/kml?mid=${mid}</href></Link>`)).toBe(mid);
    expect(myMapsId(`<href>https://www.google.com/maps/d/kml?forcekml=1&amp;mid=${mid}&amp;lid=abc</href>`)).toBe(mid);
  });
  it('trouve la carte dans les liens partagés', () => {
    expect(myMapsId(`https://www.google.fr/mymaps/viewer?mid=${mid}&hl=fr`)).toBe(mid);
    expect(myMapsId(`https://www.google.com/maps/d/viewer?mid=${mid}&ll=48.5,2.6&z=12`)).toBe(mid);
    expect(myMapsId(`https://www.google.com/maps/d/u/0/edit?mid=${mid}&usp=sharing`)).toBe(mid);
  });
  it('refuse ce qui n’est pas Google My Maps', () => {
    expect(myMapsId(`https://exemple.fr/maps/d/kml?mid=${mid}`)).toBe(null);
  });
});
