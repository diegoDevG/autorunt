import type { RuntPort } from '../croma/client';
import type { VehicleByPlate, VehicleHistory } from '../croma/types';
import { lookupInputSchema, normalizeDocument } from './validators';
import { normalizeVehicle, extractAlerts, type Alerts, type FormVehicleBlock } from './normalizer';
import { checkPreconditions, type Warning } from './preconditions';
import { applyIntent, getTramite } from './tramites';
import { splitColombianName, type SplitName } from './name';

export const CREDITS_PER_CROMA_CALL = 10;

export interface OwnerInfo {
  name: SplitName | null;
  rawName: string | null;
  documentNumber: string;
}

export interface SoatStatus {
  status: 'vigente' | 'vencido' | 'sin_registro';
  insurer: string | null;
  expiresAt: string | null; // AAAA-MM-DD
}

/** Estado del SOAT según la póliza vigente que trae Croma (o la de vencimiento más lejano). */
export function soatStatus(policies: VehicleByPlate['soat_policies'], today = new Date().toISOString().slice(0, 10)): SoatStatus {
  const list = policies ?? [];
  if (list.length === 0) return { status: 'sin_registro', insurer: null, expiresAt: null };
  const current = list.find((p) => p.is_current) ?? [...list].sort((a, b) => b.expiry_date.localeCompare(a.expiry_date))[0]!;
  const vigente = current.is_current && current.expiry_date >= today;
  return { status: vigente ? 'vigente' : 'vencido', insurer: current.insurer, expiresAt: current.expiry_date };
}

export type LookupOutcome =
  | { status: 'invalid'; issues: { path: string; message: string }[] }
  | { status: 'not_found' }
  | { status: 'blocked'; warnings: Warning[]; estimatedCredits: number }
  | {
      status: 'ok';
      vehicle: FormVehicleBlock;
      alerts: Alerts;
      owner: OwnerInfo;
      importRecord: VehicleHistory['import_record'];
      warnings: Warning[];
      soat: SoatStatus;
      registrationAuthority: string | null;
      estimatedCredits: number; // créditos de Croma realmente consumidos (caché = 0)
    };

/** Si la oficina no coincide, ya hay un aviso de advertencia; si coincide o no se indicó, se informa la secretaría. */
function withAuthorityInfo(warnings: Warning[], src: VehicleByPlate): Warning[] {
  const auth = src.vehicle?.traffic_authority;
  if (!auth || warnings.some((w) => w.code === 'AUTHORITY_DIFFERS')) return warnings;
  return [...warnings, {
    code: 'REGISTRATION_AUTHORITY',
    severity: 'info',
    message: `Vehículo matriculado en ${auth}; confirmar que el trámite se puede radicar en su oficina`,
  }];
}

/**
 * Consulta en dos pasos:
 *  1. vehicle-by-plate como compuerta (placa + documento del propietario).
 *  2. Solo si hay datos y no hay bloqueos: vehicle-history-by-plate para el nombre y la importación.
 * Así no se expone el nombre de un propietario a quien solo conoce la placa, y no se gasta
 * la segunda consulta cuando el trámite ya está bloqueado.
 */
/** Etapa actual de la consulta, para que la interfaz muestre qué está pasando. */
export type LookupStage = 'validating' | 'gate' | 'history';

export async function runLookup(
  port: RuntPort,
  raw: unknown,
  onStage?: (stage: LookupStage) => void,
): Promise<LookupOutcome> {
  onStage?.('validating');
  const parsed = lookupInputSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      status: 'invalid',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const input = parsed.data;
  const doc = normalizeDocument(input.documentType, input.documentNumber);
  if (!doc.ok) return { status: 'invalid', issues: [{ path: 'documentNumber', message: doc.error }] };

  const tramite = getTramite(input.tramiteId);
  onStage?.('gate');
  const gate = await port.vehicleByPlate(input.plate, { type: input.documentType, number: doc.number });
  let credits = gate.cacheHit ? 0 : CREDITS_PER_CROMA_CALL;

  if (!gate.data.found || !gate.data.vehicle) return { status: 'not_found' };

  const warnings = checkPreconditions(tramite.id, gate.data, { officeAuthority: input.officeAuthority });
  if (warnings.some((w) => w.severity === 'block')) {
    return { status: 'blocked', warnings, estimatedCredits: credits };
  }

  let owner: OwnerInfo = { name: null, rawName: null, documentNumber: doc.number };
  let importRecord: VehicleHistory['import_record'] = null;
  try {
    onStage?.('history');
    const hist = await port.vehicleHistory(input.plate);
    if (!hist.cacheHit) credits += CREDITS_PER_CROMA_CALL;
    if (hist.data.found) {
      importRecord = hist.data.import_record;
      const current = hist.data.owners.find((o) => !o.ownership_end_date) ?? hist.data.owners[0];
      const sameDoc = (current?.document_number ?? '').replace(/\D/g, '') === doc.number.replace(/\D/g, '');
      if (current && sameDoc && !current.name) {
        // Croma a veces no trae el nombre (por ejemplo, en algunas empresas): se digita a mano.
        warnings.push({
          code: 'OWNER_NAME_MISSING',
          severity: 'info',
          message: 'El nombre del propietario no está disponible: digítalo desde el documento',
        });
      } else if (current && sameDoc) {
        // Una razón social no se separa en apellidos: va completa en Nombres.
        const name: SplitName = input.documentType === 'NIT'
          ? { surname1: '', surname2: '', names: current.name.trim().toUpperCase(), confidence: 'high' }
          : splitColombianName(current.name);
        owner = { name, rawName: current.name, documentNumber: doc.number };
      } else {
        warnings.push({
          code: 'OWNER_MISMATCH',
          severity: 'warn',
          message: 'El propietario del historial no coincide con el documento ingresado; no se usa el nombre',
        });
      }
    }
  } catch {
    warnings.push({
      code: 'HISTORY_UNAVAILABLE',
      severity: 'info',
      message: 'No se pudo obtener el nombre del propietario: digitarlo desde la cédula',
    });
  }

  return {
    status: 'ok',
    vehicle: applyIntent(normalizeVehicle(gate.data), tramite),
    alerts: extractAlerts(gate.data),
    owner,
    importRecord,
    warnings: withAuthorityInfo(warnings, gate.data),
    soat: soatStatus(gate.data.soat_policies),
    registrationAuthority: gate.data.vehicle.traffic_authority ?? null,
    estimatedCredits: credits,
  };
}
