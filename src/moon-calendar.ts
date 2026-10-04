/* ===== ЛУННЫЙ КАЛЕНДАРЬ =====
 *
 * Для шторки «Луна» на экране дня (тап по плашке с Луной):
 *
 *   now    — Луна сейчас: долгота, знак, элонгация от Солнца и доля
 *            освещённого диска;
 *   phases — новолуния, четверти и полнолуния с точным временем, с
 *            пометкой затмения;
 *   voc    — периоды «Луны без курса»: от последнего точного мажорного
 *            аспекта Луны к планетам в знаке до перехода в следующий знак;
 *   days   — дни запрошенного месяца: фаза и знак в местный полдень и
 *            переход Луны в другой знак, если он случился в этот день.
 *
 * Всё — по эфемериде (Swiss Ephemeris), тот же движок, что считает день.
 * Моменты событий ищутся так: функцию «угол минус цель» считаем с шагом
 * в несколько часов, на смене знака — бисекция до ~20 секунд.
 *
 * Затмения — по геометрии в момент новолуния и полнолуния: расстояние
 * между центрами Луны и Солнца (или центра земной тени) сравнивается с
 * суммой видимых радиусов с поправкой на параллакс; тень — по Данжону
 * (+2% на атмосферу). Это «затмение где-то на Земле», а не обязательно
 * видимое из вашего города.
 *
 * Луна без курса считается по аспектам 0°, 60°, 90°, 120°, 180° ко всем
 * планетам от Солнца до Плутона — так в большинстве современных
 * календарей. Традиция берёт только Солнце…Сатурн; это вопрос к астрологу.
 */

import { eph, constants as c } from './eph.ts';
import { localToUtc } from './time.ts';

const DAY = 86_400_000, HOUR = 3_600_000;
const R2D = 180 / Math.PI;
const AU_KM = 149_597_870.7, R_EARTH = 6378.137, R_SUN = 696_000, R_MOON = 1737.4;
const PLANETS = [c.SE_SUN, c.SE_MERCURY, c.SE_VENUS, c.SE_MARS, c.SE_JUPITER, c.SE_SATURN, c.SE_URANUS, c.SE_NEPTUNE, c.SE_PLUTO];
const ASPECT_TARGETS = [0, 60, 90, 120, 180, 240, 270, 300];   // 240…300 — те же аспекты с другой стороны

export type PhaseEvent = { kind: 0 | 1 | 2 | 3; ms: number; eclipse: 'solar' | 'lunar' | 'penumbral' | null };
export type VocPeriod = { from: number; to: number; sign: number };
export type MoonDay = { ymd: string; elong: number; lit: number; sign: number; ingress: { ms: number; sign: number } | null };

const jdOf = (ms: number) => ms / DAY + 2440587.5;
const norm = (x: number) => ((x % 360) + 360) % 360;
const signed = (x: number) => ((x % 360) + 540) % 360 - 180;   // в [−180, 180)

function pos(ms: number, ipl: number) {
  const r = eph().calc_ut(jdOf(ms), ipl, c.SEFLG_SWIEPH | c.SEFLG_SPEED);
  if (r.flag < 0) throw new Error(r.error);
  return { lon: r.data[0], lat: r.data[1], dist: r.data[2] };
}
const moonLon = (ms: number) => pos(ms, c.SE_MOON).lon;
const elongation = (ms: number) => norm(moonLon(ms) - pos(ms, c.SE_SUN).lon);
const litOf = (e: number) => (1 - Math.cos(e / R2D)) / 2;

/** f(a) < 0 ≤ f(b) → момент перехода через ноль, с точностью до 20 секунд */
function root(f: (ms: number) => number, a: number, b: number): number {
  let fa = f(a);
  while (b - a > 20_000) {
    const m = (a + b) / 2, fm = f(m);
    if ((fm < 0) === (fa < 0)) { a = m; fa = fm; } else b = m;
  }
  return (a + b) / 2;
}

/* ===== ФАЗЫ И ЗАТМЕНИЯ ===== Луна относительно Солнца уходит на ~12° в сутки,
   шаг 6 часов (~3°) ни одной фазы не пропустит */
function phases(from: number, to: number): PhaseEvent[] {
  const out: PhaseEvent[] = [];
  let t0 = from, e0 = elongation(t0);
  for (let t = from + 6 * HOUR; t <= to; t += 6 * HOUR) {
    const e1 = elongation(t);
    for (const k of [0, 1, 2, 3] as const) {
      const g0 = signed(e0 - 90 * k), g1 = signed(e1 - 90 * k);
      if (g0 < 0 && g1 >= 0 && g1 - g0 < 90) {
        const ms = root(x => signed(elongation(x) - 90 * k), t0, t);
        out.push({ kind: k, ms, eclipse: k === 0 || k === 2 ? eclipseAt(ms, k) : null });
      }
    }
    t0 = t; e0 = e1;
  }
  return out;
}

