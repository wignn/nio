export type ApiResponse<T> = { ok: true } & T;

export type GuildSummary = {
  id: string;
  name: string;
  icon?: string | null;
  iconUrl?: string | null;
  botInGuild: boolean;
  inviteUrl: string;
};

export type PanelRole = {
  id: string;
  roleId: string;
  emoji?: string | null;
  label: string;
  description?: string | null;
  buttonStyle: 'PRIMARY' | 'SECONDARY' | 'SUCCESS' | 'DANGER';
  position: number;
};

export type Panel = {
  id: string;
  guildId: string;
  channelId?: string | null;
  messageId?: string | null;
  name: string;
  title: string;
  accentText?: string | null;
  description?: string | null;
  type: 'SELF_ROLE' | 'RULES' | 'ANNOUNCEMENT' | 'LEADERBOARD';
  mode: 'BUTTONS' | 'MENU';
  style: 'PREMIUM' | 'MINIMAL' | 'COLORFUL' | 'NEON';
  color: string;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  maxRoles: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  lastPublishedAt?: string | null;
  roles: PanelRole[];
};

export type Sticker = {
  id: string;
  guildId: string;
  name: string;
  url: string;
  type: string;
  createdAt: string;
};

export type PluginType = 'FREE' | 'PREMIUM';
export type GuildPluginStatus = 'INSTALLED' | 'DISABLED' | 'SUSPENDED' | 'UNAVAILABLE';
export type EntitlementStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED' | 'PENDING';

export type MarketplacePlugin = {
  id: string;
  version: string;
  name: string;
  description: string;
  type: PluginType;
  price: number | null;
  active: boolean;
  available: boolean;
  installed: boolean;
  installationStatus: GuildPluginStatus | null;
  entitlementStatus: EntitlementStatus | null;
  entitlementExpiresAt: string | null;
  credentialConfigured: boolean;
};

export type Settings = {
  logChannelId: string | null;
  messageDeleteLogChannelId: string | null;
  stickerEnabled: boolean;
  slowmodeEnabled: boolean;
  slowmodeChannels: string[];
  slowmodeIntervalQuiet: number;
  slowmodeIntervalNormal: number;
  slowmodeIntervalBusy: number;
  anomalyEnabled: boolean;
  phishingDetectionEnabled: boolean;
  contentAnomalyEnabled: boolean;
  userAnomalyEnabled: boolean;
  guildBaselineEnabled: boolean;
  anomalyEnforcementMode: string;
};
