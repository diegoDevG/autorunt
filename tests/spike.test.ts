import { describe, expect, it } from 'vitest';
import byPlate from './fixtures/by-plate.json';
import history from './fixtures/history.json';
import { anonymize, evaluate, observe, renderReport, runCase, shouldStop, type CaseResult, type SpikeCase } from '../scripts/spike/core';
import type { VehicleByPlate, VehicleHistory } from '../src/lib/croma/types';

const DOC = history.owners[0]!.document_number;
const CASE: SpikeCase = { id: 1, label: 'Base', plate: 'TST123', documentType: 'CC', documentNumber: DOC, mode: 'normal' };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const routed = (over: Partial<Record<'byPlate' | 'history', () => Response>> = {}): typeof fetch => async (input) => {
  const url = String(input);
  if (url.includes('history')) return over.history?.() ?? json({ data: history });
  if (url.includes('vehicle-by-plate')) return over.byPlate?.() ?? json({ data: byPlate });
  throw new Error(`URL inesperada: ${url}`);
};
const opts = (fetchImpl: typeof fetch) => ({ apiKey: 'k', fetchImpl, waitSeconds: 8, sleep: async () => {} });

describe('runCase', () => {
  it('flujo normal: compuerta, historial y observación del bloque', async () => {
    const { result, exchanges } = await runCase(CASE, opts(routed()));
    expect(result.calls.map((c) => [c.op, c.ok, c.found])).toEqual([['byPlate', true, true], ['history', true, true]]);
    expect(exchanges).toHaveLength(2);
    expect(result.observation).toMatchObject({ found: true, missing: [], pledges: 1, absentKeys: [] });
    expect(result.observation?.rawValues.body_type).toBe('SUV');
    expect(result.observation?.owners).toMatchObject({ total: 1, documentMatches: true });
  });
  it('found=false no gasta el historial', async () => {
    const { result } = await runCase(CASE, opts(routed({ byPlate: () => json({ data: { found: false, plate: 'TST123', vehicle: null, pledges: [], ownership_limitations: [], armoring: null } }) })));
    expect(result.calls).toHaveLength(1);
    expect(result.observation?.found).toBe(false);
  });
  it('registra un 404 como error del contrato, sin el mensaje', async () => {
    const { result } = await runCase(CASE, opts(routed({ byPlate: () => json({ error: { code: 'NOT_FOUND', message: `Sin datos para ${DOC}` } }, 404) })));
    expect(result.calls[0]).toMatchObject({ ok: false, errorCode: 'NOT_FOUND', errorStatus: 404, httpStatuses: [404] });
    expect(JSON.stringify(result)).not.toContain(DOC);
    expect(result.observation).toBeNull();
  });
  it('sigue un 202 hasta completar y conserva las cabeceras útiles', async () => {
    let polls = 0;
    const f: typeof fetch = async (input) => {
      const url = String(input);
      if (url === 'https://poll.test/job') {
        polls++;
        return polls === 1 ? json({ job: { id: 'j', status: 'running', status_url: url } }, 200, { 'Retry-After': '1' }) : json({ job: { id: 'j', status: 'completed', status_url: url }, data: byPlate });
      }
      if (url.includes('history')) return json({ data: history }, 200, { 'X-Cache': 'HIT' });
      return json({ job: { id: 'j', status: 'queued', status_url: 'https://poll.test/job' } }, 202, { 'X-Job-Id': 'j' });
    };
    const { result } = await runCase(CASE, opts(f));
    expect(result.calls[0]).toMatchObject({ ok: true, httpStatuses: [202, 200, 200], cacheHit: false });
    expect(result.calls[0]?.headers).toMatchObject({ 'x-job-id': 'j' });
    expect(result.calls[1]).toMatchObject({ cacheHit: true });
  });
  it('modo repeat compara las dos respuestas', async () => {
    const { result } = await runCase({ ...CASE, mode: 'repeat' }, opts(routed()));
    expect(result.calls).toHaveLength(4);
    expect(result.repeatIdentical).toBe(true);
  });
  it('modo concurrent lanza dos compuertas a la vez', async () => {
    const { result } = await runCase({ ...CASE, mode: 'concurrent' }, opts(routed()));
    expect(result.calls.map((c) => c.op)).toEqual(['byPlate', 'byPlate']);
  });
  it('se detiene ante saldo, credenciales o límite de tasa', async () => {
    const { result } = await runCase(CASE, opts(routed({ byPlate: () => json({}, 429) })));
    expect(shouldStop(result)).toBe(true);
  });
});

