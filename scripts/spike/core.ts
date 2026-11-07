// Núcleo del spike con Croma: ejecuta casos, observa las respuestas y evalúa los criterios de la sección 12 del alcance.
// Lo que sale de aquí hacia results.json y report.md no lleva datos personales; las respuestas crudas solo van a spike-data/raw.
import { z } from 'zod';
import { CromaClient, CromaError } from '../../src/lib/croma/client';
import type { VehicleByPlate, VehicleHistory } from '../../src/lib/croma/types';
import { splitColombianName } from '../../src/lib/domain/name';
import { normalizeVehicle, type FormVehicleBlock } from '../../src/lib/domain/normalizer';
import { DOCUMENT_TYPES, normalizePlate } from '../../src/lib/domain/validators';
import { REQUIRED_VEHICLE_FIELDS } from '../../src/lib/pdf/formMapper';

export const caseSchema = z.object({
  id: z.number().int().positive(),
  label: z.string(),
  plate: z.string(),
  documentType: z.enum(DOCUMENT_TYPES).default('CC'),
  documentNumber: z.string(),
  mode: z.enum(['normal', 'repeat', 'concurrent']).default('normal'),
});
export type SpikeCase = z.infer<typeof caseSchema>;

export interface Exchange { method: string; url: string; status: number; ms: number; headers: Record<string, string>; body: string }

export interface CallResult {
  op: 'byPlate' | 'history';
  ok: boolean;
  ms: number;
  cacheHit: boolean | null;
  httpStatuses: number[];
  /** Cabeceras de caché, créditos, límite de tasa y trabajos, para documentar el contrato real. */
  headers: Record<string, string>;
  found: boolean | null;
  errorCode?: string;
  errorStatus?: number;
}

export interface Observation {
  found: boolean;
  rawValues: Record<string, string | null>;
  fields: Record<string, { confidence: string; hasValue: boolean }>;
  /** Campos obligatorios del bloque de vehículo sin valor. */
  missing: string[];
  review: string[];
  /** Llaves que el normalizador lee y no llegaron en la respuesta: señal de un contrato distinto. */
  absentKeys: string[];
  pledges: number;
  limitations: number;
  structures: { pledge: string[]; limitation: string[]; armoring: string[] };
  owners: {
    total: number; active: number; documentTypes: string[]; documentMatches: boolean;
    nameWords: number; nameConfidence: 'high' | 'low' | null;
  } | null;
  hasImportRecord: boolean | null;
}

export interface CaseResult {
  id: number;
  label: string;
  mode: SpikeCase['mode'];
  documentType: string;
  ranAt: string;
  calls: CallResult[];
  observation: Observation | null;
  repeatIdentical?: boolean;
  /** Créditos según el contador del panel (Croma no los expone en la respuesta hasta donde se ha observado). */
  panelCredits?: number;
}

export interface CaseRun { result: CaseResult; exchanges: Exchange[]; byPlate: VehicleByPlate | null; history: VehicleHistory | null }
export interface RunOptions { apiKey: string; fetchImpl: typeof fetch; waitSeconds: number; sleep?: (ms: number) => Promise<void>; now?: () => Date }

const CONSUMED_VEHICLE_KEYS = [
  'plate', 'registration_status', 'service_type', 'vehicle_class', 'classification', 'body_type', 'brand', 'line', 'model_year',
  'color', 'fuel_type', 'engine_displacement', 'seated_passengers', 'total_passengers', 'load_capacity', 'vin', 'engine_number',
  'chassis_number', 'serial_number', 'traffic_authority', 'engine_restamped', 'chassis_restamped', 'serial_restamped', 'vin_restamped',
];
const INTERESTING_HEADER = /cache|credit|rate|retry|job|location|usage|quota/i;
const digits = (s: string) => s.replace(/\D/g, '');

