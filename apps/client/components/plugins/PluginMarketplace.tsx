'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { GuildPluginStatus, MarketplacePlugin } from '@/lib/types';

const statusLabels: Record<GuildPluginStatus, string> = {
  INSTALLED: 'Enabled',
  DISABLED: 'Disabled',
  SUSPENDED: 'Suspended',
  UNAVAILABLE: 'Unavailable',
};

function statusClass(status: GuildPluginStatus | null) {
  if (status === 'INSTALLED') return 'badge-live';
  if (status === 'UNAVAILABLE' || status === 'SUSPENDED') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-300';
  return '';
}

export function PluginMarketplace({ guildId }: { guildId: string }) {
  const [plugins, setPlugins] = useState<MarketplacePlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [filter, setFilter] = useState<'all' | 'installed' | 'free' | 'premium'>('all');
  const [credentialInput, setCredentialInput] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const data = await api<MarketplacePlugin[] | { plugins: MarketplacePlugin[] }>(`/guilds/${guildId}/plugins`);
      setPlugins(Array.isArray(data) ? data : data.plugins);
    } catch (err: any) {
      setError(err?.message || 'Failed to load plugins.');
    } finally {
      setLoading(false);
    }
  }, [guildId]);

  useEffect(() => { void load(); }, [load]);

  const visiblePlugins = useMemo(() => plugins.filter((plugin) => {
    if (filter === 'installed') return plugin.installationStatus !== null;
    if (filter === 'free') return plugin.type === 'FREE';
    if (filter === 'premium') return plugin.type === 'PREMIUM';
    return true;
  }), [filter, plugins]);

  const mutate = async (plugin: MarketplacePlugin, action: 'install' | 'enable' | 'disable' | 'uninstall') => {
    if (action === 'uninstall' && !window.confirm(`Uninstall ${plugin.name}? Its commands and saved connection will be removed from this server.`)) return;
    try {
      setPending(`${plugin.id}:${action}`);
      setError('');
      setSuccess('');
      const method = action === 'install' ? 'POST' : action === 'uninstall' ? 'DELETE' : 'PATCH';
      const suffix = action === 'install' ? 'install' : action;
      await api(`/guilds/${guildId}/plugins/${plugin.id}${action === 'uninstall' ? '' : `/${suffix}`}`, { method });
      await load();
      const pastTense = action === 'install' ? 'installed' : action === 'uninstall' ? 'uninstalled' : action === 'disable' ? 'disabled' : 'enabled';
      setSuccess(`${plugin.name} ${pastTense}.`);
    } catch (err: any) {
      setError(err?.message || `Failed to ${action} plugin.`);
    } finally {
      setPending(null);
    }
  };

  const configureKinetic = async (plugin: MarketplacePlugin) => {
    const token = credentialInput.trim();
    if (!token) {
      setError('Enter your Kinetic API key first.');
      return;
    }
    if (token.length > 512) {
      setError('The Kinetic API key is too long.');
      return;
    }
    try {
      setPending(`${plugin.id}:credential`);
      setError('');
      setSuccess('');
      await api(`/guilds/${guildId}/plugins/${plugin.id}/credentials`, {
        method: 'PUT',
        body: JSON.stringify({ token }),
      });
      setCredentialInput('');
      await load();
      setSuccess('Kinetic Hosting connected. Your API key is stored securely and is never shown again.');
    } catch (err: any) {
      setError(err?.message || 'Kinetic could not verify that API key.');
    } finally {
      setPending(null);
    }
  };

  const removeKineticCredential = async (plugin: MarketplacePlugin) => {
    if (!window.confirm('Remove the saved Kinetic API key from this server?')) return;
    try {
      setPending(`${plugin.id}:remove-credential`);
      setError('');
      setSuccess('');
      await api(`/guilds/${guildId}/plugins/${plugin.id}/credentials`, { method: 'DELETE' });
      await load();
      setSuccess('Kinetic API key removed.');
    } catch (err: any) {
      setError(err?.message || 'Failed to remove the Kinetic API key.');
    } finally {
      setPending(null);
    }
  };

  return (
    <div>
      {error && <div className="notice notice-error mb-6" role="alert">{error}</div>}
      {success && <div className="notice notice-success mb-6" role="status">{success}</div>}

      <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Plugin filters">
        {[
          ['all', 'All plugins'],
          ['installed', 'Installed'],
          ['free', 'Free'],
          ['premium', 'Premium'],
        ].map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value as typeof filter)} className={`btn px-3 py-2 text-xs ${filter === value ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : ''}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="card flex min-h-48 items-center justify-center p-8 text-sm text-[var(--muted)]">Loading plugin marketplace...</div>
      ) : visiblePlugins.length === 0 ? (
        <div className="card p-8 text-center text-sm text-[var(--muted)]">No plugins match this filter.</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visiblePlugins.map((plugin) => {
            const status = plugin.installationStatus;
            const unavailable = !plugin.available || status === 'UNAVAILABLE';
            const premiumLocked = plugin.type === 'PREMIUM' && plugin.entitlementStatus !== 'ACTIVE';
            const busy = pending?.startsWith(`${plugin.id}:`);
            const kinetic = plugin.id === 'kinetic-hosting';
            return (
              <article key={plugin.id} className="card flex flex-col p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-bold text-[var(--text)]">{plugin.name}</h2>
                    <p className="mt-1 text-xs text-[var(--muted)]">v{plugin.version}</p>
                  </div>
                  <span className="badge">{plugin.type}</span>
                </div>
                <p className="mt-5 min-h-16 text-sm leading-6 text-[var(--muted)]">{plugin.description}</p>
                {status && <span className={`badge mt-4 w-fit ${statusClass(status)}`}>{statusLabels[status]}</span>}
                {kinetic && <p className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] p-3 text-xs leading-5 text-[var(--muted)]">Connect your own Kinetic Panel API key. It is encrypted on the server and never displayed or shared with other guilds.</p>}
                {kinetic && status === 'INSTALLED' && (
                  <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-strong)] p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">Kinetic connection</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{plugin.credentialConfigured ? 'API key configured' : 'API key required before commands can run'}</p>
                      </div>
                      <span className={`h-2.5 w-2.5 rounded-full ${plugin.credentialConfigured ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    </div>
                    <label className="mt-4 block">
                      <span className="field-label">{plugin.credentialConfigured ? 'Replace API key' : 'Kinetic API key'}</span>
                      <input type="password" autoComplete="new-password" value={credentialInput} onChange={(event) => setCredentialInput(event.target.value)} placeholder={plugin.credentialConfigured ? 'Enter a new key to replace it' : 'Paste your Kinetic API key'} className="input" disabled={busy} />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary" disabled={busy || !credentialInput.trim()} onClick={() => void configureKinetic(plugin)}>{busy ? 'Verifying...' : plugin.credentialConfigured ? 'Update key' : 'Connect key'}</button>
                      {plugin.credentialConfigured && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void removeKineticCredential(plugin)}>Remove key</button>}
                    </div>
                  </div>
                )}
                <div className="mt-auto flex flex-wrap gap-2 pt-6">
                  {!status && !unavailable && !premiumLocked && <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void mutate(plugin, 'install')}>{busy ? 'Installing...' : 'Install'}</button>}
                  {premiumLocked && <span className="self-center text-xs font-semibold text-[var(--muted)]">Entitlement required</span>}
                  {unavailable && <span className="self-center text-xs font-semibold text-[var(--muted)]">Not available in this deployment</span>}
                  {status === 'INSTALLED' && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void mutate(plugin, 'disable')}>{busy ? 'Working...' : 'Disable'}</button>}
                  {status === 'DISABLED' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void mutate(plugin, 'enable')}>{busy ? 'Working...' : 'Enable'}</button>}
                  {status && status !== 'UNAVAILABLE' && <button type="button" className="btn btn-danger" disabled={busy} onClick={() => void mutate(plugin, 'uninstall')}>Uninstall</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
