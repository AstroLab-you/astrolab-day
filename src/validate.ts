/* ===== СВЕРКА РАСЧЁТА С ВНЕШНИМИ ИСТОЧНИКАМИ =====
 *
 *   node src/validate.ts
 *
 * Каждая контрольная карта (cases.ts) сверяется с двумя бесплатными
 * сервисами, и они проверяют разное.
 *
 * 1. astro.com swetest — веб-версия эталонной утилиты от авторов Swiss
 *    Ephemeris. Тот же движок, поэтому расхождение должно быть нулевым.
 *    Проверяет, что мы правильно им пользуемся: юлианская дата, флаги,
 *    система домов, узлы, Лилит, Хирон. Второй прогон — по несжатой
 *    JPL DE441 (-ejplde441.eph) — показывает цену сжатия файлов .se1.
 *
 * 2. JPL Horizons (NASA) — независимый расчёт: свои алгоритмы редукции,
 *    свой ΔT, ничего общего с кодом Swiss Ephemeris. Даёт видимые
 *    эклиптические долготы планет (QUANTITIES=31) и местное звёздное
 *    время (QUANTITIES=7), из которого Асцендент и MC пересчитываются
 *    здесь же по формулам сферической астрономии.
 *
 * Тонкость со шкалой времени: Horizons понимает «UT» как UT1 до 1962 года
 * и как UTC после, а swetest -ut — всегда как UT1. Поэтому Horizons
 * получает момент в UTC, swetest — в UT1; перепутать — значит получить
 * расхождение в DUT1 (до 0.9 с, до 13″ на осях), которого на деле нет.
 *
 * В обоих сервисах сверяется ровно тот момент UT, что посчитали мы:
 * перевод местного времени в UTC — отдельная тема, и смешивать ошибки
 * пояса с ошибками эфемериды нельзя.
 */

import './eph-node.ts';
import { calculateNatal, type BodyId, type NatalChart } from './natal.ts';
import { CASES } from './cases.ts';

/* ===== ДОПУСКИ ===== */
// в угловых секундах
const TOL = {
  swetest: 0.01,        // тот же движок: только округление вывода (7 знаков)
  horizonsPlanet: 1,    // разные редукции и ΔT; на практике доли секунды
  horizonsMoon: 2,      // Луна быстрая: 0.1 с разницы в ΔT ≈ 0.05″
  horizonsAngle: 5,     // наш ε из укороченного ряда нутации
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const arcsec = (a: number, b: number) => { let d = ((a - b) % 360 + 540) % 360 - 180; return d * 3600; };

async function fetchText(url: string): Promise<string> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'astrolab-natal-calc/0.1 (validation)' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url}: ${(e as Error).message}`);
      await sleep(2000 * attempt);
    }
  }
}

/* ===== ASTRO.COM SWETEST ===== */

const SWETEST_NAMES: Record<string, BodyId> = {
  'Sun': 'sun', 'Moon': 'moon', 'Mercury': 'mercury', 'Venus': 'venus', 'Mars': 'mars',
  'Jupiter': 'jupiter', 'Saturn': 'saturn', 'Uranus': 'uranus', 'Neptune': 'neptune', 'Pluto': 'pluto',
  'true Node': 'northNode', 'mean Apogee': 'lilith', 'Chiron': 'chiron',
};

type Ref = { bodies: Partial<Record<BodyId, number>>; houses: number[]; asc?: number; mc?: number };

async function swetest(ch: NatalChart, ephe: '-eswe' | '-ejplde441.eph'): Promise<Ref> {
  const { latitude, longitude } = ch.input.place;
  const params = new URLSearchParams({
    b: '', n: '1', s: '1', p: '0123456789tAD', e: ephe, f: 'Pl',
    arg: `-bj${ch.time.jdUT.toFixed(10)} -ut -house${longitude},${latitude},P`,
  });
  const html = await fetchText(`https://www.astro.com/cgi/swetest.cgi?${params}`);
  const text = html.replace(/<[^>]*>/g, '');
  const ref: Ref = { bodies: {}, houses: [] };
  for (const line of text.split('\n')) {
    const m = line.match(/^(.+?)\s{2,}(-?\d+\.\d+)\s*$/);
    if (!m) continue;
    const name = m[1].trim(), val = Number(m[2]);
    if (SWETEST_NAMES[name]) ref.bodies[SWETEST_NAMES[name]] = val;
    const h = name.match(/^house\s+(\d+)$/);
    if (h) ref.houses[Number(h[1]) - 1] = val;
    if (name === 'Ascendant') ref.asc = val;
    if (name === 'MC') ref.mc = val;
  }
  if (Object.keys(ref.bodies).length < 13) throw new Error(`swetest: разобрано ${Object.keys(ref.bodies).length} тел из 13 — сменился формат ответа?`);
  return ref;
}

/* ===== JPL HORIZONS ===== */

