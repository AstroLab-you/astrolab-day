/* ===== ЭФЕМЕРИДЫ: ОБЩИЙ ИНТЕРФЕЙС =====
 *
 * Расчёт (natal.ts, forecast.ts) не знает, откуда берётся Swiss Ephemeris:
 * в Node это нативный пакет sweph (eph-node.ts), в телефоне и браузере —
 * тот же C-код, собранный в WebAssembly (eph-wasm.ts). Обе реализации
 * отдают результат в форме пакета sweph, поэтому код расчёта один.
 */

// Нужные константы Swiss Ephemeris (swephexp.h). Свои, а не из пакета
// sweph: тот отдаёт их только вместе с нативным модулем, а в браузере его нет.
export const constants = {
  OK: 0, ERR: -1, SE_GREG_CAL: 1,
  SE_SUN: 0, SE_MOON: 1, SE_MERCURY: 2, SE_VENUS: 3, SE_MARS: 4, SE_JUPITER: 5,
  SE_SATURN: 6, SE_URANUS: 7, SE_NEPTUNE: 8, SE_PLUTO: 9,
  SE_MEAN_NODE: 10, SE_TRUE_NODE: 11, SE_MEAN_APOG: 12, SE_CHIRON: 15,
  SEFLG_SWIEPH: 2, SEFLG_MOSEPH: 4, SEFLG_SPEED: 256, SEFLG_SIDEREAL: 64 * 1024,
  SE_SIDM_LAHIRI: 1,
} as const;

export type CalcResult = { flag: number; error: string; data: number[] };
export type HousesResult = { flag: number; error: string; data: { houses: number[]; points: number[] } };

export interface Ephemeris {
  calc_ut(jdUT: number, ipl: number, flags: number): CalcResult;
  houses_ex2(jdUT: number, flags: number, lat: number, lon: number, hsys: string): HousesResult;
  utc_to_jd(y: number, m: number, d: number, h: number, min: number, sec: number, greg: number): { flag: number; error: string; data: number[] };
  set_sid_mode(mode: number, t0: number, ayanT0: number): void;
  get_ayanamsa_ut(jdUT: number): number;
  version(): string;
}

let impl: Ephemeris | null = null;

export function useEphemeris(e: Ephemeris): void { impl = e; }

export function eph(): Ephemeris {
  if (!impl) throw new Error('Эфемериды не подключены: импортируйте eph-node.ts или вызовите loadWasmEphemeris()');
  return impl;
}
