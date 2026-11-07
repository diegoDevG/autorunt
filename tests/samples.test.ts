import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { COVERAGE } from '../src/mocks/coverage';
import { buildSample, stampSample } from '../src/mocks/pipeline';
import { MockRuntPort } from '../src/mocks/mockRunt';
import { SCENARIOS } from '../src/mocks/scenarios';
import { DEV_COORDINATES } from '../src/lib/pdf/devLayout';
import v1 from '../templates/fun-rna/v1/coordinates.json';
import { getTramite } from '../src/lib/domain/tramites';
import { blockFromManual, buildStampValues, type ManualVehicle, type PersonInput } from '../src/lib/pdf/formMapper';
import { stampForm } from '../src/lib/pdf/overlay';

const TEMPLATE = 'templates/fun-rna/dev/form.pdf';
const PERSON: PersonInput = { documentType: 'CC', documentNumber: '1000000001', surname1: 'PEREZ', surname2: 'GIL', names: 'ANA', address: 'CRA 1', city: 'YOPAL', phone: '3105550101' };
const MANUAL: ManualVehicle = {
  plate: 'ABC123', vehicleClass: 'AUTOMOVIL', brand: 'MARCA', line: 'LINEA', modelYear: '2020', color: 'BLANCO', fuel: 1, displacement: 1200,
  capacity: { kind: 'passengers', value: 5 }, bodyType: { type: 'SEDAN' }, chassisNumber: 'CHASIS1', vin: 'VIN1', serviceType: 1,
};
const pairs = Object.entries(COVERAGE).flatMap(([t, ss]) => ss.map((s) => [Number(t), s] as const));

