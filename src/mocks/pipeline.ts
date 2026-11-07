import { runLookup } from '../lib/domain/lookup';
import { getTramite, requiresCompany } from '../lib/domain/tramites';
import type { Alerts, FormVehicleBlock } from '../lib/domain/normalizer';
import { splitColombianName } from '../lib/domain/name';
import { blockFromManual, buildStampValues, type Issue, type ManualInput, type PersonInput } from '../lib/pdf/formMapper';
import { stampForm, type StampResult, type StampValues } from '../lib/pdf/overlay';
import { DEV_COORDINATES } from '../lib/pdf/devLayout';
import type { Warning } from '../lib/domain/preconditions';
import { MockRuntPort } from './mockRunt';
import { getScenario } from './scenarios';

export const OFFICE_AUTHORITY = 'SECRETARIA DE TRANSITO DE YOPAL';

const BUYER: PersonInput = {
  documentType: 'CC', documentNumber: '1098765432', surname1: 'RAMIREZ', surname2: 'TORRES', names: 'CARLOS ANDRES',
  address: 'CALLE 15 # 30-12 BARRIO LAS PALMAS', city: 'YOPAL', phone: '3205550199',
};

/** Qué cambia cada trámite con campo de intención (lo digita el usuario, no el RUNT). */
const INTENT: Record<number, Partial<ManualInput>> = {
  5: { overrides: { color: 'AZUL METALICO' } },
  6: { overrides: { serviceType: 2 }, company: { name: 'COOTRANSYOPAL LTDA', nit: '900555111' } },
  7: { overrides: { engineNumber: 'NUEVOMOTOR0001', restamped: { engine: true } }, observations: 'REGRABADO DE MOTOR POR ORDEN DE AUTORIDAD' },
  8: { overrides: { chassisNumber: 'NUEVOCHASIS0001', restamped: { chassis: true } }, observations: 'REGRABADO DE CHASIS' },
  9: { observations: 'TRANSFORMACION: INSTALACION DE KIT DE CONVERSION A GAS NATURAL VEHICULAR' },
  17: { overrides: { bodyType: { type: 'PICKUP', code: '12' } } },
  1: { observations: 'VEHICULO NUEVO FACTURA 0001' },
};

export interface SampleResult {
  scenarioId: string;
  tramiteId: number;
  status: 'ok' | 'blocked' | 'not_found' | 'invalid';
  warnings: Warning[];
  issues: Issue[];
  values?: StampValues;
  creditsCroma: number;
  vehicle?: FormVehicleBlock;
  alerts?: Alerts;
}

export async function buildSample(scenarioId: string, tramiteId: number): Promise<SampleResult> {
  const scn = getScenario(scenarioId);
  const tramite = getTramite(tramiteId);
  let vehicle: FormVehicleBlock;
  let alerts: Alerts = { pledges: [], limitations: [] };
  let warnings: Warning[] = [];
  let credits = 0;
  let ownerSplit = splitColombianName(scn.ownerName);

  if (tramite.needsRunt) {
    const out = await runLookup(new MockRuntPort(), {
      plate: scn.plate, documentType: scn.ownerDocType, documentNumber: scn.ownerDoc, tramiteId, officeAuthority: OFFICE_AUTHORITY,
    });
    if (out.status !== 'ok') {
      return { scenarioId, tramiteId, status: out.status, warnings: out.status === 'blocked' ? out.warnings : [], issues: [], creditsCroma: out.status === 'blocked' ? out.estimatedCredits : 0 };
    }
    vehicle = out.vehicle; alerts = out.alerts; warnings = out.warnings; credits = out.estimatedCredits;
    if (out.owner.name) ownerSplit = out.owner.name;
  } else {
    vehicle = blockFromManual(scn.manualVehicle);
  }

  const isCompany = scn.ownerDocType === 'NIT';
  const owner: PersonInput = {
    documentType: scn.ownerDocType, documentNumber: scn.ownerDoc,
    surname1: isCompany ? '' : ownerSplit.surname1, surname2: isCompany ? '' : ownerSplit.surname2,
    names: isCompany ? scn.ownerName : ownerSplit.names, ...scn.ownerContact,
  };
  const manual: ManualInput = {
    owner, power: scn.power,
    ...(tramite.sections.includes('buyer') ? { buyer: BUYER } : {}),
    ...(tramite.sections.includes('import') ? { import: { kind: 2 as const, number: scn.history.import_record?.import_record_number ?? '11870099', date: scn.history.import_record?.import_record_date ?? '2024-01-10' } } : {}),
    ...(requiresCompany(vehicle.serviceType.value) ? { company: { name: 'COOTRANSYOPAL LTDA', nit: '900555111' } } : {}),
    ...INTENT[tramiteId],
  };
  const { values, issues } = buildStampValues({ tramiteId, vehicle, alerts, manual });
  return { scenarioId, tramiteId, status: 'ok', warnings, issues, values, creditsCroma: credits, vehicle, alerts };
}

export async function stampSample(template: Uint8Array, r: SampleResult): Promise<StampResult> {
  if (!r.values) throw new Error('Muestra sin valores');
  return stampForm(template, DEV_COORDINATES, r.values);
}
