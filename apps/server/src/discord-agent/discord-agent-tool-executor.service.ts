import { BadRequestException, Injectable, ServiceUnavailableException, ForbiddenException } from '@nestjs/common';
import { Client, PermissionFlagsBits } from 'discord.js';
import * as vm from 'node:vm';
import { ModerationService } from '../moderation/moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentActionProposalService } from './agent-action-proposal.service';
import { DiscordAgentContextService } from './discord-agent-context.service';
import { DiscordMessageLogService } from './discord-message-log.service';
import { AgentActionRecommendation, AgentActionType, AgentSettingsUpdate } from './agent-action.types';
import { PluginToolRegistryService } from '../plugins/plugin-tool-registry.service';

const MAX_READ_LIMIT = 100;
const MAX_BATCH_ITEMS = 25;
const QUARANTINE_SNAPSHOT_PREFIX = '[Quarantine Snapshot]';
const DISCORD_ACTION_TOOLS: Record<string, AgentActionType> = {
  create_channel: 'CREATE_CHANNEL',
  edit_channel: 'EDIT_CHANNEL',
  delete_channel: 'DELETE_CHANNEL',
  move_channel: 'MOVE_CHANNEL',
  set_channel_permissions: 'SET_CHANNEL_PERMISSIONS',
  create_category_with_channels: 'CREATE_CATEGORY_WITH_CHANNELS',
  clone_channel_permissions: 'CLONE_CHANNEL_PERMISSIONS',
  sync_category_permissions: 'SYNC_CATEGORY_PERMISSIONS',
  rename_channel_batch: 'RENAME_CHANNEL_BATCH',
  cleanup_empty_channels: 'CLEANUP_EMPTY_CHANNELS',
  create_role: 'CREATE_ROLE',
  edit_role: 'EDIT_ROLE',
  delete_role: 'DELETE_ROLE',
  move_role: 'MOVE_ROLE',
  snapshot_member_roles: 'SNAPSHOT_MEMBER_ROLES',
  restore_member_roles: 'RESTORE_MEMBER_ROLES',
  quarantine_member: 'QUARANTINE_MEMBER',
  send_plain_message: 'SEND_PLAIN_MESSAGE',
  send_embed_message: 'SEND_EMBED_MESSAGE',
  edit_bot_message: 'EDIT_BOT_MESSAGE',
  delete_bot_message: 'DELETE_BOT_MESSAGE',
  create_thread: 'CREATE_THREAD',
  archive_thread: 'ARCHIVE_THREAD',
  lock_thread: 'LOCK_THREAD',
  pin_message: 'PIN_MESSAGE',
  unpin_message: 'UNPIN_MESSAGE',
  react_to_message: 'REACT_TO_MESSAGE',
  remove_reaction: 'REMOVE_REACTION',
  move_member_voice: 'MOVE_MEMBER_VOICE',
  disconnect_member_voice: 'DISCONNECT_MEMBER_VOICE',
  set_voice_channel_status: 'SET_VOICE_CHANNEL_STATUS',
  create_invite: 'CREATE_INVITE',
  delete_invite: 'DELETE_INVITE',
  bot_join_voice: 'BOT_JOIN_VOICE',
  bot_leave_voice: 'BOT_LEAVE_VOICE',
};

@Injectable()
export class DiscordAgentToolExecutorService {
  private client?: Client;

  constructor(
    private readonly moderation: ModerationService,
    private readonly prisma: PrismaService,
    private readonly proposals: AgentActionProposalService,
    private readonly messageLogs: DiscordMessageLogService,
    private readonly contextService: DiscordAgentContextService,
    private readonly pluginTools: PluginToolRegistryService,
  ) {}

  setClient(client: Client) {
    this.client = client;
  }

  async execute(
    name: string,
    args: any,
    context: { guildId: string; channelId: string; requestedById: string },
  ): Promise<any> {
    if (this.pluginTools.has(name)) {
      return this.pluginTools.execute(name, args, context);
    }

    const discordActionType = DISCORD_ACTION_TOOLS[name];
    if (discordActionType) {
      return this.createDiscordActionProposal(discordActionType, args, context);
    }

    switch (name) {
      case 'get_user_warnings':
        return this.moderation.listWarnings(context.guildId, { search: this.requireString(args.targetUserId, 'targetUserId') });

      case 'get_member_info':
        return this.contextService.buildModContext(context.guildId, this.requireString(args.targetUserId, 'targetUserId'));

      case 'get_server_settings':
        return this.getServerSettings(context.guildId);

      case 'get_channel_recent_messages':
        return this.getChannelRecentMessages(context.guildId, args.channelId || context.channelId, args.targetUserId, args.limit);

      case 'get_deleted_message_history':
        return this.getDeletedMessageHistory(context.guildId, args.channelId, args.targetUserId, args.limit);

      case 'get_server_channels':
        return this.getServerChannels(context.guildId);

      case 'get_server_roles':
        return this.getServerRoles(context.guildId);

      case 'get_channel_slowmode':
        return this.getChannelSlowmode(context.guildId, args.channelId || context.channelId);

      case 'get_guild_overview':
        return this.getGuildOverview(context.guildId);

      case 'get_channel_info':
        return this.getChannelInfo(context.guildId, args.channelId || context.channelId);

      case 'get_member_permissions':
        return this.getMemberPermissions(
          context.guildId,
          this.requireString(args.targetUserId, 'targetUserId'),
          args.channelId || context.channelId,
        );

      case 'get_bot_permissions':
        return this.getBotPermissions(context.guildId, args.channelId || context.channelId, args.targetUserId, args.roleId);

      case 'get_role_info':
        return this.getRoleInfo(context.guildId, this.requireString(args.roleId, 'roleId'));

      case 'get_voice_state':
        return this.getVoiceState(context.guildId, this.requireString(args.targetUserId, 'targetUserId'));

      case 'preview_embed_message':
        return this.previewEmbedMessage(args);

      case 'warn_user': {
        const warnProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: { type: 'WARN', reason: this.requireString(args.reason, 'reason') },
        });
        return { proposalCreated: true, proposalId: warnProposal.id, actionType: 'WARN' };
      }

