import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { Client, Events, GatewayIntentBits, GuildMember, Message, Partials, EmbedBuilder } from 'discord.js';
import { GuildCommandSyncService } from '../plugins/guild-command-sync.service';
import { PluginEventDispatcherService } from '../plugins/plugin-event-dispatcher.service';
import { AppLogger } from '../logger/logger.service';
import { DiscordInteractionService } from './discord-interaction.service';
import { StickersService } from '../stickers/stickers.service';
import { DiscordSlowmodeService } from './discord-slowmode.service';
import { DiscordAnomalyService } from './discord-anomaly.service';
import { BoosterRoleService } from '../booster-role/booster-role.service';
import { TakoService } from '../tako/tako.service';
import { DiscordAgentService } from '../discord-agent/discord-agent.service';
import { DiscordAgentContextService } from '../discord-agent/discord-agent-context.service';
import { DiscordMessageLogService } from '../discord-agent/discord-message-log.service';
import { AgentActionProposalService } from '../discord-agent/agent-action-proposal.service';
import { DiscordAgentToolExecutorService } from '../discord-agent/discord-agent-tool-executor.service';
import { ConversationMemoryService } from '../discord-agent/conversation-memory.service';
import { RustAnalyticsClientService } from './rust-analytics-client.service';
import { DiscordVoiceConnectionService } from './discord-voice-connection.service';

const MAX_DELETE_LOG_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const DELETE_LOG_MEDIA_DIR = path.resolve(process.cwd(), '.tmp/delete-log-media');
const DELETE_LOG_MEDIA_TTL_MS = 24 * 60 * 60 * 1000;
const DELETE_LOG_MEDIA_CLEANUP_MS = 60 * 60 * 1000;