async function timed<T extends { found: boolean }>(
  op: CallResult['op'], opts: RunOptions, all: Exchange[], fn: (client: CromaClient) => Promise<{ data: T; cacheHit: boolean }>,
): Promise<{ call: CallResult; data: T | null }> {
  const own: Exchange[] = [];
  const recording: typeof fetch = async (input, init) => {
    const start = Date.now();
    const res = await opts.fetchImpl(input, init);
    const exchange: Exchange = {
      method: init?.method ?? 'GET', url: String(input), status: res.status, ms: Date.now() - start,
      headers: Object.fromEntries(res.headers.entries()), body: await res.clone().text(),
    };
    own.push(exchange); all.push(exchange);
    return res;
  };
  const client = new CromaClient({ apiKey: opts.apiKey, fetchImpl: recording, waitSeconds: opts.waitSeconds, ...(opts.sleep ? { sleep: opts.sleep } : {}) });
  const start = Date.now();
  const details = () => ({
    op, ms: Date.now() - start, httpStatuses: own.map((e) => e.status),
    headers: Object.fromEntries(own.flatMap((e) => Object.entries(e.headers)).filter(([k]) => INTERESTING_HEADER.test(k))),
  });
  try {
    const { data, cacheHit } = await fn(client);
    return { call: { ...details(), ok: true, cacheHit, found: data.found }, data };
  } catch (e) {
    const err = e instanceof CromaError ? e : null;
    return {
      // El mensaje de error se omite a propósito: podría repetir la placa o el documento.
      call: { ...details(), ok: false, cacheHit: null, found: null, errorCode: err?.code ?? 'NETWORK_OR_PARSE', ...(err?.status ? { errorStatus: err.status } : {}) },
      data: null,
    };
  }
}

export function observe(c: Pick<SpikeCase, 'documentNumber' | 'documentType'>, byPlate: VehicleByPlate | null, history: VehicleHistory | null): Observation | null {
  if (!byPlate) return null;
  const empty = { rawValues: {}, fields: {}, missing: [], review: [], absentKeys: [], pledges: 0, limitations: 0, structures: { pledge: [], limitation: [], armoring: [] }, owners: null, hasImportRecord: null };
  if (!byPlate.found || !byPlate.vehicle) return { found: false, ...empty };

  const v = byPlate.vehicle as unknown as Record<string, unknown>;
  const block = normalizeVehicle(byPlate);
  const fields = Object.fromEntries(Object.entries(block).map(([k, f]) => [k, { confidence: f.confidence, hasValue: f.value !== null }]));
  const required = REQUIRED_VEHICLE_FIELDS as (keyof FormVehicleBlock)[];
  const raw = (k: string) => (v[k] == null ? null : String(v[k]));
  const owners = history?.found ? history.owners ?? [] : null;
  const active = owners?.filter((o) => !o.ownership_end_date) ?? [];
  const current = active[0] ?? owners?.[0];
  const keysOf = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o).sort() : []);

  return {
    found: true,
    rawValues: {
      vehicle_class: raw('vehicle_class'), classification: raw('classification'), body_type: raw('body_type'), fuel_type: raw('fuel_type'),
      service_type: raw('service_type'), registration_status: raw('registration_status'), engine_displacement: raw('engine_displacement'),
    },
    fields,
    missing: required.filter((k) => !fields[k]?.hasValue),
    review: Object.entries(fields).filter(([, f]) => f.confidence === 'review').map(([k]) => k),
    absentKeys: CONSUMED_VEHICLE_KEYS.filter((k) => !(k in v)),
    pledges: byPlate.pledges?.length ?? 0,
    limitations: byPlate.ownership_limitations?.length ?? 0,
    structures: { pledge: keysOf(byPlate.pledges?.[0]), limitation: keysOf(byPlate.ownership_limitations?.[0]), armoring: keysOf(byPlate.armoring) },
    owners: owners && {
      total: owners.length,
      active: active.length,
      documentTypes: [...new Set(owners.map((o) => o.document_type))],
      documentMatches: !!current && digits(current.document_number) === digits(c.documentNumber),
      nameWords: current?.name?.trim().split(/\s+/).filter(Boolean).length ?? 0,
      nameConfidence: current?.name && c.documentType !== 'NIT' ? splitColombianName(current.name).confidence : null,
    },
    hasImportRecord: history?.found ? !!history.import_record : null,
  };
}

