import { Injectable } from '@nestjs/common';
import { NioCommand } from './nio-plugin.interface';
import { PluginRegistryService } from './plugin-registry.service';
import { CoreCommandService } from './core-command.service';

@Injectable()
export class CommandRegistryService {
  constructor(
    private readonly plugins: PluginRegistryService,
    private readonly core: CoreCommandService,
  ) {}

  executeCore(name: string, interaction: Parameters<NioCommand['execute']>[0]) {
    return this.core.execute(name, interaction);
  }

  list() {
    const commands = new Map<string, NioCommand>();
    for (const plugin of this.plugins.list()) {
      for (const command of plugin.commands) {
        if (commands.has(command.name)) {
          throw new Error(`Duplicate command name: ${command.name}`);
        }
        commands.set(command.name, {
          ...command,
          pluginId: plugin.id === 'core' ? undefined : (command.pluginId || plugin.id),
          execute: plugin.id === 'core'
            ? (interaction) => this.core.execute(command.name, interaction)
            : command.execute,
        });
      }
    }
    return [...commands.values()];
  }

  get(name: string) {
    return this.list().find((command) => command.name === name);
  }
}
