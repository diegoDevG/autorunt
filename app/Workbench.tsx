'use client';

import { useEffect, useState } from 'react';
import type { Alerts, Field, FormVehicleBlock } from '../src/lib/domain/normalizer';
import type { Warning } from '../src/lib/domain/preconditions';
import type { LookupStage } from '../src/lib/domain/lookup';
import { requiresCompany } from '../src/lib/domain/tramites';

type TramiteInfo = { id: number; name: string; mvp: boolean; needsRunt: boolean; sections: string[]; intentFields: string[] };
type ScenarioInfo = { id: string; description: string; plate: string; ownerDocType: string; ownerDoc: string };
type Person = { documentType: string; documentNumber: string; surname1: string; surname2: string; names: string; address: string; city: string; phone: string };
type OwnerName = { surname1: string; surname2: string; names: string; confidence: 'high' | 'low' } | null;
type Outcome =
  | { status: 'ok'; vehicle: FormVehicleBlock; alerts: Alerts; owner: { name: OwnerName; rawName: string | null }; warnings: Warning[]; estimatedCredits: number; soat: { status: 'vigente' | 'vencido' | 'sin_registro'; insurer: string | null; expiresAt: string | null }; registrationAuthority: string | null }
  | { status: 'not_found' }
  | { status: 'blocked'; warnings: Warning[]; estimatedCredits: number }
  | { status: 'invalid'; issues: { path: string; message: string }[] };
type ServerEvent =
  | { event: 'stage'; stage: LookupStage }
  | { event: 'result'; source: string; outcome: Outcome }
  | { event: 'error'; code: string; message: string };
type Issue = { field: string; level: 'missing' | 'review' | 'info'; note: string };
type Preview = { pdf: string; issues: Issue[]; overflow: string[]; unknownKeys: string[] };

const DOC_TYPES = ['CC', 'CE', 'TI', 'RC', 'PA', 'NIT', 'PPT'];
const FUEL = ['Gasolina', 'Diésel', 'Gas', 'Mixto', 'Eléctrico', 'Hidrógeno', 'Etanol', 'Biodiésel'];
const SERVICE = ['Particular', 'Público', 'Diplomático', 'Oficial', 'Especial', 'Otros'];
const LABELS: Record<string, string> = {
  plate: 'Placa', vehicleClass: 'Clase', brand: 'Marca', line: 'Línea', modelYear: 'Modelo', color: 'Color', fuel: 'Combustible',
  displacement: 'Cilindrada', capacity: 'Capacidad', armoring: 'Blindaje', power: 'Potencia (HP)', bodyType: 'Carrocería',
  engineNumber: 'N.º de motor', chassisNumber: 'N.º de chasis', serialNumber: 'N.º de serie', vin: 'VIN', restamped: 'Regrabados', serviceType: 'Servicio',
};
const STEPS = ['Consultar', 'Revisar y completar', 'Formulario'];
const LOOKUP_STAGES: { key: LookupStage | 'done'; label: string }[] = [
  { key: 'validating', label: 'Validando los datos' },
  { key: 'gate', label: 'Consultando la placa en el RUNT' },
  { key: 'history', label: 'Consultando propietario e historia del vehículo' },
  { key: 'done', label: 'Respuesta recibida' },
];
const emptyPerson = (documentType = 'CC', documentNumber = ''): Person => ({ documentType, documentNumber, surname1: '', surname2: '', names: '', address: '', city: '', phone: '' });

function show(key: string, f: Field<unknown>): string {
  const v = f.value as never;
  if (v === null || v === undefined) return '—';
  if (key === 'fuel') return FUEL[(v as number) - 1] ?? String(v);
  if (key === 'serviceType') return SERVICE[(v as number) - 1] ?? String(v);
  if (key === 'capacity') { const c = v as { kind: string; value: number }; return c.kind === 'kg' ? `${c.value} kg` : `${c.value} pasajeros`; }
  if (key === 'armoring') return (v as { armored: boolean }).armored ? 'Blindado' : 'No blindado';
  if (key === 'bodyType') { const b = v as { type: string; code: string | null }; return b.code ? `${b.type} (${b.code})` : b.type; }
  if (key === 'restamped') { const r = v as Record<string, boolean>; const on = Object.entries(r).filter(([, x]) => x).map(([k]) => k); return on.length ? on.join(', ') : 'Ninguno'; }
  return String(v);
}

