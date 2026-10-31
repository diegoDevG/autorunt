import { CromaError } from '../../../src/lib/croma/client';
import { runLookup } from '../../../src/lib/domain/lookup';
import { getRuntPort } from '../../../src/lib/runt/port';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const { port, source } = getRuntPort();
  try {
    const outcome = await runLookup(port, await req.json());
    return Response.json({ source, outcome });
  } catch (e) {
    const code = e instanceof CromaError ? e.code : 'ERROR';
    const message = e instanceof Error ? e.message : 'Error desconocido';
    return Response.json({ source, error: { code, message } }, { status: 502 });
  }
}
