import { describe, expect, it } from 'vitest';
import { isNitOk, } from './helpers';
import { nitCheckDigit, normalizeDocument, normalizePlate, plateKind, lookupInputSchema } from '../src/lib/domain/validators';

describe('placa', () => {
  it('normaliza y clasifica', () => {
    expect(normalizePlate(' abc-123 ')).toBe('ABC123');
    expect(plateKind('ABC123')).toBe('car');
    expect(plateKind('abc12d')).toBe('motorcycle');
    expect(plateKind('AB1234')).toBeNull();
  });
});

describe('NIT', () => {
  it('calcula el dígito de verificación (Bancolombia 890903938-8)', () => {
    expect(nitCheckDigit('890903938')).toBe(8);
  });
  it('valida con y sin guion', () => {
    expect(isNitOk('890903938-8')).toBe(true);
    expect(isNitOk('890903938-7')).toBe(false);
    expect(normalizeDocument('NIT', '890.903.938')).toEqual({ ok: true, number: '890903938' });
  });
});

describe('documentos y entrada', () => {
  it('rechaza documentos inválidos', () => {
    expect(normalizeDocument('CC', '12')).toMatchObject({ ok: false });
    expect(normalizeDocument('CC', '1.234.567')).toEqual({ ok: true, number: '1234567' });
  });
  it('el esquema transforma la placa y usa CC por defecto', () => {
    const r = lookupInputSchema.parse({ plate: 'tst-123', documentNumber: '1234567', tramiteId: 2 });
    expect(r.plate).toBe('TST123');
    expect(r.documentType).toBe('CC');
  });
  it('el esquema rechaza trámite fuera de rango y placa mala', () => {
    expect(lookupInputSchema.safeParse({ plate: 'XX', documentNumber: '1234567', tramiteId: 2 }).success).toBe(false);
    expect(lookupInputSchema.safeParse({ plate: 'TST123', documentNumber: '1234567', tramiteId: 19 }).success).toBe(false);
  });
});
