import { describe, expect, it, jest } from '@jest/globals';
import { KineticHostingService } from './kinetic-hosting.service';

describe('KineticHostingService', () => {
  it('sends the bearer token and rejects invalid server identifiers', async () => {
    process.env.KINETIC_PANEL_TOKEN = 'secret-token';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    } as Response);
    const service = new KineticHostingService();

    await service.listServers();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/client?page=1'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer secret-token' }),
    }));
    await expect(service.serverStatus('../secret')).rejects.toThrow('Invalid Kinetic server identifier');
    fetchMock.mockRestore();
  });

  it('sanitizes non-success responses', async () => {
    process.env.KINETIC_PANEL_TOKEN = 'secret-token';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(new KineticHostingService().listServers()).rejects.toThrow('Kinetic API request failed (500)');
    fetchMock.mockRestore();
  });
});
