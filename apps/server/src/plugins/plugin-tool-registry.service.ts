import { Injectable } from '@nestjs/common';
import { AGENT_TOOLS } from '../discord-agent/discord-agent-tools';
import { NioAgentTool, NioPluginContext } from './nio-plugin.interface';
import { PluginAccessService } from './plugin-access.service';
import { PluginRegistryService } from './plugin-registry.service';

@Injectable()
export class PluginToolRegistryService {
  constructor(
    private readonly plugins: PluginRegistryService,
    private readonly access: PluginAccessService,
  ) {}

  list() {
    const tools = new Map<string, NioAgentTool>();
    for (const plugin of this.plugins.list()) {
      for (const tool of plugin.tools || []) {
        if (tools.has(tool.name) || AGENT_TOOLS.some((builtIn) => builtIn.name === tool.name)) {
          throw new Error(`Duplicate tool name: ${tool.name}`);
        }
        tools.set(tool.name, tool);
      }
    }
    return [...tools.values()];
  }

  async definitionsForGuild(guildId: string) {
    const active = new Set((await this.access.getActivePlugins(guildId)).map((plugin) => plugin.id));
    return this.list()
      .filter((tool) => active.has(tool.pluginId))
      .map(({ execute, ...definition }) => definition);
  }

  async execute(name: string, args: unknown, context: NioPluginContext) {
    const tool = this.list().find((candidate) => candidate.name === name);
    if (!tool) return undefined;
    if (!await this.access.canUse(context.guildId, tool.pluginId)) {
      throw new Error('Plugin is not installed or its entitlement has expired');
    }
    return tool.execute(args, context);
  }

  has(name: string) {
    return this.list().some((tool) => tool.name === name);
  }
}
