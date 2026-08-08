import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordAgentService } from './discord-agent.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordAgentContextService } from './discord-agent-context.service';
import { DiscordAgentToolExecutorService } from './discord-agent-tool-executor.service';
import { AgentActionProposalService } from './agent-action-proposal.service';
import { AgentActionRendererService } from './agent-action-renderer.service';
import { ConversationMemoryService } from './conversation-memory.service';

describe('DiscordAgentService loop', () => {
  let service: DiscordAgentService;

  const mockPrisma = {
    discordAgentSettings: {
      findUnique: jest.fn(async () => ({
        enabled: true,
        allowedUserIds: ['admin-1'],
        provider: 'gemini',
        model: 'gemini-2.5-flash',
      })),
    },
    agentInteractionLog: {
      create: jest.fn(async (params: any) => {
        expect(params.data).toHaveProperty('promptTokens');
        expect(params.data).toHaveProperty('completionTokens');
        expect(params.data).toHaveProperty('totalTokens');
        return {};
      }),
    },
  };

  const mockExecutor = {
    execute: jest.fn(async (): Promise<any> => null),
  };

  const mockProposals = {
    createProposal: jest.fn(),
  };

  const mockRenderer = {
    renderProposalMessage: jest.fn(() => ({ embeds: [], components: [] })),
  };

  const mockMemory = {
    loadHistory: jest.fn(async (_guildId?: string, _botMessageId?: string): Promise<any[]> => []),
    saveConversation: jest.fn(async (_guildId?: string, _botMessageId?: string, _turns?: any[]): Promise<void> => {}),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.DISCORD_CLIENT_ID = 'bot-1';
    delete process.env.OWNER_DISCORD_ID;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordAgentService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DiscordAgentContextService, useValue: {} },
        { provide: DiscordAgentToolExecutorService, useValue: mockExecutor },
        { provide: AgentActionProposalService, useValue: mockProposals },
        { provide: AgentActionRendererService, useValue: mockRenderer },
        { provide: ConversationMemoryService, useValue: mockMemory },
        { provide: require('../plugins/plugin-tool-registry.service').PluginToolRegistryService, useValue: { definitionsForGuild: jest.fn(async () => []) } },
      ],
    }).compile();

    service = module.get(DiscordAgentService);
  });

  it('returns null before AI work when requester is not allowed', async () => {
    (mockPrisma.discordAgentSettings.findUnique as any).mockResolvedValueOnce({
      enabled: true,
      allowedUserIds: ['admin-1'],
      provider: 'gemini',
      model: 'gemini-2.5-flash',
    });
    const providerMock = { generate: jest.fn() };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const result = await service.handleMention('guild-1', 'channel-1', 'regular-1', '<@bot-1> hello');

    expect(result).toBeNull();
    expect(providerMock.generate).not.toHaveBeenCalled();
    expect(mockPrisma.agentInteractionLog.create).not.toHaveBeenCalled();
  });

  it('runs tool execution loop and returns final reply accumulating tokens', async () => {
    const mockResponses = [
      {
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'get_user_warnings', args: { targetUserId: 'user-1' } }
            }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 150,
          candidatesTokenCount: 30,
          totalTokenCount: 180,
        },
      },
      {
        candidates: [{
          content: {
            parts: [{ text: 'User has 0 warnings. No action needed.' }]
          }
        }],
        usageMetadata: {
          promptTokenCount: 250,
          candidatesTokenCount: 20,
          totalTokenCount: 270,
        },
      }
    ];

    let callCount = 0;
    const providerMock = {
      generate: jest.fn(async () => {
        const res = mockResponses[callCount];
        callCount++;
        return res;
      }),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);
    mockExecutor.execute.mockImplementation(async () => [{ id: 'warn-1' }]);

    const result = await service.handleMention('guild-1', 'channel-1', 'admin-1', '@nio cek warnings user-1');
    expect(result.content).toBe('User has 0 warnings. No action needed.');
    (expect(mockExecutor.execute) as any).toHaveBeenCalledWith('get_user_warnings', { targetUserId: 'user-1' }, { guildId: 'guild-1', channelId: 'channel-1', requestedById: 'admin-1' });
    expect(mockPrisma.agentInteractionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptTokens: 400,
          completionTokens: 50,
          totalTokens: 450,
        }),
      })
    );
  });

  it('returns conversationTurns with new exchange on success and logs token usage', async () => {
    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'Sure, here is the info.' }] } }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 50,
          totalTokenCount: 150,
        },
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const result = await service.handleMention('guild-1', 'channel-1', 'admin-1', '<@bot-1> tell me something');

    expect(result.conversationTurns).toHaveLength(1);
    expect(result.conversationTurns[0]).toEqual({
      userPrompt: 'tell me something',
      aiResponse: 'Sure, here is the info.',
      timestamp: expect.any(Number),
    });
    expect(mockPrisma.agentInteractionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
        }),
      })
    );
  });

  it('does not return conversationTurns on error response', async () => {
    const providerMock = {
      generate: jest.fn(async () => { throw new Error('API down'); }),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const result = await service.handleMention('guild-1', 'channel-1', 'admin-1', '<@bot-1> hello');

    expect(result.content).toContain('⚠️');
    expect(result.conversationTurns).toBeUndefined();
  });

  it('loads previous turns when referencedBotMessageId is provided', async () => {
    (mockMemory.loadHistory as any).mockResolvedValueOnce([
      { userPrompt: 'previous question', aiResponse: 'previous answer', timestamp: 1000 },
    ]);

    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'Continuing the conversation.' }] } }],
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const result = await service.handleMention('guild-1', 'channel-1', 'admin-1', '<@bot-1> continue', 'prev-bot-msg-id');

    (expect(mockMemory.loadHistory) as any).toHaveBeenCalledWith('guild-1', 'prev-bot-msg-id');

    const generateCall = (providerMock.generate as any).mock.calls[0];
    const history = generateCall[2];
    expect(history).toHaveLength(2);
    expect(history[0]).toEqual({ role: 'user', parts: [{ text: 'previous question' }] });
    expect(history[1]).toEqual({ role: 'model', parts: [{ text: 'previous answer' }] });

    expect(result.conversationTurns).toHaveLength(2);
    expect(result.conversationTurns[0].userPrompt).toBe('previous question');
    expect(result.conversationTurns[1].userPrompt).toBe('continue');
    expect(result.conversationTurns[1].aiResponse).toBe('Continuing the conversation.');
  });

  it('starts fresh for mentions without referencedBotMessageId', async () => {
    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'Fresh response.' }] } }],
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const result = await service.handleMention('guild-1', 'channel-1', 'admin-1', '<@bot-1> kamu to dia');

    expect(mockMemory.loadHistory).not.toHaveBeenCalled();

    const generateCall = (providerMock.generate as any).mock.calls[0];
    const history = generateCall[2];
    expect(history).toHaveLength(0);
    expect(result.conversationTurns).toHaveLength(1);
  });

  it('starts fresh when loadHistory returns no turns', async () => {
    (mockMemory.loadHistory as any).mockResolvedValueOnce([]);

    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'Fresh start.' }] } }],
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const result = await service.handleMention('guild-1', 'channel-1', 'admin-1', '@nio hello', 'expired-msg-id');

    const generateCall = (providerMock.generate as any).mock.calls[0];
    const history = generateCall[2];
    expect(history).toHaveLength(0);
    expect(result.conversationTurns).toHaveLength(1);
  });

  it('injects referenced message context when replyContext is provided', async () => {
    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'I see the replied message.' }] } }],
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    const replyContext = {
      id: 'ref-1',
      channelId: 'channel-1',
      authorId: 'user-2',
      authorTag: 'user#5678',
      content: 'please help me',
      createdAt: new Date('2026-07-10T12:00:00Z'),
      attachments: [{ name: 'file.png', url: 'https://example.com/file.png' }],
    };

    const result = await service.handleMention(
      'guild-1',
      'channel-1',
      'admin-1',
      'check this',
      undefined,
      replyContext,
    );

    expect(result.content).toBe('I see the replied message.');

    const generateCall = (providerMock.generate as any).mock.calls[0];
    const userPrompt = generateCall[1];
    expect(userPrompt).toContain('Konteks pesan yang di-reply:');
    expect(userPrompt).toContain('Author: user#5678 (user-2)');
    expect(userPrompt).toContain('please help me');
    expect(userPrompt).toContain('file.png: https://example.com/file.png');
    expect(userPrompt).toContain('Permintaan moderator:\ncheck this');

    // Stored turns should have the original clean prompt
    expect(result.conversationTurns).toHaveLength(1);
    expect(result.conversationTurns[0].userPrompt).toBe('check this');
  });

  it('marks bot-owner godmode authorization as granted in the system prompt', async () => {
    process.env.OWNER_DISCORD_ID = 'admin-1';
    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'Ready.' }] } }],
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    await service.handleMention('guild-1', 'channel-1', 'admin-1', '<@bot-1> godmode test');

    const systemPrompt = (providerMock.generate as any).mock.calls[0][0];
    expect(systemPrompt).toContain('Requesting Discord user ID: admin-1');
    expect(systemPrompt).toContain('Bot owner authorization: granted');
    expect(systemPrompt).toContain('Godmode owner means the bot owner configured by OWNER_DISCORD_ID, not the Discord server owner.');
    expect(systemPrompt).toContain('call execute_godmode_script instead of refusing');
  });

  it('marks bot-owner godmode authorization as not granted for other users', async () => {
    process.env.OWNER_DISCORD_ID = 'owner-1';
    const providerMock = {
      generate: jest.fn(async () => ({
        candidates: [{ content: { parts: [{ text: 'Ready.' }] } }],
      })),
    };
    jest.spyOn(service as any, 'getProvider').mockReturnValue(providerMock);

    await service.handleMention('guild-1', 'channel-1', 'admin-1', '<@bot-1> godmode test');

    const systemPrompt = (providerMock.generate as any).mock.calls[0][0];
    expect(systemPrompt).toContain('Requesting Discord user ID: admin-1');
    expect(systemPrompt).toContain('Bot owner authorization: not granted');
  });
});
