import { Injectable } from '@nestjs/common';

const DEFAULT_BASE_URL = 'https://kineticpanel.net';
const MAX_ITEMS = 25;
const MAX_TEXT = 3500;

@Injectable()
export class KineticHostingService {
  private readonly baseUrl = (process.env.KINETIC_PANEL_URL || DEFAULT_BASE_URL).replace(/\/$/, '');

  private token() {
    const token = process.env.KINETIC_PANEL_TOKEN?.trim();
    if (!token) throw new Error('Kinetic Hosting is not configured');
    return token;
  }

  private serverId(value: unknown) {
    const id = String(value || '').trim();
    if (!/^[A-Za-z0-9_-]{3,128}$/.test(id)) throw new Error('Invalid Kinetic server identifier');
    return id;
  }

  private async request(path: string, init: RequestInit = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      signal: init.signal || AbortSignal.timeout(10_000),
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.token()}`,
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

  async listServers() {
    return this.compact(await this.request('/api/client?page=1&per_page=50&include=allocations'));
  }

  async serverStatus(server: unknown) {
    const id = this.serverId(server);
    const [details, resources] = await Promise.all([
      this.request(`/api/client/servers/${encodeURIComponent(id)}`),
      this.request(`/api/client/servers/${encodeURIComponent(id)}/resources`),
    ]);
    return this.compact({ details, resources });
  }

  async onlinePlayers(server: unknown) {
    const id = this.serverId(server);
    return this.compact(await this.request(`/api/client/servers/${encodeURIComponent(id)}/players`));
  }

  limit(value: string) {
    return value.slice(0, MAX_TEXT);
  }

  maxItems() {
    return MAX_ITEMS;
  }
}
