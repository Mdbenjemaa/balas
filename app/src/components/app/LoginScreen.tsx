import { useEffect, useRef, useState } from 'react';
import { normCode } from '../../lib/equipe/api';
import type { Equipe } from '../../lib/equipe/useEquipe';
import { errText, Icon } from './ui';

/** Code collé tel quel depuis le message reçu (lien « #code=… » ou « code personnel : XXXX-XXXX »). */
export function codeFromText(text: string): string {
  const link = /[#&?]code=([A-Za-z0-9-]{8,16})/.exec(text);
  if (link) return normCode(link[1]);
  const labelled = /code[^:]*:\s*([A-Za-z0-9]{4,8}-?[A-Za-z0-9]{4,8})/i.exec(text);
  if (labelled) return normCode(labelled[1]);
  return normCode(text).slice(0, 16);
}

/** Écran d'accueil : connexion avec le code personnel, ou carte sans compte. */
export function LoginScreen(p: {
  eq: Equipe;
  /** Code reçu par lien (SMS, WhatsApp) : rempli et envoyé tout seul. */
  linkCode?: string | null;
  onSkip: () => void;
  onConnected: () => void;
}) {
  const [code, setCode] = useState(p.linkCode ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tried = useRef(false);

  const go = async (value = code) => {
    setBusy(true);
    setErr(null);
    try {
      await p.eq.connecter(value);
      p.onConnected();
    } catch (e) {
      setErr(e instanceof Error && /Accès refusé/.test(e.message) ? 'Code inconnu ou compte désactivé. Vérifie le code reçu.' : errText(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (p.linkCode && !tried.current) {
      tried.current = true;
      void go(p.linkCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.linkCode]);

  const ready = normCode(code).length >= 8;
  const shown = normCode(code).replace(/^(.{4})(.+)$/, '$1-$2');

  return (
    <div className="login">
      <div className="login-hero">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={72} height={72} />
        <h1>Repère Rail</h1>
        <p>Ton PK, ton chantier, ton équipe.</p>
      </div>

      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) void go();
        }}
      >
        <label htmlFor="rr-code">Code personnel</label>
        <input
          id="rr-code"
          className="text code-input"
          value={shown}
          onChange={(e) => setCode(e.target.value.length > 18 ? codeFromText(e.target.value) : normCode(e.target.value).slice(0, 16))}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (t.length > 18) {
              e.preventDefault();
              setCode(codeFromText(t));
            }
          }}
          placeholder="XXXX-XXXX"
          autoCapitalize="characters"
          autoComplete="one-time-code"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Code personnel"
        />
        {p.eq.sync.error && !err && <p className="warn-box small">{p.eq.sync.error}</p>}
        {err && <p className="error">{err}</p>}
        <button className="btn primary wide btn-big" type="submit" disabled={busy || !ready}>
          {busy ? 'Connexion…' : 'Se connecter'}
        </button>
        <p className="muted small login-help">
          Agents : le code t’est envoyé par ton chef de chantier. Chefs : par l’administrateur. Tu restes connecté sur ce
          téléphone jusqu’à « Se déconnecter ».
        </p>
      </form>

      <div className="login-or">
        <span>ou</span>
      </div>
      <button className="btn wide login-skip" onClick={p.onSkip}>
        <Icon name="map" />
        <span>
          <b>Continuer sans compte</b>
          <small>Carte, PK, gares, PN, accès</small>
        </span>
      </button>

      <p className="login-note">
        <b>Aide au repérage, jamais une référence de sécurité.</b> PK et signaux calculés à partir de données ouvertes
        (SNCF Réseau, OpenStreetMap) : ils peuvent être faux ou périmés. Ne t’en sers pas pour une annonce, une protection
        de chantier ou une manœuvre ; vérifie toujours sur le terrain et dans les documents officiels.
      </p>
    </div>
  );
}
