import { SCENARIOS } from './scenarios';

/** Qué escenarios se estampan para cada trámite (plan de pruebas locales antes de usar Croma). */
export const COVERAGE: Record<number, string[]> = {
  1: ['car-gasoline-clean'],
  2: SCENARIOS.map((s) => s.id),
  3: ['car-gasoline-clean'],
  4: ['car-gasoline-clean'],
  5: ['car-gasoline-clean'],
  6: ['car-gasoline-clean'],
  7: ['restamped-engine'],
  8: ['car-gasoline-clean'],
  9: ['armored-imported'],
  10: ['car-gasoline-clean', 'moto'],
  11: ['car-gasoline-clean'],
  12: ['ev-pledge'],
  13: ['ev-pledge', 'car-gasoline-clean'],
  14: ['car-gasoline-clean'],
  15: ['car-gasoline-clean'],
  16: ['armored-imported'],
  17: ['car-gasoline-clean'],
  18: ['moto'],
};
