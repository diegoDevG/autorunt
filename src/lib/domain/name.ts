export interface SplitName {
  surname1: string;
  surname2: string;
  names: string;
  /** 'low' cuando hay partículas, 1-2 palabras o más de 4: el usuario debe revisar. */
  confidence: 'high' | 'low';
}

const PARTICLES = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'Y']);

/**
 * El RUNT entrega el nombre en una sola cadena, nombres primero y apellidos al final.
 * Heurística: se agrupan las partículas con la palabra siguiente (DE LA CRUZ) y se toman
 * las dos últimas unidades como apellidos. Siempre debe ser editable por el usuario.
 */
export function splitColombianName(full: string): SplitName {
  const tokens = full.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const units: string[] = [];
  let pending: string[] = [];
  let hasParticle = false;
  for (const t of tokens) {
    if (PARTICLES.has(t)) {
      pending.push(t);
      hasParticle = true;
    } else {
      units.push([...pending, t].join(' '));
      pending = [];
    }
  }
  if (pending.length) units.push(pending.join(' '));

  const n = units.length;
  const confidence = hasParticle || n < 3 || n > 4 ? 'low' : 'high';
  if (n === 0) return { surname1: '', surname2: '', names: '', confidence: 'low' };
  if (n === 1) return { surname1: '', surname2: '', names: units[0] as string, confidence };
  if (n === 2) return { surname1: units[1] as string, surname2: '', names: units[0] as string, confidence };
  return {
    surname1: units[n - 2] as string,
    surname2: units[n - 1] as string,
    names: units.slice(0, n - 2).join(' '),
    confidence,
  };
}
