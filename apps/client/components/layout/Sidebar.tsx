'use client';

import { usePathname } from 'next/navigation';

type SidebarProps = {
  guildId?: string;
};

const guildLinks = [
  ['Overview', (guildId: string) => `/dashboard/${guildId}`, true],
  ['Plugins', (guildId: string) => `/dashboard/${guildId}/plugins`, false],
  ['Stickers', (guildId: string) => `/dashboard/${guildId}/stickers`, false],
  ['Moderation', (guildId: string) => `/dashboard/${guildId}/moderation`, false],
  ['Booster Roles', (guildId: string) => `/dashboard/${guildId}/booster-roles`, false],
  ['Tako Rewards', (guildId: string) => `/dashboard/${guildId}/tako`, false],
  ['Embed Studio', (guildId: string) => `/dashboard/${guildId}/embed-templates`, false],
  ['Analytics', (guildId: string) => `/dashboard/${guildId}/analytics`, false],
  ['Leaderboard', (guildId: string) => `/leaderboard/${guildId}`, false],
  ['Audit Logs', (guildId: string) => `/dashboard/${guildId}/audit-logs`, false],
  ['Settings', (guildId: string) => `/dashboard/${guildId}/settings`, false],
] as const;

export function Sidebar({ guildId }: SidebarProps) {
  const pathname = usePathname();
  const links = guildId ? guildLinks.map(([label, getHref, exact]) => ({ label, href: getHref(guildId), exact })) : [{ label: 'Servers', href: '/dashboard', exact: true }];

  return (
    <aside className="hidden min-h-screen w-64 shrink-0 border-r border-[var(--border)] bg-[var(--panel)] px-5 py-6 backdrop-blur-md lg:block">
      <a href="/dashboard" className="block text-xl font-black tracking-tight text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">
        nio
      </a>
      <nav className="mt-8 space-y-1" aria-label="Dashboard navigation">
        <a
          href="/dashboard"
          className="mb-4 block rounded-md px-3 py-2 text-sm font-medium text-[var(--muted)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          All servers
        </a>
        {links.map((link) => {
          const isActive = link.exact ? pathname === link.href : pathname.startsWith(link.href);
          return (
            <a
              key={link.href}
              href={link.href}
              aria-current={isActive ? 'page' : undefined}
              className={`block rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isActive
                  ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                  : 'text-[var(--text-secondary)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)]'
              }`}
            >
              {link.label}
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