describe('cobertura: 18 trámites con datos simulados', () => {
  it('cubre los 18 trámites', () => {
    expect(Object.keys(COVERAGE).map(Number).sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it.each(pairs)('trámite %i con %s: estampa sin desbordes ni claves desconocidas', async (tramiteId, scenarioId) => {
    const r = await buildSample(scenarioId, tramiteId);
    expect(r.status).toBe('ok');
    expect(r.values?.checks).toContain(`tramite_${tramiteId}`);
    expect(r.issues.filter((i) => i.level === 'missing' && i.field !== 'owner.documentType')).toEqual([]);
    if (existsSync(TEMPLATE)) {
      const s = await stampSample(readFileSync(TEMPLATE), r);
      expect(s.overflow).toEqual([]);
      expect(s.unknownKeys).toEqual([]);
      expect((await PDFDocument.load(s.pdf)).getPageCount()).toBe(1);
    }
  });
});

describe('contenido por escenario', () => {
  const val = async (s: string, t: number) => (await buildSample(s, t)).values!;

  it('traspaso eléctrico con prenda: alertas, combustible y créditos', async () => {
    const r = await buildSample('ev-pledge', 2);
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(['PLEDGE_ACTIVE', 'AUTHORITY_DIFFERS']));
    expect(r.values!.checks).toEqual(expect.arrayContaining(['fuel_5', 'alert_other', 'class_camioneta', 'owner_doctype_C', 'buyer_doctype_C', 'armored_no']));
    expect(String(r.values!.text.obs_1)).toContain('PRENDA A FAVOR DE BANCO EJEMPLO');
    expect(r.values!.text.owner_names).toBe('MARIA ALEJANDRA');
    expect(r.creditsCroma).toBe(20);
  });
  it('moto: letras y números de placa y capacidad en pasajeros', async () => {
    const v = await val('moto', 2);
    expect(v.text.plate_letters).toBe('XYZ');
    expect(v.text.plate_numbers).toBe('12D');
    expect(v.text.capacity).toBe('2 PSJ');
    expect(v.checks).toContain('class_motocicleta');
  });
  it('empresa con NIT y camión: razón social, casilla N y capacidad en kg', async () => {
    const v = await val('company-owner', 2);
    expect(v.checks).toContain('owner_doctype_N');
    expect(v.text.owner_names).toBe('TRANSPORTES DEL LLANO S A S');
    expect(v.text.capacity).toBe('6500 KG');
    expect(v.checks).toContain('fuel_2');
  });
  it('taxi: servicio público con empresa vinculadora', async () => {
    const v = await val('taxi-public', 2);
    expect(v.checks).toContain('service_2');
    expect(v.text.company_name).toBe('COOTRANSYOPAL LTDA');
  });
  it('eléctrico: imprime cilindrada 0 y deja potencia y código de carrocería en blanco', async () => {
    const r = await buildSample('ev-pledge', 2);
    expect(r.values!.text.displacement).toBe(0);
    expect(r.issues.map((i) => i.field)).not.toEqual(expect.arrayContaining(['displacement']));
    expect(r.issues.map((i) => i.field)).not.toContain('bodyType');
    expect(r.values!.text.body_code).toBeNull();
    const sinPotencia = buildStampValues({ tramiteId: 2, vehicle: r.vehicle!, manual: { owner: PERSON, buyer: PERSON } });
    expect(sinPotencia.values.text.power).toBeNull();
    expect(sinPotencia.issues.map((i) => i.field)).not.toContain('power');
    const s = await stampForm(readFileSync(TEMPLATE), DEV_COORDINATES, sinPotencia.values);
    expect(s.overflow).toEqual([]);
  });
  it('NIT: ignora apellidos y deja la razón social en Nombres', () => {
    const empresa = { ...PERSON, documentType: 'NIT' as const, surname1: 'NO', surname2: 'VA', names: 'EMPRESA S A S' };
    const { values } = buildStampValues({ tramiteId: 2, vehicle: blockFromManual(MANUAL), manual: { owner: empresa, buyer: PERSON } });
    expect(values.text.owner_names).toBe('EMPRESA S A S');
    expect(values.text.owner_surname1).toBeUndefined();
    expect(values.text.owner_surname2).toBeUndefined();
    expect(values.checks).toContain('owner_doctype_N');
  });
  it('PPT: no marca ninguna casilla, imprime el número y pide revisión', () => {
    const ppt = { ...PERSON, documentType: 'PPT' as const };
    const { values, issues } = buildStampValues({ tramiteId: 2, vehicle: blockFromManual(MANUAL), manual: { owner: ppt, buyer: PERSON } });
    expect(values.checks.some((c) => c.startsWith('owner_doctype_'))).toBe(false);
    expect(values.text.owner_doc_number).toBe(PERSON.documentNumber);
    expect(issues).toContainEqual(expect.objectContaining({ field: 'owner.documentType', level: 'review' }));
  });
  it.each([[2, 'público'], [5, 'especial']])('servicio %i (%s): exige empresa y NIT', (serviceType) => {
    const vehicle = blockFromManual({ ...MANUAL, serviceType });
    const fields = (company?: { name: string; nit?: string }) =>
      buildStampValues({ tramiteId: 2, vehicle, manual: { owner: PERSON, buyer: PERSON, ...(company ? { company } : {}) } }).issues.map((i) => i.field);
    expect(fields()).toEqual(expect.arrayContaining(['company', 'company.nit']));
    expect(fields({ name: 'COOPERATIVA' })).toContain('company.nit');
    const completos = fields({ name: 'COOPERATIVA', nit: '900555111' });
    expect(completos).not.toContain('company');
    expect(completos).not.toContain('company.nit');
  });
  it('servicio particular: no exige empresa', () => {
    const { issues } = buildStampValues({ tramiteId: 2, vehicle: blockFromManual(MANUAL), manual: { owner: PERSON, buyer: PERSON } });
    expect(issues.map((i) => i.field)).not.toContain('company');
  });
  it('embargo marca la casilla de embargo', async () => {
    expect((await val('limitation-seizure', 2)).checks).toContain('alert_seizure');
  });
  it('blindado: casilla y resolución', async () => {
    const v = await val('armored-imported', 2);
    expect(v.checks).toContain('armored_yes');
    expect(v.text.armor_resolution).toBe('RES-123/2022');
  });
  it('híbrido: sin casilla de combustible y con aviso de revisión', async () => {
    const r = await buildSample('hybrid-unknown-fuel', 2);
    expect(r.values!.checks.some((c) => c.startsWith('fuel_'))).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ field: 'fuel', level: 'review' }));
  });
  it('motor regrabado: casilla SI en el motor', async () => {
    const v = await val('restamped-engine', 7);
    expect(v.checks).toContain('restamped_engine_yes');
    expect(v.text.engine_number).toBe('NUEVOMOTOR0001');
  });
  it('cambio de color usa el color nuevo, no el del RUNT', async () => {
    expect((await val('car-gasoline-clean', 5)).text.color).toBe('AZUL METALICO');
  });
  it('cambio de servicio a público pide y estampa la empresa', async () => {
    const v = await val('car-gasoline-clean', 6);
    expect(v.checks).toContain('service_2');
    expect(v.text.company_name).toBe('COOTRANSYOPAL LTDA');
  });
  it('cambio de carrocería usa la carrocería nueva con código', async () => {
    const v = await val('car-gasoline-clean', 17);
    expect(v.text.body_type).toBe('PICKUP');
    expect(v.text.body_code).toBe('12');
  });
  it('matrícula inicial no usa Croma y estampa la importación', async () => {
    const r = await buildSample('armored-imported', 1);
    expect(r.creditsCroma).toBe(0);
    expect(r.values!.checks).toContain('import_2');
    expect(r.values!.text.import_number).toBe('11870001');
    expect(r.values!.text.import_year).toBe('2021');
  });
  it('texto largo: cabe reduciendo la fuente o se reporta', async () => {
    const r = await buildSample('long-strings', 2);
    const s = await stampSample(readFileSync(TEMPLATE), r);
    expect(s.overflow).toEqual([]);
    expect(r.values!.text.owner_surname1).toBe('DE LA CRUZ');
  });
});

