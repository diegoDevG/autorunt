import type { VehicleByPlate } from '../croma/types';
import { norm } from './normalizer';

export type Severity = 'block' | 'warn' | 'info';
export interface Warning {
  code: string;
  severity: Severity;
  message: string;
}

const AUTHORITY_AGNOSTIC = new Set([3, 4]); // traslado y radicado cambian de organismo

export function checkPreconditions(
  tramiteId: number,
  src: VehicleByPlate,
  opts: { officeAuthority?: string } = {},
): Warning[] {
  const w: Warning[] = [];
  const v = src.vehicle;
  if (!v) return [{ code: 'NO_VEHICLE', severity: 'block', message: 'Sin datos del vehículo' }];

  if (norm(v.registration_status) !== 'ACTIVO') {
    w.push({ code: 'NOT_ACTIVE', severity: 'block', message: `Matrícula no activa: ${v.registration_status}` });
  }
  // Se decide por los arreglos, no por has_liens / has_pledges.
  const pledges = src.pledges?.length ?? 0;
  const limitations = src.ownership_limitations?.length ?? 0;

  if (tramiteId === 12 && pledges === 0) {
    w.push({ code: 'NO_PLEDGE', severity: 'block', message: 'No hay prenda inscrita: no hay nada que levantar' });
  }
  if (tramiteId === 11 && pledges > 0) {
    w.push({ code: 'PLEDGE_EXISTS', severity: 'warn', message: 'El vehículo ya tiene una prenda inscrita' });
  }
  if (tramiteId === 2 && pledges > 0) {
    w.push({ code: 'PLEDGE_ACTIVE', severity: 'warn', message: 'Hay prenda inscrita: validar levantamiento o autorización del acreedor' });
  }
  if (tramiteId === 2 && limitations > 0) {
    w.push({ code: 'LIMITATION_ACTIVE', severity: 'warn', message: 'Hay limitaciones a la propiedad inscritas' });
  }
  if (
    opts.officeAuthority &&
    !AUTHORITY_AGNOSTIC.has(tramiteId) &&
    v.traffic_authority &&
    norm(opts.officeAuthority) !== norm(v.traffic_authority)
  ) {
    w.push({
      code: 'AUTHORITY_DIFFERS',
      severity: 'warn',
      message: `Vehículo matriculado en ${v.traffic_authority}; confirmar que el trámite se puede radicar en su oficina`,
    });
  }
  return w;
}
