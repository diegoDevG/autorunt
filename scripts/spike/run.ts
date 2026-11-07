// Ejecuta el spike con Croma. Sin --yes solo muestra el plan y no llama a la API.
//   npm run spike -- --only 1,2 --yes --ask-credits
// Entrada: spike-data/cases.json. Salida: spike-data/{results.json,report.md,raw/,fixtures/}. Toda la carpeta está fuera de git.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { z } from 'zod';
import { anonymize, caseSchema, renderReport, runCase, shouldStop, type CaseResult, type SpikeCase } from './core';

const DIR = 'spike-data';
const CASES = `${DIR}/cases.json`;
const RESULTS = `${DIR}/results.json`;

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };

const callsFor = (c: SpikeCase) => (c.mode === 'repeat' ? 4 : 2);

async function main() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
  if (!existsSync(CASES)) {
    console.error(`Falta ${CASES}. Cópialo desde scripts/spike/cases.example.json y llena placas y documentos autorizados:\n  mkdir -p ${DIR} && cp scripts/spike/cases.example.json ${CASES}`);
    process.exit(1);
  }
  const all = z.array(caseSchema).parse(JSON.parse(readFileSync(CASES, 'utf8')));
  const only = option('only')?.split(',').map(Number);
  const selected = all.filter((c) => !only || only.includes(c.id));
  const ready = selected.filter((c) => c.plate.trim() && c.documentNumber.trim());
  const unfilled = selected.filter((c) => !ready.includes(c));
  const maxCalls = ready.reduce((s, c) => s + callsFor(c), 0);

  console.log(`Casos listos: ${ready.map((c) => c.id).join(', ') || 'ninguno'}`);
  if (unfilled.length) console.log(`Sin llenar (se omiten): ${unfilled.map((c) => c.id).join(', ')}`);
  console.log(`Máximo ${maxCalls} llamadas, unos ${maxCalls * 10} créditos si cada una cuesta 10 y ninguna sale de caché.`);
  if (!flag('yes')) { console.log('Plan solamente: no se llamó a Croma. Agrega --yes para ejecutar.'); return; }
  if (!ready.length) return;

  const apiKey = process.env.CROMA_API_KEY;
  if (!apiKey) { console.error('Falta CROMA_API_KEY en .env.local'); process.exit(1); }

  mkdirSync(`${DIR}/raw`, { recursive: true });
  mkdirSync(`${DIR}/fixtures`, { recursive: true });
  const previous: CaseResult[] = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : [];
  const results = new Map(previous.map((r) => [r.id, r]));
  const save = () => {
    const list = [...results.values()].sort((a, b) => a.id - b.id);
    writeFileSync(RESULTS, JSON.stringify(list, null, 2));
    writeFileSync(`${DIR}/report.md`, renderReport(list, all, new Date().toISOString()));
  };

  const askCredits = flag('ask-credits');
  const rl = askCredits ? createInterface({ input: process.stdin, output: process.stdout }) : null;
  const readCounter = async (when: string) => {
    const answer = (await rl?.question(`Créditos consumidos en el panel de Croma (no Requests) ${when}: `))?.trim();
    const n = Number(answer);
    return answer && Number.isFinite(n) ? n : undefined;
  };
  let counter = askCredits ? await readCounter('antes de empezar') : undefined;

  for (const c of ready) {
    console.log(`\nCaso ${c.id}: ${c.label}`);
    const run = await runCase(c, { apiKey, fetchImpl: fetch, waitSeconds: Number(option('wait') ?? 8) });
    writeFileSync(`${DIR}/raw/case-${c.id}.json`, JSON.stringify({ case: c, exchanges: run.exchanges }, null, 2));
    if (run.byPlate) writeFileSync(`${DIR}/fixtures/case-${c.id}-by-plate.json`, JSON.stringify(anonymize(run.byPlate), null, 2));
    if (run.history) writeFileSync(`${DIR}/fixtures/case-${c.id}-history.json`, JSON.stringify(anonymize(run.history), null, 2));
    if (askCredits) {
      const after = await readCounter(`después del caso ${c.id}`);
      if (after !== undefined && counter !== undefined) run.result.panelCredits = after - counter;
      counter = after ?? counter;
    }
    results.set(c.id, run.result);
    save();
    for (const call of run.result.calls) {
      console.log(`  ${call.op}: ${call.ok ? `found=${call.found} caché=${call.cacheHit}` : `error ${call.errorCode}`} HTTP ${call.httpStatuses.join('→')} ${call.ms} ms`);
    }
    if (shouldStop(run.result)) { console.error('Se detiene la corrida: credenciales, saldo o límite de tasa.'); break; }
  }
  rl?.close();
  console.log(`\nInforme: ${DIR}/report.md`);
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