/** Fecha AAAA-MM-DD a DD/MM/AAAA. */
function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function soatText(s: { status: string; insurer: string | null; expiresAt: string | null }): string {
  if (s.status === 'sin_registro') return 'Sin SOAT registrado en el RUNT';
  const who = s.insurer ? ` · ${s.insurer}` : '';
  return s.status === 'vigente' ? `Vigente hasta ${formatDate(s.expiresAt)}${who}` : `Vencido el ${formatDate(s.expiresAt)}${who}`;
}

/** Muestra qué etapa está en curso y cuánto lleva esperando. */
function Loader({ stage, startedAt, live }: { stage: LookupStage | null; startedAt: number; live: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const current = stage ? LOOKUP_STAGES.findIndex((s) => s.key === stage) : 0;
  const seconds = Math.floor((now - startedAt) / 1000);
  return (
    <div className="loader" role="status" aria-live="polite">
      <div className="loader-head">
        <span className="spinner" aria-hidden="true" />
        <strong>Consultando el vehículo</strong>
        <span className="elapsed">{seconds} s</span>
      </div>
      <ol className="stages">
        {LOOKUP_STAGES.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'pending';
          return <li key={s.key} className={state}><span className="dot" aria-hidden="true" />{s.label}</li>;
        })}
      </ol>
      {live && <p className="note">La primera consulta de un vehículo puede tardar entre 15 y 40 segundos. Puedes esperar aquí; no cierres la página.</p>}
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="stepper" aria-label="Progreso">
      {STEPS.map((label, i) => (
        <li key={label} className={i < current ? 'done' : i === current ? 'current' : ''} aria-current={i === current ? 'step' : undefined}>
          <span className="num">{i < current ? '✓' : i + 1}</span>
          <span className="label">{label}</span>
        </li>
      ))}
    </ol>
  );
}

function PersonFields({ value, onChange }: { value: Person; onChange: (p: Person) => void }) {
  const set = (k: keyof Person) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <>
      {value.documentType === 'NIT' ? (
        <div className="row"><label>Razón social<input placeholder="Nombre de la empresa" value={value.names} onChange={set('names')} /></label></div>
      ) : (
        <div className="row three">
          <label>Primer apellido<input placeholder="PEREZ" value={value.surname1} onChange={set('surname1')} /></label>
          <label>Segundo apellido<input placeholder="GOMEZ" value={value.surname2} onChange={set('surname2')} /></label>
          <label>Nombres<input placeholder="JUAN CARLOS" value={value.names} onChange={set('names')} /></label>
        </div>
      )}
      <div className="row two">
        <label>Tipo de documento<select value={value.documentType} onChange={set('documentType')}>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</select></label>
        <label>Número<input placeholder="Sin puntos" inputMode="numeric" value={value.documentNumber} onChange={set('documentNumber')} /></label>
      </div>
      <div className="row three">
        <label>Dirección<input placeholder="CRA 1 # 2-3" value={value.address} onChange={set('address')} /></label>
        <label>Ciudad<input placeholder="YOPAL" value={value.city} onChange={set('city')} /></label>
        <label>Teléfono<input placeholder="3001234567" inputMode="tel" value={value.phone} onChange={set('phone')} /></label>
      </div>
    </>
  );
}

