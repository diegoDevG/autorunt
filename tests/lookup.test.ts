import { describe, expect, it, vi } from 'vitest';
import byPlate from './fixtures/by-plate.json';
import history from './fixtures/history.json';
import { runLookup } from '../src/lib/domain/lookup';
import type { RuntPort } from '../src/lib/croma/client';
import type { VehicleByPlate, VehicleHistory } from '../src/lib/croma/types';

const base = { plate: 'TST123', documentType: 'CC', documentNumber: '1234567', tramiteId: 2 };

function port(over: Partial<{ gate: unknown; hist: unknown; histFails: boolean; gateCache: boolean; histCache: boolean }> = {}) {
  const vehicleByPlate = vi.fn(async () => ({ data: (over.gate ?? byPlate) as unknown as VehicleByPlate, cacheHit: !!over.gateCache }));
  const vehicleHistory = vi.fn(async () => {
    if (over.histFails) throw new Error('boom');
    return { data: (over.hist ?? history) as unknown as VehicleHistory, cacheHit: !!over.histCache };
  });
  return { p: { vehicleByPlate, vehicleHistory } as RuntPort, vehicleByPlate, vehicleHistory };
}

describe('runLookup', () => {
  it('flujo feliz: compuerta, historial, nombre separado y 20 créditos', async () => {
    const { p, vehicleHistory } = port();
    const r = await runLookup(p, base);
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(vehicleHistory).toHaveBeenCalledOnce();
    expect(r.owner.name).toMatchObject({ names: 'MARIA ALEJANDRA', surname1: 'RODRIGUEZ', surname2: 'PEREZ' });
    expect(r.importRecord?.import_record_number).toBe('10000001');
    expect(r.estimatedCredits).toBe(20);
    expect(r.warnings.map((w) => w.code)).toContain('PLEDGE_ACTIVE');
  });
  it('respuestas en caché no cuestan créditos', async () => {
    const { p } = port({ gateCache: true, histCache: true });
    const r = await runLookup(p, base);
    expect(r.status === 'ok' && r.estimatedCredits).toBe(0);
  });
  it('entrada inválida no llama a Croma', async () => {
    const { p, vehicleByPlate } = port();
    const r = await runLookup(p, { ...base, plate: 'XX' });
    expect(r.status).toBe('invalid');
    expect(vehicleByPlate).not.toHaveBeenCalled();
  });
  it('found=false no consulta el historial', async () => {
    const { p, vehicleHistory } = port({ gate: { found: false, plate: 'TST123', vehicle: null, pledges: [], ownership_limitations: [], armoring: null } });
    expect((await runLookup(p, base)).status).toBe('not_found');
    expect(vehicleHistory).not.toHaveBeenCalled();
  });
  it('trámite bloqueado no gasta la segunda consulta', async () => {
    const { p, vehicleHistory } = port({ gate: { ...byPlate, pledges: [] } });
    const r = await runLookup(p, { ...base, tramiteId: 12 });
    expect(r).toMatchObject({ status: 'blocked', estimatedCredits: 10 });
    expect(vehicleHistory).not.toHaveBeenCalled();
  });
  it('propietario del historial distinto: no se usa el nombre', async () => {
    const otro = { ...history, owners: [{ ...history.owners[0], document_number: '9999999' }] };
    const r = await runLookup(port({ hist: otro }).p, base);
    expect(r.status === 'ok' && r.owner.name).toBeNull();
    expect(r.status === 'ok' && r.warnings.map((w) => w.code)).toContain('OWNER_MISMATCH');
  });
  it('historial caído degrada a nombre manual sin fallar', async () => {
    const r = await runLookup(port({ histFails: true }).p, base);
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.owner.name).toBeNull();
    expect(r.status === 'ok' && r.estimatedCredits).toBe(10);
  });
  it('levanta prenda con prenda inscrita pasa', async () => {
    const r = await runLookup(port().p, { ...base, tramiteId: 12 });
    expect(r.status).toBe('ok');
  });
});
