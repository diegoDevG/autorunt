// Estampa el formulario con datos simulados (sin Croma) para cada trámite y escenario.
// Uso: npm run dev-template && npm run samples   → out/samples/*.pdf + out/samples/report.json
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { COVERAGE } from '../src/mocks/coverage';
import { buildSample, stampSample } from '../src/mocks/pipeline';
import { getTramite } from '../src/lib/domain/tramites';

async function main() {
  if (!existsSync('templates/fun-rna/dev/form.pdf')) throw new Error('Falta la plantilla: npm run dev-template');
  const template = readFileSync('templates/fun-rna/dev/form.pdf');
  mkdirSync('out/samples', { recursive: true });
  const report: unknown[] = [];
  for (const [id, scenarios] of Object.entries(COVERAGE)) {
    const t = getTramite(Number(id));
    for (const sid of scenarios) {
      const r = await buildSample(sid, t.id);
      let overflow: string[] = [], unknown: string[] = [], file: string | null = null;
      if (r.status === 'ok') {
        const s = await stampSample(template, r);
        overflow = s.overflow; unknown = s.unknownKeys;
        file = `out/samples/${String(t.id).padStart(2, '0')}-${t.slug}__${sid}.pdf`;
        writeFileSync(file, s.pdf);
      }
      report.push({ tramite: t.id, slug: t.slug, scenario: sid, status: r.status, file, overflow, unknown, croma: r.creditsCroma,
        warnings: r.warnings.map((w) => w.code), issues: r.issues.map((i) => `${i.level}:${i.field}`) });
      console.log(`${String(t.id).padStart(2)} ${t.slug.padEnd(20)} ${sid.padEnd(20)} ${r.status.padEnd(9)} ovf=${overflow.length} unk=${unknown.length} issues=${r.issues.length}`);
    }
  }
  writeFileSync('out/samples/report.json', JSON.stringify(report, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