export default function Workbench({ tramites, scenarios, source }: { tramites: TramiteInfo[]; scenarios: ScenarioInfo[]; source: 'mock' | 'croma' }) {
  const [tramiteId, setTramiteId] = useState(2);
  const [scenarioId, setScenarioId] = useState('');
  const [plate, setPlate] = useState('');
  const [docType, setDocType] = useState('CC');
  const [docNumber, setDocNumber] = useState('');
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<LookupStage | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [owner, setOwner] = useState<Person>(emptyPerson());
  const [buyer, setBuyer] = useState<Person>(emptyPerson());
  const [power, setPower] = useState('');
  const [bodyCode, setBodyCode] = useState('');
  const [observations, setObservations] = useState('');
  const [color, setColor] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [engineNumber, setEngineNumber] = useState('');
  const [chassisNumber, setChassisNumber] = useState('');
  const [bodyType, setBodyType] = useState('');
  const [company, setCompany] = useState({ name: '', nit: '' });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const tramite = tramites.find((t) => t.id === tramiteId) as TramiteInfo;
  const ok = outcome?.status === 'ok' ? outcome : null;
  const needsCompany = !!ok && tramite.sections.includes('company') && (tramiteId === 6 || requiresCompany(ok.vehicle.serviceType.value));
  const currentStep = preview ? 2 : ok ? 1 : 0;

  const pickScenario = (id: string) => {
    const s = scenarios.find((x) => x.id === id) as ScenarioInfo;
    setScenarioId(id); setPlate(s.plate); setDocType(s.ownerDocType); setDocNumber(s.ownerDoc);
  };

  function handleOutcome(o: Outcome) {
    setOutcome(o);
    if (o.status === 'ok') {
      const n = o.owner.name;
      setOwner({ ...emptyPerson(docType, docNumber), surname1: n?.surname1 ?? '', surname2: n?.surname2 ?? '', names: n?.names ?? '' });
      setBuyer(emptyPerson());
      setBodyCode(''); setPower('');
    }
  }

  async function consult() {
    setBusy(true); setError(null); setOutcome(null); setPreview(null); setPdfUrl(null);
    setStage('validating'); setStartedAt(Date.now());
    try {
      const res = await fetch('/api/lookups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate, documentType: docType, documentNumber: docNumber, tramiteId, officeAuthority: 'SECRETARIA DE TRANSITO DE YOPAL' }),
      });
      if (!res.body) throw new Error(`La consulta falló (código ${res.status}). Intenta de nuevo.`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let received = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let nl = buffer.indexOf('\n');
        while (nl >= 0) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          nl = buffer.indexOf('\n');
          if (!line) continue;
          const ev = JSON.parse(line) as ServerEvent;
          if (ev.event === 'stage') setStage(ev.stage);
          else if (ev.event === 'error') throw new Error(ev.message);
          else { received = true; handleOutcome(ev.outcome); }
        }
      }
      if (!received) throw new Error('La consulta terminó sin respuesta. Intenta de nuevo.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo consultar');
    } finally {
      setBusy(false); setStage(null);
    }
  }

  const fillExample = () => {
    const c = { address: 'CRA 20 # 8-45 CENTRO', city: 'YOPAL', phone: '3105550101' };
    setOwner((o) => ({ ...o, ...c }));
    setBuyer({ documentType: 'CC', documentNumber: '1098765432', surname1: 'RAMIREZ', surname2: 'TORRES', names: 'CARLOS ANDRES', address: 'CALLE 15 # 30-12', city: 'YOPAL', phone: '3205550199' });
  };

  async function generate() {
    if (!ok) return;
    setGenerating(true); setError(null);
    const overrides: Record<string, unknown> = {};
    if (tramiteId === 5 && color) overrides.color = color;
    if (tramiteId === 6) overrides.serviceType = Number(serviceType);
    if (tramiteId === 7 && engineNumber) { overrides.engineNumber = engineNumber; overrides.restamped = { engine: true }; }
    if (tramiteId === 8 && chassisNumber) { overrides.chassisNumber = chassisNumber; overrides.restamped = { chassis: true }; }
    const currentType = ok.vehicle.bodyType.value?.type ?? '';
    if (tramiteId === 17 && bodyType) overrides.bodyType = { type: bodyType, code: bodyCode || undefined };
    else if (bodyCode) overrides.bodyType = { type: currentType, code: bodyCode };
    const manual = {
      owner, ...(tramite.sections.includes('buyer') ? { buyer } : {}), ...(power ? { power: Number(power) } : {}),
      ...(needsCompany && company.name ? { company } : {}), ...(observations ? { observations } : {}), overrides,
    };
    try {
      const res = await fetch('/api/forms/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tramiteId, vehicle: ok.vehicle, alerts: ok.alerts, manual }),
      });
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      const p = json as Preview;
      const bytes = Uint8Array.from(atob(p.pdf), (c) => c.charCodeAt(0));
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
      setPdfUrl(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })));
      setPreview(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo generar el formulario');
    } finally { setGenerating(false); }
  }

  return (
    <>
      <header className="bar">
        <div>
          <h1>Formulario de tránsito</h1>
          <p>Consulta el vehículo, revisa lo que trae el RUNT, completa lo que falta y genera el PDF.</p>
        </div>
        <span className={`badge ${source === 'croma' ? 'live' : ''}`}>
          {source === 'croma' ? 'Datos reales' : 'Modo simulado'}
        </span>
      </header>

      <div className="wrap">
        <Stepper current={currentStep} />

        <main className="layout">
          <div className="col">
            <section>
              <h2>1. Consulta</h2>
              <div className="row">
                <label>Trámite
                  <select value={tramiteId} disabled={busy} onChange={(e) => { setTramiteId(Number(e.target.value)); setOutcome(null); setPreview(null); }}>
                    {tramites.map((t) => <option key={t.id} value={t.id}>{t.id}. {t.name}{t.mvp ? ' (MVP)' : ''}</option>)}
                  </select>
                </label>
                {source === 'mock' && (
                  <label>Vehículo de prueba
                    <select value={scenarioId} onChange={(e) => pickScenario(e.target.value)}>
                      <option value="">Elige un vehículo de prueba…</option>{scenarios.map((s) => <option key={s.id} value={s.id}>{s.description}</option>)}
                    </select>
                  </label>
                )}
              </div>
              <div className="row plate">
                <label>Placa<input placeholder="ABC123" value={plate} disabled={busy} autoCapitalize="characters" onChange={(e) => setPlate(e.target.value.toUpperCase())} /></label>
                <label>Tipo<select value={docType} disabled={busy} onChange={(e) => setDocType(e.target.value)}>{DOC_TYPES.map((d) => <option key={d}>{d}</option>)}</select></label>
                <label>Documento del propietario<input placeholder="Cédula o NIT" value={docNumber} disabled={busy} inputMode="numeric" onChange={(e) => setDocNumber(e.target.value)} /></label>
              </div>
              {!tramite.needsRunt && <p className="alert info">Este trámite no se consulta en el RUNT. El modo manual llega en el siguiente paso.</p>}
              <div className="actions">
                <button onClick={consult} disabled={busy || !tramite.needsRunt || !plate.trim() || !docNumber.trim()}>{busy ? 'Consultando…' : 'Consultar vehículo'}</button>
              </div>
              {busy && <Loader stage={stage} startedAt={startedAt} live={source === 'croma'} />}
              {error && <p className="alert error" role="alert">{error}</p>}
            </section>

            {outcome?.status === 'invalid' && (
              <section><h2>Revisa los datos de la consulta</h2>{outcome.issues.map((i, k) => <p key={k} className="alert error">{i.message}</p>)}</section>
            )}
            {outcome?.status === 'not_found' && (
              <section>
                <h2>No encontramos el vehículo</h2>
                <p className="alert warn">Revisa la placa y el documento del propietario. Una consulta sin resultado también puede tener costo.</p>
              </section>
            )}
            {outcome?.status === 'blocked' && (
              <section>
                <h2>Trámite bloqueado</h2>
                {outcome.warnings.map((w) => <p key={w.code} className={`alert ${w.severity}`}>{w.message}</p>)}
                
              </section>
            )}

            {ok && (
              <>
                <section>
                  <h2>2. Datos del RUNT</h2>
                    <div className={`soat ${ok.soat.status}`}><strong>SOAT</strong><span>{soatText(ok.soat)}</span></div>
                  {ok.warnings.map((w) => <p key={w.code} className={`alert ${w.severity}`}>{w.message}</p>)}
                  <div className="table-wrap">
                    <table><tbody>
                      {(Object.keys(LABELS) as (keyof FormVehicleBlock)[]).map((k) => {
                        const f = ok.vehicle[k] as Field<unknown>;
                        return (
                          <tr key={k}>
                            <td>{LABELS[k]}</td>
                            <td>
                              {show(k, f)}
                              {f.confidence !== 'ok' && <span className={`tag ${f.confidence}`}>{f.confidence === 'review' ? 'Revisar' : 'Falta'}</span>}
                              {f.note && f.confidence !== 'ok' && <small>{f.note}</small>}
                            </td>
                          </tr>
                        );
                      })}
                      {ok.alerts.pledges.map((p, i) => <tr key={`p${i}`}><td>Prenda</td><td>{p.creditor}<small>NIT {p.creditor_document_number}</small></td></tr>)}
                      {ok.alerts.limitations.map((l, i) => <tr key={`l${i}`}><td>Limitación</td><td>{l.limitation_type ?? 'Sin tipo'}<small>{l.legal_entity}</small></td></tr>)}
                    </tbody></table>
                  </div>
                </section>

                <section>
                  <h2>3. Completa lo que falta</h2>
                  <div className="actions quiet-actions">
                    <button className="quiet" onClick={fillExample}>Rellenar con datos de ejemplo</button>
                  </div>
                  <h3>Propietario (vendedor)</h3>
                  {ok.owner.name?.confidence === 'low' && <p className="alert warn">El nombre se separó automáticamente y tiene partículas o es atípico: compáralo con el documento.</p>}
                  <PersonFields value={owner} onChange={setOwner} />
                  {tramite.sections.includes('buyer') && (<><h3>Comprador</h3><PersonFields value={buyer} onChange={setBuyer} /></>)}

                  <h3>Vehículo</h3>
                  <div className="row two">
                    <label>Potencia (HP), opcional<input inputMode="numeric" value={power} onChange={(e) => setPower(e.target.value)} /></label>
                    <label>Código de carrocería, opcional<input value={bodyCode} onChange={(e) => setBodyCode(e.target.value)} /></label>
                  </div>
                  {tramiteId === 5 && <div className="row"><label>Color nuevo<input value={color} onChange={(e) => setColor(e.target.value)} /></label></div>}
                  {tramiteId === 6 && <div className="row"><label>Servicio nuevo<select value={serviceType} onChange={(e) => setServiceType(e.target.value)}><option value="">Selecciona…</option>{SERVICE.map((s, i) => <option key={s} value={i + 1}>{s}</option>)}</select></label></div>}
                  {tramiteId === 7 && <div className="row"><label>Número de motor nuevo<input value={engineNumber} onChange={(e) => setEngineNumber(e.target.value)} /></label></div>}
                  {tramiteId === 8 && <div className="row"><label>Número de chasis nuevo<input value={chassisNumber} onChange={(e) => setChassisNumber(e.target.value)} /></label></div>}
                  {tramiteId === 17 && <div className="row"><label>Tipo de carrocería nuevo<input value={bodyType} onChange={(e) => setBodyType(e.target.value)} /></label></div>}
                  {needsCompany && (
                    <div className="row two">
                      <label>Empresa vinculadora<input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} /></label>
                      <label>NIT de la empresa<input value={company.nit} onChange={(e) => setCompany({ ...company, nit: e.target.value })} /></label>
                    </div>
                  )}
                  <div className="row"><label>Observaciones<textarea value={observations} onChange={(e) => setObservations(e.target.value)} /></label></div>
                  <div className="actions">
                    <button onClick={generate} disabled={generating || (tramiteId === 6 && !serviceType)}>{generating ? 'Generando PDF…' : 'Generar formulario'}</button>
                  </div>
                </section>
              </>
            )}
          </div>

          <aside className="preview" aria-label="Formulario">
            <div className="col">
              <h2>4. Formulario</h2>
              {generating && <div className="empty" role="status">Generando el PDF…</div>}
              {!generating && (pdfUrl ? <iframe title="Vista previa del formulario" src={pdfUrl} /> : <div className="empty">Cuando completes los datos, el formulario aparecerá aquí.</div>)}
              {preview && (
                <>
                  <div className="actions"><a href={pdfUrl ?? '#'} download={`formulario-${plate}-${tramiteId}.pdf`}><button className="quiet">Descargar PDF</button></a></div>
                  {preview.overflow.length > 0 && <p className="alert error">No caben en su casilla: {preview.overflow.join(', ')}</p>}
                  {preview.unknownKeys.length > 0 && <p className="alert error">Campos sin coordenadas: {preview.unknownKeys.join(', ')}</p>}
                  <ul className="issues">
                    {preview.issues.filter((i) => i.level !== 'info').map((i, k) => (
                      <li key={k}><span className={`tag ${i.level}`}>{i.level === 'missing' ? 'Falta' : 'Revisar'}</span> {LABELS[i.field] ?? i.field}: {i.note}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </aside>
        </main>
      </div>
    </>
  );
}
