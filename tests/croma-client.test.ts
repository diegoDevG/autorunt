import { describe, expect, it, vi } from 'vitest';
import { CromaClient, CromaError } from '../src/lib/croma/client';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const mk = (responses: Response[]) => {
  const fetchImpl = vi.fn(async () => responses.shift() as Response);
  const client = new CromaClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, waitSeconds: 20 });
  return { client, fetchImpl };
};

describe('CromaClient', () => {
  it('200 directo con caché y cabeceras correctas', async () => {
    const { client, fetchImpl } = mk([json(200, { data: { found: true } }, { 'X-Cache': 'HIT' })]);
    const r = await client.vehicleHistory('TST123');
    expect(r).toEqual({ data: { found: true }, cacheHit: true });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.croma.run/co/runt/vehicle-history-by-plate/v1');
    expect((init.headers as Record<string, string>).Prefer).toBe('wait=20');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
  });
  it('202 y polling hasta completar', async () => {
    const env = (status: string, data: unknown = null) => ({ job: { id: 'run_1', status, status_url: 'https://api.croma.run/jobs/run_1' }, data, error: null });
    const { client } = mk([json(202, env('running')), json(200, env('running'), { 'Retry-After': '1' }), json(200, env('completed', { found: true }))]);
    const r = await client.vehicleByPlate('TST123', { type: 'CC', number: '1234567' });
    expect(r).toEqual({ data: { found: true }, cacheHit: false });
  });
  it('trabajo fallido lanza CromaError con el código', async () => {
    const failed = { job: { id: 'run_1', status: 'failed', status_url: 'u' }, data: null, error: { type: 'x', code: 'UPSTREAM_DOWN', message: 'RUNT caído' } };
    const { client } = mk([json(202, { job: { id: 'run_1', status: 'queued', status_url: 'https://api.croma.run/jobs/run_1' } }), json(200, failed)]);
    await expect(client.vehicleHistory('TST123')).rejects.toMatchObject({ code: 'UPSTREAM_DOWN' });
  });
  it('errores HTTP se traducen', async () => {
    const { client } = mk([json(401, { error: { code: 'UNAUTHORIZED', message: 'clave inválida' } })]);
    await expect(client.vehicleHistory('TST123')).rejects.toBeInstanceOf(CromaError);
  });
  it('waitSeconds se limita a 55', async () => {
    const fetchImpl = vi.fn(async () => json(200, { data: {} }));
    const c = new CromaClient({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch, waitSeconds: 300 });
    await c.vehicleHistory('TST123');
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Prefer).toBe('wait=55');
  });
});
