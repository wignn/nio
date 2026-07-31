import { describe, expect, it, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import * as path from 'path';
import { DiscordBotService } from './discord-bot.service';

const makeService = (overrides: any = {}) => {
  const messageLogs = overrides.messageLogs || {
    prisma: {
      guildSettings: { findUnique: jest.fn(async () => ({ messageDeleteLogChannelId: null })) },
      discordMessageLog: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    },
    logCreate: jest.fn(),
    logDelete: jest.fn(),
  };

  const rustAnalytics = overrides.rustAnalytics || {
    ingestMessage: jest.fn(async () => true),
    ingestVoiceState: jest.fn(async () => true),
  };

  return {
    service: new DiscordBotService(
      { handle: jest.fn() } as any,
      { getCachedUrl: jest.fn() } as any,
      { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      { setClient: jest.fn(), handleMessage: jest.fn() } as any,
      { handleMessage: jest.fn() } as any,
      { setClient: jest.fn(), handleBoosterStatusChange: jest.fn() } as any,
      { setClient: jest.fn() } as any,
      { canHandle: jest.fn(async () => ({ allowed: false })) } as any,
      { setClient: jest.fn() } as any,
      messageLogs as any,
      { setClient: jest.fn() } as any,
      { setClient: jest.fn() } as any,
      { saveConversation: jest.fn() } as any,
      rustAnalytics as any,
      { } as any,
    ),
    messageLogs,
    rustAnalytics,
  };
};

describe('DiscordBotService deleted message logs', () => {
  it('logs message creates to Prisma even when Rust analytics succeeds', async () => {
    const { service, messageLogs, rustAnalytics } = makeService();
    const message = {
      id: 'msg-1',
      guild: { id: 'guild-1' },
      channel: { id: 'channel-1' },
      author: { id: 'user-1' },
      content: 'hello',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      createdTimestamp: Date.parse('2026-01-01T00:00:00Z'),
      attachments: new Map(),
      embeds: [],
      reference: null,
    };

    await (service as any).handleAgentMessage(message);

    expect(messageLogs.logCreate).toHaveBeenCalledWith(expect.objectContaining({
      id: 'msg-1',
      content: 'hello',
      attachments: [],
    }));
    expect(rustAnalytics.ingestMessage).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'msg-1' }));
  });

  it('clears the media cleanup interval on shutdown', () => {
    const { service } = makeService();
    (service as any).mediaCleanupInterval = setInterval(() => undefined, 1000);

    service.onModuleDestroy();

    expect((service as any).mediaCleanupInterval).toBeNull();
  });

  it('sends cached media files to the Discord delete log channel', async () => {
    const deletedBytes = Buffer.from('deleted image');
    const cachedFileName = path.join('guild-1', 'msg-1', 'att-1-photo.png');
    const send = jest.fn(async () => ({}));
    const cachePath = path.resolve(process.cwd(), '.tmp/delete-log-media', cachedFileName);
    await fs.rm(path.dirname(path.dirname(cachePath)), { recursive: true, force: true });
    const messageLogs = {
      prisma: {
        guildSettings: { findUnique: jest.fn(async () => ({ messageDeleteLogChannelId: 'log-channel-1' })) },
        discordMessageLog: {
          findUnique: jest.fn(async () => ({
            id: 'msg-1',
            authorId: 'user-1',
            channelId: 'channel-1',
            content: '',
            createdAt: new Date('2026-01-01T00:00:00Z'),
            guildId: 'guild-1',
            attachments: [{ name: 'photo.png', cachedFileName }],
          })),
          update: jest.fn(),
          updateMany: jest.fn(),
        },
      },
      logCreate: jest.fn(),
      logDelete: jest.fn(),
    };
    const { service } = makeService({ messageLogs });
    await (service as any).writeDeleteLogMedia(cachedFileName, deletedBytes);

    await (service as any).handleMessageDelete({
      id: 'msg-1',
      guild: {
        id: 'guild-1',
        channels: { fetch: jest.fn(async () => ({ isTextBased: () => true, send })) },
      },
    });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      files: [{ attachment: deletedBytes, name: 'photo.png' }],
    }));
    await expect(fs.readFile(cachePath)).rejects.toThrow();
  });
});
