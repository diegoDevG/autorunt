import type { HistoryOwner, Pledge, OwnershipLimitation, VehicleByPlate, VehicleHistory, VehicleRecord, Armoring } from '../lib/croma/types';
import type { DocumentType } from '../lib/domain/validators';
import type { ManualVehicle, PersonInput } from '../lib/pdf/formMapper';

/** Datos 100% ficticios con la misma estructura que devuelve Croma. */
export interface Scenario {
  id: string;
  description: string;
  plate: string;
  ownerDocType: DocumentType;
  ownerDoc: string;
  ownerName: string;
  ownerContact: Pick<PersonInput, 'address' | 'city' | 'phone'>;
  power?: number;
  byPlate: VehicleByPlate;
  history: VehicleHistory;
  /** Datos tecleados a mano para trámites sin RUNT (matrícula inicial, rematrícula, otros). */
  manualVehicle: ManualVehicle;
}

interface Spec {
  id: string; description: string; plate: string;
  ownerDocType?: DocumentType; ownerDoc?: string; ownerName: string; power?: number;
  vehicle?: Partial<VehicleRecord>;
  pledges?: Pledge[]; limitations?: OwnershipLimitation[]; armoring?: Armoring | null;
  importRecord?: { import_record_number: string; import_record_date: string } | null;
}

const contact = { address: 'CRA 20 # 8-45 BARRIO CENTRO', city: 'YOPAL', phone: '3105550101' };

function scenario(s: Spec): Scenario {
  const vehicle: VehicleRecord = {
    plate: s.plate, registration_status: 'ACTIVO', service_type: 'Particular', vehicle_class: 'AUTOMOVIL',
    classification: 'AUTOMOVIL', body_type: 'SEDAN', brand: 'CHEVROLET', line: 'SPARK GT', model_year: '2018',
    color: 'BLANCO', fuel_type: 'GASOLINA', engine_displacement: 1200, doors: 5, seated_passengers: 5,
    total_passengers: 5, axle_count: 2, gross_weight: null, load_capacity: null, vin: '9GATEST00J0000001',
    engine_number: 'B12D1TEST001', chassis_number: '9GATEST00J0000001', serial_number: 'SER000001',
    traffic_license_number: '10000001', traffic_authority: 'SECRETARIA DE TRANSITO DE YOPAL',
    registration_date: '2018-05-10', has_liens: false, has_pledges: (s.pledges?.length ?? 0) > 0,
    engine_restamped: false, chassis_restamped: false, serial_restamped: false, vin_restamped: false,
    ...s.vehicle,
  };
  const docType = s.ownerDocType ?? 'CC';
  const doc = s.ownerDoc ?? '1000000001';
  const pledges = s.pledges ?? [];
  const byPlate: VehicleByPlate = {
    found: true, plate: s.plate, vehicle, pledges, ownership_limitations: s.limitations ?? [], armoring: s.armoring ?? null,
  };
  const owner: HistoryOwner = {
    document_type: docType === 'NIT' ? 'NIT' : 'Cédula Ciudadanía', name: s.ownerName, document_number: doc,
    ownership_start_date: '2024-01-15', ownership_end_date: null, owner_type: 'PROPIO',
  };
  const history: VehicleHistory = {
    found: true, plate: s.plate, owners: [owner], import_record: s.importRecord ?? null,
    guarantee: pledges[0]
      ? { creditor: pledges[0].creditor, creditor_document_type: pledges[0].creditor_document_type,
          creditor_document_number: pledges[0].creditor_document_number, registered_date: '2024-01-20', guarantee_type: 'PRENDA' }
      : null,
  };
  const cap = vehicle.total_passengers != null
    ? { kind: 'passengers' as const, value: vehicle.total_passengers }
    : { kind: 'kg' as const, value: vehicle.load_capacity ?? 0 };
  return {
    id: s.id, description: s.description, plate: s.plate, ownerDocType: docType, ownerDoc: doc,
    ownerName: s.ownerName, ownerContact: contact, power: s.power, byPlate, history,
    manualVehicle: {
      plate: s.plate, vehicleClass: vehicle.vehicle_class ?? 'AUTOMOVIL', brand: vehicle.brand ?? '', line: vehicle.line ?? '',
      modelYear: vehicle.model_year ?? '', color: vehicle.color ?? '', fuel: 1, displacement: vehicle.engine_displacement ?? 0,
      capacity: cap, power: s.power, bodyType: { type: vehicle.body_type ?? '', code: '01' },
      engineNumber: vehicle.engine_number ?? undefined, chassisNumber: vehicle.chassis_number ?? '',
      serialNumber: vehicle.serial_number ?? undefined, vin: vehicle.vin ?? '', serviceType: 1,
    },
  };
}

