import { FORM_DOC_LETTER, type DocumentType } from '../domain/validators';
import { norm, type Alerts, type Field, type FormVehicleBlock } from '../domain/normalizer';
import { getTramite } from '../domain/tramites';
import type { StampValues } from './overlay';

export interface PersonInput {
  documentType: DocumentType;
  documentNumber: string;
  surname1: string;
  surname2?: string;
  names: string; // para personas jurídicas: razón social (por validar con las oficinas)
  address?: string;
  city?: string;
  phone?: string;
}

export interface ManualVehicle {
  plate: string;
  vehicleClass: string;
  brand: string;
  line: string;
  modelYear: string;
  color: string;
  fuel: number;
  displacement: number;
  capacity: { kind: 'passengers' | 'kg'; value: number };
  power?: number;
  bodyType: { type: string; code?: string };
  engineNumber?: string;
  chassisNumber: string;
  serialNumber?: string;
  vin: string;
  serviceType: number;
}

export interface Overrides {
  color?: string;
  serviceType?: number;
  bodyType?: { type: string; code?: string };
  engineNumber?: string;
  chassisNumber?: string;
  restamped?: Partial<{ engine: boolean; chassis: boolean; serial: boolean; vin: boolean }>;
}

export interface ManualInput {
  owner: PersonInput;
  buyer?: PersonInput;
  power?: number;
  company?: { name: string; nit?: string };
  observations?: string;
  observationsPreRunt?: string;
  overrides?: Overrides;
  import?: { kind: 1 | 2 | 3 | 4 | 5 | 6; number: string; date: string };
}

export interface Issue {
  field: string;
  level: 'missing' | 'review' | 'info';
  note: string;
}

const ok = <T>(value: T): Field<T> => ({ value, confidence: 'ok' });
const none = <T>(): Field<T> => ({ value: null, confidence: 'missing' });

export function blockFromManual(m: ManualVehicle): FormVehicleBlock {
  return {
    plate: ok(m.plate), vehicleClass: ok(norm(m.vehicleClass)), brand: ok(m.brand), line: ok(m.line),
    modelYear: ok(m.modelYear), color: ok(m.color), fuel: ok(m.fuel), displacement: ok(m.displacement),
    capacity: ok(m.capacity), armoring: ok({ armored: false, resolution: null, dearmoredDate: null }),
    power: m.power != null ? ok(m.power) : none(), bodyType: ok({ type: m.bodyType.type, code: m.bodyType.code ?? null }),
    engineNumber: m.engineNumber ? ok(m.engineNumber) : none(), chassisNumber: ok(m.chassisNumber),
    serialNumber: m.serialNumber ? ok(m.serialNumber) : none(), vin: ok(m.vin),
    restamped: ok({ engine: false, chassis: false, serial: false, vin: false }), serviceType: ok(m.serviceType),
  };
}

export function applyOverrides(b: FormVehicleBlock, o: Overrides = {}, power?: number): FormVehicleBlock {
  const out = { ...b };
  if (o.color) out.color = ok(o.color);
  if (o.serviceType) out.serviceType = ok(o.serviceType);
  if (o.bodyType) out.bodyType = ok({ type: o.bodyType.type, code: o.bodyType.code ?? null });
  if (o.engineNumber) out.engineNumber = ok(o.engineNumber);
  if (o.chassisNumber) out.chassisNumber = ok(o.chassisNumber);
  if (o.restamped) out.restamped = ok({ ...(b.restamped.value ?? { engine: false, chassis: false, serial: false, vin: false }), ...o.restamped });
  if (power != null) out.power = ok(power);
  return out;
}

/** Parte el texto en líneas de máximo `max` caracteres respetando palabras. */
export function wrapLines(text: string, max: number, lines: number): { lines: string[]; overflow: boolean } {
  const out: string[] = [];
  let cur = '';
  for (const w of text.trim().split(/\s+/).filter(Boolean)) {
    if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) out.push(cur);
  return { lines: out.slice(0, lines), overflow: out.length > lines };
}

const REQUIRED: (keyof FormVehicleBlock)[] = [
  'plate', 'vehicleClass', 'brand', 'line', 'modelYear', 'color', 'fuel', 'displacement',
  'capacity', 'bodyType', 'chassisNumber', 'vin', 'serviceType', 'power',
];

export interface BuildArgs {
  tramiteId: number;
  vehicle: FormVehicleBlock;
  alerts?: Alerts;
  manual: ManualInput;
}

