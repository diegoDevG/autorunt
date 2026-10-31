import type { JobEnvelope, VehicleByPlate, VehicleHistory } from './types';
import type { DocumentType } from '../domain/validators';

export class CromaError extends Error {
  constructor(
    public code: string,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = 'CromaError';
  }
}

export type Started<T> =
  | { kind: 'done'; data: T; cacheHit: boolean }
  | { kind: 'pending'; jobId: string; statusUrl: string };

export interface CromaOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  /** Segundos de espera en línea (Prefer: wait=N, máximo 55 en Croma). */
  waitSeconds?: number;
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Contrato mínimo que usa el servicio de consultas (permite simular Croma en pruebas). */
export interface RuntPort {
  vehicleByPlate(
    plate: string,
    doc: { type: DocumentType; number: string },
  ): Promise<{ data: VehicleByPlate; cacheHit: boolean }>;
  vehicleHistory(plate: string): Promise<{ data: VehicleHistory; cacheHit: boolean }>;
}

export class CromaClient implements RuntPort {
  private baseUrl: string;
  private f: typeof fetch;
  private waitSeconds: number;
  private pollTimeoutMs: number;
  private sleep: (ms: number) => Promise<void>;

  constructor(private opts: CromaOptions) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.croma.run').replace(/\/$/, '');
    this.f = opts.fetchImpl ?? fetch;
    this.waitSeconds = Math.min(opts.waitSeconds ?? 25, 55);
    this.pollTimeoutMs = opts.pollTimeoutMs ?? 90_000;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private auth() {
    return { Authorization: `Bearer ${this.opts.apiKey}` };
  }

  /** Inicia una consulta. Maneja siempre 200 (listo, posible caché) y 202 (en proceso). */
  async start<T>(path: string, body: object): Promise<Started<T>> {
    const res = await this.f(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { ...this.auth(), 'Content-Type': 'application/json', Prefer: `wait=${this.waitSeconds}` },
      body: JSON.stringify(body),
    });
    if (res.status === 200) {
      const json = (await res.json()) as { data: T };
      return { kind: 'done', data: json.data, cacheHit: res.headers.get('X-Cache') === 'HIT' };
    }
    if (res.status === 202) {
      const json = (await res.json()) as JobEnvelope<T>;
      const statusUrl = json.job?.status_url ?? res.headers.get('Location');
      if (!statusUrl) throw new CromaError('NO_STATUS_URL', 'Croma devolvió 202 sin status_url', 202);
      return { kind: 'pending', jobId: json.job?.id ?? res.headers.get('X-Job-Id') ?? '', statusUrl };
    }
    throw await this.toError(res);
  }

  /** Espera un trabajo pendiente consultando su status_url (respeta Retry-After). */
  async poll<T>(statusUrl: string): Promise<T> {
    const deadline = Date.now() + this.pollTimeoutMs;
    for (;;) {
      const res = await this.f(statusUrl, { headers: this.auth() });
      if (!res.ok) throw await this.toError(res);
      const body = (await res.json()) as JobEnvelope<T>;
      const s = body.job.status;
      if (s === 'completed') return body.data as T;
      if (s === 'failed' || s === 'canceled' || s === 'expired') {
        throw new CromaError(body.error?.code ?? s.toUpperCase(), body.error?.message ?? `Trabajo ${s}`);
      }
      if (Date.now() >= deadline) throw new CromaError('TIMEOUT', 'Croma no respondió a tiempo');
      await this.sleep(Number(res.headers.get('Retry-After') ?? 2) * 1000);
    }
  }

  private async run<T>(path: string, body: object): Promise<{ data: T; cacheHit: boolean }> {
    const started = await this.start<T>(path, body);
    if (started.kind === 'done') return { data: started.data, cacheHit: started.cacheHit };
    return { data: await this.poll<T>(started.statusUrl), cacheHit: false };
  }

  vehicleByPlate(plate: string, doc: { type: DocumentType; number: string }) {
    return this.run<VehicleByPlate>('/co/runt/vehicle-by-plate/v1', {
      plate,
      document_type: doc.type,
      document_number: doc.number,
    });
  }

  vehicleHistory(plate: string) {
    return this.run<VehicleHistory>('/co/runt/vehicle-history-by-plate/v1', { plate });
  }

  private async toError(res: Response): Promise<CromaError> {
    let code = `HTTP_${res.status}`;
    let message = res.statusText || 'Error de Croma';
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      if (j.error?.code) code = j.error.code;
      if (j.error?.message) message = j.error.message;
    } catch {
      /* cuerpo no JSON */
    }
    return new CromaError(code, message, res.status);
  }
}
