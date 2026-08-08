import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CredentialEncryptionService } from '../credential-encryption.service';

const DEFAULT_BASE_URL = 'https://kineticpanel.net';
const MAX_ITEMS = 25;
const MAX_TEXT = 3500;
const PLUGIN_ID = 'kinetic-hosting';

@Injectable()
export class KineticHostingService {
  private readonly baseUrl = (process.env.KINETIC_PANEL_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
  ) {}

  private async token(guildId: string) {
    if (!guildId) throw new Error('Kinetic Hosting requires a guild');
    const credential = await this.prisma.guildPluginCredential.findUnique({
      where: { guildId_pluginId: { guildId, pluginId: PLUGIN_ID } },
      select: { encryptedToken: true },
    });
    if (!credential) throw new Error('Kinetic Hosting API key is not configured for this server');
    return this.encryption.decrypt(credential.encryptedToken);
  }

  private serverId(value: unknown) {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(id)) throw new Error('Invalid Kinetic server identifier');
    return id;
  }

  private async request(guildId: string, path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal || AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${await this.token(guildId)}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`Kinetic API request failed (${response.status})`);
    return response.json() as Promise<any>;
  }

  private compact(value: any) {
    const data = Array.isArray(value) ? value : value?.data || value?.servers || value?.players || value;
    return JSON.stringify(data, (_key, item) => typeof item === 'string' && item.length > 300 ? `${item.slice(0, 300)}…` : item).slice(0, MAX_TEXT);
  }

  async validateToken(token: string) {
    const value = token.trim();
    if (!value || value.length > 512) throw new Error('Kinetic API key is invalid');
    const response = await fetch(`${this.baseUrl}/api/client?page=1&per_page=1`, {
      signal: AbortSignal.timeout(10_000),
      headers: { Accept: 'application/json', Authorization: `Bearer ${value}` },
    });
    if (!response.ok) throw new Error('Kinetic API key could not be verified');
  }

  async listServers(guildId: string) {
    return this.compact(await this.request(guildId, '/api/client?page=1&per_page=50&include=allocations'));
  }

  async serverStatus(guildId: string, server: unknown) {
    const id = this.serverId(server);
    const [details, resources] = await Promise.all([
      this.request(guildId, `/api/client/servers/${encodeURIComponent(id)}`),
      this.request(guildId, `/api/client/servers/${encodeURIComponent(id)}/resources`),
    ]);
    return this.compact({ details, resources });
  }

  async onlinePlayers(guildId: string, server: unknown) {
    const id = this.serverId(server);
    return this.compact(await this.request(guildId, `/api/client/servers/${encodeURIComponent(id)}/players`));
  }

  limit(value: string) {
    return value.slice(0, MAX_TEXT);
  }

  maxItems() {
    return MAX_ITEMS;
  }
}
