'use client';

import React, { useEffect, useState, use } from 'react';
import { api } from '@/lib/api';
import { DashboardNav } from '@/components/dashboard/DashboardNav';

type ChannelOption = { id: string; name: string };
type RoleOption = { id: string; name: string; color: string; manageable: boolean };

type TakoRewardTier = {
  id?: string;
  label: string;
  thresholdAmount: number;
  roleId: string;
  position: number;
};

type TakoSettings = {
  enabled: boolean;
  creatorSlug: string | null;
  rewardRoleId: string | null;
  minimumAmount: number;
  paymentMethods: string[];
  logChannelId: string | null;
  directNotificationsEnabled: boolean;
  directNotificationChannelId: string | null;
  directNotifyMinimumAmount: number;
  rewardTiers: TakoRewardTier[];
  hasApiKey: boolean;
  hasWebhookToken: boolean;
};

type DonationLog = {
  id: string;
  discordUserId: string;
  transactionId: string | null;
  amount: number;
  paymentMethod: string;
  senderName: string;
  email: string;
  message: string | null;
  status: string;
  failureReason: string | null;
  roleAssignedAt: string | null;
  createdAt: string;
  user: {
    id: string;
    username: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
};

type PageProps = {
  params: Promise<{ guildId: string }>;
};

function Switch({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
      className={`relative inline-flex h-6 w-11 items-center rounded-full border transition-colors ${
        checked ? 'border-zinc-950 bg-zinc-950 dark:border-zinc-50 dark:bg-zinc-50' : 'border-zinc-300 bg-zinc-200 dark:border-zinc-700 dark:bg-zinc-800'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform dark:bg-zinc-950 ${checked ? 'translate-x-6' : 'translate-x-1'}`}
      />
    </button>
  );
}

export default function TakoDashboardPage({ params }: PageProps) {
  const { guildId } = use(params);
  const [activeTab, setActiveTab] = useState<'config' | 'logs'>('config');

  const [settings, setSettings] = useState<TakoSettings>({
    enabled: false,
    creatorSlug: '',
    rewardRoleId: null,
    minimumAmount: 10000,
    paymentMethods: ['qris'],
    logChannelId: null,
    directNotificationsEnabled: true,
    directNotificationChannelId: null,
    directNotifyMinimumAmount: 0,
    rewardTiers: [],
    hasApiKey: false,
    hasWebhookToken: false,
  });

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [webhookTokenInput, setWebhookTokenInput] = useState('');

  const [donations, setDonations] = useState<DonationLog[]>([]);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingRole, setCreatingRole] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [backendUrl, setBackendUrl] = useState('');

  useEffect(() => {
    // Tentukan backend public URL untuk dicopy user ke Tako
    const url = typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.hostname}${window.location.port ? ':' + window.location.port : ''}/api`
      : '/api';
    setBackendUrl(url);
    fetchData();
  }, [guildId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      const [settingsRes, channelsRes, rolesRes, donationsRes] = await Promise.all([
        api<{ ok: boolean; settings: TakoSettings }>(`/guilds/${guildId}/tako/settings`),
        api<{ ok: boolean; channels: ChannelOption[] }>(`/guilds/${guildId}/channels`),
        api<{ ok: boolean; roles: RoleOption[] }>(`/guilds/${guildId}/roles`),
        api<{ ok: boolean; donations: DonationLog[] }>(`/guilds/${guildId}/tako/donations`),
      ]);

      setSettings(settingsRes.settings);
      setChannels(channelsRes.channels || []);
      setRoles(rolesRes.roles || []);
      setDonations(donationsRes.donations || []);

      if (settingsRes.settings.hasApiKey) setApiKeyInput('__masked__');
      if (settingsRes.settings.hasWebhookToken) setWebhookTokenInput('__masked__');
    } catch (err: any) {
      setError(err?.message || 'Failed to load Tako integration settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setError('');
      setSuccess('');

      const payload: any = {
        enabled: settings.enabled,
        creatorSlug: settings.creatorSlug || '',
        rewardRoleId: settings.rewardRoleId || null,
        minimumAmount: settings.minimumAmount,
        paymentMethods: settings.paymentMethods,
        logChannelId: settings.logChannelId || null,
        directNotificationsEnabled: settings.directNotificationsEnabled,
        directNotificationChannelId: settings.directNotificationChannelId || null,
        directNotifyMinimumAmount: settings.directNotifyMinimumAmount,
        rewardTiers: settings.rewardTiers.map((tier, index) => ({
          label: tier.label,
          thresholdAmount: tier.thresholdAmount,
          roleId: tier.roleId,
          position: index,
        })),
      };

      if (apiKeyInput && apiKeyInput !== '__masked__') payload.apiKey = apiKeyInput;
      if (webhookTokenInput && webhookTokenInput !== '__masked__') payload.webhookToken = webhookTokenInput;

      const res = await api<{ ok: boolean; settings: TakoSettings }>(`/guilds/${guildId}/tako/settings`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });

      setSettings(res.settings);
      setSuccess('Settings updated successfully.');
      if (res.settings.hasApiKey) setApiKeyInput('__masked__');
      if (res.settings.hasWebhookToken) setWebhookTokenInput('__masked__');
    } catch (err: any) {
      setError(err?.message || 'Failed to save Tako settings');
    } finally {
      setSaving(false);
    }
  };

  const handleRetryRole = async (donationId: string) => {
    try {
      setError('');
      setSuccess('');
      const res = await api<{ ok: boolean; status: string; reason?: string }>(
        `/guilds/${guildId}/tako/donations/${donationId}/retry-role`,
        { method: 'POST' }
      );

      if (res.ok && res.status === 'role_assigned') {
        setSuccess('Role assigned successfully.');
        // Refresh logs
        const donationsRes = await api<{ ok: boolean; donations: DonationLog[] }>(`/guilds/${guildId}/tako/donations`);
        setDonations(donationsRes.donations || []);
      } else {
        setError(res.reason || 'Failed to assign role. Check bot permissions.');
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to retry role assignment');
    }
  };

  const togglePaymentMethod = (method: string) => {
    setSettings((prev) => {
      const selected = prev.paymentMethods.includes(method);
      return {
        ...prev,
        paymentMethods: selected
          ? prev.paymentMethods.filter((m) => m !== method)
          : [...prev.paymentMethods, method],
      };
    });
  };

  const updateRewardTier = (index: number, patch: Partial<TakoRewardTier>) => {
    setSettings((prev) => ({
      ...prev,
      rewardTiers: prev.rewardTiers.map((tier, idx) => idx === index ? { ...tier, ...patch } : tier),
    }));
  };

  const addRewardTier = () => {
    setSettings((prev) => ({
      ...prev,
      rewardTiers: [
        ...prev.rewardTiers,
        { label: '', thresholdAmount: prev.minimumAmount, roleId: '', position: prev.rewardTiers.length },
      ],
    }));
  };

  const removeRewardTier = (index: number) => {
    setSettings((prev) => ({
      ...prev,
      rewardTiers: prev.rewardTiers.filter((_, idx) => idx !== index).map((tier, idx) => ({ ...tier, position: idx })),
    }));
  };

  const createCustomRole = async (name: string, apply: (roleId: string) => void, key: string) => {
    try {
      setCreatingRole(key);
      setError('');
      setSuccess('');
      const res = await api<{ ok: boolean; role: RoleOption }>(`/guilds/${guildId}/roles`, {
        method: 'POST',
        body: JSON.stringify({ name, color: '#F59E0B' }),
      });
      setRoles((prev) => [res.role, ...prev.filter((role) => role.id !== res.role.id)]);
      apply(res.role.id);
      setSuccess(`Created role ${res.role.name}. Save settings to use it.`);
    } catch (err: any) {
      setError(err?.message || 'Failed to create custom role. Check bot Manage Roles permission and role hierarchy.');
    } finally {
      setCreatingRole(null);
    }
  };

  const webhookUrl = `${backendUrl}/guilds/${guildId}/tako/webhook`;

  return (
    <main className="px-6 py-8">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted)]">Support & Donate</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--text)]">Tako Role Rewards</h1>
            <p className="mt-1 text-[var(--muted)]">Configure automatic role assignment for members supporting via Tako donations.</p>
          </div>
          <a href={`/dashboard/${guildId}/embed-templates`} className="btn btn-secondary w-fit px-4">
            Custom Embed Templates
          </a>
        </div>

        <DashboardNav guildId={guildId} activeTab="tako" />

        {error && <div className="notice notice-error mb-6">{error}</div>}
        {success && <div className="notice notice-success mb-6">{success}</div>}

        <div className="flex gap-4 border-b border-[var(--border)] pb-px mb-6">
          <button
            onClick={() => setActiveTab('config')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'config' ? 'border-indigo-600 text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Configuration
          </button>
          <button
            onClick={() => setActiveTab('logs')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors ${
              activeTab === 'logs' ? 'border-indigo-600 text-[var(--text)]' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            Donation Logs
          </button>
        </div>

        {loading ? (
          <div className="flex h-64 items-center justify-center text-[var(--muted)]">Loading Tako integration...</div>
        ) : activeTab === 'config' ? (
          <form onSubmit={handleSaveSettings} className="space-y-6 max-w-3xl">
            <section className="card border-indigo-500/30 bg-indigo-500/5 p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text)]">Custom Embed Tampilan</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Atur tampilan pesan donasi Tako: DM sukses, announcement public, dan direct donation tanpa coding.
                  </p>
                </div>
                <a href={`/dashboard/${guildId}/embed-templates`} className="btn btn-primary w-fit px-4">
                  Buat Custom Embed
                </a>
              </div>
            </section>

            <section className="card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-[var(--text)]">Tako Integration</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">Enable or disable automatic role rewards from Tako donations.</p>
                </div>
                <Switch
                  checked={settings.enabled}
                  label="Toggle Tako integration"
                  onClick={() => setSettings((prev) => ({ ...prev, enabled: !prev.enabled }))}
                />
              </div>

              {settings.enabled && (
                <div className="mt-6 space-y-4">
                  <label className="block">
                    <span className="field-label">Tako Creator Slug</span>
                    <input
                      type="text"
                      className="input"
                      value={settings.creatorSlug || ''}
                      onChange={(e) => setSettings((prev) => ({ ...prev, creatorSlug: e.target.value }))}
                      placeholder="e.g. wignn"
                      required
                    />
                    <p className="mt-1.5 text-xs text-[var(--muted)]">Your Tako username/creator identifier in URLs (e.g. tako.id/wignn).</p>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">Tako API Key</span>
                      <input
                        type="password"
                        className="input"
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        placeholder="Paste your Tako API key"
                        required
                      />
                    </label>

                    <label className="block">
                      <span className="field-label">Tako Webhook Token</span>
                      <input
                        type="password"
                        className="input"
                        value={webhookTokenInput}
                        onChange={(e) => setWebhookTokenInput(e.target.value)}
                        placeholder="Paste your Tako Webhook Token"
                        required
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="field-label">Webhook URL (Copy to Tako Dashboard)</span>
                    <div className="flex gap-2">
                      <input type="text" className="input bg-[var(--panel-strong)] flex-1 font-mono text-xs select-all" value={webhookUrl} readOnly />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(webhookUrl);
                          alert('Copied webhook URL to clipboard!');
                        }}
                        className="btn btn-secondary px-4 text-xs h-11"
                      >
                        Copy
                      </button>
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--muted)]">Add this endpoint URL to your Tako dashboard under "Notifikasi Webhook".</p>
                  </label>
                </div>
              )}
            </section>

            {settings.enabled && (
              <>
                <section className="card p-6 space-y-4">
                  <h2 className="text-lg font-bold text-[var(--text)]">Role Rewards Configuration</h2>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="field-label">Reward Role</span>
                      <select
                        value={settings.rewardRoleId || ''}
                        onChange={(e) => setSettings((prev) => ({ ...prev, rewardRoleId: e.target.value || null }))}
                        className="input"
                        required
                      >
                        <option value="">Select a role...</option>
                        {roles.map((role) => (
                          <option key={role.id} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-secondary mt-2 h-9 px-3 text-xs"
                        disabled={creatingRole === 'base'}
                        onClick={() => createCustomRole('Tako Supporter', (roleId) => setSettings((prev) => ({ ...prev, rewardRoleId: roleId })), 'base')}
                      >
                        {creatingRole === 'base' ? 'Creating...' : 'Create custom reward role'}
                      </button>
                    </label>

                    <label className="block">
                      <span className="field-label">Minimum Donation Amount (Rp)</span>
                      <input
                        type="number"
                        min="1000"
                        className="input"
                        value={settings.minimumAmount}
                        onChange={(e) => setSettings((prev) => ({ ...prev, minimumAmount: parseInt(e.target.value) || 10000 }))}
                        required
                      />
                    </label>
                  </div>

                  <div>
                    <span className="field-label">Allowed Payment Methods</span>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {['qris', 'gopay', 'dana', 'paypal'].map((method) => {
                        const selected = settings.paymentMethods.includes(method);
                        return (
                          <label key={method} className="flex items-center gap-3 rounded-lg border border-[var(--border)] p-3 bg-[var(--surface)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => togglePaymentMethod(method)}
                              className="h-4 w-4 rounded border-zinc-300 text-zinc-950 focus:ring-zinc-950 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:ring-zinc-50"
                            />
                            <span className="text-sm font-semibold">{method.toUpperCase()}</span>
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">Cumulative Reward Tiers</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">Assign stacked Discord roles when a donor reaches total donation thresholds.</p>
                      </div>
                      <button type="button" onClick={addRewardTier} className="btn btn-secondary h-9 px-3 text-xs" disabled={settings.rewardTiers.length >= 10}>
                        Add Tier
                      </button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {settings.rewardTiers.length === 0 ? (
                        <p className="text-xs text-[var(--muted)]">No cumulative tiers configured yet.</p>
                      ) : settings.rewardTiers.map((tier, index) => (
                        <div key={tier.id || index} className="grid gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
                          <label className="block">
                            <span className="field-label">Threshold (Rp)</span>
                            <input
                              type="number"
                              min="1000"
                              className="input"
                              value={tier.thresholdAmount}
                              onChange={(e) => updateRewardTier(index, { thresholdAmount: parseInt(e.target.value) || 1000 })}
                            />
                          </label>
                          <label className="block">
                            <span className="field-label">Label</span>
                            <input
                              type="text"
                              className="input"
                              value={tier.label}
                              onChange={(e) => updateRewardTier(index, { label: e.target.value })}
                              placeholder="VIP Donatur"
                            />
                          </label>
                          <label className="block">
                            <span className="field-label">Tier Role</span>
                            <select
                              value={tier.roleId}
                              onChange={(e) => updateRewardTier(index, { roleId: e.target.value })}
                              className="input"
                            >
                              <option value="">Select a role...</option>
                              {roles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {role.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="btn btn-secondary mt-2 h-9 px-3 text-xs"
                              disabled={creatingRole === `tier-${index}`}
                              onClick={() => createCustomRole(tier.label || `Tako Tier ${index + 1}`, (roleId) => updateRewardTier(index, { roleId }), `tier-${index}`)}
                            >
                              {creatingRole === `tier-${index}` ? 'Creating...' : 'Create custom tier role'}
                            </button>
                          </label>
                          <button type="button" onClick={() => removeRewardTier(index)} className="btn btn-secondary h-11 self-end px-3 text-xs">
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>

                <section className="card p-6 space-y-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-[var(--text)]">Notifications</h2>
                      <p className="mt-1 text-sm text-[var(--muted)]">Configure notification channels here. Customize the embed text and layout in Embed Studio.</p>
                    </div>
                    <a href={`/dashboard/${guildId}/embed-templates`} className="btn btn-secondary h-9 w-fit px-3 text-xs">
                      Customize embeds
                    </a>
                  </div>

                  <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-[var(--text)]">Direct Donation Notifications</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">Send a clean Discord notification when someone donates directly from Tako without using /donate-role.</p>
                      </div>
                      <Switch
                        checked={settings.directNotificationsEnabled}
                        label="Toggle direct donation notifications"
                        onClick={() => setSettings((prev) => ({ ...prev, directNotificationsEnabled: !prev.directNotificationsEnabled }))}
                      />
                    </div>

                    {settings.directNotificationsEnabled && (
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="field-label">Notification Channel</span>
                          <select
                            value={settings.directNotificationChannelId || 'none'}
                            onChange={(e) => setSettings((prev) => ({ ...prev, directNotificationChannelId: e.target.value === 'none' ? null : e.target.value }))}
                            className="input"
                          >
                            <option value="none">Disabled</option>
                            {channels.map((ch) => (
                              <option key={ch.id} value={ch.id}>
                                #{ch.name}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="field-label">Minimum Notify Amount (Rp)</span>
                          <input
                            type="number"
                            min="0"
                            className="input"
                            value={settings.directNotifyMinimumAmount}
                            onChange={(e) => setSettings((prev) => ({ ...prev, directNotifyMinimumAmount: parseInt(e.target.value) || 0 }))}
                          />
                        </label>
                      </div>
                    )}
                  </div>
                </section>
              </>
            )}

            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="btn btn-primary px-6 py-3">
                {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </form>
        ) : (
          <section className="card overflow-hidden">
            <div className="border-b border-[var(--border)] p-6">
              <h2 className="text-lg font-bold text-[var(--text)]">Donation Logs</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">Track completed payments and role assignments from supporters.</p>
            </div>

            {donations.length === 0 ? (
              <div className="p-8 text-center text-sm text-[var(--muted)]">No donation events recorded yet.</div>
            ) : (
              <div className="overflow-x-auto p-6">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--muted)]">
                      <th className="pb-3">Donor</th>
                      <th className="pb-3">Amount</th>
                      <th className="pb-3">Transaction</th>
                      <th className="pb-3">Status</th>
                      <th className="pb-3">Date</th>
                      <th className="pb-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {donations.map((log) => (
                      <tr key={log.id} className="text-[var(--text-secondary)]">
                        <td className="py-4">
                          <div className="flex items-center gap-3">
                            {log.user.avatarUrl ? (
                              <img src={log.user.avatarUrl} alt="" className="h-9 w-9 rounded-full border border-[var(--border)]" />
                            ) : (
                              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--panel-strong)] text-xs font-bold text-[var(--muted)]">
                                {(log.user.displayName || log.user.username || log.discordUserId).charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div>
                              <div className="font-semibold text-[var(--text)]">{log.user.displayName || log.senderName}</div>
                              <div className="text-xs text-[var(--muted)]">{log.user.username ? `@${log.user.username}` : log.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-4">
                          <div className="font-semibold text-[var(--text)]">Rp{log.amount.toLocaleString('id-ID')}</div>
                          <div className="text-xs text-[var(--muted)]">{log.paymentMethod.toUpperCase()}</div>
                        </td>
                        <td className="py-4">
                          <div className="font-mono text-xs text-[var(--text)]">{log.transactionId || 'None'}</div>
                          {log.message && <div className="text-xs text-[var(--muted)] truncate max-w-xs">{log.message}</div>}
                        </td>
                        <td className="py-4">
                          <span
                            className={`badge ${
                              log.status === 'ROLE_ASSIGNED'
                                ? 'badge-live'
                                : log.status === 'FAILED'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                            }`}
                          >
                            {log.status === 'ROLE_ASSIGNED' ? 'Role Assigned' : log.status}
                          </span>
                          {log.failureReason && (
                            <div className="text-xs text-red-500 mt-1 max-w-xs leading-4" title={log.failureReason}>
                              {log.failureReason}
                            </div>
                          )}
                        </td>
                        <td className="py-4 text-[var(--muted)]">
                          {new Date(log.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                        </td>
                        <td className="py-4 text-right">
                          {(log.status === 'FAILED' || log.status === 'PAID' || log.status === 'PENDING') && (
                            <button
                              onClick={() => handleRetryRole(log.id)}
                              className="btn btn-secondary h-8 px-3 text-xs"
                            >
                              Assign Role
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
