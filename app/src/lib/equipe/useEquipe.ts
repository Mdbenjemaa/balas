import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, normCode, type Etat } from './api';
import {
  cacheEtat, dropItem, enqueue, flushOutbox, loadCachedEtat, loadOutbox, loadSession, mergePending, saveSession,
  type NewItem, type OutItem, type Session,
} from './store';

export interface Sync {
  busy: boolean;
  offline: boolean;
  error: string | null;
  last: number | null;
}

export interface Equipe {
  session: Session | null;
  /** Données du chantier ouvert. */
  etat: Etat | null;
  view: ReturnType<typeof mergePending>;
  pending: OutItem[];
  sync: Sync;
  refresh: () => Promise<void>;
  connecter: (code: string) => Promise<void>;
  deconnecter: () => void;
  choisir: (chantierId: string | null) => void;
  envoyer: (item: NewItem) => Promise<void>;
  abandonner: (id: string) => Promise<void>;
}

/** Compte connecté (code personnel), chantier ouvert, données et file d'envoi hors-ligne. */
export function useEquipe(): Equipe {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [etat, setEtat] = useState<Etat | null>(null);
  const [pending, setPending] = useState<OutItem[]>([]);
  const [sync, setSync] = useState<Sync>({ busy: false, offline: false, error: null, last: null });
  const running = useRef(false);
  const sessionRef = useRef(session);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const update = useCallback((s: Session | null) => {
    sessionRef.current = s;
    saveSession(s);
    setSession(s);
  }, []);

  const refresh = useCallback(async () => {
    const s = sessionRef.current;
    if (!s || running.current) return;
    running.current = true;
    setSync((x) => ({ ...x, busy: true }));
    try {
      const out = await flushOutbox(s.code);
      setPending(out.items);
      if (out.offline) {
        setSync((x) => ({ ...x, busy: false, offline: true, error: null }));
        return;
      }
      // Liste des chantiers à jour (nouvelle affectation, chantier archivé…).
      let cx;
      try {
        cx = await api.connexion(s.code);
      } catch (e) {
        if (e instanceof ApiError && e.denied) {
          // Code renouvelé ou compte désactivé : retour à l'écran de connexion.
          setEtat(null);
          update(null);
          setSync({ busy: false, offline: false, error: 'Ton code n’est plus valable (renouvelé ou compte désactivé). Demande ton nouveau code.', last: null });
          return;
        }
        throw e;
      }
      let chantierId = s.chantierId;
      if (chantierId && !cx.chantiers.some((c) => c.id === chantierId)) chantierId = null;
      if (!chantierId && cx.chantiers.length === 1 && cx.compte.role === 'agent') chantierId = cx.chantiers[0].id;
      const next: Session = { ...s, compte: cx.compte, chantiers: cx.chantiers, chantierId };
      if (sessionRef.current?.code !== s.code) return;
      update(next);
      if (chantierId) {
        const e = await api.etat(s.code, chantierId);
        if (sessionRef.current?.chantierId !== chantierId) return;
        setEtat(e);
        void cacheEtat(e);
      } else {
        setEtat(null);
      }
      setSync({ busy: false, offline: false, error: null, last: Date.now() });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(String(e), 0);
      setSync((x) => ({ ...x, busy: false, offline: err.offline, error: err.offline ? null : err.message }));
    } finally {
      running.current = false;
    }
  }, [update]);

  // Chantier ouvert : données gardées sur le téléphone, puis mise à jour.
  const chantierId = session?.chantierId ?? null;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [cached, items] = await Promise.all([chantierId ? loadCachedEtat(chantierId) : undefined, loadOutbox()]);
      if (cancelled) return;
      setEtat(cached ?? null);
      setPending(items);
      void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [chantierId, refresh]);

  // Relance : retour du réseau, appli rouverte, et toutes les minutes.
  const connected = !!session;
  useEffect(() => {
    if (!connected) return;
    const kick = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', kick);
    const timer = setInterval(kick, 60_000);
    return () => {
      window.removeEventListener('online', kick);
      document.removeEventListener('visibilitychange', kick);
      clearInterval(timer);
    };
  }, [connected, refresh]);

  const view = useMemo(() => mergePending(etat, pending), [etat, pending]);

  return {
    session,
    etat,
    view,
    pending,
    sync,
    refresh,
    async connecter(code) {
      const c = normCode(code);
      const cx = await api.connexion(c);
      const only = cx.compte.role === 'agent' && cx.chantiers.length === 1 ? cx.chantiers[0].id : null;
      setEtat(null);
      update({ code: c, compte: cx.compte, chantiers: cx.chantiers, chantierId: only });
      setSync({ busy: false, offline: false, error: null, last: Date.now() });
    },
    deconnecter() {
      setEtat(null);
      update(null);
    },
    choisir(id) {
      const s = sessionRef.current;
      if (!s || s.chantierId === id) return;
      setEtat(null);
      update({ ...s, chantierId: id });
    },
    async envoyer(item) {
      const s = sessionRef.current;
      const chantier = item.chantier ?? s?.chantierId;
      if (!s || !chantier) return;
      setPending(await enqueue({ ...item, chantier } as OutItem));
      void refresh();
    },
    async abandonner(id) {
      setPending(await dropItem(id));
    },
  };
}
