import { DashboardNav } from '@/components/dashboard/DashboardNav';
import { PluginMarketplace } from '@/components/plugins/PluginMarketplace';

export default async function PluginsPage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Extensions</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text)]">Plugin Marketplace</h1>
          <p className="mt-1 max-w-2xl text-[var(--muted)]">Install optional features for this server. Each guild controls its own plugins and command visibility.</p>
        </div>
        <DashboardNav guildId={guildId} activeTab="plugins" />
        <PluginMarketplace guildId={guildId} />
      </div>
    </main>
  );
}
