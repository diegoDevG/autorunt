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

const TEMPLATE = 'templates/fun-rna/dev/form.pdf';
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
