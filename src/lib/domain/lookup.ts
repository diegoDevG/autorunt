import type { RuntPort } from '../croma/client';
import type { VehicleHistory } from '../croma/types';
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
      estimatedCredits: number; // créditos de Croma realmente consumidos (caché = 0)
    };

/**
 * Consulta en dos pasos:
 *  1. vehicle-by-plate como compuerta (placa + documento del propietario).
 *  2. Solo si hay datos y no hay bloqueos: vehicle-history-by-plate para el nombre y la importación.
 * Así no se expone el nombre de un propietario a quien solo conoce la placa, y no se gasta
 * la segunda consulta cuando el trámite ya está bloqueado.
 */
export async function runLookup(port: RuntPort, raw: unknown): Promise<LookupOutcome> {
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
    const hist = await port.vehicleHistory(input.plate);
    if (!hist.cacheHit) credits += CREDITS_PER_CROMA_CALL;
    if (hist.data.found) {
      importRecord = hist.data.import_record;
      const current = hist.data.owners.find((o) => !o.ownership_end_date) ?? hist.data.owners[0];
      if (current && current.document_number.replace(/\D/g, '') === doc.number.replace(/\D/g, '')) {
        owner = { name: splitColombianName(current.name), rawName: current.name, documentNumber: doc.number };
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
    warnings,
    estimatedCredits: credits,
  };
}
