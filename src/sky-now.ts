/* ===== НЕБО СЕЙЧАС: ПЛАНЕТЫ ДЛЯ ЭКРАНА «НЕБО» =====
 *
 * Для карты неба нужны две разные долготы, и это не дублирование:
 *
 *   ra, dec — экваториальные J2000, в той же системе, что и звёзды
 *             справочника (app/sky.json): по ним планета рисуется на небе
 *             и по ним же определяется созвездие, в котором она стоит;
 *   lon     — эклиптическая долгота на дату (тропическая) — по ней знак
 *             зодиака и натальный дом, как во всём остальном приложении.
 *
 * Разница между знаком и созвездием — не ошибка расчёта, а прецессия:
 * точка весеннего равноденствия, от которой отсчитываются знаки, ползёт
 * по небу на 1° за 72 года.
 */

import { eph, constants as c } from './eph.ts';

const BODIES = [
  ['sun', c.SE_SUN], ['moon', c.SE_MOON], ['mercury', c.SE_MERCURY], ['venus', c.SE_VENUS], ['mars', c.SE_MARS],
  ['jupiter', c.SE_JUPITER], ['saturn', c.SE_SATURN], ['uranus', c.SE_URANUS], ['neptune', c.SE_NEPTUNE], ['pluto', c.SE_PLUTO],
] as const;

export type SkyBody = { id: string; ra: number; dec: number; lon: number; speed: number; dist: number };

export function skyNow(ms: number): { jd: number; bodies: SkyBody[] } {
  const jd = ms / 86400000 + 2440587.5;
  const bodies = BODIES.map(([id, ipl]) => {
    const eq = eph().calc_ut(jd, ipl, c.SEFLG_SWIEPH | c.SEFLG_EQUATORIAL | c.SEFLG_J2000);
    const ec = eph().calc_ut(jd, ipl, c.SEFLG_SWIEPH | c.SEFLG_SPEED);
    if (eq.flag < 0 || ec.flag < 0) throw new Error(`${id}: ${eq.error || ec.error}`);
    return { id, ra: eq.data[0], dec: eq.data[1], dist: eq.data[2], lon: ec.data[0], speed: ec.data[3] };
  });
  return { jd, bodies };
}