@Injectable()
export class DiscordBotService implements OnModuleInit, OnModuleDestroy {
  private mediaCleanupInterval: NodeJS.Timeout | null = null;
  readonly client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.GuildMember, Partials.Message, Partials.Channel],
    allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
  });

  constructor(
    private readonly interactions: DiscordInteractionService,
    private readonly stickers: StickersService,
    private readonly logger: AppLogger,
    private readonly slowmode: DiscordSlowmodeService,
    private readonly anomaly: DiscordAnomalyService,
    private readonly boosterRoles: BoosterRoleService,
    private readonly tako: TakoService,
    private readonly agent: DiscordAgentService,
    private readonly agentContext: DiscordAgentContextService,
    private readonly messageLogs: DiscordMessageLogService,
    private readonly actionProposals: AgentActionProposalService,
    private readonly agentToolExecutor: DiscordAgentToolExecutorService,
    private readonly conversationMemory: ConversationMemoryService,
    private readonly rustAnalytics: RustAnalyticsClientService,
    private readonly voiceConnections: DiscordVoiceConnectionService,
    private readonly commandSync: GuildCommandSyncService,
    private readonly pluginEvents: PluginEventDispatcherService,
  ) {}

  async onModuleInit() {
    this.cleanupDeletedMedia().catch((err) => this.logger.error(`Delete media cleanup error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'));
    this.mediaCleanupInterval = setInterval(() => {
      this.cleanupDeletedMedia().catch((err) => this.logger.error(`Delete media cleanup error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'));
    }, DELETE_LOG_MEDIA_CLEANUP_MS);

    this.slowmode.setClient(this.client);
    this.boosterRoles.setClient(this.client);
    this.tako.setClient(this.client);
    this.agentContext.setClient(this.client);
    this.actionProposals.setClient(this.client);
    this.actionProposals.setSlowmodeService(this.slowmode);
    this.actionProposals.setAnomalyService(this.anomaly);
    this.actionProposals.setVoiceConnectionService(this.voiceConnections);
    this.agentToolExecutor.setClient(this.client);

    const token = process.env.DISCORD_BOT_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!token || !clientId) {
      this.logger.warn('DISCORD_BOT_TOKEN or DISCORD_CLIENT_ID missing; Discord bot not started.', 'DiscordBot');
      return;
    }

    this.client.once(Events.ClientReady, () => this.logger.log(`Discord bot online as ${this.client.user?.tag}`, 'DiscordBot'));
    this.client.on('interactionCreate', (interaction) => this.interactions.handle(interaction).catch(
      (err) => this.logger.error(`Interaction error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
    ));

    this.client.on(Events.GuildMemberUpdate, (oldMember, newMember) => {
      const oldGuildMember = oldMember as GuildMember;
      const newGuildMember = newMember as GuildMember;
      const wasBoosting = this.isBoosting(oldGuildMember);
      const isBoosting = this.isBoosting(newGuildMember);

      this.pluginEvents.onGuildMemberUpdate(oldGuildMember, newGuildMember).catch(
        (err) => this.logger.error(`Plugin member event error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
      if (wasBoosting === isBoosting) return;

      this.boosterRoles.handleBoosterStatusChange(newGuildMember.guild.id, newGuildMember.id, wasBoosting, isBoosting).catch(
        (err) => this.logger.error(`Booster role status update error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
    });

    this.client.on(Events.VoiceStateUpdate, (oldState, newState) => {
      this.handleVoiceStateUpdate(oldState, newState).catch(
        (err) => this.logger.error(`Voice state update error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
    });

    this.client.on('messageCreate', (message) => {
      this.pluginEvents.onMessageCreate(message).catch(
        (err) => this.logger.error(`Plugin message event error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
      this.slowmode.handleMessage(message).catch(
        (err) => this.logger.error(`Slowmode service error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );

      this.anomaly.handleMessage(message).catch(
        (err) => this.logger.error(`Anomaly service error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );

      if (message.author.bot || !message.guild) return;

      this.handleAgentMessage(message).catch(
        (err) => this.logger.error(`Discord agent message error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );

      const name = message.content.trim().toLowerCase();
      if (!name || name.length > 32) return;
      const url = this.stickers.getCachedUrl(message.guild.id, name);
      if (!url) return;

      const ext = url.split('?')[0].split('.').pop() || 'png';
      message.channel.send({
        files: [{
          attachment: url,
          name: `${name}.${ext}`,
        }],
      }).catch(
        (err) => this.logger.error(`Sticker send error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
    });

    this.client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
      if (!newMessage.guild || !newMessage.id) return;
      this.messageLogs.logUpdate(newMessage.id, newMessage.content || '', new Date()).catch(
        (err) => this.logger.error(`Message log update error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
    });

    this.client.on(Events.MessageDelete, (message) => {
      this.handleMessageDelete(message).catch(
        (err) => this.logger.error(`Message delete log error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
      if (!message.guild || !message.id) return;
      this.messageLogs.logDelete(message.id, new Date()).catch(
        (err) => this.logger.error(`Message log delete error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
    });

    this.client.on(Events.MessageBulkDelete, (messages) => {
      const messageIds = messages.map((m: any) => m.id);
      this.handleMessageDeleteBulk(messages).catch(
        (err: any) => this.logger.error(`Message delete bulk log error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
      this.messageLogs.prisma.discordMessageLog.updateMany({
        where: { id: { in: messageIds } },
        data: { deletedAt: new Date() },
      }).catch(
        (err: any) => this.logger.error(`Message log bulk delete error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
      );
    });

    await this.client.login(token);
    await this.commandSync.reconcileUnavailablePlugins().catch((err) =>
      this.logger.error(`Plugin reconciliation error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'),
    );
    for (const guild of this.client.guilds.cache.values()) {
      await this.commandSync.sync(guild.id).catch((err) => this.logger.error(`Guild command sync error: ${err?.message ?? err}`, err?.stack, 'DiscordBot'));
    }
    this.logger.log('Guild slash commands synchronized', 'DiscordBot');
  }

  onModuleDestroy() {
    if (this.mediaCleanupInterval) {
      clearInterval(this.mediaCleanupInterval);
      this.mediaCleanupInterval = null;
    }
  }

  private async handleAgentMessage(message: Message) {
    if (!message.guild) return;

    const guildSettings = await this.messageLogs.prisma.guildSettings.findUnique({
      where: { guildId: message.guild.id },
      select: { messageDeleteLogChannelId: true },
    }).catch(() => null);
    const attachments = await this.buildMessageLogAttachments(message, Boolean(guildSettings?.messageDeleteLogChannelId), message.guild.id);

    await this.messageLogs.logCreate({
      id: message.id,
      guildId: message.guild.id,
      channelId: message.channel.id,
      authorId: message.author.id,
      content: message.content || '',
      attachments,
      embeds: message.embeds.map((embed) => embed.toJSON()),
      createdAt: message.createdAt,
    }).catch(() => null);

    await this.rustAnalytics.ingestMessage({
      messageId: message.id,
      guildId: message.guild.id,
      channelId: message.channel.id,
      authorId: message.author.id,
      content: message.content || '',
      timestampMs: message.createdTimestamp,
    });

    if (!this.client.user) return;

    let referencedBotMessageId: string | undefined;
    let replyContext: any = undefined;

    if (message.reference?.messageId) {
      try {
        const referencedMessage = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
        if (referencedMessage) {
          if (referencedMessage.author.id === this.client.user.id) {
            referencedBotMessageId = referencedMessage.id;
          } else {
            replyContext = {
              id: referencedMessage.id,
              channelId: referencedMessage.channel.id,
              authorId: referencedMessage.author.id,
              authorTag: referencedMessage.author.tag,
              content: referencedMessage.content || '',
              createdAt: referencedMessage.createdAt,
              attachments: Array.from(referencedMessage.attachments.values()).map((a: any) => ({
                name: a.name,
                url: a.url,
              })),
            };
          }
        }
      } catch {
        // If we can't fetch the referenced message, proceed without memory or reply context.
      }
    }

    const isMentioningBot = message.mentions.has(this.client.user);
    if (!isMentioningBot && !referencedBotMessageId) return;

    if (!await this.canUseAgent(message)) return;

    if (message.channel && typeof (message.channel as any).sendTyping === 'function') {
      await (message.channel as any).sendTyping().catch(() => null);
    }

    const loadingMessage = await message.reply({
      content: '**nio** sedang membaca konteks...\n-# Meninjau riwayat channel, warning, role, dan tool yang relevan.',
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    }).catch(() => null);

    const response = await this.agent.handleMention(
      message.guild.id,
      message.channel.id,
      message.author.id,
      message.content,
      referencedBotMessageId,
      replyContext,
    );

    if (!response) {
      await loadingMessage?.delete().catch(() => null);
      return;
    }

    const replyPayload = {
      content: response.content,
      embeds: response.embeds,
      components: response.components,
      allowedMentions: { parse: [], users: [], roles: [], repliedUser: false },
    };

    let responseMessageId: string | undefined;

    if (loadingMessage) {
      const edited = await loadingMessage.edit(replyPayload).catch(() => null);
      if (edited) {
        responseMessageId = edited.id;
      } else {
        const fallback = await message.reply(replyPayload).catch(() => null);
        responseMessageId = fallback?.id;
      }
    } else {
      const sent = await message.reply(replyPayload).catch(() => null);
      responseMessageId = sent?.id;
    }

    if (responseMessageId && response.conversationTurns?.length) {
      await this.conversationMemory.saveConversation(
        message.guild.id,
        responseMessageId,
        response.conversationTurns,
      ).catch(() => null);
    }
  }

  private async buildMessageLogAttachments(message: Message, cacheFiles: boolean, guildId: string) {
    const attachments: any[] = [];
    let remainingCacheBytes = MAX_DELETE_LOG_ATTACHMENT_BYTES;

    for (const attachment of message.attachments.values()) {
      const logAttachment: any = {
        id: attachment.id,
        name: attachment.name,
        url: attachment.url,
        contentType: attachment.contentType,
        size: attachment.size,
      };

      if (cacheFiles && attachment.url && attachment.size <= remainingCacheBytes) {
        const res = await fetch(attachment.url).catch(() => null);
        const contentLength = Number(res?.headers.get('content-length') || attachment.size || '0');
        if (res?.ok && contentLength > 0 && contentLength <= remainingCacheBytes) {
          const arrayBuffer = await res.arrayBuffer().catch(() => null);
          const buffer = arrayBuffer ? Buffer.from(arrayBuffer) : null;
          if (buffer && buffer.length <= remainingCacheBytes) {
            const cachedFileName = path.join(guildId, message.id, `${attachment.id}-${this.safeFileName(attachment.name || 'file')}`);
            const saved = await this.writeDeleteLogMedia(cachedFileName, buffer).catch(() => false);
            if (saved) {
              remainingCacheBytes -= buffer.length;
              logAttachment.cachedFileName = cachedFileName;
              logAttachment.cachedContentType = attachment.contentType;
              logAttachment.cachedSize = buffer.length;
            }
          }
        }
      }

      attachments.push(logAttachment);
    }

    return attachments;
  }

  private safeFileName(fileName: string) {
    return fileName.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 120) || 'file';
  }

  private resolveDeleteLogMediaPath(cachedFileName: string) {
    const filePath = path.resolve(DELETE_LOG_MEDIA_DIR, cachedFileName);
    return filePath.startsWith(`${DELETE_LOG_MEDIA_DIR}${path.sep}`) ? filePath : null;
  }

  private async writeDeleteLogMedia(cachedFileName: string, buffer: Buffer) {
    const filePath = this.resolveDeleteLogMediaPath(cachedFileName);
    if (!filePath) return false;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return true;
  }

  private async readDeleteLogMedia(cachedFileName: string) {
    const filePath = this.resolveDeleteLogMediaPath(cachedFileName);
    if (!filePath) return null;
    return fs.readFile(filePath).catch(() => null);
  }

  private async removeDeleteLogMediaDir(guildId: string, messageId: string) {
    const dir = this.resolveDeleteLogMediaPath(path.join(guildId, messageId));
    if (!dir) return;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => null);
  }

  private async cleanupDeletedMedia() {
    const cutoff = Date.now() - DELETE_LOG_MEDIA_TTL_MS;
    await this.cleanupMediaDir(DELETE_LOG_MEDIA_DIR, cutoff, true);
  }

  private async cleanupMediaDir(dir: string, cutoff: number, keepRoot = false): Promise<boolean> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch((err: any) => {
      if (err?.code === 'ENOENT') return [];
      throw err;
    });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (await this.cleanupMediaDir(fullPath, cutoff)) await fs.rmdir(fullPath).catch(() => null);
        continue;
      }

      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fs.unlink(fullPath).catch(() => null);
    }

    const remaining = await fs.readdir(dir).catch(() => []);
    return !keepRoot && remaining.length === 0;
  }

  private async canUseAgent(message: Message) {
    if (!message.guild) return false;
    const result = await this.agent.canHandle(message.guild.id, message.channel.id, message.author.id).catch(() => ({ allowed: false }));
    return result.allowed;
  }

  private async handleMessageDelete(message: any) {
    if (!message.guild || !message.id) return;

    try {
      const settings = await this.messageLogs.prisma.guildSettings.findUnique({
        where: { guildId: message.guild.id },
      });

      const logChannelId = settings?.messageDeleteLogChannelId;
      if (!logChannelId) return;

      const dbLog = await this.messageLogs.prisma.discordMessageLog.findUnique({
        where: { id: message.id },
      });

      if (!dbLog) return;

      const logChannel = await message.guild.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel || !logChannel.isTextBased()) return;

      const attachments = (dbLog.attachments as any[]) || [];
      const attachmentBuffers: { attachment: Buffer; name: string }[] = [];
      const largeAttachments: any[] = [];

      for (const att of attachments) {
        if (att.cachedFileName) {
          const buffer = await this.readDeleteLogMedia(att.cachedFileName);
          if (buffer && buffer.length <= MAX_DELETE_LOG_ATTACHMENT_BYTES) {
            attachmentBuffers.push({ attachment: buffer, name: att.name || 'file' });
            continue;
          }
          largeAttachments.push(att);
          continue;
        }

        if (att.cachedBase64) {
          const buffer = Buffer.from(att.cachedBase64, 'base64');
          if (buffer.length <= MAX_DELETE_LOG_ATTACHMENT_BYTES) {
            attachmentBuffers.push({ attachment: buffer, name: att.name || 'file' });
            continue;
          }
          largeAttachments.push(att);
          continue;
        }

        if (!att.url) {
          largeAttachments.push(att);
          continue;
        }
        const res = await fetch(att.url).catch(() => null);
        if (res && res.ok) {
          const contentLength = Number(res.headers.get('content-length') || '0');
          if (contentLength > 0 && contentLength <= MAX_DELETE_LOG_ATTACHMENT_BYTES) {
            const buffer = Buffer.from(await res.arrayBuffer());
            attachmentBuffers.push({ attachment: buffer, name: att.name || 'file' });
          } else {
            largeAttachments.push(att);
          }
        } else {
          largeAttachments.push(att);
        }
      }

      let contentDescription = dbLog.content ? `>>> ${dbLog.content}` : '*No text content*';
      if (largeAttachments.length > 0) {
        const largeList = largeAttachments.map((att) => {
          const name = att.name || 'file';
          const label = att.url ? `[${name}](${att.url})` : name;
          return `• ${label} (File too large or unavailable to re-upload)`;
        }).join('\n');
        contentDescription += `\n\n**Attachments (Not re-uploaded):**\n${largeList}`;
      }

      const embed = new EmbedBuilder()
        .setColor(0x7f8c8d)
        .setTitle('Message Deleted')
        .setDescription(contentDescription.length > 4096 ? `${contentDescription.slice(0, 4093)}...` : contentDescription)
        .addFields(
          { name: 'Author', value: `<@${dbLog.authorId}> (\`${dbLog.authorId}\`)`, inline: true },
          { name: 'Channel', value: `<#${dbLog.channelId}>`, inline: true },
          { name: 'Sent At', value: `<t:${Math.floor(dbLog.createdAt.getTime() / 1000)}:f>`, inline: true }
        )
        .setTimestamp();

      await logChannel.send({
        embeds: [embed],
        files: attachmentBuffers,
      });
      await this.removeDeleteLogMediaDir(dbLog.guildId, dbLog.id);
    } catch (err: any) {
      this.logger.error(`Error in handleMessageDelete: ${err.message}`, err.stack, 'DiscordBot');
    }
  }

  private async handleMessageDeleteBulk(messages: any) {
    const firstMsg = messages.first();
    if (!firstMsg || !firstMsg.guild) return;

    const guildId = firstMsg.guild.id;
    const channelId = firstMsg.channel.id;

    try {
      const settings = await this.messageLogs.prisma.guildSettings.findUnique({
        where: { guildId },
      });

      const logChannelId = settings?.messageDeleteLogChannelId;
      if (!logChannelId) return;

      const messageIds = messages.map((m: any) => m.id);
      const dbLogs = await this.messageLogs.prisma.discordMessageLog.findMany({
        where: { id: { in: messageIds } },
        orderBy: { createdAt: 'asc' },
      });

      if (dbLogs.length === 0) return;

      const logChannel = await firstMsg.guild.channels.fetch(logChannelId).catch(() => null);
      if (!logChannel || !logChannel.isTextBased()) return;

      const logLines: string[] = [
        `=== BULK DELETION LOG: #${firstMsg.channel.name || channelId} ===`,
        `Guild: ${firstMsg.guild.name} (${guildId})`,
        `Deleted count: ${dbLogs.length}`,
        `Date: ${new Date().toISOString()}`,
        `----------------------------------------\n`
      ];

      for (const log of dbLogs) {
        const timestamp = log.createdAt.toISOString();
        const attachments = (log.attachments as any[]) || [];
        const attNames = attachments.map((a) => a.name).join(', ');
        const attSuffix = attNames ? ` [Attachments: ${attNames}]` : '';
        logLines.push(`[${timestamp}] User ID ${log.authorId}: ${log.content || ''}${attSuffix}`);
      }

      logLines.push(`\n========================================`);
      const logContent = logLines.join('\n');
      const buffer = Buffer.from(logContent, 'utf8');

      await logChannel.send({
        content: `🗑️ **Bulk Message Deletion**\nChannel: <#${channelId}>\nDeleted: \`${dbLogs.length} messages\``,
        files: [{ attachment: buffer, name: `bulk-delete-log-${Date.now()}.txt` }],
      }).catch((err: any) => this.logger.error(`Failed to send message delete bulk log: ${err.message}`, err.stack, 'DiscordBot'));
    } catch (err: any) {
      this.logger.error(`Error in handleMessageDeleteBulk: ${err.message}`, err.stack, 'DiscordBot');
    }
  }

  private isBoosting(member: GuildMember) {
    const premiumRoleId = member.guild.roles.premiumSubscriberRole?.id;
    return Boolean(member.premiumSince || (premiumRoleId && member.roles.cache.has(premiumRoleId)));
  }

  private async handleVoiceStateUpdate(oldState: any, newState: any) {
    const member = newState.member || oldState.member;
    if (!member || member.user.bot || !newState.guild) return;

    const guildId = newState.guild.id;
    const userId = member.id;

    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // Case 1: Join Voice
    if (!oldChannelId && newChannelId) {
      const sent = await this.rustAnalytics.ingestVoiceState({
        guildId,
        userId,
        channelId: newChannelId,
        eventType: 1,
        timestampMs: Date.now(),
      });
      if (!sent) {
        await this.messageLogs.prisma.voiceSession.create({
          data: {
            guildId,
            userId,
            channelId: newChannelId,
            joinedAt: new Date(),
          },
        }).catch(() => null);
      }
    }
    // Case 2: Leave Voice
    else if (oldChannelId && !newChannelId) {
      const sent = await this.rustAnalytics.ingestVoiceState({
        guildId,
        userId,
        channelId: oldChannelId,
        eventType: 2,
        timestampMs: Date.now(),
      });
      if (!sent) {
        await this.closeActiveVoiceSession(guildId, userId);
      }
    }
    // Case 3: Move Channels
    else if (oldChannelId && newChannelId && oldChannelId !== newChannelId) {
      const sent = await this.rustAnalytics.ingestVoiceState({
        guildId,
        userId,
        channelId: newChannelId,
        eventType: 3,
        timestampMs: Date.now(),
      });
      if (!sent) {
        await this.closeActiveVoiceSession(guildId, userId);
        await this.messageLogs.prisma.voiceSession.create({
          data: {
            guildId,
            userId,
            channelId: newChannelId,
            joinedAt: new Date(),
          },
        }).catch(() => null);
      }
    }
  }

  private async closeActiveVoiceSession(guildId: string, userId: string) {
    const activeSession = await this.messageLogs.prisma.voiceSession.findFirst({
      where: {
        guildId,
        userId,
        leftAt: null,
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    if (activeSession) {
      const now = new Date();
      const durationSeconds = Math.max(0, Math.floor((now.getTime() - activeSession.joinedAt.getTime()) / 1000));

      await this.messageLogs.prisma.voiceSession.update({
        where: { id: activeSession.id },
        data: {
          leftAt: now,
          duration: durationSeconds,
        },
      }).catch(() => null);
    }
  }
}