export async function runCase(c: SpikeCase, opts: RunOptions): Promise<CaseRun> {
  const exchanges: Exchange[] = [];
  const calls: CallResult[] = [];
  const plate = normalizePlate(c.plate);
  const doc = { type: c.documentType, number: c.documentNumber };
  const gate = () => timed('byPlate', opts, exchanges, (cl) => cl.vehicleByPlate(plate, doc));
  const hist = () => timed('history', opts, exchanges, (cl) => cl.vehicleHistory(plate));
  const lookup = async () => {
    const g = await gate();
    calls.push(g.call);
    let h: Awaited<ReturnType<typeof hist>> | null = null;
    // Igual que en producción: sin datos en la compuerta no se gasta el historial.
    if (g.data?.found) { h = await hist(); calls.push(h.call); }
    return { byPlate: g.data, history: h?.data ?? null };
  };

  let first: Awaited<ReturnType<typeof lookup>>;
  let repeatIdentical: boolean | undefined;
  if (c.mode === 'concurrent') {
    const [a, b] = await Promise.all([gate(), gate()]);
    calls.push(a.call, b.call);
    first = { byPlate: a.data ?? b.data, history: null };
  } else {
    first = await lookup();
    if (c.mode === 'repeat') {
      const again = await lookup();
      repeatIdentical = JSON.stringify(first) === JSON.stringify(again);
    }
  }
  return {
    result: {
      id: c.id, label: c.label, mode: c.mode, documentType: c.documentType, ranAt: (opts.now?.() ?? new Date()).toISOString(), calls,
      observation: observe(c, first.byPlate, first.history), ...(repeatIdentical === undefined ? {} : { repeatIdentical }),
    },
    exchanges, byPlate: first.byPlate, history: first.history,
  };
}

/** Errores tras los cuales no tiene sentido seguir gastando: credenciales, saldo o límite de tasa. */
export const shouldStop = (r: CaseResult): boolean => r.calls.some((c) => [401, 402, 403, 429].includes(c.errorStatus ?? 0));

// --- Anonimización: lista de permitidos. Todo texto que no esté aquí se reemplaza, incluidas llaves que aún no conocemos.
const SAFE_STRING_KEYS = new Set([
  'registration_status', 'service_type', 'vehicle_class', 'classification', 'body_type', 'brand', 'line', 'model_year', 'color', 'fuel_type',
  'traffic_authority', 'country_name', 'document_type', 'creditor_document_type', 'owner_type', 'limitation_type', 'guarantee_type', 'license_status',
  'level', 'armoring_type', 'normalized_status',
]);
const SENSITIVE_NUMBER_KEY = /number|document|phone|policy|license/i;
const SAFE_NUMBER_KEYS = new Set(['level_number']);

export function anonymize(value: unknown, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => anonymize(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, anonymize(v, k)]));
  if (typeof value === 'string') return SAFE_STRING_KEYS.has(key) ? value : `ANON_${key.toUpperCase() || 'VALOR'}`;
  if (typeof value === 'number' && SENSITIVE_NUMBER_KEY.test(key) && !SAFE_NUMBER_KEYS.has(key)) return 0;
  return value;
}

// --- Criterios de aceptación (sección 12 del alcance, ajustados: código de carrocería y potencia son opcionales).
export type CriterionStatus = 'pasa' | 'no pasa' | 'pendiente' | 'manual';
export interface Criterion { name: string; threshold: string; status: CriterionStatus; detail: string }

const percentile = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] as number;
};
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : 'n/a');

