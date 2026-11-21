import { useState } from 'react';
import { fmtCode } from '../../lib/equipe/api';
import { Icon, prenom } from './ui';

/** Adresse de l'appli qui connecte directement avec ce code (le code reste dans le téléphone : partie « # » du lien). */
export const loginLink = (code: string) => `${location.origin}${location.pathname}#code=${code}`;

export function shareText(nom: string, code: string, role: 'agent' | 'chef', chantier?: string | null): string {
  const pour = role === 'chef' ? ' (chef de chantier)' : chantier ? ` pour le chantier « ${chantier} »` : '';
  return (
    `Bonjour ${prenom(nom)}, voici ton accès à Repère Rail${pour}.\n` +
    `Ouvre ce lien pour te connecter directement : ${loginLink(code)}\n` +
    `Ton code personnel : ${fmtCode(code)} (garde-le pour toi).`
  );
}

/**
 * Code tout juste créé : affiché une seule fois, avec l'envoi par SMS ou WhatsApp.
 * Le message contient le lien de connexion directe et le code.
 */
export function ShareCode(p: {
  nom: string;
  code: string;
  role: 'agent' | 'chef';
  chantier?: string | null;
  renouvele?: boolean;
  onDone: () => void;
}) {
  const text = shareText(p.nom, p.code, p.role, p.chantier);
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent(text);
  return (
    <div className="share">
      <div className="share-ok">
        <span className="share-check"><Icon name="check" size={30} /></span>
        <b>{p.renouvele ? `Nouveau code pour ${p.nom}` : `${p.nom} est ajouté${p.role === 'chef' ? ' comme chef' : ''}`}</b>
        <small>{p.renouvele ? 'L’ancien code ne marche plus.' : 'Envoie-lui son accès maintenant.'}</small>
      </div>

      <div className="share-code">
        <small>Code personnel</small>
        <b>{fmtCode(p.code)}</b>
      </div>

      <div className="share-btns">
        <a className="btn share-sms" href={`sms:?&body=${enc}`}>
          <Icon name="chat" /> SMS
        </a>
        <a className="btn share-wa" href={`https://wa.me/?text=${enc}`} target="_blank" rel="noreferrer">
          <Icon name="chat" /> WhatsApp
        </a>
      </div>
      <div className="share-btns">
        {typeof navigator.share === 'function' && (
          <button className="btn" onClick={() => void navigator.share({ text }).catch(() => undefined)}>
            <Icon name="share" size={18} /> Autre…
          </button>
        )}
        <button
          className="btn"
          onClick={() =>
            void navigator.clipboard
              ?.writeText(text)
              .then(() => setCopied(true))
              .catch(() => undefined)
          }
        >
          <Icon name="copy" size={18} /> {copied ? 'Copié' : 'Copier le message'}
        </button>
      </div>

      <details className="share-preview">
        <summary>Voir le message</summary>
        <p>{text}</p>
      </details>
      <p className="muted small">
        Le lien connecte {prenom(p.nom)} directement : envoie-le à lui seul. Ce code ne sera plus affiché ; tu pourras en
        créer un nouveau.
      </p>
      <button className="btn primary wide btn-big" onClick={p.onDone}>
        Terminé
      </button>
    </div>
  );
}
