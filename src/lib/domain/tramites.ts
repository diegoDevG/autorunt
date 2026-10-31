import type { FormVehicleBlock, Field } from './normalizer';

export type Section = 'vehicle' | 'owner' | 'buyer' | 'alerts' | 'import' | 'company' | 'observations';

export interface TramiteConfig {
  id: number; // casilla del campo 3
  slug: string;
  name: string;
  sections: Section[];
  /** Campos que el trámite modifica: el RUNT trae el valor viejo y NO debe prellenarse. */
  intentFields: (keyof FormVehicleBlock)[];
  /** false: el vehículo no existe en el RUNT (o no está activo); modo manual. */
  needsRunt: boolean;
  /** Incluido en el MVP (límite de alcance). */
  mvp: boolean;
}

const base: Section[] = ['vehicle', 'owner'];

export const TRAMITES: TramiteConfig[] = [
  { id: 1, slug: 'matricula-inicial', name: 'Matrícula / registro', sections: ['vehicle', 'import', 'owner', 'observations'], intentFields: [], needsRunt: false, mvp: false },
  { id: 2, slug: 'traspaso', name: 'Traspaso', sections: [...base, 'buyer', 'alerts', 'company', 'observations'], intentFields: [], needsRunt: true, mvp: true },
  { id: 3, slug: 'traslado', name: 'Traslado de matrícula / registro', sections: [...base, 'alerts'], intentFields: [], needsRunt: true, mvp: false },
  { id: 4, slug: 'radicado', name: 'Radicado de matrícula / registro', sections: [...base, 'alerts'], intentFields: [], needsRunt: true, mvp: false },
  { id: 5, slug: 'cambio-color', name: 'Cambio de color', sections: base, intentFields: ['color'], needsRunt: true, mvp: false },
  { id: 6, slug: 'cambio-servicio', name: 'Cambio de servicio', sections: [...base, 'company'], intentFields: ['serviceType'], needsRunt: true, mvp: false },
  { id: 7, slug: 'regrabar-motor', name: 'Regrabar motor', sections: [...base, 'observations'], intentFields: ['engineNumber', 'restamped'], needsRunt: true, mvp: false },
  { id: 8, slug: 'regrabar-chasis', name: 'Regrabar chasis', sections: [...base, 'observations'], intentFields: ['chassisNumber', 'restamped'], needsRunt: true, mvp: false },
  { id: 9, slug: 'transformacion', name: 'Transformación', sections: [...base, 'observations'], intentFields: [], needsRunt: true, mvp: false },
  { id: 10, slug: 'duplicado-licencia', name: 'Duplicado licencia de tránsito', sections: ['vehicle', 'owner'], intentFields: [], needsRunt: true, mvp: false },
  { id: 11, slug: 'inscripcion-prenda', name: 'Inscripción de prenda', sections: [...base, 'alerts'], intentFields: [], needsRunt: true, mvp: false },
  { id: 12, slug: 'levanta-prenda', name: 'Levantamiento de prenda', sections: [...base, 'alerts'], intentFields: [], needsRunt: true, mvp: false },
  { id: 13, slug: 'cancelacion', name: 'Cancelación de matrícula / registro', sections: [...base, 'alerts', 'observations'], intentFields: [], needsRunt: true, mvp: false },
  { id: 14, slug: 'cambio-placas', name: 'Cambio de placas', sections: base, intentFields: [], needsRunt: true, mvp: false },
  { id: 15, slug: 'duplicado-placas', name: 'Duplicado de placas', sections: base, intentFields: [], needsRunt: true, mvp: false },
  { id: 16, slug: 'rematricula', name: 'Rematrícula', sections: ['vehicle', 'import', 'owner', 'observations'], intentFields: [], needsRunt: false, mvp: false },
  { id: 17, slug: 'cambio-carroceria', name: 'Cambio de carrocería', sections: [...base, 'observations'], intentFields: ['bodyType'], needsRunt: true, mvp: false },
  { id: 18, slug: 'otros', name: 'Otros', sections: ['vehicle', 'owner', 'observations'], intentFields: [], needsRunt: false, mvp: false },
];

export function getTramite(id: number): TramiteConfig {
  const t = TRAMITES.find((x) => x.id === id);
  if (!t) throw new Error(`Trámite desconocido: ${id}`);
  return t;
}

/** Vacía los campos de intención: el usuario debe digitar el valor nuevo. */
export function applyIntent(block: FormVehicleBlock, tramite: TramiteConfig): FormVehicleBlock {
  const out = { ...block } as Record<string, Field<unknown>>;
  for (const key of tramite.intentFields) {
    out[key] = { value: null, confidence: 'missing', note: 'El trámite modifica este dato: digitar el valor nuevo' };
  }
  return out as unknown as FormVehicleBlock;
}