const HORIZONS_IDS: Partial<Record<BodyId, string>> = {
  sun: '10', moon: '301', mercury: '199', venus: '299', mars: '499',
  jupiter: '599', saturn: '699', uranus: '799', neptune: '899', pluto: '999',
};

function horizonsUrl(p: Record<string, string>): string {
  const q = new URLSearchParams({ format: 'text', OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'OBSERVER', CSV_FORMAT: 'YES', TIME_TYPE: 'UT', TLIST_TYPE: 'JD', EXTRA_PREC: 'YES', ...p });
  return `https://ssd.jpl.nasa.gov/api/horizons.api?${q}`;
}

function horizonsRows(text: string): string[][] {
  const body = text.split('$$SOE')[1]?.split('$$EOE')[0];
  if (!body) throw new Error(`Horizons: нет таблицы в ответе\n${text.slice(0, 600)}`);
  return body.trim().split('\n').map(l => l.split(',').map(x => x.trim()).filter(x => x !== ''));
}

// Видимая геоцентрическая долгота на эклиптику даты, все моменты разом
async function horizonsLongitudes(jds: number[]): Promise<Partial<Record<BodyId, number>>[]> {
  const out: Partial<Record<BodyId, number>>[] = jds.map(() => ({}));
  for (const [id, cmd] of Object.entries(HORIZONS_IDS) as [BodyId, string][]) {
    const text = await fetchText(horizonsUrl({
      COMMAND: `'${cmd}'`, CENTER: "'500@399'", QUANTITIES: "'31'",
      TLIST: jds.map(j => `'${j.toFixed(10)}'`).join(' '),
    }));
    const rows = horizonsRows(text);
    if (rows.length !== jds.length) throw new Error(`Horizons ${id}: строк ${rows.length}, ждали ${jds.length}`);
    // Horizons выдаёт строки по возрастанию времени, а не в порядке запроса
    const order = jds.map((_, i) => i).sort((a, b) => jds[a] - jds[b]);
    // в строке: дата, [метки солнца/луны], долгота, широта — берём предпоследнее число
    rows.forEach((r, k) => { out[order[k]][id] = Number(r[r.length - 2]); });
    await sleep(400);
  }
  return out;
}

// Местное видимое звёздное время в точке рождения, часы
async function horizonsLast(jd: number, lat: number, lon: number): Promise<number> {
  const text = await fetchText(horizonsUrl({
    COMMAND: "'10'", CENTER: "'coord@399'", COORD_TYPE: 'GEODETIC', SITE_COORD: `'${lon},${lat},0'`,
    QUANTITIES: "'7'", TLIST: `'${jd.toFixed(10)}'`,
  }));
  const r = horizonsRows(text)[0];
  const hms = r[r.length - 1];
  const [h, m, s] = hms.split(/\s+/).map(Number);
  if ([h, m, s].some(Number.isNaN)) throw new Error(`Horizons LAST: не разобрано «${hms}»`);
  return h + m / 60 + s / 3600;
}

/* ===== АСЦЕНДЕНТ И MC ИЗ ЗВЁЗДНОГО ВРЕМЕНИ =====
 * Независимо от Swiss Ephemeris: истинный наклон эклиптики считается
 * здесь — средний по IAU 2006 плюс нутация по четырём главным членам
 * IAU 1980 (Meeus, гл. 22; остаток ряда ≲ 0.1″).
 */

const rad = Math.PI / 180;

function trueObliquity(jdTT: number): number {
  const T = (jdTT - 2451545.0) / 36525;
  const eps0 = (84381.406 - 46.836769 * T - 0.0001831 * T * T + 0.0020034 * T ** 3) / 3600;
  const omega = (125.04452 - 1934.136261 * T) * rad;
  const Ls = (280.4665 + 36000.7698 * T) * rad;
  const Lm = (218.3165 + 481267.8813 * T) * rad;
  const dEps = (9.20 * Math.cos(omega) + 0.57 * Math.cos(2 * Ls) + 0.10 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * omega)) / 3600;
  return eps0 + dEps;
}

function anglesFromSidereal(lastHours: number, latDeg: number, epsDeg: number) {
  const ramc = lastHours * 15 * rad, phi = latDeg * rad, eps = epsDeg * rad;
  const mc = Math.atan2(Math.sin(ramc), Math.cos(ramc) * Math.cos(eps)) / rad;
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / rad;
  return { asc: (asc + 360) % 360, mc: (mc + 360) % 360 };
}

/* ===== ПРОГОН ===== */

type Row = { label: string; diffs: { what: string; arcsec: number; tol: number }[] };