export function evaluate(results: CaseResult[]): Criterion[] {
  const core = results.filter((r) => r.id >= 1 && r.id <= 8);
  const coreMissing = 8 - core.length;
  const complete = core.filter((r) => r.observation?.found && r.observation.missing.length === 0).length;
  const blockRatio = complete / 8;

  const billed = results.filter((r) => r.mode === 'normal' && r.panelCredits !== undefined && r.calls.every((c) => c.ok && !c.cacheHit));
  const maxCredits = billed.length ? Math.max(...billed.map((r) => r.panelCredits as number)) : null;

  // El umbral del alcance es por consulta. El total muestra lo que espera el usuario si se hacen dos en serie.
  const fresh = results.filter((r) => r.mode !== 'concurrent').map((r) => r.calls.filter((c) => c.ok && !c.cacheHit && c.ms > 0).map((c) => c.ms));
  const perCall = fresh.flat();
  const totals = fresh.filter((ms) => ms.length).map((ms) => ms.reduce((s, x) => s + x, 0));
  const p95 = perCall.length ? percentile(perCall, 95) : null;
  const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

  const observed = results.filter((r) => r.observation?.found);
  const mapped = observed.flatMap((r) => ['vehicleClass', 'fuel', 'serviceType'].map((k) => !!r.observation?.fields[k]?.hasValue));
  const mapRatio = mapped.length ? mapped.filter(Boolean).length / mapped.length : null;

  return [
    {
      name: 'Casos 1 a 8 con el bloque de vehículo completo', threshold: '≥ 90%',
      status: blockRatio >= 0.9 ? 'pasa' : coreMissing > 0 ? 'pendiente' : 'no pasa',
      detail: `${complete} de 8 completos${coreMissing ? `; faltan ${coreMissing} por correr` : ''}`,
    },
    {
      name: 'Costo por consulta conocido', threshold: '≤ 20 créditos',
      status: maxCredits === null ? 'pendiente' : maxCredits <= 20 ? 'pasa' : 'no pasa',
      detail: maxCredits === null ? 'Sin lecturas del panel (usa --ask-credits)' : `Máximo ${maxCredits} créditos en ${billed.length} casos sin caché`,
    },
    {
      name: 'Latencia p95 por consulta a Croma', threshold: '≤ 30 s',
      status: p95 === null ? 'pendiente' : p95 <= 30_000 ? 'pasa' : 'no pasa',
      detail: p95 === null ? 'Sin mediciones' : `${seconds(p95)} con ${perCall.length} muestras${perCall.length < 20 ? ' (orientativo: menos de 20 muestras)' : ''}. Espera total por vehículo: hasta ${seconds(Math.max(...totals))}`,
    },
    {
      name: 'Mapeo de clase, combustible y servicio', threshold: '≥ 90%',
      status: mapRatio === null ? 'pendiente' : mapRatio >= 0.9 ? 'pasa' : 'no pasa',
      detail: mapRatio === null ? 'Sin datos' : `${pct(mapped.filter(Boolean).length, mapped.length)} de ${mapped.length} valores`,
    },
    { name: 'Términos de Croma permiten uso comercial y reventa', threshold: 'Confirmado por escrito', status: 'manual', detail: 'No se puede comprobar con el script' },
  ];
}

const cell = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v).replace(/\|/g, '\\|'));