export function buildStampValues({ tramiteId, vehicle: v0, alerts, manual }: BuildArgs): { values: StampValues; issues: Issue[] } {
  const tramite = getTramite(tramiteId);
  const has = (s: (typeof tramite.sections)[number]) => tramite.sections.includes(s);
  const v = applyOverrides(v0, manual.overrides, manual.power);
  const text: StampValues['text'] = {};
  const checks: string[] = [];
  const issues: Issue[] = [];

  checks.push(`tramite_${tramite.id}`);

  // Calidad de los datos del vehículo
  for (const k of REQUIRED) {
    const f = v[k] as Field<unknown>;
    if (f.confidence === 'missing') issues.push({ field: k, level: 'missing', note: f.note ?? 'Falta el dato' });
    else if (f.confidence === 'review') issues.push({ field: k, level: 'review', note: f.note ?? 'Revisar' });
  }
  for (const k of ['engineNumber', 'serialNumber'] as const) {
    if (v[k].confidence === 'missing') issues.push({ field: k, level: 'info', note: v[k].note ?? 'Sin dato: verificar con la tarjeta de propiedad' });
  }

  // 2. Placa
  const plate = v.plate.value ?? '';
  text.plate_letters = plate.slice(0, 3);
  text.plate_numbers = plate.slice(3);

  // 4. Clase
  if (v.vehicleClass.value) checks.push(`class_${v.vehicleClass.value.toLowerCase()}`);

  text.brand = v.brand.value;
  text.line = v.line.value;
  text.color = v.color.value;
  text.model_year = v.modelYear.value;
  text.displacement = v.displacement.value;
  if (v.fuel.value) checks.push(`fuel_${v.fuel.value}`);

  const cap = v.capacity.value;
  if (cap) text.capacity = cap.kind === 'passengers' ? `${cap.value} PSJ` : `${cap.value} KG`;

  const arm = v.armoring.value;
  checks.push(arm?.armored ? 'armored_yes' : 'armored_no');
  if (arm?.armored) text.armor_resolution = arm.resolution;

  text.power = v.power.value;
  text.body_code = v.bodyType.value?.code;
  text.body_type = v.bodyType.value?.type;
  text.engine_number = v.engineNumber.value;
  text.chassis_number = v.chassisNumber.value;
  text.serial_number = v.serialNumber.value;
  text.vin = v.vin.value;

  const r = v.restamped.value;
  if (r) {
    checks.push(r.engine ? 'restamped_engine_yes' : 'restamped_engine_no');
    checks.push(r.chassis ? 'restamped_chassis_yes' : 'restamped_chassis_no');
    checks.push(r.serial ? 'restamped_serial_yes' : 'restamped_serial_no');
  }
  if (v.serviceType.value) checks.push(`service_${v.serviceType.value}`);

  // 19. Empresa vinculadora
  if (has('company') && manual.company) {
    text.company_name = manual.company.name;
    text.company_nit = manual.company.nit;
  }
  if (has('company') && v.serviceType.value === 2 && !manual.company) {
    issues.push({ field: 'company', level: 'missing', note: 'Servicio público: falta la empresa vinculadora' });
  }

  // 21 y 22. Personas
  const person = (prefix: 'owner' | 'buyer', p: PersonInput) => {
    text[`${prefix}_surname1`] = p.surname1;
    text[`${prefix}_surname2`] = p.surname2;
    text[`${prefix}_names`] = p.names;
    text[`${prefix}_doc_number`] = p.documentNumber;
    text[`${prefix}_address`] = p.address;
    text[`${prefix}_city`] = p.city;
    text[`${prefix}_phone`] = p.phone;
    const letter = FORM_DOC_LETTER[p.documentType];
    if (letter) checks.push(`${prefix}_doctype_${letter}`);
    else issues.push({ field: `${prefix}.documentType`, level: 'review', note: `${p.documentType} no tiene casilla en el formulario` });
    for (const [k, val] of [['names', p.names], ['documentNumber', p.documentNumber], ['address', p.address], ['city', p.city], ['phone', p.phone]] as const) {
      if (!val) issues.push({ field: `${prefix}.${k}`, level: 'missing', note: 'Dato manual pendiente' });
    }
  };
  person('owner', manual.owner);
  if (has('buyer')) {
    if (manual.buyer) person('buyer', manual.buyer);
    else issues.push({ field: 'buyer', level: 'missing', note: 'Traspaso: faltan los datos del comprador' });
  }

  // 17. Importación
  if (has('import') && manual.import) {
    checks.push(`import_${manual.import.kind}`);
    text.import_number = manual.import.number;
    const [y, m, d] = manual.import.date.split('-');
    text.import_day = d; text.import_month = m; text.import_year = y;
  }

  // 20. Alertas y observaciones automáticas (mapeo de la prenda por validar con las oficinas)
  const obs: string[] = [];
  if (manual.observations) obs.push(manual.observations);
  if (has('alerts') && alerts) {
    if (alerts.pledges.length) {
      checks.push('alert_other');
      obs.push(...alerts.pledges.map((p) => `PRENDA A FAVOR DE ${p.creditor} NIT ${p.creditor_document_number}`));
      issues.push({ field: 'alerts', level: 'review', note: 'Prenda en alertas (casilla OTRO + observaciones): validar con la oficina' });
    }
    if (alerts.limitations.length) {
      const seizure = alerts.limitations.some((l) => norm(l.limitation_type).includes('EMBARGO'));
      checks.push(seizure ? 'alert_seizure' : 'alert_limitation');
      obs.push(...alerts.limitations.map((l) => `LIMITACION A LA PROPIEDAD ${l.limitation_type ?? ''} ${l.legal_entity ?? ''}`.trim()));
    }
  }
  if (obs.length) {
    const w = wrapLines(obs.join(' / '), 100, 2);
    text.obs_1 = w.lines[0];
    text.obs_2 = w.lines[1];
    if (w.overflow) issues.push({ field: 'observations', level: 'missing', note: 'Observaciones no caben en 2 líneas' });
  }
  if (manual.observationsPreRunt) {
    const w = wrapLines(manual.observationsPreRunt, 130, 2);
    text.obs_prerunt_1 = w.lines[0];
    text.obs_prerunt_2 = w.lines[1];
  }

  return { values: { text, checks }, issues };
}
