import { describe, expect, it } from '@jest/globals';
import { PluginRegistryService } from './plugin-registry.service';
import { CommandRegistryService } from './command-registry.service';
import { NioPlugin } from './nio-plugin.interface';

const command = (name: string, pluginId?: string) => ({
  name,
  pluginId,
  data: { name, description: name },
  execute: async () => undefined,
});

const plugin = (id: string, type: NioPlugin['type'] = 'FREE'): NioPlugin => ({
  id,
  version: '1.0.0',
  name: id,
  description: id,
  type,
  commands: [command(`${id}-command`, id)],
});

describe('PluginRegistryService', () => {
  it('rejects duplicate plugin ids', () => {
    const registry = new PluginRegistryService();
    registry.register(plugin('alpha'));
    expect(() => registry.register(plugin('alpha'))).toThrow('Duplicate plugin id: alpha');
  });

  it('rejects duplicate command names', () => {
    const plugins = new PluginRegistryService();
    plugins.register({ ...plugin('alpha'), commands: [command('shared', 'alpha')] });
    plugins.register({ ...plugin('beta'), commands: [command('shared', 'beta')] });

    expect(() => new CommandRegistryService(plugins, { execute: jest.fn() } as any).list()).toThrow('Duplicate command name: shared');
  });
});
