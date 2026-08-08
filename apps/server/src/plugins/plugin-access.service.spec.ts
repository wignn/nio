import { describe, expect, it, jest } from '@jest/globals';
import { EntitlementStatus, GuildPluginStatus, PluginType } from '@prisma/client';
import { PluginAccessService } from './plugin-access.service';

const free = { id: 'free', type: PluginType.FREE, active: true };
const premium = { id: 'premium', type: PluginType.PREMIUM, active: true };

describe('PluginAccessService', () => {
  it('returns only installed compiled plugins with valid premium entitlement', async () => {
    const prisma = {
      guildPlugin: { findMany: jest.fn(async () => [
        { pluginId: 'free', plugin: free },
        { pluginId: 'premium', plugin: premium },
      ]) },
      guildEntitlement: { findFirst: jest.fn(async () => ({ status: EntitlementStatus.ACTIVE })) },
    } as any;
    const registry = { get: jest.fn((id: string) => ({ id })), list: jest.fn() } as any;
    const service = new PluginAccessService(prisma, registry);

    expect((await service.getActivePlugins('guild')).map((plugin) => plugin.id)).toEqual(['free', 'premium']);
    expect(prisma.guildEntitlement.findFirst).toHaveBeenCalledTimes(1);
  });

  it('rejects premium installation without entitlement', async () => {
    const prisma = {
      pluginCatalog: { findUnique: jest.fn(async () => premium) },
      guildEntitlement: { findFirst: jest.fn(async () => null) },
    } as any;
    const registry = { get: jest.fn(() => ({ id: 'premium' })) } as any;
    const service = new PluginAccessService(prisma, registry);

    await expect(service.install('guild', 'premium')).rejects.toThrow('Premium entitlement required');
  });
});
