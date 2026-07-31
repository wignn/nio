import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordMessageLogService } from './discord-message-log.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DiscordMessageLogService', () => {
  let service: DiscordMessageLogService;
  let prisma: PrismaService;

  const mockPrisma = {
    discordMessageLog: {
      upsert: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({})),
    },
    guildSettings: {
      findUnique: jest.fn(async () => ({ messageDeleteLogChannelId: null })),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordMessageLogService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<DiscordMessageLogService>(DiscordMessageLogService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('creates or updates a message log when the agent is enabled', async () => {
    (mockPrisma as any).discordAgentSettings = {
      findUnique: jest.fn(async () => ({ enabled: true, excludedChannelIds: [] })),
    };

    await service.logCreate({
      id: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'author-1',
      content: 'hello',
      attachments: [],
      embeds: [],
      createdAt: new Date(),
    });

    expect(prisma.discordMessageLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('does not log messages from excluded channels', async () => {
    (mockPrisma as any).discordAgentSettings = {
      findUnique: jest.fn(async () => ({ enabled: true, excludedChannelIds: ['channel-1'] })),
    };

    await service.logCreate({
      id: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'author-1',
      content: 'hello',
      attachments: [],
      embeds: [],
      createdAt: new Date(),
    });

    expect(prisma.discordMessageLog.upsert).not.toHaveBeenCalled();
  });

  it('logs when a Discord delete-log channel is configured', async () => {
    (mockPrisma as any).discordAgentSettings = {
      findUnique: jest.fn(async () => ({ enabled: false, excludedChannelIds: [] })),
    };
    mockPrisma.guildSettings.findUnique.mockResolvedValueOnce({ messageDeleteLogChannelId: 'log-channel-1' });

    await service.logCreate({
      id: 'msg-1',
      guildId: 'guild-1',
      channelId: 'channel-1',
      authorId: 'author-1',
      content: '',
      attachments: [{ name: 'photo.png' }],
      embeds: [],
      createdAt: new Date(),
    });

    expect(prisma.discordMessageLog.upsert).toHaveBeenCalledTimes(1);
  });

  it('updates an existing message content', async () => {
    await service.logUpdate('msg-1', 'updated content', new Date());
    expect(prisma.discordMessageLog.update).toHaveBeenCalledTimes(1);
  });

  it('marks a message as deleted', async () => {
    await service.logDelete('msg-1', new Date());
    expect(prisma.discordMessageLog.update).toHaveBeenCalledTimes(1);
  });
});
