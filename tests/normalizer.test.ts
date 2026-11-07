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
  it('clase: usa vehicle_class del RUNT sin pedir revisión aunque classification difiera', () => {
    expect(b.vehicleClass.value).toBe('CAMIONETA');
    expect(b.vehicleClass.confidence).toBe('ok');
  });
  it('capacidad derivada de seated_passengers, cilindrada 0 y carrocería sin código', () => {
    expect(b.capacity).toEqual({ value: { kind: 'passengers', value: 5 }, confidence: 'ok' });
    expect(b.displacement).toEqual({ value: 0, confidence: 'ok' });
    expect(b.bodyType).toEqual({ value: { type: 'SUV', code: null }, confidence: 'ok' });
  });
  it('capacidad: load_capacity 0 no es carga, usa pasajeros', () => {
    const sedan = { ...src, vehicle: { ...src.vehicle!, total_passengers: null, seated_passengers: 5, load_capacity: 0 } } as VehicleByPlate;
    expect(normalizeVehicle(sedan).capacity).toEqual({ value: { kind: 'passengers', value: 5 }, confidence: 'ok' });
    const camion = { ...src, vehicle: { ...src.vehicle!, total_passengers: null, seated_passengers: 3, load_capacity: 6500 } } as VehicleByPlate;
    expect(normalizeVehicle(camion).capacity).toEqual({ value: { kind: 'kg', value: 6500 }, confidence: 'ok' });
  });
  it('potencia opcional: queda en blanco sin pedir revisión', () => {
    expect(b.power).toMatchObject({ value: null, confidence: 'ok' });
  });
  it('faltantes: motor y serie', () => {
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

describe('valores de relleno de Croma', () => {
  it('NA, INDEFINIDO y vacíos cuentan como faltantes, no como datos', () => {
    const relleno = {
      ...src,
      vehicle: { ...src.vehicle!, color: 'INDEFINIDO', engine_number: 'NA', vin: 'N/A', chassis_number: 'N/A', serial_number: '', brand: 'na' },
    } as VehicleByPlate;
    const b = normalizeVehicle(relleno);
    expect(b.color).toMatchObject({ value: null, confidence: 'missing' });
    expect(b.engineNumber.confidence).toBe('missing');
    expect(b.chassisNumber.confidence).toBe('missing');
    expect(b.serialNumber.confidence).toBe('missing');
    expect(b.brand.confidence).toBe('missing');
  });
  it('un dato real con espacios se conserva recortado', () => {
    const real = { ...src, vehicle: { ...src.vehicle!, engine_number: '  7919101 7 ' } } as VehicleByPlate;
    expect(normalizeVehicle(real).engineNumber).toEqual({ value: '7919101 7', confidence: 'ok' });
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

describe('VIN, chasis y serie: se usan como vienen del RUNT', () => {
  it('no se copian entre sí: cada campo conserva su valor', () => {
    const v = { ...src, vehicle: { ...src.vehicle!, vin: 'VIN0000000000001', chassis_number: 'NA', serial_number: '0012024' } } as VehicleByPlate;
    const b = normalizeVehicle(v);
    expect(b.chassisNumber.confidence).toBe('missing');
    expect(b.serialNumber).toEqual({ value: '0012024', confidence: 'ok' });
    expect(b.vin).toEqual({ value: 'VIN0000000000001', confidence: 'ok' });
  });
});
