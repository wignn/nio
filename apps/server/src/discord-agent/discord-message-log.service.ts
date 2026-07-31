import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DiscordMessageLogService {
  constructor(public readonly prisma: PrismaService) {}

  async logCreate(msg: {
    id: string;
    guildId: string;
    channelId: string;
    authorId: string;
    content: string;
    attachments: any;
    embeds: any;
    createdAt: Date;
  }) {
    const [settings, guildSettings] = await Promise.all([
      this.prisma.discordAgentSettings.findUnique({ where: { guildId: msg.guildId } }),
      this.prisma.guildSettings.findUnique({ where: { guildId: msg.guildId } }),
    ]);
    const isEnabled = Boolean(settings?.enabled || process.env.DISCORD_AGENT_ENABLED === 'true' || guildSettings?.messageDeleteLogChannelId);
    if (!isEnabled || settings?.excludedChannelIds?.includes(msg.channelId)) return;

    await this.prisma.discordMessageLog.upsert({
      where: { id: msg.id },
      update: {
        content: msg.content,
        attachments: msg.attachments || undefined,
        embeds: msg.embeds || undefined,
      },
      create: {
        id: msg.id,
        guildId: msg.guildId,
        channelId: msg.channelId,
        authorId: msg.authorId,
        content: msg.content,
        attachments: msg.attachments || undefined,
        embeds: msg.embeds || undefined,
        createdAt: msg.createdAt,
      },
    });
  }

  async logUpdate(messageId: string, content: string, editedAt: Date) {
    await this.prisma.discordMessageLog.update({
      where: { id: messageId },
      data: { content, editedAt },
    }).catch(() => null);
  }

  async logDelete(messageId: string, deletedAt: Date) {
    await this.prisma.discordMessageLog.update({
      where: { id: messageId },
      data: { deletedAt },
    }).catch(() => null);
  }

  async getUserRecentMessages(guildId: string, userId: string, limit = 50) {
    return this.prisma.discordMessageLog.findMany({
      where: { guildId, authorId: userId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getChannelRecentMessages(guildId: string, channelId: string, limit = 50, userId?: string) {
    return this.prisma.discordMessageLog.findMany({
      where: {
        guildId,
        channelId,
        deletedAt: null,
        ...(userId ? { authorId: userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getDeletedMessages(guildId: string, limit = 50, filters: { channelId?: string; userId?: string } = {}) {
    return this.prisma.discordMessageLog.findMany({
      where: {
        guildId,
        deletedAt: { not: null },
        ...(filters.channelId ? { channelId: filters.channelId } : {}),
        ...(filters.userId ? { authorId: filters.userId } : {}),
      },
      orderBy: { deletedAt: 'desc' },
      take: limit,
    });
  }

  async runRetentionCleanup(guildId: string, retentionDays: number) {
    if (retentionDays <= 0) return;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    await this.prisma.discordMessageLog.deleteMany({
      where: { guildId, createdAt: { lt: cutoff } },
    });
  }
}
