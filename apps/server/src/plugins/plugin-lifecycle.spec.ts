import { describe, expect, it, jest } from '@jest/globals';
import { GuildPluginStatus, PluginType } from '@prisma/client';
import { PluginAccessService } from './plugin-access.service';

describe('plugin lifecycle access', () => {
  it('denies expired premium entitlement', async () => {
    const prisma = {
      guildPlugin: { findMany: jest.fn(async () => [{ pluginId: 'premium', plugin: { id: 'premium', type: PluginType.PREMIUM, active: true } }]) },
      guildEntitlement: { findFirst: jest.fn(async () => null) },
    } as any;
    const registry = { get: jest.fn(() => ({ id: 'premium' })) } as any;
    const service = new PluginAccessService(prisma, registry);

    await expect(service.canUse('guild', 'premium')).resolves.toBe(false);
  });

  it('excludes disabled installations before command sync', async () => {
    const prisma = {
      guildPlugin: { findMany: jest.fn(async () => []) },
      guildEntitlement: { findFirst: jest.fn() },
    } as any;
    const registry = { get: jest.fn(), list: jest.fn() } as any;
    const service = new PluginAccessService(prisma, registry);

    await expect(service.getActivePlugins('guild')).resolves.toEqual([]);
    expect(prisma.guildPlugin.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { guildId: 'guild', status: GuildPluginStatus.INSTALLED, plugin: { active: true } },
    }));
  });
});
