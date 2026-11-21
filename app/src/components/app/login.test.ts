import { describe, expect, it } from 'vitest';
import { codeFromText } from './LoginScreen';

describe('codeFromText (code collé depuis le message reçu)', () => {
  const msg =
    'Bonjour Karim, voici ton accès à Repère Rail pour le chantier « RVB ».\n' +
    'Ouvre ce lien pour te connecter directement : https://mdbenjemaa.github.io/balas/#code=B7KRMD3V\n' +
    'Ton code personnel : B7KR-MD3V (garde-le pour toi).';
  it('prend le code du lien', () => expect(codeFromText(msg)).toBe('B7KRMD3V'));
  it('prend le code après « code personnel : »', () => expect(codeFromText('Ton code personnel : abcd-2345 (garde-le)')).toBe('ABCD2345'));
  it('nettoie un code tapé', () => expect(codeFromText('abcd 2345')).toBe('ABCD2345'));
});