describe('observe', () => {
  it('detecta copropietarios y una llave que dejó de llegar', () => {
    const { vin: _vin, ...vehicle } = byPlate.vehicle;
    const two = { ...history, owners: [history.owners[0], history.owners[0]] } as unknown as VehicleHistory;
    const o = observe(CASE, { ...byPlate, vehicle } as unknown as VehicleByPlate, two);
    expect(o?.owners?.active).toBe(2);
    expect(o?.absentKeys).toContain('vin');
    expect(o?.missing).not.toContain('vin'); // el VIN se llena con el chasis o la serie
  });
});

describe('anonymize', () => {
  it('no deja pasar datos personales ni textos de llaves desconocidas', () => {
    const out = JSON.stringify(anonymize({
      ...byPlate, plate: 'TST123', llave_nueva: 'DATO SENSIBLE', telefono_number: 3105550101,
      owners: [{ name: 'MARIA PEREZ', document_number: '1234567', document_type: 'Cédula Ciudadanía' }],
    }));
    for (const secret of ['TST123', 'DATO SENSIBLE', 'MARIA PEREZ', '1234567', '3105550101', 'TESTVIN0000000001', 'BANCO EJEMPLO', '900000001']) expect(out).not.toContain(secret);
  });
  it('conserva los valores necesarios para los mapeos', () => {
    const out = anonymize(byPlate) as VehicleByPlate;
    expect(out.vehicle).toMatchObject({ vehicle_class: 'CAMIONETA', body_type: 'SUV', fuel_type: 'ELECTRICO', engine_displacement: 0, seated_passengers: 5 });
  });
});

describe('evaluate y renderReport', () => {
  const result = async (id: number, panelCredits?: number): Promise<CaseResult> => {
    const { result: r } = await runCase({ ...CASE, id }, opts(routed()));
    return { ...r, ...(panelCredits === undefined ? {} : { panelCredits }) };
  };
  const status = (rs: CaseResult[]) => Object.fromEntries(evaluate(rs).map((c) => [c.name, c.status]));

  it('sin resultados todo queda pendiente, salvo lo manual', () => {
    expect(evaluate([]).map((c) => c.status)).toEqual(['pendiente', 'pendiente', 'pendiente', 'pendiente', 'manual']);
  });
  it('pasa con los 8 casos completos y costo dentro del tope', async () => {
    const rs = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((id) => result(id, 20)));
    const s = status(rs);
    expect(s['Casos 1 a 8 con el bloque de vehículo completo']).toBe('pasa');
    expect(s['Costo por consulta conocido']).toBe('pasa');
    expect(s['Mapeo de clase, combustible y servicio']).toBe('pasa');
  });
  it('no pasa si una consulta supera los 20 créditos', async () => {
    expect(status([await result(1, 30)])['Costo por consulta conocido']).toBe('no pasa');
  });
  it('la latencia se evalúa por consulta y muestra la espera total', () => {
    const call = (ms: number) => ({ op: 'byPlate' as const, ok: true, ms, cacheHit: false, httpStatuses: [202, 200], headers: {}, found: true });
    const r: CaseResult = { id: 1, label: 'x', mode: 'normal', documentType: 'CC', ranAt: '', calls: [call(23_000), call(19_000)], observation: null };
    const c = evaluate([r]).find((x) => x.name.startsWith('Latencia'))!;
    expect(c.status).toBe('pasa');
    expect(c.detail).toContain('23.0 s');
    expect(c.detail).toContain('42.0 s');
  });
  it('el informe no contiene datos personales', async () => {
    const report = renderReport([await result(1, 20)], [{ id: 1, label: 'Base' }, { id: 2, label: 'Moto' }], '2026-11-06');
    for (const secret of ['TST123', DOC, history.owners[0]!.name, 'TESTVIN0000000001']) expect(report).not.toContain(secret);
    expect(report).toContain('Sin correr: 2 (Moto)');
    expect(report).toContain('SUV');
  });
});
