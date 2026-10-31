import { normalizeDocument } from '../src/lib/domain/validators';
export const isNitOk = (s: string) => normalizeDocument('NIT', s).ok;
