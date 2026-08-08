import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EntitlementStatus, GuildPluginStatus, PluginType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppLogger } from '../logger/logger.service';
import { GuildCommandSyncService } from './guild-command-sync.service';

const RECONCILE_INTERVAL_MS = 60_000;

@Injectable()
export class PluginEntitlementSyncService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly commandSync: GuildCommandSyncService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    void this.reconcile();
    this.timer = setInterval(() => void this.reconcile(), RECONCILE_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async reconcile(now = new Date()) {
    const rows = await this.prisma.guildEntitlement.findMany({
      where: {
        status: EntitlementStatus.ACTIVE,
        plugin: { type: PluginType.PREMIUM, active: true },
        OR: [
          { startsAt: { lte: now } },
          { expiresAt: { lte: now } },
        ],
      },
      select: { id: true, guildId: true, startsAt: true, expiresAt: true },
    });
    const guilds = new Set<string>();
    for (const entitlement of rows) {
      if (entitlement.expiresAt && entitlement.expiresAt <= now) {
        await this.prisma.guildEntitlement.update({
          where: { id: entitlement.id },
          data: { status: EntitlementStatus.EXPIRED },
        });
        guilds.add(entitlement.guildId);
      } else if (!entitlement.startsAt || entitlement.startsAt <= now) {
        guilds.add(entitlement.guildId);
      }
    }
    await Promise.all([...guilds].map(async (guildId) => {
      try {
        await this.commandSync.sync(guildId);
      } catch (error: any) {
        this.logger.error(`Entitlement command sync error: ${error?.message ?? error}`, error?.stack, 'PluginEntitlementSync');
      }
    }));
    return guilds.size;
  }
}
