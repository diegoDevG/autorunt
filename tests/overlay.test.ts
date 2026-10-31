import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import coords from '../templates/fun-rna/v1/coordinates.json';
import { stampForm, sanitize, type Coordinates } from '../src/lib/pdf/overlay';

async function blank() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return d.save();
}
const c: Coordinates = {
  templateId: 't', calibrated: true,
  fields: { brand: { x: 50, y: 700, size: 10, maxWidth: 60 }, vin: { x: 50, y: 680, size: 10, maxWidth: 400 } },
  checkboxes: { fuel_5: { x: 50, y: 650 } },
};

describe('áreas en blanco', () => {
  it('pinta rectángulos blancos antes de estampar', async () => {
    const tpl = await blank();
    const a = await stampForm(tpl, c, { text: {}, checks: [] });
    const b = await stampForm(tpl, { ...c, blankAreas: [{ x: 10, y: 10, width: 50, height: 20 }] }, { text: {}, checks: [] });
    expect(b.pdf.length).toBeGreaterThan(a.pdf.length);
  });
});

describe('stampForm', () => {
  it('rechaza plantillas sin calibrar', async () => {
    await expect(stampForm(await blank(), coords as Coordinates, { text: {}, checks: [] })).rejects.toThrow('UNCALIBRATED_TEMPLATE');
  });
  it('estampa texto y casillas y devuelve un PDF válido', async () => {
    const r = await stampForm(await blank(), c, { text: { brand: 'Tesla', vin: 'TESTVIN0000000001' }, checks: ['fuel_5'] });
    expect(r.overflow).toEqual([]);
    expect(r.unknownKeys).toEqual([]);
    expect((await PDFDocument.load(r.pdf)).getPageCount()).toBe(1);
  });
  it('reduce la fuente y marca desbordamiento si aun así no cabe', async () => {
    const r = await stampForm(await blank(), c, { text: { brand: 'UN TEXTO LARGUISIMO QUE NO CABE' }, checks: [] });
    expect(r.overflow).toEqual(['brand']);
  });
  it('reporta claves desconocidas', async () => {
    const r = await stampForm(await blank(), c, { text: { nada: 'x' }, checks: ['nada'] });
    expect(r.unknownKeys).toEqual(['nada', 'nada']);
  });
  it('sanitiza a mayúsculas WinAnsi', () => {
    expect(sanitize('muñoz ñandú → ok')).toBe('MUÑOZ ÑANDÚ ? OK');
  });
});
