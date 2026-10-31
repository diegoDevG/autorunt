// Regenera templates/fun-rna/v1/coordinates.json (sin calibrar) con las mismas claves del layout de desarrollo.
import { writeFileSync } from 'node:fs';
import { DEV_COORDINATES } from '../src/lib/pdf/devLayout';

const f = Object.fromEntries(Object.keys(DEV_COORDINATES.fields).map((k) => [k, { x: 0, y: 0, size: 9, maxWidth: 0 }]));
const c = Object.fromEntries(Object.keys(DEV_COORDINATES.checkboxes).map((k) => [k, { x: 0, y: 0, size: 9 }]));
writeFileSync('templates/fun-rna/v1/coordinates.json', JSON.stringify({ templateId: 'fun-rna-v1', calibrated: false, fields: f, checkboxes: c }, null, 2));
console.log(Object.keys(f).length, 'campos,', Object.keys(c).length, 'casillas');
