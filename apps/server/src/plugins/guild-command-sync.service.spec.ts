import { describe, expect, it, jest } from '@jest/globals';
import { GuildCommandSyncService } from './guild-command-sync.service';

const command = (name: string, pluginId?: string) => ({
  name,
  pluginId,
  data: { name, description: name },
  execute: async () => undefined,
});

describe('GuildCommandSyncService', () => {
  it('bulk overwrites only commands for active plugins', async () => {
    const put = jest.fn(async () => []);
    jest.spyOn(require('discord.js'), 'REST').mockImplementation(() => ({
      setToken: () => ({ put }),
    }) as any);
    const prisma = {
      guildCommandSync: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async (args: any) => args),
      },
    } as any;
    const access = { getActivePlugins: jest.fn(async () => [{ id: 'enabled' }]) } as any;
    const commands = {
      list: jest.fn(() => [command('core'), command('enabled-cmd', 'enabled'), command('disabled-cmd', 'disabled')]),
    } as any;
    process.env.DISCORD_CLIENT_ID = 'client';
    process.env.DISCORD_BOT_TOKEN = 'token';

    const registry = { list: jest.fn(() => [{ id: 'core' }]) } as any;
    await new GuildCommandSyncService(prisma, access, commands, registry).sync('guild');

    expect(put).toHaveBeenCalledWith(expect.anything(), {
      body: [
        { name: 'core', description: 'core' },
        { name: 'enabled-cmd', description: 'enabled-cmd' },
      ],
    });
  });

  it('marks installed plugins missing from the compiled registry unavailable', async () => {
    const prisma = {
      guildPlugin: { updateMany: jest.fn(async (args: any) => args) },
    } as any;
    const access = {} as any;
    const commands = {} as any;
    const registry = { list: jest.fn(() => [{ id: 'core' }]) } as any;

    await new GuildCommandSyncService(prisma, access, commands, registry).reconcileUnavailablePlugins();

    expect(prisma.guildPlugin.updateMany).toHaveBeenCalledWith({
      where: { status: 'INSTALLED', pluginId: { notIn: ['core'] } },
      data: { status: 'UNAVAILABLE' },
    });
  });
});
