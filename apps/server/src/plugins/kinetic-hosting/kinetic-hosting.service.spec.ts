import { describe, expect, it, jest } from '@jest/globals';
import { CredentialEncryptionService } from '../credential-encryption.service';
import { KineticHostingService } from './kinetic-hosting.service';

describe('KineticHostingService', () => {
  it('uses the credential belonging to the requested guild', async () => {
    process.env.PLUGIN_CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-that-is-long-enough';
    const encryption = new CredentialEncryptionService();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: [] }) } as Response);
    const prisma = {
      guildPluginCredential: {
        findUnique: jest.fn(async ({ where }: any) => ({ encryptedToken: encryption.encrypt(where.guildId_pluginId.guildId === 'guild-a' ? 'token-a' : 'token-b') })),
      },
    } as any;
    const service = new KineticHostingService(prisma, encryption);

    await service.listServers('guild-a');
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/client?page=1'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer token-a' }),
    }));
    fetchMock.mockRestore();
  });

  it('rejects missing guild credentials and invalid server identifiers', async () => {
    const prisma = { guildPluginCredential: { findUnique: jest.fn(async () => null) } } as any;
    const service = new KineticHostingService(prisma, new CredentialEncryptionService());

    await expect(service.listServers('guild')).rejects.toThrow('API key is not configured');
    await expect(service.serverStatus('guild', '../secret')).rejects.toThrow('Invalid Kinetic server identifier');
  });

  it('sanitizes non-success responses', async () => {
    process.env.PLUGIN_CREDENTIALS_ENCRYPTION_KEY = 'test-encryption-key-that-is-long-enough';
    const encryption = new CredentialEncryptionService();
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    const prisma = { guildPluginCredential: { findUnique: jest.fn(async () => ({ encryptedToken: encryption.encrypt('secret-token') })) } } as any;
    await expect(new KineticHostingService(prisma, encryption).listServers('guild')).rejects.toThrow('Kinetic API request failed (500)');
    fetchMock.mockRestore();
  });
});