async function main() {
  const charts = CASES.map(c => ({ label: c.label, chart: calculateNatal(c.input) }));
  const rows: Row[] = [];

  // момент для Horizons: UTC после 1962 года, UT1 до (см. шапку)
  const horizonsJd = (ch: NatalChart) => ch.input.birth.year >= 1962
    ? Date.parse(ch.time.utc.replace(' ', 'T') + 'Z') / 86400_000 + 2440587.5
    : ch.time.jdUT;

  console.log('JPL Horizons: планеты по всем картам…');
  const hz = await horizonsLongitudes(charts.map(c => horizonsJd(c.chart)));

  for (const [i, { label, chart }] of charts.entries()) {
    console.log(`\n■ ${label}\n  местное ${chart.time.local} (UTC${chart.time.utcOffset}) → UTC ${chart.time.utc}, JD UT ${chart.time.jdUT.toFixed(6)}`);
    const row: Row = { label, diffs: [] };
    const our = (id: BodyId) => chart.bodies.find(b => b.id === id)!.longitude;

    // 1. swetest, тот же движок
    const sw = await swetest(chart, '-eswe');
    await sleep(500);
    const de = await swetest(chart, '-ejplde441.eph');
    await sleep(500);
    let maxSw = 0, maxDe = 0, maxHouse = 0;
    for (const [id, v] of Object.entries(sw.bodies) as [BodyId, number][]) {
      const d = arcsec(our(id), v); maxSw = Math.max(maxSw, Math.abs(d));
      row.diffs.push({ what: `swetest ${id}`, arcsec: d, tol: TOL.swetest });
      if (de.bodies[id] !== undefined && id !== 'lilith' && id !== 'northNode') maxDe = Math.max(maxDe, Math.abs(arcsec(our(id), de.bodies[id]!)));
    }
    chart.houses!.forEach((h, k) => {
      const d = arcsec(h.longitude, sw.houses[k]); maxHouse = Math.max(maxHouse, Math.abs(d));
      row.diffs.push({ what: `swetest дом ${k + 1}`, arcsec: d, tol: TOL.swetest });
    });
    console.log(`  swetest (сжатая SE):  тела ≤ ${maxSw.toFixed(4)}″, куспиды ≤ ${maxHouse.toFixed(4)}″`);
    console.log(`  swetest (DE441):      планеты ≤ ${maxDe.toFixed(4)}″ — цена сжатия файлов .se1`);

    // 2. Horizons, независимо
    console.log('  JPL Horizons:');
    const line: string[] = [];
    for (const id of Object.keys(HORIZONS_IDS) as BodyId[]) {
      const d = arcsec(our(id), hz[i][id]!);
      row.diffs.push({ what: `Horizons ${id}`, arcsec: d, tol: id === 'moon' ? TOL.horizonsMoon : TOL.horizonsPlanet });
      line.push(`${id} ${d >= 0 ? '+' : ''}${d.toFixed(2)}″`);
    }
    console.log('    ' + line.slice(0, 5).join('  ') + '\n    ' + line.slice(5).join('  '));

    const last = await horizonsLast(horizonsJd(chart), chart.input.place.latitude, chart.input.place.longitude);
    await sleep(400);
    const ang = anglesFromSidereal(last, chart.input.place.latitude, trueObliquity(chart.time.jdTT));
    const dAsc = arcsec(chart.angles!.asc.longitude, ang.asc), dMc = arcsec(chart.angles!.mc.longitude, ang.mc);
    row.diffs.push({ what: 'Horizons ASC', arcsec: dAsc, tol: TOL.horizonsAngle }, { what: 'Horizons MC', arcsec: dMc, tol: TOL.horizonsAngle });
    console.log(`    ASC ${dAsc.toFixed(2)}″  MC ${dMc.toFixed(2)}″  (по местному звёздному времени ${last.toFixed(6)} ч)`);
    if (chart.meta.warnings.length) console.log(`  ! ${chart.meta.warnings.join('\n  ! ')}`);
    rows.push(row);
  }

  /* ===== ИТОГ ===== */
  console.log('\n===== ИТОГ =====');
  let failed = 0;
  const groups: Record<string, number> = {};
  for (const r of rows) for (const d of r.diffs) {
    const g = d.what.startsWith('swetest дом') ? 'swetest: куспиды'
      : d.what.startsWith('swetest') ? 'swetest: тела'
      : d.what === 'Horizons moon' ? 'Horizons: Луна'
      : d.what.startsWith('Horizons ASC') || d.what.startsWith('Horizons MC') ? 'Horizons: ASC/MC'
      : 'Horizons: планеты';
    groups[g] = Math.max(groups[g] ?? 0, Math.abs(d.arcsec));
    if (Math.abs(d.arcsec) > d.tol) { failed++; console.log(`  ✗ ${r.label}: ${d.what} ${d.arcsec.toFixed(3)}″ > ${d.tol}″`); }
  }
  for (const [g, v] of Object.entries(groups)) console.log(`  ${g.padEnd(20)} макс. расхождение ${v.toFixed(4)}″`);
  console.log(failed ? `\n${failed} проверок за пределами допуска` : `\nВсе ${rows.reduce((n, r) => n + r.diffs.length, 0)} сравнений в пределах допуска`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
