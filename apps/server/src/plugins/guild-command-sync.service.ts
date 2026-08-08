import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { REST, Routes } from 'discord.js';
import { PrismaService } from '../prisma/prisma.service';
import { PluginAccessService } from './plugin-access.service';
import { CommandRegistryService } from './command-registry.service';
import { PluginRegistryService } from './plugin-registry.service';
import { GuildPluginStatus } from '@prisma/client';

@Injectable()
export class GuildCommandSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: PluginAccessService,
    private readonly commands: CommandRegistryService,
    private readonly registry: PluginRegistryService,
  ) {}

  async reconcileUnavailablePlugins() {
    const compiledIds = this.registry.list().map((plugin) => plugin.id);
    return this.prisma.guildPlugin.updateMany({
      where: {
        status: GuildPluginStatus.INSTALLED,
        pluginId: { notIn: compiledIds },
      },
      data: { status: GuildPluginStatus.UNAVAILABLE },
    });
  }

  async sync(guildId: string) {
    const previous = await this.prisma.guildCommandSync.findUnique({ where: { guildId } });
    const clientId = process.env.DISCORD_CLIENT_ID;
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!clientId || !token) {
      const message = 'Discord credentials are not configured';
      await this.prisma.guildCommandSync.upsert({
        where: { guildId },
        create: { guildId, manifestHash: previous?.manifestHash || '', lastError: message },
        update: { lastError: message },
      }).catch(() => undefined);
      throw new Error(message);
    }

    const activePlugins = await this.access.getActivePlugins(guildId);
    const activeIds = new Set(activePlugins.map((plugin) => plugin.id));
    const desired = this.commands.list()
      .filter((command) => !command.pluginId || activeIds.has(command.pluginId))
      .map((command) => command.data)
      .sort((a, b) => a.name.localeCompare(b.name));
    const manifestHash = this.hash(desired);
    if (previous?.manifestHash === manifestHash) return { changed: false, manifestHash };

    try {
      await new REST({ version: '10' }).setToken(token).put(
        Routes.applicationGuildCommands(clientId, guildId),
        { body: desired },
      );
      await this.prisma.guildCommandSync.upsert({
        where: { guildId },
        create: { guildId, manifestHash, syncedAt: new Date(), lastError: null },
        update: { manifestHash, syncedAt: new Date(), lastError: null },
      });
      return { changed: true, manifestHash, count: desired.length };
    } catch (error: any) {
      await this.prisma.guildCommandSync.upsert({
        where: { guildId },
        create: { guildId, manifestHash: previous?.manifestHash || '', lastError: error?.message || 'Sync failed' },
        update: { lastError: error?.message || 'Sync failed' },
      }).catch(() => undefined);
      throw error;
    }
  }

  private hash(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}
