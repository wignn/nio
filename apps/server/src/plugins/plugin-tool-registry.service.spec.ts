import { describe, expect, it, jest } from '@jest/globals';
import { PluginToolRegistryService } from './plugin-tool-registry.service';

describe('PluginToolRegistryService', () => {
  it('filters tools by guild access and blocks stale execution', async () => {
    const execute = jest.fn(async () => ({ ok: true }));
    const tool = {
      name: 'hosting_status',
      pluginId: 'hosting',
      description: 'Read hosting status',
      parameters: { type: 'OBJECT', properties: {} },
      execute,
    };
    const plugins = { list: jest.fn(() => [{ id: 'hosting', tools: [tool] }]) } as any;
    const access = { getActivePlugins: jest.fn(async () => []), canUse: jest.fn(async () => false) } as any;
    const registry = new PluginToolRegistryService(plugins, access);

    await expect(registry.definitionsForGuild('guild')).resolves.toEqual([]);
    await expect(registry.execute('hosting_status', {}, { guildId: 'guild', channelId: 'channel', requestedById: 'user' }))
      .rejects.toThrow('Plugin is not installed');
    expect(execute).not.toHaveBeenCalled();
  });
});
