import { describe, expect, it } from 'vitest';
import byPlate from './fixtures/by-plate.json';
import { normalizeVehicle, extractAlerts } from '../src/lib/domain/normalizer';
import { applyIntent, getTramite } from '../src/lib/domain/tramites';
import { checkPreconditions } from '../src/lib/domain/preconditions';
import type { VehicleByPlate } from '../src/lib/croma/types';

const src = byPlate as unknown as VehicleByPlate;

describe('normalizeVehicle (eléctrico con prenda)', () => {
  const b = normalizeVehicle(src);
  it('campos directos', () => {
    expect(b.brand).toEqual({ value: 'TESLA', confidence: 'ok' });
    expect(b.fuel).toEqual({ value: 5, confidence: 'ok' });
    expect(b.serviceType).toEqual({ value: 1, confidence: 'ok' });
    expect(b.vin.value).toBe('TESTVIN0000000001');
    expect(b.restamped.value).toEqual({ engine: false, chassis: false, serial: false, vin: false });
  });
  it('clase: prevalece vehicle_class y se pide revisión por discrepancia', () => {
    expect(b.vehicleClass.value).toBe('CAMIONETA');
    expect(b.vehicleClass.confidence).toBe('review');
  });
  it('capacidad derivada de seated_passengers, cilindrada 0 y carrocería sin código', () => {
    expect(b.capacity).toMatchObject({ value: { kind: 'passengers', value: 5 }, confidence: 'review' });
    expect(b.displacement).toMatchObject({ value: 0, confidence: 'review' });
    expect(b.bodyType).toMatchObject({ value: { type: 'SUV', code: null }, confidence: 'review' });
  });
  it('faltantes: potencia, motor y serie', () => {
    expect(b.power.confidence).toBe('missing');
    expect(b.engineNumber.confidence).toBe('missing');
    expect(b.engineNumber.note).toMatch(/Eléctrico/);
    expect(b.serialNumber.confidence).toBe('missing');
  });
  it('armoring null significa no blindado', () => {
    expect(b.armoring).toEqual({ value: { armored: false, resolution: null, dearmoredDate: null }, confidence: 'ok' });
  });
  it('combustible desconocido (híbrido) pide revisión', () => {
    const hib = { ...src, vehicle: { ...src.vehicle!, fuel_type: 'HIBRIDO' } } as VehicleByPlate;
    expect(normalizeVehicle(hib).fuel).toMatchObject({ value: null, confidence: 'review' });
  });
});

describe('alertas y precondiciones', () => {
  it('alertas por arreglos, no por banderas', () => {
    expect(extractAlerts(src).pledges).toHaveLength(1);
    expect(src.vehicle!.has_liens).toBe(false);
  });
  it('levanta prenda sin prenda bloquea', () => {
    const sinPrenda = { ...src, pledges: [] } as VehicleByPlate;
    expect(checkPreconditions(12, sinPrenda).map((w) => w.code)).toContain('NO_PLEDGE');
    expect(checkPreconditions(12, src)).toEqual([]);
  });
  it('traspaso con prenda advierte sin bloquear', () => {
    const w = checkPreconditions(2, src);
    expect(w).toEqual([expect.objectContaining({ code: 'PLEDGE_ACTIVE', severity: 'warn' })]);
  });
  it('organismo distinto advierte, salvo en traslado y radicado', () => {
    expect(checkPreconditions(2, src, { officeAuthority: 'Yopal' }).map((w) => w.code)).toContain('AUTHORITY_DIFFERS');
    expect(checkPreconditions(3, src, { officeAuthority: 'Yopal' }).map((w) => w.code)).not.toContain('AUTHORITY_DIFFERS');
  });
  it('matrícula no activa bloquea', () => {
    const c = { ...src, vehicle: { ...src.vehicle!, registration_status: 'CANCELADO' } } as VehicleByPlate;
    expect(checkPreconditions(2, c).some((w) => w.severity === 'block')).toBe(true);
  });
});

describe('campos de intención', () => {
  it('cambio de color no prellena el color', () => {
    const out = applyIntent(normalizeVehicle(src), getTramite(5));
    expect(out.color).toMatchObject({ value: null, confidence: 'missing' });
    expect(out.brand.value).toBe('TESLA');
  });
  it('solo el traspaso es MVP', () => {
    const mvp = [2];
    expect(mvp).toEqual([2]);
    expect(getTramite(2).mvp).toBe(true);
    expect(getTramite(12).mvp).toBe(false);
  });
});
