import { z } from 'zod';

export const DOCUMENT_TYPES = ['CC', 'CE', 'TI', 'RC', 'PA', 'NIT', 'PPT'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** Letra de la casilla de tipo de documento del formulario (campos 21 y 22). PPT no tiene casilla. */
export const FORM_DOC_LETTER: Record<DocumentType, string | null> = {
  CC: 'C',
  NIT: 'N',
  PA: 'P',
  CE: 'E',
  TI: 'T',
  RC: 'U', // NUIP
  PPT: null,
};

export function normalizePlate(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, '');
}

export function plateKind(raw: string): 'car' | 'motorcycle' | null {
  const p = normalizePlate(raw);
  if (/^[A-Z]{3}\d{3}$/.test(p)) return 'car';
  if (/^[A-Z]{3}\d{2}[A-Z]$/.test(p)) return 'motorcycle';
  return null;
}

const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/** Dígito de verificación del NIT (algoritmo DIAN). */
export function nitCheckDigit(base: string): number {
  const digits = base.replace(/\D/g, '');
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += Number(digits[digits.length - 1 - i]) * (NIT_WEIGHTS[i] ?? 0);
  }
  const r = sum % 11;
  return r > 1 ? 11 - r : r;
}

export type DocResult = { ok: true; number: string } | { ok: false; error: string };

/** Normaliza el número para Croma. Un NIT con guion se valida y se envía sin dígito de verificación. */
export function normalizeDocument(type: DocumentType, raw: string): DocResult {
  const s = raw.trim().replace(/[.\s]/g, '');
  if (type === 'NIT') {
    const m = s.match(/^(\d{5,15})(?:-(\d))?$/);
    if (!m) return { ok: false, error: 'NIT inválido' };
    const base = m[1] as string;
    if (m[2] !== undefined && nitCheckDigit(base) !== Number(m[2])) {
      return { ok: false, error: 'Dígito de verificación del NIT incorrecto' };
    }
    return { ok: true, number: base };
  }
  if (!/^[A-Za-z0-9-]{3,30}$/.test(s)) return { ok: false, error: 'Documento inválido' };
  return { ok: true, number: s.toUpperCase() };
}

export const lookupInputSchema = z
  .object({
    plate: z
      .string()
      .transform(normalizePlate)
      .refine((p) => plateKind(p) !== null, 'Placa inválida'),
    documentType: z.enum(DOCUMENT_TYPES).default('CC'),
    documentNumber: z.string(),
    tramiteId: z.number().int().min(1).max(18),
    officeAuthority: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const r = normalizeDocument(v.documentType, v.documentNumber);
    if (!r.ok) ctx.addIssue({ code: 'custom', path: ['documentNumber'], message: r.error });
  });

export type LookupInput = z.infer<typeof lookupInputSchema>;