describe('bloqueos y ahorro de créditos', () => {
  it('levantar una prenda inexistente se bloquea tras 1 consulta (10 créditos)', async () => {
    const r = await buildSample('car-gasoline-clean', 12);
    expect(r.status).toBe('blocked');
    expect(r.creditsCroma).toBe(10);
    expect(r.warnings.map((w) => w.code)).toContain('NO_PLEDGE');
  });
});

describe('MockRuntPort', () => {
  it('documento que no es del propietario devuelve found=false', async () => {
    const p = new MockRuntPort();
    const s = SCENARIOS[0]!;
    const r = await p.vehicleByPlate(s.plate, { type: 'CC', number: '999999999' });
    expect(r.data.found).toBe(false);
  });
  it('la segunda llamada idéntica sale como caché', async () => {
    const p = new MockRuntPort();
    const s = SCENARIOS[0]!;
    const a = await p.vehicleHistory(s.plate);
    const b = await p.vehicleHistory(s.plate);
    expect([a.cacheHit, b.cacheHit]).toEqual([false, true]);
  });
});

describe('plantillas', () => {
  it('la plantilla de desarrollo borra organismo, ciudad y código preimpresos (3 áreas dentro de la página)', () => {
    const areas = DEV_COORDINATES.blankAreas ?? [];
    expect(areas).toHaveLength(3);
    for (const a of areas) { expect(a.x + a.width).toBeLessThanOrEqual(1044); expect(a.y).toBeGreaterThan(0); }
  });
  it('la plantilla oficial sin calibrar tiene las mismas claves que la de desarrollo', () => {
    expect(Object.keys(v1.fields).sort()).toEqual(Object.keys(DEV_COORDINATES.fields).sort());
    expect(Object.keys(v1.checkboxes).sort()).toEqual(Object.keys(DEV_COORDINATES.checkboxes).sort());
    expect(v1.calibrated).toBe(false);
  });
  it('los 18 trámites tienen casilla', () => {
    for (let i = 1; i <= 18; i++) { expect(DEV_COORDINATES.checkboxes[`tramite_${i}`]).toBeDefined(); expect(getTramite(i).id).toBe(i); }
  });
});
