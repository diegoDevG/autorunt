import { CromaClient, type RuntPort } from '../croma/client';
import { MockRuntPort } from '../../mocks/mockRunt';

const g = globalThis as unknown as { __mockRunt?: MockRuntPort };

/** RUNT_SOURCE=croma (con CROMA_API_KEY) usa la API real; por defecto, datos simulados. */
export function getRuntPort(): { port: RuntPort; source: 'mock' | 'croma' } {
  if (process.env.RUNT_SOURCE === 'croma' && process.env.CROMA_API_KEY) {
    return { port: new CromaClient({ apiKey: process.env.CROMA_API_KEY }), source: 'croma' };
  }
  g.__mockRunt ??= new MockRuntPort(); // una sola instancia: la segunda consulta idéntica sale como caché
  return { port: g.__mockRunt, source: 'mock' };
}
