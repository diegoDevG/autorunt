# Trámites de Tránsito (SaaS B2B)

Slice 1: dominio, base de datos y cliente Croma. Ver el documento de alcance técnico.

## Interfaz (banco de pruebas)
```
npm install
npm run dev        # http://localhost:3000
```
Pantalla única: eliges el trámite y un vehículo de prueba, consultas (datos simulados por defecto), revisas los datos del RUNT con su nivel de confianza, completas lo manual y generas el formulario con vista previa y descarga. No requiere Supabase ni Croma. Para usar Croma real: `RUNT_SOURCE=croma` y `CROMA_API_KEY` en `.env.local`.

Rutas: `POST /api/lookups` (consulta en dos pasos) y `POST /api/forms/preview` (estampado).

## Contenido
- `supabase/migrations/0001_init.sql`: organizaciones, ledger de créditos (solo inserción), órdenes, consultas, formularios, RLS y funciones (`consume_credit`, `approve_order`, `grant_trial`, `purge_personal_data`).
- `src/lib/croma/`: cliente (200, 202 y polling, caché `X-Cache`) y tipos.
- `src/lib/domain/`: validadores (placa, NIT), separador de nombres, normalizador RUNT a formulario con confianza por campo, configuración de los 18 trámites, precondiciones y servicio de consulta en dos pasos.
- `src/lib/pdf/overlay.ts` y `templates/fun-rna/v1/coordinates.json`: motor de estampado (plantilla **sin calibrar**).
- `scripts/grid.ts`: cuadrícula para calibrar coordenadas.

## Uso
```
npm install
npm test
npm run typecheck
```

## Calibrar el formulario
1. Copia el PDF oficial a `templates/fun-rna/v1/form.pdf` (está en .gitignore).
2. `npm run grid -- templates/fun-rna/v1/form.pdf out/grid.pdf` y mide x, y de cada campo.
3. Completa `coordinates.json` y pon `calibrated: true`.

## Pruebas locales con datos simulados (antes de usar Croma)
`src/mocks/` replica la estructura de las respuestas de Croma con 10 escenarios ficticios (auto, eléctrico con prenda, moto, empresa con NIT, taxi, embargo, blindado e importado, híbrido, motor regrabado, textos largos). `MockRuntPort` cumple el mismo contrato que `CromaClient`, incluida la caché en la segunda llamada idéntica.

```
npm run dev-template   # genera templates/fun-rna/dev/form.pdf desde la imagen del formulario
npm run samples        # out/samples/*.pdf + report.json (un PDF por trámite y escenario de src/mocks/coverage.ts)
npm test               # incluye la matriz de cobertura de los 18 trámites
```
`src/lib/pdf/devLayout.ts` tiene las coordenadas calibradas contra la imagen (1044 x 785). Cuando llegue el PDF oficial se calibra `templates/fun-rna/v1/coordinates.json` (mismas claves; hay una prueba de paridad).

Para pasar de simulado a real: cambiar `MockRuntPort` por `new CromaClient({ apiKey })` en el servicio; el resto no cambia.

## Spike con Croma
Corre los casos de la sección 12 del alcance contra la API real y evalúa sus criterios. Todo lo generado queda en `spike-data/`, fuera de git, porque las respuestas crudas tienen datos personales.

1. Pon `CROMA_API_KEY` en `.env.local`.
2. Copia los casos y llena placas y documentos autorizados por sus propietarios (los casos vacíos se omiten):
   ```
   mkdir -p spike-data && cp scripts/spike/cases.example.json spike-data/cases.json
   ```
3. Revisa el plan, que no llama a Croma, y luego ejecuta por tandas (`--ask-credits` pide los créditos consumidos en el panel en cada caso, no el contador de Requests, que incluye los sondeos):
   ```
   npm run spike
   npm run spike -- --only 1 --yes --ask-credits
   ```

Resultado: `spike-data/report.md` (criterios, valores crudos para los mapeos y contrato observado, sin datos personales), `raw/` (respuestas completas: borrar al terminar) y `fixtures/` (anonimizados, para revisar y mover a `tests/fixtures`). `--wait N` cambia la espera en línea (por defecto 8 s).

### Estado del spike (cerrado con pendientes)
- Medidos: casos 1, 3, 4, 9, 10 y 11 (con caché), más reintentos del caso 3.
- Hallazgos: consulta por placa con NIT sin dígito de verificación devuelve `job_failed` en el caso 3 (cobrado, 10 créditos por intento); un vehículo de empresa llegó con propietario sin nombre; Croma devuelve `"NA"` e `"INDEFINIDO"` como relleno; los fallos (`job_failed`) y los no encontrados cobran 10 créditos.
- Pendientes: casos 2, 5, 6, 7, 8 y 12 a 20 (faltan placas y documentos autorizados); caso 21 no se corre (es una medición repetida, no una consulta nueva); cache duration y condiciones comerciales de Croma por confirmar.

## Pendiente (siguientes slices)
Rutas API (`/api/lookups`, `/api/forms/:id/pdf`), Auth y UI, panel admin, cron de purga, pruebas doradas del PDF.
