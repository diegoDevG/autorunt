import { CromaError } from '../../../src/lib/croma/client';
import { runLookup, type LookupStage } from '../../../src/lib/domain/lookup';
import { getRuntPort } from '../../../src/lib/runt/port';

export const runtime = 'nodejs';

// La respuesta es NDJSON: una línea por etapa real y al final el resultado o el error.
// Así la interfaz muestra lo que está pasando mientras responde el servicio de consulta.
type Event =
  | { event: 'stage'; stage: LookupStage }
  | { event: 'result'; source: 'mock' | 'croma'; outcome: unknown }
  | { event: 'error'; code: string; message: string };

const USER_MESSAGES: Record<string, string> = {
  job_failed: 'No pudimos completar la consulta del vehículo. Puedes intentar de nuevo o digitar los datos a mano.',
};

function friendly(e: unknown): { code: string; message: string } {
  if (e instanceof CromaError) {
    return { code: e.code, message: USER_MESSAGES[e.code] ?? 'No pudimos consultar el vehículo en este momento. Intenta de nuevo o digita los datos a mano.' };
  }
  console.error(e);
  return { code: 'ERROR', message: 'No pudimos consultar el vehículo en este momento. Intenta de nuevo o digita los datos a mano.' };
}

export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: Event) => controller.enqueue(encoder.encode(`${JSON.stringify(ev)}\n`));
      const { port, source } = getRuntPort();
      try {
        const outcome = await runLookup(port, await req.json(), (stage) => send({ event: 'stage', stage }));
        send({ event: 'result', source, outcome });
      } catch (e) {
        send({ event: 'error', ...friendly(e) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' } });
}