function eclipseAt(ms: number, kind: 0 | 2): PhaseEvent['eclipse'] {
  const m = pos(ms, c.SE_MOON), s = pos(ms, c.SE_SUN);
  const dm = m.dist * AU_KM, ds = s.dist * AU_KM;
  const parM = Math.asin(R_EARTH / dm) * R2D, parS = Math.asin(R_EARTH / ds) * R2D;
  const semiM = Math.asin(R_MOON / dm) * R2D, semiS = Math.asin(R_SUN / ds) * R2D;
  if (kind === 0) {
    // солнечное: Луна заходит на диск Солнца хотя бы для кого-то на Земле
    return Math.abs(m.lat - s.lat) < semiS + semiM + parM - parS ? 'solar' : null;
  }
  // лунное: центр тени — точка против Солнца, его широта −β☉
  const sep = Math.abs(m.lat + s.lat);
  const umbra = 1.02 * (parM + parS - semiS), penumbra = 1.02 * (parM + parS + semiS);
  return sep < umbra + semiM ? 'lunar' : sep < penumbra + semiM ? 'penumbral' : null;
}

/* ===== ПЕРЕХОДЫ ЛУНЫ ИЗ ЗНАКА В ЗНАК ===== за 2 часа Луна проходит ~1,1°,
   знак не перескочит */
function ingresses(from: number, to: number) {
  const out: { ms: number; sign: number }[] = [];
  let t0 = from, s0 = Math.floor(moonLon(t0) / 30);
  for (let t = from + 2 * HOUR; t <= to; t += 2 * HOUR) {
    const s1 = Math.floor(moonLon(t) / 30);
    if (s1 !== s0) { const b = s1 * 30; out.push({ ms: root(x => signed(moonLon(x) - b), t0, t), sign: s1 }); }
    t0 = t; s0 = s1;
  }
  return out;
}

/* ===== ЛУНА БЕЗ КУРСА =====
   В каждом знаке ищем последний точный аспект Луны к планетам; от него до
   выхода из знака — «без курса». Луна быстрее любой планеты (даже
   Меркурия), поэтому угол «Луна − планета» только растёт: достаточно
   ловить переходы снизу вверх. */
function vocPeriods(from: number, to: number): VocPeriod[] {
  const ing = ingresses(from - 3 * DAY, to + 3 * DAY);
  const out: VocPeriod[] = [];
  for (let i = 0; i + 1 < ing.length; i++) {
    const a = ing[i].ms, b = ing[i + 1].ms;
    if (b < from || a > to) continue;
    let last = 0;
    for (const ipl of PLANETS) {
      const diff = (ms: number) => norm(moonLon(ms) - pos(ms, ipl).lon);
      let t0 = a, d0 = diff(t0);
      for (let t = Math.min(a + 2 * HOUR, b); ; t = Math.min(t + 2 * HOUR, b)) {
        const d1 = diff(t);
        for (const A of ASPECT_TARGETS) {
          const g0 = signed(d0 - A), g1 = signed(d1 - A);
          if (g0 < 0 && g1 >= 0 && g1 - g0 < 90) last = Math.max(last, root(x => signed(diff(x) - A), t0, t));
        }
        if (t >= b) break;
        t0 = t; d0 = d1;
      }
    }
    out.push({ from: last || a, to: b, sign: ing[i].sign });
  }
  return out;
}

/* ===== МЕСТНОЕ ВРЕМЯ ===== */
const utcOfLocal = (y: number, m: number, d: number, h: number, tz: string) => {
  const u = localToUtc({ year: y, month: m, day: d, hour: h, minute: 0 }, tz).utc;
  return Date.UTC(u.year, u.month - 1, u.day, u.hour, u.minute, u.second);
};
const ymdOf = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function moonCalendar(inp: { ms: number; tz: string; year: number; month: number }) {
  const { ms: now, tz, year, month } = inp;
  const monthStart = utcOfLocal(year, month, 1, 0, tz);
  const nextY = month === 12 ? year + 1 : year, nextM = month === 12 ? 1 : month + 1;
  const monthEnd = utcOfLocal(nextY, nextM, 1, 0, tz);

  const m = pos(now, c.SE_MOON), e = elongation(now);
  const monthIngress = ingresses(monthStart, monthEnd);
  const days: MoonDay[] = [];
  const nDays = Math.round((Date.UTC(nextY, nextM - 1, 1) - Date.UTC(year, month - 1, 1)) / DAY);
  for (let d = 1; d <= nDays; d++) {
    const noon = utcOfLocal(year, month, d, 12, tz);
    const dayStart = utcOfLocal(year, month, d, 0, tz), dayEnd = d === nDays ? monthEnd : utcOfLocal(year, month, d + 1, 0, tz);
    const el = elongation(noon);
    days.push({ ymd: ymdOf(year, month, d), elong: el, lit: litOf(el), sign: Math.floor(moonLon(noon) / 30),
      ingress: monthIngress.find(x => x.ms >= dayStart && x.ms < dayEnd) ?? null });
  }

  return {
    now: { ms: now, lon: m.lon, sign: Math.floor(m.lon / 30), elong: e, lit: litOf(e) },
    phases: phases(Math.min(monthStart, now) - DAY, Math.max(monthEnd, now + 40 * DAY)),
    voc: vocPeriods(now - DAY, now + 9 * DAY),
    days,
  };
}
