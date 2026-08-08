import { Injectable, OnModuleInit } from '@nestjs/common';
import { NioPlugin } from './nio-plugin.interface';
import { CORE_PLUGIN } from './core-plugin';

@Injectable()
export class PluginRegistryService implements OnModuleInit {
  private readonly plugins = new Map<string, NioPlugin>();

  onModuleInit() {
    if (!this.plugins.has(CORE_PLUGIN.id)) this.register(CORE_PLUGIN);
  }

  register(plugin: NioPlugin) {
    if (this.plugins.has(plugin.id)) {
      throw new Error(`Duplicate plugin id: ${plugin.id}`);
    }
    this.plugins.set(plugin.id, plugin);
    return plugin;
  }

  unregister(pluginId: string) {
    this.plugins.delete(pluginId);
  }

  get(pluginId: string) {
    return this.plugins.get(pluginId);
  }

  list() {
    return [...this.plugins.values()];
  }
}
