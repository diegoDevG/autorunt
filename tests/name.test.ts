import { describe, expect, it } from 'vitest';
import { splitColombianName } from '../src/lib/domain/name';

describe('splitColombianName', () => {
  it('cuatro palabras: dos nombres y dos apellidos', () => {
    expect(splitColombianName('MARIA ALEJANDRA RODRIGUEZ PEREZ')).toEqual({
      names: 'MARIA ALEJANDRA', surname1: 'RODRIGUEZ', surname2: 'PEREZ', confidence: 'high',
    });
  });
  it('tres palabras: un nombre y dos apellidos', () => {
    expect(splitColombianName('JUAN PEREZ GOMEZ')).toMatchObject({ names: 'JUAN', surname1: 'PEREZ', surname2: 'GOMEZ', confidence: 'high' });
  });
  it('agrupa partículas con el apellido y baja la confianza', () => {
    const r = splitColombianName('JUAN DE LA CRUZ');
    expect(r).toMatchObject({ names: 'JUAN', surname1: 'DE LA CRUZ', surname2: '', confidence: 'low' });
  });
  it('apellido compuesto en segunda posición', () => {
    expect(splitColombianName('ANA GARCIA DEL VALLE')).toMatchObject({ names: 'ANA', surname1: 'GARCIA', surname2: 'DEL VALLE', confidence: 'low' });
  });
  it('casos degenerados', () => {
    expect(splitColombianName('')).toMatchObject({ names: '', confidence: 'low' });
    expect(splitColombianName('PRUEBA')).toMatchObject({ names: 'PRUEBA', confidence: 'low' });
  });
});
