import { Global, Module } from '@nestjs/common';
import { BoosterRoleModule } from '../booster-role/booster-role.module';
import { EmbedTemplateModule } from '../embed-templates/embed-template.module';
import { ModerationModule } from '../moderation/moderation.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { TakoModule } from '../tako/tako.module';
import { CommandRegistryService } from './command-registry.service';
import { CoreCommandService } from './core-command.service';
import { GuildCommandSyncService } from './guild-command-sync.service';
import { PluginAccessService } from './plugin-access.service';
import { PluginEntitlementSyncService } from './plugin-entitlement-sync.service';
import { PluginEventDispatcherService } from './plugin-event-dispatcher.service';
import { PluginRegistryService } from './plugin-registry.service';
import { PluginToolRegistryService } from './plugin-tool-registry.service';
import { PluginsController } from './plugins.controller';
import { KineticHostingModule } from './kinetic-hosting/kinetic-hosting.module';
import { KineticHostingService } from './kinetic-hosting/kinetic-hosting.service';
import { createKineticHostingPlugin } from './kinetic-hosting/kinetic-hosting.plugin';

const kineticRegistration = {
  provide: 'KINETIC_PLUGIN_REGISTRATION',
  inject: [PluginRegistryService, KineticHostingService, PrismaService],
  useFactory: async (
    registry: PluginRegistryService,
    service: KineticHostingService,
    prisma: PrismaService,
  ) => {
    registry.register(createKineticHostingPlugin(service));
    await prisma.pluginCatalog.upsert({
      where: { id: 'kinetic-hosting' },
      create: {
        id: 'kinetic-hosting',
        version: '1.0.0',
        name: 'Kinetic Hosting',
        description: 'Read-only Kinetic Panel server visibility for Discord and nio.',
        type: 'FREE',
        active: true,
      },
      update: {
        version: '1.0.0',
        name: 'Kinetic Hosting',
        description: 'Read-only Kinetic Panel server visibility for Discord and nio.',
        active: true,
      },
    }).catch(() => undefined);
  },
};

@Global()
@Module({
  imports: [
    PrismaModule,
    ModerationModule,
    BoosterRoleModule,
    TakoModule,
    EmbedTemplateModule,
    KineticHostingModule,
  ],
  controllers: [PluginsController],
  providers: [
    PluginRegistryService,
    CoreCommandService,
    CommandRegistryService,
    PluginAccessService,
    GuildCommandSyncService,
    PluginEntitlementSyncService,
    PluginToolRegistryService,
    PluginEventDispatcherService,
    kineticRegistration,
  ],
  exports: [
    PluginRegistryService,
    CommandRegistryService,
    PluginAccessService,
    GuildCommandSyncService,
    PluginToolRegistryService,
    PluginEventDispatcherService,
  ],
})
export class PluginsModule {}
