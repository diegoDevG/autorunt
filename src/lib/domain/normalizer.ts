import type { VehicleByPlate, Pledge, OwnershipLimitation } from '../croma/types';

export type Confidence = 'ok' | 'review' | 'missing';
export interface Field<T> {
  value: T | null;
  confidence: Confidence;
  note?: string;
}

export interface FormVehicleBlock {
  plate: Field<string>;
  vehicleClass: Field<string>; // casilla del campo 4
  brand: Field<string>;
  line: Field<string>;
  modelYear: Field<string>;
  color: Field<string>;
  fuel: Field<number>; // casilla 1-8 del campo 7
  displacement: Field<number>;
  capacity: Field<{ kind: 'passengers' | 'kg'; value: number }>;
  armoring: Field<{ armored: boolean; resolution: string | null; dearmoredDate: string | null }>;
  power: Field<number>;
  bodyType: Field<{ type: string; code: string | null }>;
  engineNumber: Field<string>;
  chassisNumber: Field<string>;
  serialNumber: Field<string>;
  vin: Field<string>;
  restamped: Field<{ engine: boolean; chassis: boolean; serial: boolean; vin: boolean }>;
  serviceType: Field<number>; // casilla 1-6 del campo 18
}

export interface Alerts {
  pledges: Pledge[];
  limitations: OwnershipLimitation[];
}

const FUEL_CODES: Record<string, number> = {
  GASOLINA: 1, DIESEL: 2, GAS: 3, MIXTO: 4, ELECTRICO: 5, HIDROGENO: 6, ETANOL: 7, BIODIESEL: 8,
};
const SERVICE_CODES: Record<string, number> = {
  PARTICULAR: 1, PUBLICO: 2, DIPLOMATICO: 3, OFICIAL: 4, ESPECIAL: 5,
};
const FORM_CLASSES = new Set([
  'AUTOMOVIL', 'BUS', 'BUSETA', 'CAMION', 'CAMIONETA', 'CAMPERO', 'MICROBUS', 'TRACTOCAMION',
  'MOTOCICLETA', 'MOTOCARRO', 'MOTOTRICICLO', 'CUATRIMOTO', 'VOLQUETA',
]);

export const norm = (s: string | null | undefined): string =>
  (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();

const ok = <T>(value: T): Field<T> => ({ value, confidence: 'ok' });
const review = <T>(value: T | null, note: string): Field<T> => ({ value, confidence: 'review', note });
const missing = <T>(note?: string): Field<T> => ({ value: null, confidence: 'missing', note });
const text = (s: string | null | undefined): Field<string> =>
  s && s.trim() ? ok(s.trim()) : missing();

export function normalizeVehicle(src: VehicleByPlate): FormVehicleBlock {
  const v = src.vehicle;
  if (!v) throw new Error('normalizeVehicle: la respuesta no trae vehículo');

  const isElectric = norm(v.fuel_type) === 'ELECTRICO';

  // Clase: prevalece vehicle_class; si discrepa de classification se pide revisión.
  const cls = norm(v.vehicle_class);
  let vehicleClass: Field<string>;
  if (!FORM_CLASSES.has(cls)) {
    vehicleClass = review<string>(null, `Clase sin casilla conocida: ${v.vehicle_class ?? 'vacía'}`);
  } else if (v.classification && norm(v.classification) !== cls) {
    vehicleClass = review(cls, `vehicle_class=${cls} difiere de classification=${norm(v.classification)}`);
  } else {
    vehicleClass = ok(cls);
  }

  const fuelCode = FUEL_CODES[norm(v.fuel_type)];
  const fuel: Field<number> = fuelCode
    ? ok(fuelCode)
    : review<number>(null, `Combustible sin casilla: ${v.fuel_type ?? 'vacío'} (¿híbrido?)`);

  const displacement: Field<number> =
    v.engine_displacement == null
      ? missing()
      : v.engine_displacement === 0 && isElectric
        ? review(0, 'Eléctrico: cilindrada 0, definir qué se imprime')
        : ok(v.engine_displacement);

  let capacity: Field<{ kind: 'passengers' | 'kg'; value: number }>;
  if (v.total_passengers != null) capacity = ok({ kind: 'passengers', value: v.total_passengers });
  else if (v.load_capacity != null) capacity = ok({ kind: 'kg', value: v.load_capacity });
  else if (v.seated_passengers != null) {
    capacity = review({ kind: 'passengers', value: v.seated_passengers }, 'Derivada de seated_passengers');
  } else capacity = missing();

  // Según la documentación, armoring es null cuando el vehículo no está blindado.
  const armoring: FormVehicleBlock['armoring'] = src.armoring?.is_armored
    ? ok({
        armored: true,
        resolution: src.armoring.resolution_number,
        dearmoredDate: src.armoring.dearmored_date,
      })
    : ok({ armored: false, resolution: null, dearmoredDate: null });

  const bodyType: Field<{ type: string; code: string | null }> = v.body_type
    ? review({ type: v.body_type.trim(), code: null }, 'Falta el código de carrocería (tabla de mapeo)')
    : missing();

  const noEngine = isElectric ? 'Eléctrico: sin número de motor en el RUNT' : undefined;

  return {
    plate: text(v.plate),
    vehicleClass,
    brand: text(v.brand),
    line: text(v.line),
    modelYear: text(v.model_year),
    color: text(v.color),
    fuel,
    displacement,
    capacity,
    armoring,
    power: missing('Potencia no viene del RUNT'),
    bodyType,
    engineNumber: v.engine_number ? ok(v.engine_number) : missing(noEngine),
    chassisNumber: text(v.chassis_number),
    serialNumber: v.serial_number ? ok(v.serial_number) : missing('Serie sin dato en el RUNT'),
    vin: text(v.vin),
    restamped: ok({
      engine: v.engine_restamped,
      chassis: v.chassis_restamped,
      serial: v.serial_restamped,
      vin: v.vin_restamped,
    }),
    serviceType: SERVICE_CODES[norm(v.service_type)]
      ? ok(SERVICE_CODES[norm(v.service_type)] as number)
      : review<number>(null, `Servicio sin casilla: ${v.service_type ?? 'vacío'}`),
  };
}

/** Las alertas se deciden por los arreglos, no por las banderas has_liens/has_pledges (se contradicen). */
export function extractAlerts(src: VehicleByPlate): Alerts {
  return { pledges: src.pledges ?? [], limitations: src.ownership_limitations ?? [] };
}
