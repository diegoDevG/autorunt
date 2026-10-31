import type { BlankArea, Coordinates, CheckboxSpec, FieldSpec } from './overlay';

/**
 * Coordenadas de la plantilla de DESARROLLO (imagen del formulario, 1044 x 785 px = pt).
 * Se escriben en píxeles con origen arriba-izquierda (y = línea base del texto) y se convierten
 * a los puntos de pdf-lib (origen abajo-izquierda). La plantilla oficial tendrá su propio archivo.
 */
export const DEV_PAGE = { width: 1044, height: 785 };
const H = DEV_PAGE.height;

const fields: Record<string, FieldSpec> = {};
const checkboxes: Record<string, CheckboxSpec> = {};
const blankAreas: BlankArea[] = [];
/** Área en píxeles (arriba-izquierda) a dejar en blanco. */
const blank = (x: number, y: number, width: number, height: number) => {
  blankAreas.push({ x, y: H - (y + height), width, height });
};

const text = (key: string, x: number, y: number, maxWidth?: number, size = 8) => {
  fields[key] = { x, y: H - y, size, minSize: 5, ...(maxWidth ? { maxWidth } : {}) };
};
/** (cx, cy) = centro de la casilla o número que se marca con X. */
const mark = (key: string, cx: number, cy: number) => {
  checkboxes[key] = { x: cx - 3, y: H - (cy + 3.5), size: 9 };
};

// 1. Organismo de tránsito: la plantilla trae preimpreso Bogotá / SIM / 11001. Lo diligencia el tránsito
// (instrucción 1), así que se borra el texto preimpreso dentro de las celdas, sin tocar sus líneas.
blank(692, 76, 207, 12); // nombre
blank(642, 106, 68, 17); // ciudad
blank(714, 106, 74, 17); // código

// 2. Placa
text('plate_letters', 938, 116, 32, 9);
text('plate_numbers', 975, 116, 30, 9);

// 3. Trámite (X sobre el número de cada casilla)
const triCols = [42, 116, 193, 268, 344, 419];
const triRows = [165, 199, 232];
for (let i = 0; i < 18; i++) mark(`tramite_${i + 1}`, triCols[i % 6] as number, triRows[Math.floor(i / 6)] as number);

// 4. Clase de vehículo
const row1: [string, number][] = [['automovil', 70], ['bus', 135], ['buseta', 195], ['camion', 255], ['camioneta', 309], ['campero', 370], ['microbus', 440]];
const row2: [string, number][] = [['tractocamion', 75], ['motocicleta', 135], ['motocarro', 195], ['mototriciclo', 255], ['cuatrimoto', 309], ['volqueta', 370], ['otro', 440]];
row1.forEach(([k, cx]) => mark(`class_${k}`, cx, 294));
row2.forEach(([k, cx]) => mark(`class_${k}`, cx, 324));

// 5-6 Marca / Línea, 8 Colores, 9 Modelo, 10 Cilindrada
text('brand', 500, 170, 98);
text('line', 604, 170, 100);
text('color', 500, 209, 320);
text('model_year', 830, 211, 62);
text('displacement', 906, 211, 90);

// 7. Combustible
[734, 772, 807, 843, 879, 917, 952, 987].forEach((cx, i) => mark(`fuel_${i + 1}`, cx, 174));

// 11-14 Capacidad, blindaje, desmonte, potencia
text('capacity', 500, 246, 100);
mark('armored_yes', 685, 222); mark('armored_no', 716, 222);
text('armor_resolution', 608, 247, 110, 6);
mark('desmonte_yes', 867, 222); mark('desmonte_no', 890, 222);
text('power', 910, 246, 90);

// 15. Carrocería
text('body_code', 502, 298, 150);
text('body_type', 502, 336, 150);

// 16. Identificación interna
text('engine_number', 762, 298, 180); mark('restamped_engine_yes', 950, 299); mark('restamped_engine_no', 984, 299);
text('chassis_number', 762, 333, 180); mark('restamped_chassis_yes', 947, 335); mark('restamped_chassis_no', 984, 335);
text('serial_number', 762, 371, 180); mark('restamped_serial_yes', 950, 374); mark('restamped_serial_no', 984, 374);
text('vin', 762, 412, 230);

// 17. Importación o remate
[509, 542, 575, 614, 652, 705].forEach((cx, i) => mark(`import_${i + 1}`, cx, 427));
text('import_number', 503, 470, 88);
text('import_day', 600, 478, 30); text('import_month', 640, 478, 30); text('import_year', 690, 478, 45);

// 18. Tipo de servicio
[770, 805, 841, 877, 916, 970].forEach((cx, i) => mark(`service_${i + 1}`, cx, 491));

// 19. Empresa vinculadora
text('company_name', 762, 545, 165); text('company_nit', 938, 545, 65);

// 20. Datos de alerta
mark('alert_theft', 507, 556); mark('alert_limitation', 557, 556); mark('alert_seizure', 615, 556); mark('alert_other', 652, 556);
text('alert_in_favor_of', 680, 548, 62, 6);

// 21 y 22. Propietario / comprador (el comprador está 189 px más abajo)
const letters = ['C', 'N', 'X', 'P', 'E', 'T', 'U', 'D'];
const letterX = [46, 84, 118, 156, 199, 254, 310, 368];
for (const [prefix, dy] of [['owner', 0], ['buyer', 189]] as const) {
  text(`${prefix}_surname1`, 40, 410 + dy, 125);
  text(`${prefix}_surname2`, 172, 410 + dy, 160);
  text(`${prefix}_names`, 340, 410 + dy, 145);
  letters.forEach((l, i) => mark(`${prefix}_doctype_${l}`, letterX[i] as number, 446 + dy));
  text(`${prefix}_doc_number`, 408, 452 + dy, 75);
  text(`${prefix}_address`, 42, 484 + dy, 205);
  text(`${prefix}_city`, 258, 484 + dy, 140);
  text(`${prefix}_phone`, 412, 484 + dy, 75);
}

// 23. Observaciones
text('obs_1', 504, 627, 495); text('obs_2', 504, 639, 495);
text('obs_prerunt_1', 504, 713, 495, 7); text('obs_prerunt_2', 504, 722, 495, 7);

export const DEV_COORDINATES: Coordinates = {
  templateId: 'fun-rna-dev-png',
  calibrated: true,
  blankAreas,
  fields,
  checkboxes,
};
