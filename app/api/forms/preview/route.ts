import { buildStampValues } from '../../../../src/lib/pdf/formMapper';
import { DEV_COORDINATES } from '../../../../src/lib/pdf/devLayout';
import { ensureDevTemplate } from '../../../../src/lib/pdf/devTemplate';
import { stampForm } from '../../../../src/lib/pdf/overlay';

export const runtime = 'nodejs';

// Banco de pruebas: confía en el cuerpo que envía la interfaz. En producción la consulta se
// lee de la base de datos (lookups) y nunca del cliente.
export async function POST(req: Request) {
  try {
    const { tramiteId, vehicle, alerts, manual } = await req.json();
    const { values, issues } = buildStampValues({ tramiteId, vehicle, alerts, manual });
    const r = await stampForm(await ensureDevTemplate(), DEV_COORDINATES, values);
    return Response.json({ pdf: Buffer.from(r.pdf).toString('base64'), issues, overflow: r.overflow, unknownKeys: r.unknownKeys });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : 'Error desconocido' }, { status: 400 });
  }
}
