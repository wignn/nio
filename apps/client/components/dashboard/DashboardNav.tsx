'use client';

type DashboardNavProps = {
  guildId: string;
  activeTab: 'panels' | 'plugins' | 'analytics' | 'audit-logs' | 'settings' | 'stickers' | 'moderation' | 'booster-roles' | 'tako' | 'embed-templates' | 'leaderboard';
};

const tabs = [
  ['panels', 'Overview', (guildId: string) => `/dashboard/${guildId}`],
  ['plugins', 'Plugins', (guildId: string) => `/dashboard/${guildId}/plugins`],
  ['stickers', 'Stickers', (guildId: string) => `/dashboard/${guildId}/stickers`],
  ['moderation', 'Moderation', (guildId: string) => `/dashboard/${guildId}/moderation`],
  ['booster-roles', 'Booster Roles', (guildId: string) => `/dashboard/${guildId}/booster-roles`],
  ['tako', 'Tako Rewards', (guildId: string) => `/dashboard/${guildId}/tako`],
  ['embed-templates', 'Embed Studio', (guildId: string) => `/dashboard/${guildId}/embed-templates`],
  ['analytics', 'Analytics', (guildId: string) => `/dashboard/${guildId}/analytics`],
  ['leaderboard', 'Leaderboard', (guildId: string) => `/leaderboard/${guildId}`],
  ['audit-logs', 'Audit Logs', (guildId: string) => `/dashboard/${guildId}/audit-logs`],
  ['settings', 'Settings', (guildId: string) => `/dashboard/${guildId}/settings`],
] as const;

export function DashboardNav({ guildId, activeTab }: DashboardNavProps) {
  return (
    <nav className="mb-8 flex gap-2 overflow-x-auto whitespace-nowrap border-b border-[var(--border)] pb-3 lg:hidden" aria-label="Server navigation">
      {tabs.map(([id, label, href]) => (
        <a
          key={id}
          href={href(guildId)}
          aria-current={id === activeTab ? 'page' : undefined}
          className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
            id === activeTab
              ? 'bg-indigo-600 text-white dark:bg-indigo-500'
              : 'text-[var(--text-secondary)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]'
          }`}
        >
          {label}
        </a>
      ))}
    </nav>
  );
}