      case 'timeout_user': {
        const timeoutProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: {
            type: 'TIMEOUT',
            reason: this.requireString(args.reason, 'reason'),
            durationMinutes: args.durationMinutes || 10,
          },
        });
        return { proposalCreated: true, proposalId: timeoutProposal.id, actionType: 'TIMEOUT' };
      }

      case 'kick_user': {
        const kickProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: { type: 'KICK', reason: this.requireString(args.reason, 'reason') },
        });
        return { proposalCreated: true, proposalId: kickProposal.id, actionType: 'KICK' };
      }

      case 'ban_user': {
        const banProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: {
            type: 'BAN',
            reason: this.requireString(args.reason, 'reason'),
            deleteMessageSeconds: args.deleteMessageSeconds,
          },
        });
        return { proposalCreated: true, proposalId: banProposal.id, actionType: 'BAN' };
      }

      case 'purge_channel_messages': {
        const purgeProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: args.targetUserId || null,
          recommendation: {
            type: 'PURGE',
            reason: this.requireString(args.reason, 'reason'),
            purgeLimit: args.limit,
            purgeChannelId: args.channelId || context.channelId,
            purgeTargetUserId: args.targetUserId,
          },
        });
        return { proposalCreated: true, proposalId: purgeProposal.id, actionType: 'PURGE' };
      }

      case 'add_role_to_user': {
        const roleProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: {
            type: 'ADD_ROLE',
            reason: this.requireString(args.reason, 'reason'),
            roleId: this.requireString(args.roleId, 'roleId'),
          },
        });
        return { proposalCreated: true, proposalId: roleProposal.id, actionType: 'ADD_ROLE' };
      }

      case 'remove_role_from_user': {
        const roleProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: {
            type: 'REMOVE_ROLE',
            reason: this.requireString(args.reason, 'reason'),
            roleId: this.requireString(args.roleId, 'roleId'),
          },
        });
        return { proposalCreated: true, proposalId: roleProposal.id, actionType: 'REMOVE_ROLE' };
      }

      case 'remove_timeout_user': {
        const timeoutProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: { type: 'REMOVE_TIMEOUT', reason: this.requireString(args.reason, 'reason') },
        });
        return { proposalCreated: true, proposalId: timeoutProposal.id, actionType: 'REMOVE_TIMEOUT' };
      }

      case 'revoke_warning': {
        const warningProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'REVOKE_WARNING',
            reason: this.requireString(args.reason, 'reason'),
            warningId: this.requireString(args.warningId, 'warningId'),
          },
        });
        return { proposalCreated: true, proposalId: warningProposal.id, actionType: 'REVOKE_WARNING' };
      }

      case 'update_server_settings': {
        const settings = this.extractSettings(args);
        if (!Object.keys(settings).length) {
          throw new BadRequestException('At least one supported setting must be provided.');
        }
        const settingsProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'UPDATE_SETTINGS',
            reason: this.requireString(args.reason, 'reason'),
            settings,
          },
        });
        return { proposalCreated: true, proposalId: settingsProposal.id, actionType: 'UPDATE_SETTINGS' };
      }

      case 'lockdown_channel': {
        const lockdownProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'LOCKDOWN',
            reason: this.requireString(args.reason, 'reason'),
            channelId: args.channelId || context.channelId,
          },
        });
        return { proposalCreated: true, proposalId: lockdownProposal.id, actionType: 'LOCKDOWN' };
      }

      case 'unlock_channel': {
        const unlockProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'UNLOCK',
            reason: this.requireString(args.reason, 'reason'),
            channelId: args.channelId || context.channelId,
          },
        });
        return { proposalCreated: true, proposalId: unlockProposal.id, actionType: 'UNLOCK' };
      }

      case 'set_channel_slowmode': {
        const slowmodeProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'SET_SLOWMODE',
            reason: this.requireString(args.reason, 'reason'),
            channelId: args.channelId || context.channelId,
            slowmodeSeconds: args.slowmodeSeconds,
          },
        });
        return { proposalCreated: true, proposalId: slowmodeProposal.id, actionType: 'SET_SLOWMODE' };
      }

      case 'send_channel_announcement': {
        const announcementProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'SEND_ANNOUNCEMENT',
            reason: this.requireString(args.reason, 'reason'),
            channelId: args.channelId || context.channelId,
            content: this.requireString(args.content, 'content'),
            title: args.title || undefined,
            announcementColor: args.color || undefined,
            announcementImageUrl: args.imageUrl || undefined,
            announcementThumbnailUrl: args.thumbnailUrl || undefined,
            announcementFooter: args.footer || undefined,
            announcementPing: args.ping || 'none',
          },
        });
        return { proposalCreated: true, proposalId: announcementProposal.id, actionType: 'SEND_ANNOUNCEMENT' };
      }

      case 'get_discord_audit_logs':
        return this.getDiscordAuditLogs(context.guildId, args.limit, args.targetUserId, args.actionType);

      case 'get_audit_logs':
        return this.getAuditLogs(context.guildId, {
          category: args.category,
          actionType: args.actionType,
          targetUserId: args.targetUserId,
          executorId: args.executorId,
          limit: args.limit,
        });

      case 'get_member_audit_trail':
        return this.getAuditLogs(context.guildId, {
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          limit: args.limit,
        });

      case 'get_moderator_actions':
        return this.getAuditLogs(context.guildId, {
          executorId: this.requireString(args.moderatorId, 'moderatorId'),
          limit: args.limit,
        });

      case 'search_audit_events':
        return this.searchAuditEvents(context.guildId, this.requireString(args.query, 'query'), args.limit);

      case 'check_user_activity_score':
        return this.checkUserActivityScore(context.guildId, this.requireString(args.targetUserId, 'targetUserId'), args.days);

      case 'get_recent_joins':
        return this.getRecentJoins(context.guildId, args.limit, args.hours);

      case 'purge_user_messages': {
        const purgeUserProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: this.requireString(args.targetUserId, 'targetUserId'),
          recommendation: {
            type: 'PURGE_USER_MESSAGES',
            reason: this.requireString(args.reason, 'reason'),
            purgeLimit: args.limit || 50,
            purgeUserChannels: Array.isArray(args.channels) ? args.channels : undefined,
          },
        });
        return { proposalCreated: true, proposalId: purgeUserProposal.id, actionType: 'PURGE_USER_MESSAGES' };
      }

      case 'get_message_context':
        return this.getMessageContext(
          context.guildId,
          args.channelId || context.channelId,
          this.requireString(args.messageId, 'messageId'),
        );

      case 'find_duplicate_messages':
        return this.findDuplicateMessages(context.guildId, args.limit, args.hours);

      case 'get_server_stats':
        return this.getServerStats(context.guildId);

      case 'mass_moderation_action': {
        const targetIds = Array.isArray(args.targetUserIds)
          ? args.targetUserIds.filter((id: unknown) => typeof id === 'string' && id.trim()).map((id: string) => id.trim())
          : [];
        if (targetIds.length === 0) {
          throw new BadRequestException('targetUserIds array is empty or invalid.');
        }
        const actionType = this.requireString(args.actionType, 'actionType').toUpperCase();
        if (!['TIMEOUT', 'KICK', 'BAN'].includes(actionType)) {
          throw new BadRequestException('Invalid mass actionType. Supported: TIMEOUT, KICK, BAN');
        }
        const recommendationType = `MASS_${actionType}` as any;
        const massProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: recommendationType,
            reason: this.requireString(args.reason, 'reason'),
            targetUserIds: targetIds,
            durationMinutes: args.durationMinutes,
          },
        });
        return { proposalCreated: true, proposalId: massProposal.id, actionType: recommendationType };
      }

      case 'get_invite_links':
        return this.getInviteLinks(context.guildId);

      case 'add_user_note':
        return this.addUserNote(
          context.guildId,
          this.requireString(args.targetUserId, 'targetUserId'),
          context.requestedById,
          this.requireString(args.content, 'content'),
        );

      case 'get_user_notes':
        return this.getUserNotes(context.guildId, this.requireString(args.targetUserId, 'targetUserId'));

      case 'manage_server_sticker': {
        const action = this.requireString(args.action, 'action').toUpperCase();
        if (!['ADD', 'DELETE'].includes(action)) {
          throw new BadRequestException('action must be ADD or DELETE.');
        }
        const stickerProposal = await this.proposals.createProposal({
          guildId: context.guildId,
          channelId: context.channelId,
          requestedById: context.requestedById,
          targetUserId: null,
          recommendation: {
            type: 'MANAGE_STICKER',
            reason: this.requireString(args.reason, 'reason'),
            stickerName: this.requireString(args.name, 'name'),
            stickerUrl: args.url || undefined,
            stickerId: args.stickerId || undefined,
            stickerAction: action as any,
          },
        });
        return { proposalCreated: true, proposalId: stickerProposal.id, actionType: 'MANAGE_STICKER' };
      }


      case 'execute_godmode_script':
        return this.executeGodmodeScript(
          this.requireString(args.code, 'code'),
          context.requestedById,
        );

      default:
        throw new Error(`Tool ${name} is not implemented.`);
    }
  }

  private async getServerSettings(guildId: string) {
    const settings = await this.prisma.guildSettings.findUnique({
      where: { guildId },
    });
    return {
      logChannelId: settings?.logChannelId || null,
      messageDeleteLogChannelId: settings?.messageDeleteLogChannelId || null,
      stickerEnabled: settings?.stickerEnabled || false,
      slowmodeEnabled: settings?.slowmodeEnabled || false,
      slowmodeChannels: settings?.slowmodeChannels || [],
      slowmodeIntervalQuiet: settings?.slowmodeIntervalQuiet ?? 0,
      slowmodeIntervalNormal: settings?.slowmodeIntervalNormal ?? 5,
      slowmodeIntervalBusy: settings?.slowmodeIntervalBusy ?? 10,
      anomalyEnabled: settings?.anomalyEnabled || false,
      phishingDetectionEnabled: settings?.phishingDetectionEnabled ?? true,
      contentAnomalyEnabled: settings?.contentAnomalyEnabled ?? true,
      userAnomalyEnabled: settings?.userAnomalyEnabled ?? true,
      guildBaselineEnabled: settings?.guildBaselineEnabled ?? true,
      anomalyEnforcementMode: settings?.anomalyEnforcementMode || 'AUDIT_ONLY',
      warnLimitEnabled: settings?.warnLimitEnabled || false,
      warnLimitThreshold: settings?.warnLimitThreshold ?? 3,
      warnTimeoutDurationMin: settings?.warnTimeoutDurationMin ?? 60,
      warnExpiryDays: settings?.warnExpiryDays ?? 30,
    };
  }

  private async getChannelRecentMessages(guildId: string, channelId: string, targetUserId?: string, rawLimit?: number) {
    const limit = this.clampNumber(rawLimit || 15, 1, MAX_READ_LIMIT);
    const messages = await this.messageLogs.getChannelRecentMessages(guildId, this.requireString(channelId, 'channelId'), limit, targetUserId);
    return messages.map((message) => ({
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      attachments: message.attachments,
    }));
  }

  private async getDeletedMessageHistory(guildId: string, channelId?: string, targetUserId?: string, rawLimit?: number) {
    const limit = this.clampNumber(rawLimit || 15, 1, MAX_READ_LIMIT);
    const messages = await this.messageLogs.getDeletedMessages(guildId, limit, {
      channelId: typeof channelId === 'string' && channelId.trim() ? channelId.trim() : undefined,
      userId: typeof targetUserId === 'string' && targetUserId.trim() ? targetUserId.trim() : undefined,
    });
    return messages.map((message) => ({
      id: message.id,
      channelId: message.channelId,
      authorId: message.authorId,
      content: message.content,
      createdAt: message.createdAt,
      editedAt: message.editedAt,
      deletedAt: message.deletedAt,
      attachments: message.attachments,
    }));
  }

  private async getServerChannels(guildId: string) {
    const guild = await this.getGuild(guildId);
    await guild.channels.fetch();
    return guild.channels.cache
      .filter((channel: any) => channel && typeof channel.isTextBased === 'function' && channel.isTextBased())
      .map((channel: any) => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId || null,
        rateLimitPerUser: typeof channel.rateLimitPerUser === 'number' ? channel.rateLimitPerUser : null,
      }))
      .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)));
  }

  private async getServerRoles(guildId: string) {
    const guild = await this.getGuild(guildId);
    await guild.roles.fetch();
    const me = guild.members.me ?? await guild.members.fetchMe();
    return guild.roles.cache
      .filter((role) => role.id !== guild.id)
      .map((role) => ({
        id: role.id,
        name: role.name,
        position: role.position,
        managed: role.managed,
        mentionable: role.mentionable,
        color: role.hexColor,
        manageableByBot: !role.managed && role.position < me.roles.highest.position,
      }))
      .sort((a, b) => b.position - a.position);
  }

  private async getChannelSlowmode(guildId: string, channelId: string) {
    const guild = await this.getGuild(guildId);
    const channel = await guild.channels.fetch(this.requireString(channelId, 'channelId'));
    if (!channel || typeof (channel as any).rateLimitPerUser !== 'number') {
      throw new BadRequestException('Channel does not support slowmode.');
    }
    return {
      channelId: channel.id,
      rateLimitPerUser: (channel as any).rateLimitPerUser,
    };
  }

  private async getGuildOverview(guildId: string) {
    const guild = await this.getGuild(guildId);
    await Promise.all([guild.channels.fetch().catch(() => null), guild.roles.fetch().catch(() => null)]);
    const me = guild.members.me ?? await guild.members.fetchMe();
    return {
      id: guild.id,
      name: guild.name,
      ownerId: guild.ownerId || null,
      memberCount: guild.memberCount,
      premiumTier: guild.premiumTier ?? null,
      premiumSubscriptionCount: guild.premiumSubscriptionCount || 0,
      channelCount: guild.channels.cache.size,
      roleCount: guild.roles.cache.size,
      bot: this.formatMemberSummary(me),
    };
  }

  private async getChannelInfo(guildId: string, channelId: string) {
    const guild = await this.getGuild(guildId);
    const channel = await guild.channels.fetch(this.requireString(channelId, 'channelId')).catch(() => null) as any;
    if (!channel) throw new BadRequestException('Channel is not available.');
    return {
      id: channel.id,
      name: channel.name,
      type: channel.type,
      parentId: channel.parentId || null,
      position: channel.position ?? null,
      topic: channel.topic || null,
      nsfw: channel.nsfw ?? null,
      rateLimitPerUser: channel.rateLimitPerUser ?? null,
      bitrate: channel.bitrate ?? null,
      userLimit: channel.userLimit ?? null,
      permissionOverwrites: channel.permissionOverwrites?.cache?.map((overwrite: any) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow?.toArray?.() || [],
        deny: overwrite.deny?.toArray?.() || [],
      })) || [],
    };
  }

  private async getMemberPermissions(guildId: string, targetUserId: string, channelId?: string) {
    const guild = await this.getGuild(guildId);
    const member = await guild.members.fetch(targetUserId).catch(() => null) as any;
    if (!member) throw new BadRequestException('Member is not available in this server.');
    const me = guild.members.me ?? await guild.members.fetchMe();
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) as any : null;
    const permissions = channel && typeof member.permissionsIn === 'function' ? member.permissionsIn(channel.id) : member.permissions;
    return {
      member: this.formatMemberSummary(member),
      guildPermissions: member.permissions?.toArray?.() || [],
      channelId: channel?.id || null,
      channelPermissions: permissions?.toArray?.() || [],
      manageableByBot: member.roles.highest.position < me.roles.highest.position,
    };
  }

  private async getBotPermissions(guildId: string, channelId?: string, targetUserId?: string, roleId?: string) {
    const guild = await this.getGuild(guildId);
    const me = guild.members.me ?? await guild.members.fetchMe();
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) as any : null;
    const permissions = channel && typeof me.permissionsIn === 'function' ? me.permissionsIn(channel.id) : me.permissions;
    const target = typeof targetUserId === 'string' && targetUserId.trim()
      ? await guild.members.fetch(targetUserId.trim()).catch(() => null) as any
      : null;
    const role = typeof roleId === 'string' && roleId.trim()
      ? await guild.roles.fetch(roleId.trim()).catch(() => null) as any
      : null;
    return {
      bot: this.formatMemberSummary(me),
      channelId: channel?.id || null,
      permissions: permissions?.toArray?.() || [],
      canManageTargetMember: target ? target.roles.highest.position < me.roles.highest.position : null,
      canManageRole: role ? !role.managed && role.position < me.roles.highest.position : null,
    };
  }

  private async getRoleInfo(guildId: string, roleId: string) {
    const guild = await this.getGuild(guildId);
    const role = await guild.roles.fetch(roleId).catch(() => null) as any;
    if (!role) throw new BadRequestException('Role is not available in this server.');
    const me = guild.members.me ?? await guild.members.fetchMe();
    return {
      id: role.id,
      name: role.name,
      color: role.hexColor,
      position: role.position,
      managed: role.managed,
      mentionable: role.mentionable,
      hoist: role.hoist,
      permissions: role.permissions?.toArray?.() || [],
      memberCount: role.members?.size ?? null,
      manageableByBot: !role.managed && role.position < me.roles.highest.position,
    };
  }

  private async getVoiceState(guildId: string, targetUserId: string) {
    const guild = await this.getGuild(guildId);
    const member = await guild.members.fetch(targetUserId).catch(() => null) as any;
    if (!member) throw new BadRequestException('Member is not available in this server.');
    return {
      targetUserId,
      channelId: member.voice?.channelId || null,
      channelName: member.voice?.channel?.name || null,
      selfMute: member.voice?.selfMute ?? null,
      selfDeaf: member.voice?.selfDeaf ?? null,
      serverMute: member.voice?.serverMute ?? null,
      serverDeaf: member.voice?.serverDeaf ?? null,
      streaming: member.voice?.streaming ?? null,
      suppress: member.voice?.suppress ?? null,
    };
  }

  private previewEmbedMessage(args: any) {
    const title = typeof args.title === 'string' ? args.title : '';
    const description = typeof args.description === 'string' ? args.description : '';
    const footer = typeof args.footer === 'string' ? args.footer : '';
    const fields = Array.isArray(args.fields) ? args.fields.slice(0, 50) : [];
    const warnings: string[] = [];
    if (title.length > 256) warnings.push('Title exceeds 256 characters.');
    if (description.length > 4096) warnings.push('Description exceeds 4096 characters.');
    if (footer.length > 2048) warnings.push('Footer exceeds 2048 characters.');
    if (fields.length > 25) warnings.push('Embed has more than 25 fields.');
    for (const [index, field] of fields.entries()) {
      if (String(field?.name || '').length > 256) warnings.push(`Field ${index + 1} name exceeds 256 characters.`);
      if (String(field?.value || '').length > 1024) warnings.push(`Field ${index + 1} value exceeds 1024 characters.`);
    }
    const totalLength = title.length + description.length + footer.length + fields.reduce((sum: number, field: any) => sum + String(field?.name || '').length + String(field?.value || '').length, 0);
    if (totalLength > 6000) warnings.push('Combined embed text exceeds 6000 characters.');
    return { valid: warnings.length === 0, totalLength, warnings };
  }

  private formatMemberSummary(member: any) {
    return {
      id: member.id,
      tag: member.user?.tag || null,
      username: member.user?.username || null,
      displayName: member.displayName || member.user?.globalName || member.user?.username || null,
      highestRole: member.roles?.highest ? { id: member.roles.highest.id, name: member.roles.highest.name, position: member.roles.highest.position } : null,
      roles: member.roles?.cache?.map?.((role: any) => ({ id: role.id, name: role.name, position: role.position })) || [],
    };
  }

  private async createDiscordActionProposal(
    type: AgentActionType,
    args: any,
    context: { guildId: string; channelId: string; requestedById: string },
  ) {
    const recommendation = this.buildDiscordRecommendation(type, args, context);
    if (type === 'BOT_JOIN_VOICE' && !recommendation.voiceChannelId) {
      recommendation.voiceChannelId = await this.getRequesterVoiceChannelId(context.guildId, context.requestedById);
    }
    const proposal = await this.proposals.createProposal({
      guildId: context.guildId,
      channelId: context.channelId,
      requestedById: context.requestedById,
      targetUserId: typeof args.targetUserId === 'string' && args.targetUserId.trim() ? args.targetUserId.trim() : null,
      recommendation,
    });
    return { proposalCreated: true, proposalId: proposal.id, actionType: type };
  }

  private async getRequesterVoiceChannelId(guildId: string, requestedById: string) {
    const guild = await this.getGuild(guildId);
    const requester = await guild.members.fetch(requestedById).catch(() => null) as any;
    const voiceChannelId = requester?.voice?.channelId;
    if (!voiceChannelId) {
      throw new BadRequestException('Kamu belum masuk voice channel. Masuk voice dulu atau sebutkan voiceChannelId yang spesifik.');
    }
    return voiceChannelId;
  }

  private buildDiscordRecommendation(
    type: AgentActionType,
    args: any,
    context: { channelId: string },
  ): AgentActionRecommendation {
    const rec: AgentActionRecommendation = {
      type,
      reason: this.requireString(args.reason, 'reason'),
      targetUserId: args.targetUserId,
      targetUserIds: Array.isArray(args.targetUserIds) ? args.targetUserIds : undefined,
      channelId: args.channelId || context.channelId,
      parentId: args.parentId ?? args.categoryId ?? null,
      channelName: args.name,
      channelType: args.type,
      topic: args.topic,
      nsfw: args.nsfw,
      slowmodeSeconds: args.slowmodeSeconds,
      position: args.position,
      permissionTargetId: args.targetId,
      permissionTargetType: args.targetType,
      permissionOverwrites: args.overwrites,
      channels: args.channels,
      roleId: args.roleId,
      roleName: args.name,
      roleColor: args.color,
      hoist: args.hoist,
      mentionable: args.mentionable,
      messageId: args.messageId,
      content: args.content,
      title: args.title || args.name,
      embedDescription: args.description,
      fields: args.fields,
      imageUrl: args.imageUrl,
      thumbnailUrl: args.thumbnailUrl,
      footer: args.footer,
      color: args.color,
      emoji: args.emoji,
      voiceChannelId: args.voiceChannelId,
      userLimit: args.userLimit,
      bitrate: args.bitrate,
      maxAgeSeconds: args.maxAgeSeconds,
      maxUses: args.maxUses,
      temporary: args.temporary,
      unique: args.unique,
      archived: args.archived,
      locked: args.locked,
      quarantineRoleId: args.quarantineRoleId,
      removeOtherRoles: args.removeOtherRoles,
      durationMinutes: args.durationMinutes,
      deleteMessageSeconds: args.deleteMessageSeconds,
    };
    if (args.sourceChannelId) rec.channelId = args.sourceChannelId;
    if (args.targetChannelId) rec.purgeChannelId = args.targetChannelId;
    if (args.code) rec.stickerId = args.code;
    return rec;
  }

  private async getGuild(guildId: string) {
    if (!this.client) throw new ServiceUnavailableException('Discord client is not ready yet.');
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) throw new BadRequestException('Guild is not available.');
    return guild;
  }

  private requireString(value: unknown, field: string) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${field} is required.`);
    }
    return value.trim();
  }

  private clampNumber(value: unknown, min: number, max: number) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return min;
    return Math.min(Math.max(Math.floor(numberValue), min), max);
  }

  private extractSettings(args: any): AgentSettingsUpdate {
    const settings: AgentSettingsUpdate = {};
    this.copyStringOrNull(args, settings, 'logChannelId');
    this.copyStringOrNull(args, settings, 'messageDeleteLogChannelId');
    this.copyBoolean(args, settings, 'stickerEnabled');
    this.copyBoolean(args, settings, 'slowmodeEnabled');
    this.copyStringArray(args, settings, 'slowmodeChannels');
    this.copyInteger(args, settings, 'slowmodeIntervalQuiet');
    this.copyInteger(args, settings, 'slowmodeIntervalNormal');
    this.copyInteger(args, settings, 'slowmodeIntervalBusy');
    this.copyBoolean(args, settings, 'anomalyEnabled');
    this.copyBoolean(args, settings, 'phishingDetectionEnabled');
    this.copyBoolean(args, settings, 'contentAnomalyEnabled');
    this.copyBoolean(args, settings, 'userAnomalyEnabled');
    this.copyBoolean(args, settings, 'guildBaselineEnabled');
    this.copyString(args, settings, 'anomalyEnforcementMode');
    this.copyBoolean(args, settings, 'warnLimitEnabled');
    this.copyInteger(args, settings, 'warnLimitThreshold');
    this.copyInteger(args, settings, 'warnTimeoutDurationMin');
    this.copyInteger(args, settings, 'warnExpiryDays');
    return settings;
  }

  private copyBoolean(source: any, target: Record<string, any>, key: string) {
    if (typeof source[key] === 'boolean') target[key] = source[key];
  }

  private copyInteger(source: any, target: Record<string, any>, key: string) {
    if (source[key] === undefined || source[key] === null || source[key] === '') return;
    const value = Number(source[key]);
    if (Number.isFinite(value)) target[key] = Math.floor(value);
  }

  private copyString(source: any, target: Record<string, any>, key: string) {
    if (typeof source[key] === 'string' && source[key].trim()) target[key] = source[key].trim();
  }

  private copyStringOrNull(source: any, target: Record<string, any>, key: string) {
    if (source[key] === null) {
      target[key] = null;
      return;
    }
    if (typeof source[key] === 'string') target[key] = source[key].trim() || null;
  }

  private copyStringArray(source: any, target: Record<string, any>, key: string) {
    if (Array.isArray(source[key])) {
      target[key] = source[key].filter((value: unknown) => typeof value === 'string' && value.trim()).map((value: string) => value.trim());
    }
  }

  private async getDiscordAuditLogs(guildId: string, limit?: number, targetUserId?: string, actionType?: string) {
    const guild = await this.getGuild(guildId);
    const me = guild.members.me ?? await guild.members.fetchMe();

    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      throw new ForbiddenException('Bot lacks View Audit Log permission in this server.');
    }

    const fetchedLogs = await guild.fetchAuditLogs({
      limit: this.clampNumber(limit || 15, 1, MAX_READ_LIMIT),
      user: targetUserId || undefined,
      type: actionType ? (Number.isInteger(Number(actionType)) ? Number(actionType) : actionType as any) : undefined,
    });

    return fetchedLogs.entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      reason: entry.reason || null,
      executorId: entry.executor?.id || null,
      executorTag: entry.executor?.tag || null,
      targetId: entry.targetId || null,
      createdAt: entry.createdAt,
      changes: entry.changes?.map((c) => ({
        key: c.key,
        old: c.old,
        new: c.new,
      })) || [],
    }));
  }

  private async getAuditLogs(
    guildId: string,
    filters: {
      category?: string;
      actionType?: string;
      targetUserId?: string;
      executorId?: string;
      limit?: number;
    },
  ) {
    const guild = await this.getGuild(guildId);
    const me = guild.members.me ?? await guild.members.fetchMe();

    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      throw new ForbiddenException('Bot lacks View Audit Log permission in this server.');
    }

    const rawLimit = this.clampNumber(filters.limit || 15, 1, 50);

    // Fetch slightly more raw logs than requested to allow filtering by target/category post-fetch
    const fetchLimit = filters.targetUserId || filters.category ? Math.min(100, rawLimit * 3) : rawLimit;

    const fetchedLogs = await guild.fetchAuditLogs({
      limit: fetchLimit,
      user: filters.executorId || undefined,
      type: filters.actionType ? (Number.isInteger(Number(filters.actionType)) ? Number(filters.actionType) : filters.actionType as any) : undefined,
    });

    let entries = fetchedLogs.entries.map((entry) => this.normalizeAuditEntry(entry));

    // Filter post-fetch if targetUserId is set
    if (filters.targetUserId) {
      entries = entries.filter((e) => e.target.id === filters.targetUserId);
    }

    // Filter post-fetch if category is set
    if (filters.category) {
      entries = entries.filter((e) => e.category === filters.category);
    }

    // Slice to the requested limit
    entries = entries.slice(0, rawLimit);

    return {
      guildId,
      count: entries.length,
      entries,
    };
  }

  private async searchAuditEvents(guildId: string, query: string, limit?: number) {
    const guild = await this.getGuild(guildId);
    const me = guild.members.me ?? await guild.members.fetchMe();

    if (!me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      throw new ForbiddenException('Bot lacks View Audit Log permission in this server.');
    }

    const rawLimit = this.clampNumber(limit || 15, 1, 50);
    const fetchedLogs = await guild.fetchAuditLogs({
      limit: 100, // Fetch more to query match
    });

    const normalized = fetchedLogs.entries.map((entry) => this.normalizeAuditEntry(entry));
    const term = query.toLowerCase().trim();

    const matches = normalized.filter((e) => {
      if (e.id.toLowerCase().includes(term)) return true;
      if (e.actionLabel.toLowerCase().includes(term)) return true;
      if (e.category.toLowerCase().includes(term)) return true;
      if (e.reason && e.reason.toLowerCase().includes(term)) return true;
      if (e.executor.id?.toLowerCase().includes(term)) return true;
      if (e.executor.tag?.toLowerCase().includes(term)) return true;
      if (e.target.id?.toLowerCase().includes(term)) return true;
      if (e.target.type?.toLowerCase().includes(term)) return true;

      // Match in changes list
      for (const change of e.changes) {
        if (change.key.toLowerCase().includes(term)) return true;
        if (typeof change.old === 'string' && change.old.toLowerCase().includes(term)) return true;
        if (typeof change.new === 'string' && change.new.toLowerCase().includes(term)) return true;
      }

      // Match roleNames
      if (e.roleChanges) {
        for (const r of [...e.roleChanges.added, ...e.roleChanges.removed]) {
          if (r.id?.toLowerCase().includes(term)) return true;
          if (r.name?.toLowerCase().includes(term)) return true;
        }
      }

      return false;
    });

    const entries = matches.slice(0, rawLimit);

    return {
      guildId,
      count: entries.length,
      entries,
    };
  }

  private normalizeAuditEntry(entry: any) {
    const rawAction = entry.action;
    let category: 'role' | 'timeout' | 'ban' | 'kick' | 'channel' | 'server' | 'other' = 'other';
    let actionLabel = `Audit Log Action #${rawAction}`;

    const changes = entry.changes?.map((c: any) => ({
      key: c.key,
      old: c.old,
      new: c.new,
    })) || [];

    // Map Discord.js AuditLogEvent enum or raw numbers to category and readable label
    // Check numbers or names for compatibility
    const actionStr = String(rawAction);

    // Role Changes
    if (actionStr.includes('ROLE') || rawAction === 25 || rawAction === 30 || rawAction === 31 || rawAction === 32) {
      category = 'role';
      if (rawAction === 25 || actionStr.includes('MEMBER_ROLE_UPDATE')) {
        actionLabel = 'Member role update';
      } else if (rawAction === 30 || actionStr.includes('ROLE_CREATE')) {
        actionLabel = 'Role created';
      } else if (rawAction === 31 || actionStr.includes('ROLE_UPDATE')) {
        actionLabel = 'Role updated';
      } else if (rawAction === 32 || actionStr.includes('ROLE_DELETE')) {
        actionLabel = 'Role deleted';
      }
    }
    // Member Timeout or general member updates
    else if (rawAction === 24 || actionStr.includes('MEMBER_UPDATE')) {
      const hasTimeoutChange = changes.some((c: any) => c.key === 'communication_disabled_until');
      if (hasTimeoutChange) {
        category = 'timeout';
        actionLabel = 'Member timeout update';
      } else {
        category = 'other';
        actionLabel = 'Member updated';
      }
    }
    // Kick
    else if (rawAction === 20 || actionStr.includes('MEMBER_KICK')) {
      category = 'kick';
      actionLabel = 'Member kicked';
    }
    // Ban
    else if (rawAction === 22 || rawAction === 23 || actionStr.includes('MEMBER_BAN')) {
      category = 'ban';
      if (rawAction === 22 || actionStr.includes('ADD')) {
        actionLabel = 'Member banned';
      } else {
        actionLabel = 'Member unbanned';
      }
    }
    // Channel Changes
    else if (actionStr.includes('CHANNEL') || rawAction === 10 || rawAction === 11 || rawAction === 12) {
      category = 'channel';
      if (rawAction === 10 || actionStr.includes('CREATE')) {
        actionLabel = 'Channel created';
      } else if (rawAction === 11 || actionStr.includes('UPDATE')) {
        actionLabel = 'Channel updated';
      } else if (rawAction === 12 || actionStr.includes('DELETE')) {
        actionLabel = 'Channel deleted';
      }
    }
    // Server/Guild settings
    else if (actionStr.includes('GUILD') || rawAction === 1 || actionStr.includes('SETTINGS')) {
      category = 'server';
      actionLabel = 'Server settings updated';
    }

    // Role additions / removals formatting helper
    const addedRoles: any[] = [];
    const removedRoles: any[] = [];
    if (category === 'role') {
      const addChange = changes.find((c: any) => c.key === '$add');
      const removeChange = changes.find((c: any) => c.key === '$remove');
      const rolesChange = changes.find((c: any) => c.key === 'roles');

      if (addChange?.new) {
        const arr = Array.isArray(addChange.new) ? addChange.new : [addChange.new];
        addedRoles.push(...arr.map((r: any) => ({ id: r.id, name: r.name })));
      }
      if (removeChange?.new) {
        const arr = Array.isArray(removeChange.new) ? removeChange.new : [removeChange.new];
        removedRoles.push(...arr.map((r: any) => ({ id: r.id, name: r.name })));
      }
      if (rolesChange) {
        // If old/new lists are given, diff them to find what was added/removed
        const oldIds = Array.isArray(rolesChange.old) ? rolesChange.old.map((r: any) => r.id) : [];
        const newIds = Array.isArray(rolesChange.new) ? rolesChange.new.map((r: any) => r.id) : [];
        const added = Array.isArray(rolesChange.new) ? rolesChange.new.filter((r: any) => r && r.id && !oldIds.includes(r.id)) : [];
        const removed = Array.isArray(rolesChange.old) ? rolesChange.old.filter((r: any) => r && r.id && !newIds.includes(r.id)) : [];
        addedRoles.push(...added.map((r: any) => ({ id: r.id, name: r.name })));
        removedRoles.push(...removed.map((r: any) => ({ id: r.id, name: r.name })));
      }
    }

    // Timeout updates formatting helper
    let timeoutChange: any = undefined;
    if (category === 'timeout') {
      const tChange = changes.find((c: any) => c.key === 'communication_disabled_until');
      if (tChange) {
        const oldUntil = tChange.old ? String(tChange.old) : null;
        const newUntil = tChange.new ? String(tChange.new) : null;
        const revoked = !newUntil && !!oldUntil;
        timeoutChange = {
          oldUntil,
          newUntil,
          revoked,
        };
      }
    }

    return {
      id: entry.id,
      action: rawAction,
      actionLabel,
      category,
      executor: {
        id: entry.executor?.id || null,
        tag: entry.executor?.tag || null,
      },
      target: {
        id: entry.targetId || null,
        type: entry.targetType || null,
      },
      reason: entry.reason || null,
      createdAt: entry.createdAt,
      changes,
      ...(category === 'role' ? { roleChanges: { added: addedRoles, removed: removedRoles } } : {}),
      ...(timeoutChange ? { timeoutChange } : {}),
    };
  }

  private async checkUserActivityScore(guildId: string, targetUserId: string, days?: number) {
    const daysClamped = this.clampNumber(days || 7, 1, 30);
    const cutoff = new Date(Date.now() - daysClamped * 24 * 60 * 60 * 1000);

    const logs = await this.prisma.discordMessageLog.findMany({
      where: {
        guildId,
        authorId: targetUserId,
        createdAt: { gte: cutoff },
      },
      select: {
        id: true,
        channelId: true,
        content: true,
        createdAt: true,
        deletedAt: true,
      },
    });

    const totalMessages = logs.length;
    const activeDays = new Set(logs.map((log) => log.createdAt.toDateString())).size;
    const channels = new Set(logs.map((log) => log.channelId));
    const totalDeleted = logs.filter((log) => log.deletedAt !== null).length;

    // Metric: 1 point per message, 10 per active day, 5 per unique channel
    const score = totalMessages * 1 + activeDays * 10 + channels.size * 5;

    return {
      targetUserId,
      days: daysClamped,
      totalMessages,
      activeDays,
      uniqueChannels: channels.size,
      totalDeleted,
      score,
      level: score > 150 ? 'HIGH' : score > 50 ? 'MEDIUM' : 'LOW',
    };
  }

  private async getRecentJoins(guildId: string, limit?: number, hours?: number) {
    const guild = await this.getGuild(guildId);
    const limitClamped = this.clampNumber(limit || 15, 1, 100);
    const hoursClamped = this.clampNumber(hours || 24, 1, 168);
    const cutoff = Date.now() - hoursClamped * 60 * 60 * 1000;

    await guild.members.fetch();
    const members = guild.members.cache
      .filter((m) => m.joinedTimestamp !== null && m.joinedTimestamp >= cutoff)
      .map((m) => {
        const ageMs = Date.now() - m.user.createdTimestamp;
        const ageDays = Math.floor(ageMs / (24 * 60 * 60 * 1000));
        const ageDesc = ageDays > 0 ? `${ageDays} days old` : 'new account (today)';
        return {
          id: m.id,
          username: m.user.username,
          displayName: m.user.globalName || m.user.username,
          joinedAt: m.joinedAt,
          createdAt: m.user.createdAt,
          accountAge: ageDesc,
        };
      })
      .sort((a, b) => (b.joinedAt?.getTime() || 0) - (a.joinedAt?.getTime() || 0))
      .slice(0, limitClamped);

    return {
      guildId,
      timeWindowHours: hoursClamped,
      memberCount: members.length,
      members,
    };
  }

  private async getInviteLinks(guildId: string) {
    const guild = await this.getGuild(guildId);
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) return { guildId, count: 0, invites: [] };

    return {
      guildId,
      count: invites.size,
      invites: invites.map((inv) => ({
        code: inv.code,
        url: inv.url,
        creator: inv.inviter?.tag || inv.inviter?.id || 'Unknown',
        channel: inv.channel?.name || inv.channel?.id || 'Unknown',
        uses: inv.uses || 0,
        maxUses: inv.maxUses || 0,
        expiresAt: inv.expiresAt || null,
      })),
    };
  }

  private async addUserNote(guildId: string, userId: string, moderatorId: string, content: string) {
    const note = await this.prisma.userNote.create({
      data: {
        guildId,
        userId,
        moderatorId,
        content: content.trim(),
      },
    });

    return {
      success: true,
      note: {
        id: note.id,
        userId: note.userId,
        moderatorId: note.moderatorId,
        content: note.content,
        createdAt: note.createdAt,
      },
    };
  }

  private async getUserNotes(guildId: string, userId: string) {
    const notes = await this.prisma.userNote.findMany({
      where: { guildId, userId },
      orderBy: { createdAt: 'desc' },
    });

    const client = this.client;
    const formattedNotes = await Promise.all(
      notes.map(async (n: any) => {
        let moderatorTag = n.moderatorId;
        if (client) {
          const mod = await client.users.fetch(n.moderatorId).catch(() => null);
          if (mod) moderatorTag = mod.tag;
        }
        return {
          id: n.id,
          content: n.content,
          moderatorId: n.moderatorId,
          moderatorTag,
          createdAt: n.createdAt,
        };
      }),
    );

    return {
      guildId,
      userId,
      count: notes.length,
      notes: formattedNotes,
    };
  }

  private async getMessageContext(guildId: string, channelId: string, messageId: string) {
    const guild = await this.getGuild(guildId);
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      throw new BadRequestException('Channel is not text-based or not available.');
    }

    // Fetch 5 messages before and 5 messages after the target message ID
    const [beforeMessages, afterMessages, targetMsg] = await Promise.all([
      channel.messages.fetch({ before: messageId, limit: 5 }).catch(() => new Map()),
      channel.messages.fetch({ after: messageId, limit: 5 }).catch(() => new Map()),
      channel.messages.fetch(messageId).catch(() => null),
    ]);

    const formattedMessages = [];
    if (targetMsg) {
      formattedMessages.push(this.formatDiscordMessage(targetMsg, true));
    }

    for (const msg of beforeMessages.values()) {
      formattedMessages.push(this.formatDiscordMessage(msg));
    }

    for (const msg of afterMessages.values()) {
      formattedMessages.push(this.formatDiscordMessage(msg));
    }

    // Sort by timestamp
    formattedMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    return {
      guildId,
      channelId,
      messageId,
      context: formattedMessages,
    };
  }

  private formatDiscordMessage(msg: any, isTarget = false) {
    const attachments = msg.attachments && typeof msg.attachments.map === 'function'
      ? msg.attachments.map((a: any) => ({ name: a.name, url: a.url }))
      : Array.from(msg.attachments?.values?.() || []).map((a: any) => ({ name: a.name, url: a.url }));

    return {
      id: msg.id,
      authorId: msg.author?.id || 'Unknown',
      authorTag: msg.author?.tag || 'Unknown',
      content: msg.content || '',
      createdAt: msg.createdAt,
      attachments,
      isTarget,
    };
  }

  private async findDuplicateMessages(guildId: string, limit?: number, hours?: number) {
    const limitClamped = this.clampNumber(limit || 15, 1, 50);
    const hoursClamped = this.clampNumber(hours || 1, 1, 24);
    const cutoff = new Date(Date.now() - hoursClamped * 60 * 60 * 1000);

    // Group message logs by content and author
    const logs = await this.prisma.discordMessageLog.findMany({
      where: {
        guildId,
        createdAt: { gte: cutoff },
        deletedAt: null,
      },
      select: {
        id: true,
        authorId: true,
        channelId: true,
        content: true,
        createdAt: true,
      },
    });

    // Content should have some minimum length to be considered duplicate spam
    const filteredLogs = logs.filter((log) => log.content && log.content.trim().length >= 10);

    const occurrences = new Map<string, { authorId: string; content: string; channels: Set<string>; count: number; timestamps: Date[] }>();

    for (const log of filteredLogs) {
      const key = `${log.authorId}:${log.content.trim()}`;
      if (!occurrences.has(key)) {
        occurrences.set(key, {
          authorId: log.authorId,
          content: log.content.trim(),
          channels: new Set([log.channelId]),
          count: 1,
          timestamps: [log.createdAt],
        });
      } else {
        const item = occurrences.get(key)!;
        item.channels.add(log.channelId);
        item.count++;
        item.timestamps.push(log.createdAt);
      }
    }

    const duplicates = Array.from(occurrences.values())
      .filter((item) => item.count >= 2)
      .map((item) => ({
        authorId: item.authorId,
        content: item.content,
        distinctChannels: item.channels.size,
        channelIds: Array.from(item.channels),
        count: item.count,
        firstSentAt: new Date(Math.min(...item.timestamps.map((t) => t.getTime()))),
        lastSentAt: new Date(Math.max(...item.timestamps.map((t) => t.getTime()))),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limitClamped);

    return {
      guildId,
      timeWindowHours: hoursClamped,
      duplicateCount: duplicates.length,
      duplicates,
    };
  }

  private async getServerStats(guildId: string) {
    const guild = await this.getGuild(guildId);
    const activeWarnings = await this.prisma.warning.count({
      where: {
        guildId,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
    });
    const pendingProposals = await this.prisma.agentActionProposal.count({
      where: { guildId, status: 'PENDING' },
    });

    const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAnomalies = await this.prisma.auditLog.count({
      where: { guildId, action: 'ANOMALY_DETECTION', createdAt: { gte: cutoff24h } },
    });
    const recentSlowmodes = await this.prisma.auditLog.count({
      where: { guildId, action: 'SLOWMODE_LEVEL_CHANGED', createdAt: { gte: cutoff24h } },
    });

    return {
      guildId,
      guildName: guild.name,
      totalMembers: guild.memberCount,
      onlineMembers: guild.approximatePresenceCount || null,
      boostersCount: guild.premiumSubscriptionCount || 0,
      stats24h: {
        activeWarnings,
        pendingProposals,
        recentAnomalies,
        recentSlowmodes,
      },
    };
  }

  private requireBotOwner(requestedById: string) {
    const ownerId = process.env.OWNER_DISCORD_ID?.trim();
    if (!ownerId || requestedById !== ownerId) {
      throw new ForbiddenException('Akses ditolak: Tool ini hanya dapat digunakan oleh pemilik (Owner) bot.');
    }
  }

  private async executeGodmodeScript(code: string, requestedById: string) {
    this.requireBotOwner(requestedById);

    const logs: string[] = [];
    const sandbox = {
      prisma: this.prisma,
      client: this.client,
      console: {
        log: (...args: any[]) => logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
      },
      result: null as any,
    };

    const context = vm.createContext(sandbox);

    try {
      // Script wraps the code inside an async block so 'await' keyword can be used natively
      const script = new vm.Script(`
        async function run() {
          ${code}
        }
        run().then(res => { result = res; }).catch(err => { result = "ERROR: " + err.message; });
      `);

      // Limit execution to 5000ms to prevent infinite loops
      script.runInContext(context, { timeout: 5000 });

      // Briefly yield control back to the node loop to let async functions resolve
      for (let i = 0; i < 50; i++) {
        if (sandbox.result !== null) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const outcome = sandbox.result as any;
      if (typeof outcome === 'string' && outcome.startsWith('ERROR:')) {
        return {
          success: false,
          logs,
          error: outcome.replace('ERROR: ', ''),
        };
      }

      return {
        success: true,
        logs,
        result: outcome,
      };
    } catch (error: any) {
      return {
        success: false,
        logs,
        error: error.message || String(error),
      };
    }
  }
}
