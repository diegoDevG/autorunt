// Tipos de las respuestas de Croma (RUNT). Basados en la documentación y en el spike (Anexo A).
export interface Pledge {
  creditor: string;
  creditor_document_type: string;
  creditor_document_number: string;
  registered_date: string | null;
  trust_estate: string | null;
}

export interface OwnershipLimitation {
  limitation_type: string | null;
  document_number: string | null;
  legal_entity: string | null;
  department: string | null;
  municipality: string | null;
  issue_date: string | null;
  filing_date: string | null;
}

export interface Armoring {
  is_armored: boolean;
  level: string | null;
  level_number: number | null;
  armored_date: string | null;
  dearmored_date: string | null;
  resolution_number: string | null;
  armoring_type: string | null;
  certificate_issue_date: string | null;
  authorization: string | null;
}

export interface VehicleRecord {
  plate: string;
  registration_status: string;
  service_type: string | null;
  vehicle_class: string | null;
  classification: string | null;
  body_type: string | null;
  brand: string | null;
  line: string | null;
  model_year: string | null;
  color: string | null;
  fuel_type: string | null;
  engine_displacement: number | null;
  doors: number | null;
  seated_passengers: number | null;
  total_passengers: number | null;
  axle_count: number | null;
  gross_weight: number | null;
  load_capacity: number | null;
  vin: string | null;
  engine_number: string | null;
  chassis_number: string | null;
  serial_number: string | null;
  traffic_license_number: string | null;
  traffic_authority: string | null;
  registration_date: string | null;
  has_liens: boolean;
  has_pledges: boolean;
  engine_restamped: boolean;
  chassis_restamped: boolean;
  serial_restamped: boolean;
  vin_restamped: boolean;
}

export interface SoatPolicy {
  policy_number: string;
  insurer: string;
  is_current: boolean;
  issue_date?: string | null;
  start_date: string; // AAAA-MM-DD
  expiry_date: string; // AAAA-MM-DD
  origin?: string | null;
  tariff_type?: string | null;
}

export interface VehicleByPlate {
  found: boolean;
  plate: string;
  vehicle: VehicleRecord | null;
  pledges: Pledge[];
  ownership_limitations: OwnershipLimitation[];
  armoring: Armoring | null;
  soat_policies?: SoatPolicy[];
}

export interface HistoryOwner {
  document_type: string; // texto largo: "Cédula Ciudadanía"
  name: string; // una sola cadena, nombres primero
  document_number: string;
  ownership_start_date: string | null;
  ownership_end_date: string | null;
  owner_type: string;
}

export interface VehicleHistory {
  found: boolean;
  plate: string;
  owners: HistoryOwner[];
  import_record: { import_record_number: string; import_record_date: string } | null;
  guarantee: {
    creditor: string;
    creditor_document_type: string;
    creditor_document_number: string;
    registered_date: string | null;
    guarantee_type: string;
  } | null;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'canceled' | 'expired';

export interface JobEnvelope<T> {
  job: { id: string; status: JobStatus; status_url: string };
  data: T | null;
  error: { type: string; code: string; message: string } | null;
}
