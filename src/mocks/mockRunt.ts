import type { RuntPort } from '../lib/croma/client';
import type { VehicleByPlate, VehicleHistory } from '../lib/croma/types';
import { normalizeDocument, type DocumentType } from '../lib/domain/validators';
import { SCENARIOS, type Scenario } from './scenarios';

const notFoundByPlate = (plate: string): VehicleByPlate => ({ found: false, plate, vehicle: null, pledges: [], ownership_limitations: [], armoring: null });
const notFoundHistory = (plate: string): VehicleHistory => ({ found: false, plate, owners: [], import_record: null, guarantee: null });

/** Simula a Croma con datos locales: mismo contrato, caché en la segunda llamada idéntica y conteo de llamadas. */
export class MockRuntPort implements RuntPort {
  calls: string[] = [];
  private seen = new Set<string>();
  constructor(private scenarios: Scenario[] = SCENARIOS) {}

  private hit(key: string) {
    const cached = this.seen.has(key);
    this.seen.add(key);
    this.calls.push(key);
    return cached;
  }

  async vehicleByPlate(plate: string, doc: { type: DocumentType; number: string }) {
    const cacheHit = this.hit(`by:${plate}:${doc.type}:${doc.number}`);
    const s = this.scenarios.find((x) => x.plate === plate);
    const n = normalizeDocument(doc.type, doc.number);
    const match = !!s && s.ownerDocType === doc.type && n.ok && normalizeDocument(s.ownerDocType, s.ownerDoc).ok &&
      (normalizeDocument(s.ownerDocType, s.ownerDoc) as { number: string }).number === n.number;
    return { data: match && s ? s.byPlate : notFoundByPlate(plate), cacheHit };
  }

  async vehicleHistory(plate: string) {
    const cacheHit = this.hit(`hist:${plate}`);
    const s = this.scenarios.find((x) => x.plate === plate);
    return { data: s ? s.history : notFoundHistory(plate), cacheHit };
  }
}
