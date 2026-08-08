import { describe, expect, it, jest } from '@jest/globals';
import { CommandRegistryService } from './command-registry.service';
import { PluginAccessService } from './plugin-access.service';

describe('plugin command dispatch contract', () => {
  it('executes a registered command only after guild access is granted', async () => {
    const execute = jest.fn(async () => undefined);
    const registry = {
      get: jest.fn(() => ({ name: 'hosting', pluginId: 'hosting', execute })),
    } as unknown as CommandRegistryService;
    const access = { canUse: jest.fn(async () => true) } as unknown as PluginAccessService;
    const interaction = { commandName: 'hosting', guildId: 'guild' } as any;

    const command = registry.get(interaction.commandName)!;
    expect(command.pluginId && await access.canUse(interaction.guildId, command.pluginId)).toBe(true);
    await command.execute(interaction);

    expect(execute).toHaveBeenCalledWith(interaction);
  });

  it('does not execute a command after access is revoked', async () => {
    const execute = jest.fn(async () => undefined);
    const registry = { get: jest.fn(() => ({ name: 'hosting', pluginId: 'hosting', execute })) } as any;
    const access = { canUse: jest.fn(async () => false) } as any;
    const command = registry.get('hosting');

    expect(await access.canUse('guild', command.pluginId)).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
