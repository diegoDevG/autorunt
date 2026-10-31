import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface FieldSpec { x: number; y: number; size?: number; minSize?: number; maxWidth?: number; page?: number }
export interface CheckboxSpec { x: number; y: number; size?: number; page?: number }
/** Rectángulo en puntos pdf-lib (origen abajo-izquierda) que se pinta de blanco antes de estampar. */
export interface BlankArea { x: number; y: number; width: number; height: number; page?: number }
export interface Coordinates {
  templateId: string;
  /** Texto preimpreso que debe salir en blanco (p. ej. organismo de tránsito de la plantilla de Bogotá). */
  blankAreas?: BlankArea[];
  /** false hasta calibrar contra el PDF real; stampForm se niega a generar con plantilla sin calibrar. */
  calibrated: boolean;
  fields: Record<string, FieldSpec>;
  checkboxes: Record<string, CheckboxSpec>;
}
export interface StampValues {
  text: Record<string, string | number | null | undefined>;
  checks: string[];
}
export interface StampResult {
  pdf: Uint8Array;
  /** Campos cuyo texto no cabe ni con la fuente mínima: bloquear la generación. */
  overflow: string[];
  unknownKeys: string[];
}

/** Helvetica (WinAnsi) cubre tildes y Ñ. Cualquier otro carácter se reemplaza. */
export const sanitize = (s: string): string => s.toUpperCase().replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');

export async function stampForm(
  template: Uint8Array,
  coords: Coordinates,
  values: StampValues,
  opts: { allowUncalibrated?: boolean } = {},
): Promise<StampResult> {
  if (!coords.calibrated && !opts.allowUncalibrated) throw new Error('UNCALIBRATED_TEMPLATE');
  const doc = await PDFDocument.load(template);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const overflow: string[] = [];
  const unknownKeys: string[] = [];

  for (const b of coords.blankAreas ?? []) {
    const page = pages[b.page ?? 0];
    if (page) page.drawRectangle({ x: b.x, y: b.y, width: b.width, height: b.height, color: rgb(1, 1, 1) });
  }

  for (const [key, raw] of Object.entries(values.text)) {
    if (raw === null || raw === undefined || raw === '') continue;
    const spec = coords.fields[key];
    if (!spec) { unknownKeys.push(key); continue; }
    const page = pages[spec.page ?? 0];
    if (!page) { unknownKeys.push(key); continue; }
    const text = sanitize(String(raw));
    let size = spec.size ?? 9;
    const min = spec.minSize ?? 6;
    if (spec.maxWidth) {
      while (font.widthOfTextAtSize(text, size) > spec.maxWidth && size > min) size -= 0.5;
      if (font.widthOfTextAtSize(text, size) > spec.maxWidth) { overflow.push(key); continue; }
    }
    page.drawText(text, { x: spec.x, y: spec.y, size, font, color: rgb(0, 0, 0) });
  }

  for (const key of values.checks) {
    const spec = coords.checkboxes[key];
    if (!spec) { unknownKeys.push(key); continue; }
    const page = pages[spec.page ?? 0];
    if (!page) { unknownKeys.push(key); continue; }
    const size = spec.size ?? 9;
    page.drawText('X', { x: spec.x, y: spec.y, size, font, color: rgb(0, 0, 0) });
  }

  return { pdf: await doc.save(), overflow, unknownKeys };
}
