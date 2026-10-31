import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { DEV_PAGE } from './devLayout';

/** Plantilla de desarrollo: se arma una vez desde la imagen del formulario y se reutiliza. */
export async function ensureDevTemplate(): Promise<Uint8Array> {
  const dir = path.join(process.cwd(), 'templates/fun-rna/dev');
  const pdfPath = path.join(dir, 'form.pdf');
  if (existsSync(pdfPath)) return readFileSync(pdfPath);
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(readFileSync(path.join(dir, 'form.png')));
  const page = doc.addPage([DEV_PAGE.width, DEV_PAGE.height]);
  page.drawImage(img, { x: 0, y: 0, width: DEV_PAGE.width, height: DEV_PAGE.height });
  const bytes = await doc.save();
  writeFileSync(pdfPath, bytes);
  return bytes;
}
