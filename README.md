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

## Pendiente (siguientes slices)
Rutas API (`/api/lookups`, `/api/forms/:id/pdf`), Auth y UI, panel admin, cron de purga, pruebas doradas del PDF.
