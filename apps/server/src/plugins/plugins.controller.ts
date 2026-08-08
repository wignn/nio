import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { CredentialEncryptionService } from './credential-encryption.service';
import { KineticHostingService } from './kinetic-hosting/kinetic-hosting.service';
import { PrismaService } from '../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';
class ConfigureCredentialDto {
  token!: string;
}
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
    private readonly prisma: PrismaService,
    private readonly encryption: CredentialEncryptionService,
    private readonly kinetic: KineticHostingService,
    private readonly registry: PluginRegistryService,
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
    const plugins = await this.access.getMarketplacePlugins(guildId);
    const credentials = await this.prisma.guildPluginCredential.findMany({
      where: { guildId },
      select: { pluginId: true },
    });
    const configured = new Set(credentials.map((credential) => credential.pluginId));
    return plugins.map((plugin) => ({ ...plugin, credentialConfigured: configured.has(plugin.id) }));
  }

  @Put(':pluginId/credentials')
  @UseGuards(GuildAccessGuard)
  async configureCredentials(
    @Param('guildId') guildId: string,
    @Param('pluginId') pluginId: string,
    @Body() body: ConfigureCredentialDto,
  ) {
    if (pluginId !== 'kinetic-hosting' || !this.registry.get(pluginId)) {
      throw new Error('Plugin credential configuration is unavailable');
    }
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!token || token.length > 512) throw new Error('Kinetic API key is invalid');
    await this.kinetic.validateToken(token);
    await this.prisma.guildPluginCredential.upsert({
      where: { guildId_pluginId: { guildId, pluginId } },
      create: { guildId, pluginId, encryptedToken: this.encryption.encrypt(token) },
      update: { encryptedToken: this.encryption.encrypt(token) },
    });
    return { configured: true };
  }

  @Delete(':pluginId/credentials')
  @UseGuards(GuildAccessGuard)
  async removeCredentials(@Param('guildId') guildId: string, @Param('pluginId') pluginId: string) {
    await this.prisma.guildPluginCredential.deleteMany({ where: { guildId, pluginId } });
    return { configured: false };
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
