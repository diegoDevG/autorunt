// Genera templates/fun-rna/dev/form.pdf a partir de la imagen del formulario (solo desarrollo).
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { DEV_PAGE } from '../src/lib/pdf/devLayout';

async function main() {

  const doc = await PDFDocument.create();
  const img = await doc.embedPng(readFileSync('templates/fun-rna/dev/form.png'));
  const page = doc.addPage([DEV_PAGE.width, DEV_PAGE.height]);
  page.drawImage(img, { x: 0, y: 0, width: DEV_PAGE.width, height: DEV_PAGE.height });
  writeFileSync('templates/fun-rna/dev/form.pdf', await doc.save());
  console.log('templates/fun-rna/dev/form.pdf');

}
main().catch((e) => { console.error(e); process.exit(1); });
