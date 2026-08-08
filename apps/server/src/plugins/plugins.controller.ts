import { Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { GuildPluginStatus } from '@prisma/client';
import { SessionAuthGuard } from '../auth/guards/session-auth.guard';
import { GuildAccessGuard } from '../guilds/guards/guild-access.guard';
import { PluginAccessService } from './plugin-access.service';
import { GuildCommandSyncService } from './guild-command-sync.service';
import { AppLogger } from '../logger/logger.service';

@Controller('guilds/:guildId/plugins')
@UseGuards(SessionAuthGuard)
export class PluginsController {
  constructor(
    private readonly access: PluginAccessService,
    private readonly commandSync: GuildCommandSyncService,
    private readonly logger: AppLogger,
  ) {}

  private async syncGuild(guildId: string) {
    try {
      await this.commandSync.sync(guildId);
    } catch (error: any) {
      this.logger.error(
        `Plugin command sync error: ${error?.message ?? error}`,
        error?.stack,
        'PluginsController',
      );
    }
  }

  private async mutate(
    guildId: string,
    mutation: () => Promise<unknown>,
  ) {
    const result = await mutation();
    await this.syncGuild(guildId);
    return result;
  }

  @Get()
  async list(@Param('guildId') guildId: string) {
    const [catalog, installed] = await Promise.all([
      this.access.getAvailablePlugins(),
      this.access.getActivePlugins(guildId),
    ]);
    const activeIds = new Set(installed.map((plugin) => plugin.id));
    return catalog.map((plugin) => ({ ...plugin, installed: activeIds.has(plugin.id) }));
  }

  @Post(':pluginId/install')
  @UseGuards(GuildAccessGuard)
  install(@Param('guildId') guildId: string, @Param('pluginId') pluginId: string) {
    return this.mutate(guildId, () => this.access.install(guildId, pluginId));
  }

  @Patch(':pluginId/enable')
  @UseGuards(GuildAccessGuard)
  enable(@Param('guildId') guildId: string, @Param('pluginId') pluginId: string) {
    return this.mutate(guildId, () => this.access.setStatus(guildId, pluginId, GuildPluginStatus.INSTALLED));
  }

  @Patch(':pluginId/disable')
  @UseGuards(GuildAccessGuard)
  disable(@Param('guildId') guildId: string, @Param('pluginId') pluginId: string) {
    return this.mutate(guildId, () => this.access.setStatus(guildId, pluginId, GuildPluginStatus.DISABLED));
  }

  @Delete(':pluginId')
  @UseGuards(GuildAccessGuard)
  uninstall(@Param('guildId') guildId: string, @Param('pluginId') pluginId: string) {
    return this.mutate(guildId, () => this.access.uninstall(guildId, pluginId));
  }

}
