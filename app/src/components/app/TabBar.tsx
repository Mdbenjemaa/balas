import type { Role } from '../../lib/equipe/api';
import { Icon, type IconName } from './ui';

export type Tab = 'accueil' | 'carte' | 'signalements' | 'equipe' | 'chefs' | 'corrections';

const TABS: Record<Role, { key: Tab; label: string; icon: IconName }[]> = {
  chef: [
    { key: 'accueil', label: 'Accueil', icon: 'home' },
    { key: 'carte', label: 'Carte', icon: 'map' },
    { key: 'signalements', label: 'Signalements', icon: 'alert' },
    { key: 'equipe', label: 'Équipe', icon: 'users' },
  ],
  agent: [
    { key: 'accueil', label: 'Accueil', icon: 'home' },
    { key: 'carte', label: 'Carte', icon: 'map' },
    { key: 'signalements', label: 'Signalements', icon: 'alert' },
  ],
  admin: [
    { key: 'accueil', label: 'Accueil', icon: 'home' },
    { key: 'carte', label: 'Carte', icon: 'map' },
    { key: 'chefs', label: 'Chefs', icon: 'users' },
    { key: 'corrections', label: 'Corrections', icon: 'ruler' },
  ],
};

export const tabsFor = (role: Role) => TABS[role].map((t) => t.key);

/** Barre d'onglets en bas de l'écran (comptes connectés). */
export function TabBar(p: { role: Role; tab: Tab; onTab: (t: Tab) => void; badges?: Partial<Record<Tab, number>> }) {
  return (
    <nav className="tabbar" aria-label="Navigation">
      {TABS[p.role].map((t) => {
        const n = p.badges?.[t.key] ?? 0;
        return (
          <button key={t.key} className={`tab ${p.tab === t.key ? 'on' : ''}`} onClick={() => p.onTab(t.key)} aria-current={p.tab === t.key ? 'page' : undefined}>
            <span className="tab-ico">
              <Icon name={t.icon} size={24} />
              {n > 0 && <span className="tab-badge">{n > 99 ? '99+' : n}</span>}
            </span>
            <span className="tab-label">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