const bank: Pledge = { creditor: 'BANCO EJEMPLO S.A.', creditor_document_type: 'NIT', creditor_document_number: '900000001', registered_date: null, trust_estate: null };

export const SCENARIOS: Scenario[] = [
  scenario({ id: 'car-gasoline-clean', description: 'Automóvil a gasolina, sin gravámenes', plate: 'ABC123', ownerName: 'LUIS FERNANDO GOMEZ RUIZ', power: 85 }),
  scenario({
    id: 'ev-pledge', description: 'Camioneta eléctrica con prenda (caso real del spike, anonimizado)', plate: 'TST123',
    ownerName: 'MARIA ALEJANDRA RODRIGUEZ PEREZ', ownerDoc: '1234567', power: 220,
    vehicle: { vehicle_class: 'CAMIONETA', classification: 'AUTOMOVIL', body_type: 'SUV', brand: 'TESLA', line: 'MODEL Y', model_year: '2026', color: 'ROJO ULTRA', fuel_type: 'ELECTRICO', engine_displacement: 0, total_passengers: null, engine_number: null, serial_number: null, vin: 'TESTVIN0000000001', chassis_number: 'TESTVIN0000000001', traffic_authority: 'SDM BOGOTA' },
    pledges: [bank],
  }),
  scenario({
    id: 'moto', description: 'Motocicleta (placa ABC12D)', plate: 'XYZ12D', ownerName: 'JORGE ENRIQUE PARDO SUAREZ', ownerDoc: '1000000002', power: 12,
    vehicle: { vehicle_class: 'MOTOCICLETA', classification: 'MOTOCICLETA', body_type: 'SIN CARROCERIA', brand: 'AKT', line: 'NKD 125', model_year: '2022', color: 'NEGRO', engine_displacement: 125, total_passengers: 2, seated_passengers: 2, vin: '9FLTEST00N0000002', chassis_number: '9FLTEST00N0000002', engine_number: 'MOTO0000002' },
  }),
  scenario({
    id: 'company-owner', description: 'Camión de una empresa (NIT), capacidad en kg', plate: 'CAM456', ownerDocType: 'NIT', ownerDoc: '900123456',
    ownerName: 'TRANSPORTES DEL LLANO S A S', power: 190,
    vehicle: { vehicle_class: 'CAMION', classification: 'CAMION', body_type: 'FURGON', brand: 'HINO', line: 'FC9J', model_year: '2020', color: 'BLANCO', fuel_type: 'DIESEL', engine_displacement: 5123, total_passengers: null, seated_passengers: 3, load_capacity: 6500, gross_weight: 10400, vin: 'JHDTEST00L0000003', chassis_number: 'JHDTEST00L0000003', engine_number: 'J05E000003' },
  }),
  scenario({
    id: 'taxi-public', description: 'Taxi de servicio público', plate: 'TAX789', ownerName: 'PEDRO PABLO MARTINEZ DIAZ', ownerDoc: '1000000004', power: 90,
    vehicle: { service_type: 'Público', brand: 'HYUNDAI', line: 'ATOS', model_year: '2019', color: 'AMARILLO', fuel_type: 'GASOLINA', engine_displacement: 1100, total_passengers: 4, vin: 'MALTEST00K0000004', chassis_number: 'MALTEST00K0000004', engine_number: 'G4HG000004' },
  }),
  scenario({
    id: 'limitation-seizure', description: 'Vehículo con embargo inscrito', plate: 'EMB321', ownerName: 'ANA MARIA TORRES LOPEZ', ownerDoc: '1000000005', power: 100,
    vehicle: { brand: 'RENAULT', line: 'LOGAN', model_year: '2016', color: 'GRIS ESTRELLA', engine_displacement: 1600, vin: '9FBTEST00G0000005', chassis_number: '9FBTEST00G0000005', engine_number: 'K7MT000005' },
    limitations: [{ limitation_type: 'EMBARGO', document_number: '2024-0001', legal_entity: 'JUZGADO 2 CIVIL MUNICIPAL', department: 'CASANARE', municipality: 'YOPAL', issue_date: '2025-03-01', filing_date: '2025-03-05' }],
  }),
  scenario({
    id: 'armored-imported', description: 'Campero blindado e importado', plate: 'BLI654', ownerName: 'CARLOS JULIO ESPITIA CASTRO', ownerDoc: '1000000006', power: 250,
    vehicle: { vehicle_class: 'CAMPERO', classification: 'CAMPERO', body_type: 'WAGON', brand: 'TOYOTA', line: 'LAND CRUISER PRADO', model_year: '2021', color: 'NEGRO', fuel_type: 'DIESEL', engine_displacement: 2800, vin: 'JTETEST00M0000006', chassis_number: 'JTETEST00M0000006', engine_number: '1GD0000006' },
    armoring: { is_armored: true, level: 'TRES', level_number: 3, armored_date: '2022-02-01', dearmored_date: null, resolution_number: 'RES-123/2022', armoring_type: 'BLINDAJE', certificate_issue_date: '2022-02-01', authorization: null },
    importRecord: { import_record_number: '11870001', import_record_date: '2021-03-15' },
  }),
  scenario({
    id: 'hybrid-unknown-fuel', description: 'Híbrido: combustible sin casilla directa', plate: 'HIB147', ownerName: 'SOFIA ANDREA RAMIREZ GIL', ownerDoc: '1000000007', power: 121,
    vehicle: { brand: 'TOYOTA', line: 'COROLLA HIBRIDO', model_year: '2023', color: 'PLATA', fuel_type: 'HIBRIDO', engine_displacement: 1800, vin: 'JTDTEST00P0000007', chassis_number: 'JTDTEST00P0000007', engine_number: '2ZR0000007' },
  }),
  scenario({
    id: 'restamped-engine', description: 'Vehículo con motor regrabado', plate: 'REG258', ownerName: 'HECTOR RAUL DIAZ MORA', ownerDoc: '1000000008', power: 80,
    vehicle: { brand: 'MAZDA', line: '3 TOURING', model_year: '2015', color: 'AZUL', engine_displacement: 2000, engine_restamped: true, vin: 'JM7TEST00F0000008', chassis_number: 'JM7TEST00F0000008', engine_number: 'PE0000008' },
  }),
  scenario({
    id: 'long-strings', description: 'Textos largos para probar desbordamiento y apellidos compuestos', plate: 'LNG963', ownerName: 'JUAN CARLOS DE LA CRUZ DEL VALLE', ownerDoc: '1000000009', power: 95,
    vehicle: { brand: 'VOLKSWAGEN', line: 'AMAROK HIGHLINE DOBLE CABINA 4X4', model_year: '2024', color: 'GRIS PLATA METALIZADO BICOLOR', engine_displacement: 1968, body_type: 'CAMIONETA DOBLE CABINA', vin: 'WV1TESTLONGSTRING9', chassis_number: 'WV1TESTLONGSTRING9', engine_number: 'DNF00000009' },
  }),
];

export const getScenario = (id: string): Scenario => {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`Escenario desconocido: ${id}`);
  return s;
};
