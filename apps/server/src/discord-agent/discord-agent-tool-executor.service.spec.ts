import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordAgentToolExecutorService } from './discord-agent-tool-executor.service';
import { ModerationService } from '../moderation/moderation.service';
import { PrismaService } from '../prisma/prisma.service';
import { AgentActionProposalService } from './agent-action-proposal.service';
import { DiscordMessageLogService } from './discord-message-log.service';
import { DiscordAgentContextService } from './discord-agent-context.service';

describe('DiscordAgentToolExecutorService', () => {
  let service: DiscordAgentToolExecutorService;

  const mockModeration = {
    listWarnings: jest.fn(async () => [{ id: 'warn-1' }]),
  };

  const mockPrisma = {
    guildSettings: {
      findUnique: jest.fn(async () => ({ logChannelId: 'channel-1', messageDeleteLogChannelId: 'channel-del-1' })),
    },
    discordMessageLog: {
      findMany: jest.fn(async (): Promise<any[]> => []),
    },
    userNote: {
      create: jest.fn(async (params: any) => ({
        id: 'note-1',
        guildId: params.data.guildId,
        userId: params.data.userId,
        moderatorId: params.data.moderatorId,
        content: params.data.content,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      })),
      findMany: jest.fn(async () => [
        {
          id: 'note-1',
          content: 'some note',
          moderatorId: 'admin-1',
          createdAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]),
    },
  };

  const mockProposals = {
    createProposal: jest.fn(async () => ({ id: 'proposal-1', actionType: 'WARN' })),
  };

  const mockMessageLogs = {
    getUserRecentMessages: jest.fn(async () => []),
    getChannelRecentMessages: jest.fn(async () => [{ id: 'msg-1', channelId: 'channel-1', authorId: 'user-1', content: 'hello', createdAt: new Date('2026-01-01T00:00:00Z'), editedAt: null, attachments: null }]),
    getDeletedMessages: jest.fn(async () => [{ id: 'deleted-1', channelId: 'channel-1', authorId: 'user-1', content: 'gone', createdAt: new Date('2026-01-01T00:00:00Z'), editedAt: null, deletedAt: new Date('2026-01-01T00:01:00Z'), attachments: null }]),
  };

  const mockContext = {
    buildModContext: jest.fn(async () => ({ member: { id: 'user-1' } })),
  };

  const mockChannelMessages = {
    fetch: jest.fn(async (params: any) => {
      if (typeof params === 'string') {
        return { id: params, author: { id: 'user-1', tag: 'user#1234' }, content: 'target', createdAt: new Date('2026-01-01T00:01:00Z'), attachments: new Map() };
      }
      return new Map([
        ['ctx-1', { id: 'ctx-1', author: { id: 'user-1', tag: 'user#1234' }, content: params?.before ? 'before' : 'after', createdAt: params?.before ? new Date('2026-01-01T00:00:00Z') : new Date('2026-01-01T00:02:00Z'), attachments: new Map() }],
      ]);
    }),
  };

  const mockChannel = {
    id: 'channel-1',
    isTextBased: jest.fn(() => true),
    messages: mockChannelMessages,
  };

  const mockGuild = {
    name: 'Test Guild',
    memberCount: 42,
    approximatePresenceCount: 7,
    premiumSubscriptionCount: 3,
    channels: {
      fetch: jest.fn(async () => mockChannel),
    },
    members: {
      me: {
        permissions: {
          has: jest.fn(() => true),
        },
        roles: {
          highest: { position: 10 },
        },
      },
      fetchMe: jest.fn(async () => ({
        permissions: {
          has: jest.fn(() => true),
        },
        roles: {
          highest: { position: 10 },
        },
      })),
      fetch: jest.fn(async () => ({
        id: 'admin-1',
        voice: { channelId: 'voice-current' },
      })),
    },
    fetchAuditLogs: jest.fn(async (..._args: any[]): Promise<any> => ({
      entries: [
        {
          id: 'log-1',
          action: 24,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'spam',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [] as any[],
        },
      ],
    })),
  };

  const mockClient = {
    guilds: {
      fetch: jest.fn(async () => mockGuild),
    },
    users: {
      fetch: jest.fn(async () => ({ tag: 'admin#1234' })),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordAgentToolExecutorService,
        { provide: ModerationService, useValue: mockModeration },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentActionProposalService, useValue: mockProposals },
        { provide: DiscordMessageLogService, useValue: mockMessageLogs },
        { provide: DiscordAgentContextService, useValue: mockContext },
        { provide: require('../plugins/plugin-tool-registry.service').PluginToolRegistryService, useValue: { has: jest.fn(() => false), execute: jest.fn() } },
      ],
    }).compile();

    service = module.get(DiscordAgentToolExecutorService);
    service.setClient(mockClient as any);
  });

  it('executes read tools immediately', async () => {
    const res = await service.execute('get_user_warnings', { targetUserId: 'user-1' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual([{ id: 'warn-1' }]);
    (expect(mockModeration.listWarnings) as any).toHaveBeenCalledWith('guild-1', { search: 'user-1' });
  });

  it('reuses moderation context for member info', async () => {
    const res = await service.execute('get_member_info', { targetUserId: 'user-1' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual({ member: { id: 'user-1' } });
    (expect(mockContext.buildModContext) as any).toHaveBeenCalledWith('guild-1', 'user-1');
  });

  it('gets recent channel messages with a clamped limit', async () => {
    const res = await service.execute('get_channel_recent_messages', { channelId: 'channel-1', limit: 500 }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'fallback-channel' });
    expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'msg-1', content: 'hello' })]));
    (expect(mockMessageLogs.getChannelRecentMessages) as any).toHaveBeenCalledWith('guild-1', 'channel-1', 100, undefined);
  });

  it('creates proposals for write tools', async () => {
    const res = await service.execute('warn_user', { targetUserId: 'user-1', reason: 'spam' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'WARN' });
  });

  it('creates rich announcement proposals', async () => {
    const res = await service.execute('send_channel_announcement', {
      channelId: 'channel-2',
      content: 'hello',
      title: 'Update',
      color: '#ffaa00',
      imageUrl: 'https://example.com/image.png',
      thumbnailUrl: 'https://example.com/thumb.png',
      footer: 'footer',
      ping: 'here',
      reason: 'weekly update',
    }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });

    expect(res).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'SEND_ANNOUNCEMENT' });
    (expect(mockProposals.createProposal) as any).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: null,
      recommendation: expect.objectContaining({
        type: 'SEND_ANNOUNCEMENT',
        channelId: 'channel-2',
        content: 'hello',
        announcementColor: '#ffaa00',
        announcementImageUrl: 'https://example.com/image.png',
        announcementThumbnailUrl: 'https://example.com/thumb.png',
        announcementFooter: 'footer',
        announcementPing: 'here',
      }),
    }));
  });

  it('creates purge user messages proposals', async () => {
    const res = await service.execute('purge_user_messages', {
      targetUserId: 'user-1',
      limit: 25,
      channels: ['channel-1'],
      reason: 'spam cleanup',
    }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });

    expect(res).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'PURGE_USER_MESSAGES' });
    (expect(mockProposals.createProposal) as any).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: 'user-1',
      recommendation: expect.objectContaining({
        type: 'PURGE_USER_MESSAGES',
        purgeLimit: 25,
        purgeUserChannels: ['channel-1'],
      }),
    }));
  });

  it('creates bot voice connection proposals', async () => {
    const joinRes = await service.execute('bot_join_voice', {
      voiceChannelId: 'voice-1',
      reason: 'join voice test',
    }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    const leaveRes = await service.execute('bot_leave_voice', {
      reason: 'leave voice test',
    }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });

    expect(joinRes).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'BOT_JOIN_VOICE' });
    expect(leaveRes).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'BOT_LEAVE_VOICE' });
    (expect(mockProposals.createProposal) as any).toHaveBeenCalledWith(expect.objectContaining({
      recommendation: expect.objectContaining({
        type: 'BOT_JOIN_VOICE',
        voiceChannelId: 'voice-1',
      }),
    }));
  });

  it('defaults bot join voice to requester current voice channel', async () => {
    const res = await service.execute('bot_join_voice', {
      reason: 'join my voice',
    }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });

    expect(res).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'BOT_JOIN_VOICE' });
    (expect(mockProposals.createProposal) as any).toHaveBeenCalledWith(expect.objectContaining({
      recommendation: expect.objectContaining({
        type: 'BOT_JOIN_VOICE',
        voiceChannelId: 'voice-current',
      }),
    }));
  });

  it('asks for a specific voice channel when requester is not in voice', async () => {
    mockGuild.members.fetch.mockResolvedValueOnce({ id: 'admin-1', voice: { channelId: null } } as any);

    await expect(service.execute('bot_join_voice', {
      reason: 'join my voice',
    }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' })).rejects.toThrow('Kamu belum masuk voice channel.');
  });

  it('gets deleted message history with filters', async () => {
    const res = await service.execute('get_deleted_message_history', { targetUserId: 'user-1', limit: 10 }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'deleted-1', deletedAt: new Date('2026-01-01T00:01:00Z') })]));
    (expect(mockMessageLogs.getDeletedMessages) as any).toHaveBeenCalledWith('guild-1', 10, { channelId: undefined, userId: 'user-1' });
  });

  it('creates role management proposals', async () => {
    const res = await service.execute('add_role_to_user', { targetUserId: 'user-1', roleId: 'role-1', reason: 'verified' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual({ proposalCreated: true, proposalId: 'proposal-1', actionType: 'ADD_ROLE' });
    (expect(mockProposals.createProposal) as any).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: 'user-1',
      recommendation: expect.objectContaining({ type: 'ADD_ROLE', roleId: 'role-1' }),
    }));
  });

  it('creates settings update proposals with only supported settings', async () => {
    await service.execute('update_server_settings', { reason: 'reduce spam', slowmodeEnabled: true, unsupported: 'ignored' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    (expect(mockProposals.createProposal) as any).toHaveBeenCalledWith(expect.objectContaining({
      targetUserId: null,
      recommendation: expect.objectContaining({
        type: 'UPDATE_SETTINGS',
        reason: 'reduce spam',
        settings: { slowmodeEnabled: true },
      }),
    }));
  });

  it('fetches Discord audit logs', async () => {
    const res = await service.execute('get_discord_audit_logs', { limit: 10 }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual([{
      id: 'log-1',
      action: 24,
      reason: 'spam',
      executorId: 'admin-1',
      executorTag: 'admin#1234',
      targetId: 'user-1',
      createdAt: expect.any(Date),
      changes: [],
    }]);
  });

  it('fetches general normalized audit logs with categories and normalization', async () => {
    mockGuild.fetchAuditLogs.mockResolvedValueOnce({
      entries: [
        {
          id: 'log-role-1',
          action: 25, // MEMBER_ROLE_UPDATE (typically)
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'role added',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [{ key: '$add', new: [{ id: 'role-vip', name: 'VIP' }] }] as any[],
        },
        {
          id: 'log-timeout-1',
          action: 24, // MEMBER_UPDATE
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'timed out',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [{ key: 'communication_disabled_until', new: '2026-01-01T01:00:00.000Z' }] as any[],
        },
      ],
    });

    const res = await service.execute('get_audit_logs', { category: 'role' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res.guildId).toBe('guild-1');
    expect(res.count).toBe(1);
    expect(res.entries[0]).toEqual(expect.objectContaining({
      id: 'log-role-1',
      category: 'role',
      actionLabel: 'Member role update',
      roleChanges: {
        added: [{ id: 'role-vip', name: 'VIP' }],
        removed: [],
      },
    }));

    mockGuild.fetchAuditLogs.mockResolvedValueOnce({
      entries: [
        {
          id: 'log-timeout-1',
          action: 24,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'timed out',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [{ key: 'communication_disabled_until', new: '2026-01-01T01:00:00.000Z' }] as any[],
        },
      ],
    });

    const resTimeout = await service.execute('get_audit_logs', { category: 'timeout' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(resTimeout.count).toBe(1);
    expect(resTimeout.entries[0].timeoutChange).toEqual({
      newUntil: '2026-01-01T01:00:00.000Z',
      oldUntil: null,
      revoked: false,
    });
  });

  it('fetches member audit trail specifically targeting user', async () => {
    mockGuild.fetchAuditLogs.mockResolvedValueOnce({
      entries: [
        {
          id: 'log-role-1',
          action: 25,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'role added',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [{ key: '$add', new: [{ id: 'role-vip', name: 'VIP' }] }] as any[],
        },
        {
          id: 'log-role-2',
          action: 25,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-2',
          reason: 'role added to other',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [{ key: '$add', new: [{ id: 'role-vip', name: 'VIP' }] }] as any[],
        },
      ],
    });

    const res = await service.execute('get_member_audit_trail', { targetUserId: 'user-1' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res.count).toBe(1);
    expect(res.entries[0].id).toBe('log-role-1');
  });

  it('fetches moderator actions filter', async () => {
    mockGuild.fetchAuditLogs.mockResolvedValueOnce({
      entries: [
        {
          id: 'log-role-1',
          action: 25,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'role added',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [] as any[],
        },
      ],
    });

    const res = await service.execute('get_moderator_actions', { moderatorId: 'admin-1' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res.count).toBe(1);
    expect(mockGuild.fetchAuditLogs).toHaveBeenCalledWith(expect.objectContaining({ user: 'admin-1' }));
  });

  it('searches audit events based on query matching', async () => {
    mockGuild.fetchAuditLogs.mockResolvedValueOnce({
      entries: [
        {
          id: 'log-role-1',
          action: 25,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-1',
          reason: 'important update',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [{ key: '$add', new: [{ id: 'role-vip', name: 'VIP' }] }] as any[],
        },
        {
          id: 'log-role-2',
          action: 25,
          executor: { id: 'admin-1', tag: 'admin#1234' },
          targetId: 'user-2',
          reason: 'normal changes',
          createdAt: new Date('2026-01-01T00:00:00Z'),
          changes: [] as any[],
        },
      ],
    });

    const res = await service.execute('search_audit_events', { query: 'important' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res.count).toBe(1);
    expect(res.entries[0].id).toBe('log-role-1');
  });

  it('throws ForbiddenException when bot lacks ViewAuditLog permission', async () => {
    mockGuild.members.me.permissions.has.mockReturnValueOnce(false);
    await expect(service.execute('get_audit_logs', {}, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' }))
      .rejects.toThrow('Bot lacks View Audit Log permission');
  });

  it('calculates user activity score based on logged messages', async () => {
    (mockPrisma.discordMessageLog.findMany as any).mockResolvedValueOnce([
      { id: '1', channelId: 'ch-1', createdAt: new Date(), deletedAt: null },
      { id: '2', channelId: 'ch-2', createdAt: new Date(), deletedAt: new Date() },
    ]);
    const res = await service.execute('check_user_activity_score', { targetUserId: 'user-1', days: 5 }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual({
      targetUserId: 'user-1',
      days: 5,
      totalMessages: 2,
      activeDays: 1,
      uniqueChannels: 2,
      totalDeleted: 1,
      score: 22,
      level: 'LOW',
    });
  });

  it('adds user notes and lists them', async () => {
    const addRes = await service.execute('add_user_note', { targetUserId: 'user-1', content: 'good member' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(addRes).toEqual({
      success: true,
      note: {
        id: 'note-1',
        userId: 'user-1',
        moderatorId: 'admin-1',
        content: 'good member',
        createdAt: expect.any(Date),
      },
    });

    const getRes = await service.execute('get_user_notes', { targetUserId: 'user-1' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(getRes).toEqual({
      guildId: 'guild-1',
      userId: 'user-1',
      count: 1,
      notes: [{
        id: 'note-1',
        content: 'some note',
        moderatorId: 'admin-1',
        moderatorTag: 'admin#1234',
        createdAt: expect.any(Date),
      }],
    });
  });

  it('fetches message context around a target message', async () => {
    const res = await service.execute('get_message_context', { messageId: 'target-msg', channelId: 'channel-1' }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'fallback-channel' });

    expect(res).toEqual(expect.objectContaining({
      guildId: 'guild-1',
      channelId: 'channel-1',
      messageId: 'target-msg',
    }));
    expect(res.context).toHaveLength(3);
    expect(res.context[1]).toEqual(expect.objectContaining({ id: 'target-msg', isTarget: true }));
  });

  it('identifies duplicate messages to detect spam', async () => {
    (mockPrisma.discordMessageLog.findMany as any).mockResolvedValueOnce([
      { id: '1', authorId: 'user-1', channelId: 'ch-1', content: 'spam message', createdAt: new Date() },
      { id: '2', authorId: 'user-1', channelId: 'ch-2', content: 'spam message', createdAt: new Date() },
    ]);
    const res = await service.execute('find_duplicate_messages', { hours: 1 }, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res.duplicateCount).toBe(1);
    expect(res.duplicates[0]).toEqual(expect.objectContaining({
      authorId: 'user-1',
      content: 'spam message',
      distinctChannels: 2,
      count: 2,
    }));
  });

  it('returns server statistics summary', async () => {
    // mock count calls for prisma warning, proposal, and auditlog
    mockPrisma.discordMessageLog.findMany.mockResolvedValueOnce([]); // mock some details if needed
    const mockPrismaCount = jest.fn(async () => 5);
    (service as any).prisma.warning = { count: mockPrismaCount };
    (service as any).prisma.agentActionProposal = { count: mockPrismaCount };
    (service as any).prisma.auditLog = { count: mockPrismaCount };

    const res = await service.execute('get_server_stats', {}, { guildId: 'guild-1', requestedById: 'admin-1', channelId: 'channel-1' });
    expect(res).toEqual(expect.objectContaining({
      guildId: 'guild-1',
      totalMembers: expect.any(Number),
      stats24h: {
        activeWarnings: 5,
        pendingProposals: 5,
        recentAnomalies: 5,
        recentSlowmodes: 5,
      },
    }));
  });

  describe('execute_godmode_script', () => {
    beforeEach(() => {
      process.env.OWNER_DISCORD_ID = 'owner-id-123';
    });

    it('rejects execution from non-owner IDs', async () => {
      await expect(service.execute(
        'execute_godmode_script',
        { code: 'return 2 + 2;' },
        { guildId: 'guild-1', requestedById: 'some-other-user', channelId: 'channel-1' },
      )).rejects.toThrow('Akses ditolak');
    });

    it('executes simple arithmetic inside sandbox', async () => {
      const res = await service.execute(
        'execute_godmode_script',
        { code: 'return 2 + 2;' },
        { guildId: 'guild-1', requestedById: 'owner-id-123', channelId: 'channel-1' },
      );
      expect(res.success).toBe(true);
      expect(res.result).toBe(4);
    });

    it('supports prisma database query simulation inside sandbox', async () => {
      // Create a fresh independent service instance to avoid shared spy mock contamination
      const freshPrisma = {
        discordMessageLog: {
          findMany: jest.fn(async () => [
            { id: '1', content: 'test log' }
          ]),
        },
      };

      const freshModule: TestingModule = await Test.createTestingModule({
        providers: [
          DiscordAgentToolExecutorService,
          { provide: ModerationService, useValue: {} },
          { provide: PrismaService, useValue: freshPrisma },
          { provide: AgentActionProposalService, useValue: {} },
          { provide: DiscordMessageLogService, useValue: {} },
          { provide: DiscordAgentContextService, useValue: {} },
        ],
      }).compile();

      const freshService = freshModule.get(DiscordAgentToolExecutorService);
      freshService.setClient({} as any);

      const res = await freshService.execute(
        'execute_godmode_script',
        { code: 'const logs = await prisma.discordMessageLog.findMany({ take: 1 }); return logs[0].content;' },
        { guildId: 'guild-1', requestedById: 'owner-id-123', channelId: 'channel-1' },
      );

      expect(res.success).toBe(true);
      expect(res.result).toBe('test log');
    });
  });
});