export function renderReport(results: CaseResult[], cases: Pick<SpikeCase, 'id' | 'label'>[], generatedAt: string): string {
  const sorted = [...results].sort((a, b) => a.id - b.id);
  const ran = new Set(sorted.map((r) => r.id));
  const lines: string[] = [`# Informe del spike con Croma`, ``, `Generado: ${generatedAt}. Sin datos personales.`, ``, `## Criterios de aceptación`, ``, `| Criterio | Umbral | Estado | Detalle |`, `|---|---|---|---|`];
  for (const c of evaluate(sorted)) lines.push(`| ${c.name} | ${c.threshold} | **${c.status}** | ${c.detail} |`);

  lines.push(``, `## Casos`, ``, `| # | Caso | Encontrado | HTTP | Caché | ms | Créditos | Faltan | En revisión | Errores |`, `|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of sorted) {
    const o = r.observation;
    const errors = r.calls.filter((c) => !c.ok).map((c) => `${c.op}: ${c.errorCode}`).join(', ');
    lines.push(`| ${r.id} | ${cell(r.label)} | ${o ? (o.found ? 'sí' : 'no') : '—'} | ${r.calls.map((c) => c.httpStatuses.join('→')).join(', ')} | ${r.calls.map((c) => (c.cacheHit === null ? '?' : c.cacheHit ? 'HIT' : 'no')).join(', ')} | ${r.calls.map((c) => c.ms).join(', ')} | ${cell(r.panelCredits)} | ${cell(o?.missing.join(', '))} | ${cell(o?.review.join(', '))} | ${cell(errors)} |`);
  }
  const pending = cases.filter((c) => !ran.has(c.id));
  if (pending.length) lines.push(``, `Sin correr: ${pending.map((c) => `${c.id} (${c.label})`).join('; ')}.`);

  lines.push(``, `## Valores crudos observados`, ``, `Base para las tablas de mapeo. El tipo de carrocería se imprime tal cual llega.`, ``);
  for (const key of ['vehicle_class', 'classification', 'body_type', 'fuel_type', 'service_type', 'registration_status']) {
    const values = [...new Set(sorted.map((r) => r.observation?.rawValues[key]).filter((v) => v != null))].sort();
    lines.push(`- **${key}:** ${values.length ? values.join(', ') : '—'}`);
  }

  lines.push(``, `## Contrato con Croma`, ``);
  const headers = [...new Set(sorted.flatMap((r) => r.calls.flatMap((c) => Object.keys(c.headers))))].sort();
  lines.push(`- **Cabeceras de caché, créditos, tasa o trabajos:** ${headers.length ? headers.join(', ') : 'ninguna observada'}`);
  const statuses = [...new Set(sorted.flatMap((r) => r.calls.flatMap((c) => c.httpStatuses)))].sort();
  lines.push(`- **Códigos HTTP:** ${statuses.join(', ') || '—'}`);
  lines.push(`- **¿Se usó espera asíncrona (202)?** ${statuses.includes(202) ? 'sí' : 'no observada'}`);
  const absent = [...new Set(sorted.flatMap((r) => r.observation?.absentKeys ?? []))];
  lines.push(`- **Llaves esperadas que no llegaron:** ${absent.length ? absent.join(', ') : 'ninguna'}`);
  for (const [name, pick] of [['prenda', (o: Observation) => o.structures.pledge], ['limitación', (o: Observation) => o.structures.limitation], ['blindaje', (o: Observation) => o.structures.armoring]] as const) {
    const keys = [...new Set(sorted.flatMap((r) => (r.observation ? pick(r.observation) : [])))].sort();
    lines.push(`- **Estructura de ${name}:** ${keys.length ? keys.join(', ') : 'no observada'}`);
  }
  for (const r of sorted.filter((x) => x.repeatIdentical !== undefined)) lines.push(`- **Caso ${r.id}, repetición idéntica:** ${r.repeatIdentical ? 'sí' : 'no'}`);

  lines.push(``, `## Propietarios`, ``, `| # | Total | Activos | Documento coincide | Tipos de documento | Palabras del nombre | Confianza del nombre |`, `|---|---|---|---|---|---|---|`);
  for (const r of sorted) {
    const w = r.observation?.owners;
    if (w) lines.push(`| ${r.id} | ${w.total} | ${w.active} | ${w.documentMatches ? 'sí' : 'no'} | ${w.documentTypes.join(', ')} | ${w.nameWords} | ${cell(w.nameConfidence)} |`);
  }

  lines.push(``, `## Por comprobar a mano`, ``,
    `- [ ] Comparar 3 a 5 casos contra la tarjeta de propiedad física.`,
    `- [ ] Medir si un fallo (cédula incorrecta, placa inexistente, timeout) gasta créditos en el panel.`,
    `- [ ] Medir cuánto dura el caché y si devuelve datos viejos tras un cambio en el RUNT.`,
    `- [ ] Confirmar en la documentación de Croma si existe \`callback_url\`, su firma y los límites de tasa.`,
    `- [ ] Repetir algunos casos en horario de oficina.`,
    `- [ ] Borrar \`spike-data/raw\` al terminar y revisar los fixtures antes de moverlos a \`tests/fixtures\`.`,
    ``);
  return lines.join('\n');
}
