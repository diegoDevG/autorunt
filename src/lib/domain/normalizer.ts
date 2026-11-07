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
// Croma devuelve estos textos como relleno cuando el RUNT no tiene el dato: no son valores reales.
const PLACEHOLDERS = new Set(['', 'NA', 'N/A', 'INDEFINIDO', 'SIN DATO', 'NO APLICA']);
export const isPlaceholder = (s: string | null | undefined): boolean => PLACEHOLDERS.has(norm(s));
const text = (s: string | null | undefined): Field<string> =>
  isPlaceholder(s) ? missing() : ok(s!.trim());

export function normalizeVehicle(src: VehicleByPlate): FormVehicleBlock {
  const v = src.vehicle;
  if (!v) throw new Error('normalizeVehicle: la respuesta no trae vehículo');

  const isElectric = norm(v.fuel_type) === 'ELECTRICO';

  // Clase: prevalece vehicle_class; si discrepa de classification se pide revisión.
  const cls = norm(v.vehicle_class);
  let vehicleClass: Field<string>;
  if (!FORM_CLASSES.has(cls)) {
    vehicleClass = review<string>(null, `Clase sin casilla conocida: ${v.vehicle_class ?? 'vacía'}`);
  } else {
    // Se usa el valor del RUNT tal cual (vehicle_class). classification es otra clasificación y no se compara.
    vehicleClass = ok(cls);
  }

  const fuelCode = FUEL_CODES[norm(v.fuel_type)];
  const fuel: Field<number> = fuelCode
    ? ok(fuelCode)
    : review<number>(null, `Combustible sin casilla: ${v.fuel_type ?? 'vacío'} (¿híbrido?)`);

  // En un eléctrico se imprime 0 (confirmado por las oficinas).
  const displacement: Field<number> = v.engine_displacement == null ? missing() : ok(v.engine_displacement);

  let capacity: Field<{ kind: 'passengers' | 'kg'; value: number }>;
  if (v.total_passengers != null) capacity = ok({ kind: 'passengers', value: v.total_passengers });
  // Un sedán real llegó con load_capacity = 0: cero no es capacidad de carga.
  else if (v.load_capacity != null && v.load_capacity > 0) capacity = ok({ kind: 'kg', value: v.load_capacity });
  else if (v.seated_passengers != null) {
    capacity = ok({ kind: 'passengers', value: v.seated_passengers });
  } else capacity = missing();

  // Según la documentación, armoring es null cuando el vehículo no está blindado.
  const armoring: FormVehicleBlock['armoring'] = src.armoring?.is_armored
    ? ok({
        armored: true,
        resolution: src.armoring.resolution_number,
        dearmoredDate: src.armoring.dearmored_date,
      })
    : ok({ armored: false, resolution: null, dearmoredDate: null });

  // Croma trae el tipo. El código es opcional: las oficinas aceptan la casilla en blanco.
  const bodyType: Field<{ type: string; code: string | null }> = v.body_type
    ? ok({ type: v.body_type.trim(), code: null })
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
    // No viene del RUNT y es opcional: las oficinas aceptan la casilla en blanco.
    power: { value: null, confidence: 'ok', note: 'Opcional: no viene del RUNT' },
    bodyType,
    engineNumber: isPlaceholder(v.engine_number) ? missing(noEngine) : ok(v.engine_number!.trim()),
    chassisNumber: text(v.chassis_number),
    serialNumber: isPlaceholder(v.serial_number) ? missing('Serie sin dato en el RUNT') : ok(v.serial_number!.trim()),
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
