// Dibuja una cuadrícula etiquetada cada 50 pt sobre la plantilla para calibrar coordenadas.
// Uso: npm run grid -- templates/fun-rna/v1/form.pdf out/grid.pdf
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

async function main() {

  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('Uso: grid <plantilla.pdf> <salida.pdf>'); process.exit(1); }

  const doc = await PDFDocument.load(readFileSync(src));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    for (let x = 0; x <= width; x += 50) {
      page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.3, color: rgb(1, 0, 0), opacity: 0.5 });
      page.drawText(String(x), { x: x + 1, y: 2, size: 6, font, color: rgb(1, 0, 0) });
    }
    for (let y = 0; y <= height; y += 50) {
      page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.3, color: rgb(0, 0, 1), opacity: 0.5 });
      page.drawText(String(y), { x: 2, y: y + 1, size: 6, font, color: rgb(0, 0, 1) });
    }
    console.log(`Página ${width} x ${height} pt`);
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, await doc.save());

}
main().catch((e) => { console.error(e); process.exit(1); });
