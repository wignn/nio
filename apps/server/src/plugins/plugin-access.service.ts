import { Injectable } from '@nestjs/common';
import { EntitlementStatus, GuildPluginStatus, PluginType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PluginRegistryService } from './plugin-registry.service';
import { NioPlugin } from './nio-plugin.interface';

@Injectable()
export class PluginAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: PluginRegistryService,
  ) {}

  async getAvailablePlugins() {
    const catalog = await this.prisma.pluginCatalog.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
    const compiled = new Map(this.registry.list().map((plugin) => [plugin.id, plugin]));
    return catalog.map((plugin) => ({
      ...plugin,
      available: compiled.has(plugin.id),
    }));
  }

  async getMarketplacePlugins(guildId: string) {
    const [catalog, installations, entitlements] = await Promise.all([
      this.getAvailablePlugins(),
      this.prisma.guildPlugin.findMany({ where: { guildId } }),
      this.prisma.guildEntitlement.findMany({
        where: { guildId },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const installationByPlugin = new Map(
      installations.map((installation) => [installation.pluginId, installation]),
    );
    const entitlementByPlugin = new Map<string, (typeof entitlements)[number]>();
    for (const entitlement of entitlements) {
      if (!entitlementByPlugin.has(entitlement.pluginId)) {
        entitlementByPlugin.set(entitlement.pluginId, entitlement);
      }
    }

    return catalog.map((plugin) => {
      const installation = installationByPlugin.get(plugin.id);
      const entitlement = entitlementByPlugin.get(plugin.id);
      return {
        ...plugin,
        installed: installation?.status === GuildPluginStatus.INSTALLED,
        installationStatus: installation?.status ?? null,
        entitlementStatus: entitlement?.status ?? null,
        entitlementExpiresAt: entitlement?.expiresAt ?? null,
      };
    });
  }

  async getActivePlugins(guildId: string): Promise<NioPlugin[]> {
    const installations = await this.prisma.guildPlugin.findMany({
      where: { guildId, status: GuildPluginStatus.INSTALLED, plugin: { active: true } },
      include: { plugin: true },
    });
    const now = new Date();
    const active = await Promise.all(installations.map(async (installation) => {
      if (installation.plugin.type === PluginType.PREMIUM) {
        const entitlement = await this.prisma.guildEntitlement.findFirst({
          where: {
            guildId,
            pluginId: installation.pluginId,
            status: EntitlementStatus.ACTIVE,
            OR: [{ startsAt: null }, { startsAt: { lte: now } }],
            AND: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
        });
        if (!entitlement) return null;
      }
      return this.registry.get(installation.pluginId) || null;
    }));
    return active.filter((plugin): plugin is NioPlugin => Boolean(plugin));
  }

  async canUse(guildId: string, pluginId: string) {
    return (await this.getActivePlugins(guildId)).some((plugin) => plugin.id === pluginId);
  }

  async install(guildId: string, pluginId: string) {
    const plugin = await this.prisma.pluginCatalog.findUnique({ where: { id: pluginId } });
    if (!plugin || !plugin.active || !this.registry.get(pluginId)) throw new Error('Plugin is unavailable');
    if (plugin.type === PluginType.PREMIUM && !(await this.hasActiveEntitlement(guildId, pluginId))) {
      throw new Error('Premium entitlement required');
    }
    return this.prisma.guildPlugin.upsert({
      where: { guildId_pluginId: { guildId, pluginId } },
      create: { guildId, pluginId, status: GuildPluginStatus.INSTALLED },
      update: { status: GuildPluginStatus.INSTALLED },
    });
  }

  async setStatus(guildId: string, pluginId: string, status: GuildPluginStatus) {
    if (status === GuildPluginStatus.INSTALLED) {
      const plugin = await this.prisma.pluginCatalog.findUnique({ where: { id: pluginId } });
      if (!plugin || !plugin.active || !this.registry.get(pluginId)) {
        throw new Error('Plugin is unavailable');
      }
      if (plugin.type === PluginType.PREMIUM && !(await this.hasActiveEntitlement(guildId, pluginId))) {
        throw new Error('Premium entitlement required');
      }
    }

    return this.prisma.guildPlugin.update({
      where: { guildId_pluginId: { guildId, pluginId } },
      data: { status },
    });
  }

  async uninstall(guildId: string, pluginId: string) {
    return this.prisma.$transaction([
      this.prisma.guildPlugin.delete({ where: { guildId_pluginId: { guildId, pluginId } } }),
      this.prisma.guildPluginCredential.deleteMany({ where: { guildId, pluginId } }),
    ]);
  }

  private async hasActiveEntitlement(guildId: string, pluginId: string) {
    const now = new Date();
    return Boolean(await this.prisma.guildEntitlement.findFirst({
      where: {
        guildId,
        pluginId,
        status: EntitlementStatus.ACTIVE,
        OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        AND: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }));
  }
}
