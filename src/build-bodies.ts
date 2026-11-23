/* ===== «ЕЩЁ В КОСМОСЕ»: ТАБЛИЦА ПОЛОЖЕНИЙ ДЛЯ ЭКРАНА «НЕБО» =====
 *
 *   node src/build-bodies.ts app/bodies.json [папка-кэш]
 *
 * Кроме планет, на карте неба — карликовые планеты, крупные астероиды,
 * кометы, межзвёздный гость, действующие зонды и радианты метеорных
 * потоков. Планеты телефон считает сам (Swiss Ephemeris), а для этих тел
 * эфемерид в приложении нет, и считать их в телефоне по элементам орбит
 * нельзя: у комет и зондов орбиты меняются (выбросы газа, манёвры).
 *
 * Поэтому положения считаются заранее, здесь, по JPL Horizons
 * (ssd.jpl.nasa.gov, данные NASA — общественное достояние), и
 * зашиваются в приложение таблицей на два года вперёд. Телефон никуда
 * за ними не ходит — интерполирует таблицу. Пересобирать перед релизом:
 * за два года таблица кончится, кометы — уйдут и придут новые.
 *
 * Шаг таблицы у каждого тела свой: суточный там, где тело быстро идёт по
 * небу, и до месяца у далёких карликов — так, чтобы линейная интерполяция
 * ошибалась меньше чем на 0,05° (десятая доля диска Луны). Иначе файл
 * вышел бы в мегабайты.
 *
 * Кометы подбираются сами: из базы малых тел JPL (SBDB) — все, у кого
 * перигелий попадает в окно, затем Horizons считает прогноз блеска, и
 * остаются те, кто в окне ярче 14m (в любительский телескоп) вдали от Солнца. Прогноз блеска комет
 * условен: бывают и вспышки, и разочарования.
 *
 * Координаты — RA/Dec ICRF (= J2000 с точностью до сотых долей секунды),
 * геоцентрические: как у звёзд справочника sky.json.
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [out, cacheDir] = process.argv.slice(2);
if (!out) { console.error('Нужен путь к выходному JSON: node src/build-bodies.ts app/bodies.json [кэш]'); process.exit(2); }

const DAY = 86400000;
const FROM = process.env.FROM ?? new Date().toISOString().slice(0, 10);
const DAYS = 731;                                   // два года
const TO = new Date(Date.parse(FROM) + (DAYS - 1) * DAY).toISOString().slice(0, 10);
const JD0 = Date.parse(FROM) / DAY + 2440587.5;
const TOL = 0.05;                                   // допустимая ошибка интерполяции, °
const STEPS = [1, 2, 3, 4, 5, 7, 10, 15, 20, 30];
const COMET_MAG = 14;                               // комета попадает в таблицу, если ярче
const COMET_SHOW = 15;                              // и хранится, пока ярче этого
const FAST = 3;                                     // °/сут: быстрее — зонд у Земли, таблицей не описать

/* ===== ЦЕЛИ ===== */
type Kind = 'dwarf' | 'asteroid' | 'comet' | 'interstellar' | 'probe';
type Target = { id: string; cmd: string; kind: Kind; ru: string; after?: string };

const FIXED: Target[] = [
  { id: 'ceres',    cmd: '1;',      kind: 'dwarf', ru: 'Церера' },
  { id: 'eris',     cmd: '136199;', kind: 'dwarf', ru: 'Эрида' },
  { id: 'haumea',   cmd: '136108;', kind: 'dwarf', ru: 'Хаумеа' },
  { id: 'makemake', cmd: '136472;', kind: 'dwarf', ru: 'Макемаке' },
  { id: 'sedna',    cmd: '90377;',  kind: 'dwarf', ru: 'Седна' },
  { id: 'vesta',    cmd: '4;',      kind: 'asteroid', ru: 'Веста' },
  { id: 'pallas',   cmd: '2;',      kind: 'asteroid', ru: 'Паллада' },
  { id: 'juno',     cmd: '3;',      kind: 'asteroid', ru: 'Юнона' },
  { id: 'hygiea',   cmd: '10;',     kind: 'asteroid', ru: 'Гигея' },
  { id: 'apophis',  cmd: '99942;',  kind: 'asteroid', ru: 'Апофис' },
  { id: '3i',       cmd: 'DES=C/2025 N1;CAP', kind: 'interstellar', ru: '3I/ATLAS' },
  // зонды: где кончается траектория Horizons, тело уже на месте — дальше его цель
  { id: 'bepicolombo', cmd: '-121', kind: 'probe', ru: 'BepiColombo', after: '199' },
  { id: 'juice',     cmd: '-28',  kind: 'probe', ru: 'Juice' },
  { id: 'clipper',   cmd: '-159', kind: 'probe', ru: 'Europa Clipper' },
  { id: 'lucy',      cmd: '-49',  kind: 'probe', ru: 'Lucy' },
  { id: 'psyche',    cmd: '-255', kind: 'probe', ru: 'Psyche' },
  { id: 'hera',      cmd: '-91',  kind: 'probe', ru: 'Hera', after: '65803;' },
  { id: 'parker',    cmd: '-96',  kind: 'probe', ru: 'Parker' },
  { id: 'jwst',      cmd: '-170', kind: 'probe', ru: 'Джеймс Уэбб' },
  { id: 'newhorizons', cmd: '-98', kind: 'probe', ru: 'New Horizons' },
  { id: 'voyager1',  cmd: '-31',  kind: 'probe', ru: 'Вояджер-1' },
  { id: 'voyager2',  cmd: '-32',  kind: 'probe', ru: 'Вояджер-2' },
];

// русские имена известных комет; новые получают имя из Horizons
const COMET_RU: Record<string, string> = {
  '2P': 'Комета Энке', '19P': 'Комета Боррелли', '22P': 'Комета Копффа', '45P': 'Комета Хонды — Мркоса — Пайдушаковой',
  '96P': 'Комета Махгольца', '255P': 'Комета Леви', '300P': 'Комета Каталина', '332P': 'Комета Икэя — Мураками',
  '2026 C1': 'Комета Цзыцзиньшань', '2025 V2': 'Комета Ранкина', '2026 A2': 'Комета Бока',
};

/* ===== СЕТЬ С КЭШЕМ ===== */
async function get(url: string): Promise<string> {
  const key = cacheDir && `${cacheDir}/${createHash('sha1').update(url).digest('hex')}.txt`;
  if (key && existsSync(key)) return readFileSync(key, 'utf8');
  for (let i = 0; ; i++) {
    const r = await fetch(url);
    if (r.ok) { const t = await r.text(); if (key) { mkdirSync(cacheDir, { recursive: true }); writeFileSync(key, t); } return t; }
    if (i >= 3) throw new Error(`${r.status} ${url}`);
    await new Promise(res => setTimeout(res, 2000 * (i + 1)));
  }
}

type Row = { jd: number; ra: number; dec: number; mag: number | null; au: number; elong: number };

/** Эфемерида Horizons на каждый день окна; дни, которых нет в траектории, — пропуски. */
async function horizons(cmd: string, start = FROM, stop = TO): Promise<{ name: string; rows: Row[] }> {
  const u = new URL('https://ssd.jpl.nasa.gov/api/horizons.api');
  const p: Record<string, string> = { format: 'text', COMMAND: `'${cmd}'`, OBJ_DATA: "'NO'", MAKE_EPHEM: "'YES'", EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'500@399'", START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: "'1d'", QUANTITIES: "'1,9,20,23'",
    CSV_FORMAT: "'YES'", ANG_FORMAT: "'DEG'", EXTRA_PREC: "'NO'" };
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  const t = await get(u.toString());
  const cut = t.match(/No ephemeris for target .* (after|prior to) A\.D\. (\d{4})-([A-Z]{3})-(\d{2})/);
  if (cut) {
    // траектория зонда короче окна: просим то, что есть
    const mon = 'JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ').indexOf(cut[3]) + 1;
    const edge = `${cut[2]}-${String(mon).padStart(2, '0')}-${cut[4]}`;
    if (cut[1] === 'after') return horizons(cmd, start, new Date(Date.parse(edge) - DAY).toISOString().slice(0, 10));
    return horizons(cmd, new Date(Date.parse(edge) + DAY).toISOString().slice(0, 10), stop);
  }
  const name = (t.match(/Target body name: (.*?)\s*\{/) || t.match(/Target body name: (.*)/) || [])[1]?.trim();
  const a = t.indexOf('$$SOE'), b = t.indexOf('$$EOE');
  if (!name || a < 0) throw new Error(`Horizons не понял «${cmd}»: ${t.slice(0, 400)}`);
  const rows = t.slice(a + 5, b).trim().split('\n').map(line => {
    const c = line.split(',').map(s => s.trim());
    const jd = Date.parse(c[0].replace(/^(\d{4})-([A-Za-z]{3})-(\d{2}) (\d\d:\d\d)$/, '$3 $2 $1 $4 UTC')) / DAY + 2440587.5;
    const mag = parseFloat(c[5]);
    return { jd, ra: +c[3], dec: +c[4], mag: Number.isFinite(mag) ? mag : null, au: +c[7], elong: +c[9] };
  });
  return { name, rows };
}

/* ===== КОМЕТЫ: КТО БУДЕТ ЯРКИМ В ОКНЕ ===== */
async function cometCandidates(): Promise<string[]> {
  const u = new URL('https://ssd-api.jpl.nasa.gov/sbdb_query.api');
  u.searchParams.set('fields', 'full_name,pdes,q,tp,per,M1,K1');
  u.searchParams.set('sb-kind', 'c');
  u.searchParams.set('sb-cdata', JSON.stringify({ AND: ['q|LT|3.5'] }));
  const j = JSON.parse(await get(u.toString())) as { data: (string | null)[][] };
  const A = JD0 - 120, B = JD0 + DAYS + 60;         // перигелий чуть раньше окна — комета ещё яркая
  const out: [number, string][] = [];
  for (const [, pdes, q, tp, per, M1, K1] of j.data) {
    if (!pdes || !tp || !M1 || /-[A-Z]/.test(pdes) || /^\d+D$/.test(pdes) || /SOHO/.test(String(pdes))) continue;  // осколки, потерянные, солнечные
    let t = +tp;
    if (per) while (t < A) t += +per;               // в базе — прошлый перигелий периодической кометы
    if (t < A || t > B) continue;
    // грубый лучший случай: Земля в |1−q| а.е.; точный блеск посчитает Horizons
    const m = +M1 + 5 * Math.log10(Math.max(0.1, Math.abs(1 - +q!))) + +(K1 ?? 10) * Math.log10(+q!);
    if (m < COMET_MAG + 3) out.push([m, pdes]);
  }
  return out.sort((a, b) => a[0] - b[0]).map(x => x[1]);
}

/* ===== СЖАТИЕ: СВОЙ ШАГ У КАЖДОГО ТЕЛА ===== */
const unwrap = (rows: Row[]) => { const ra = rows.map(r => r.ra); for (let i = 1; i < ra.length; i++) { while (ra[i] - ra[i - 1] > 180) ra[i] -= 360; while (ra[i - 1] - ra[i] > 180) ra[i] += 360; } return ra; };
function errOf(rows: Row[], ra: number[], step: number): number {
  let worst = 0;
  for (let k = 0; k + step < rows.length; k += step) {
    for (let i = 1; i < step; i++) {
      const f = i / step, r = ra[k] + (ra[k + step] - ra[k]) * f, d = rows[k].dec + (rows[k + step].dec - rows[k].dec) * f;
      const e = Math.hypot((r - ra[k + i]) * Math.cos(rows[k + i].dec * Math.PI / 180), d - rows[k + i].dec);
      if (e > worst) worst = e;
    }
  }
  return worst;
}

type Track = { t0: number; step: number; ra: number[]; dec: number[]; au: number[]; mag?: (number | null)[] };
function pack(rows: Row[]): Track {
  const ra = unwrap(rows);
  let step = 1;
  for (const s of STEPS) if (rows.length > s && errOf(rows, ra, s) < TOL) step = s;
  // узлы — ровно через шаг; дни после последнего узла (меньше шага) отбрасываются
  const keep: number[] = [];
  for (let k = 0; k < rows.length; k += step) keep.push(k);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const t: Track = {
    t0: Math.round(rows[0].jd - JD0), step,
    ra: keep.map(k => r2(((ra[k] % 360) + 360) % 360)), dec: keep.map(k => r2(rows[k].dec)),
    au: keep.map(k => +rows[k].au.toPrecision(4)),
  };
  if (rows.some(r => r.mag !== null)) t.mag = keep.map(k => rows[k].mag === null ? null : Math.round(rows[k].mag! * 10) / 10);
  return t;
}

/** Непрерывные куски по дням: в таблице не должно быть дыр. */
function runs(rows: Row[], ok: (r: Row, i: number) => boolean): Row[][] {
  const out: Row[][] = []; let cur: Row[] = [];
  rows.forEach((r, i) => {
    const contiguous = cur.length && Math.round(r.jd - cur[cur.length - 1].jd) === 1;
    if (ok(r, i) && (contiguous || !cur.length)) cur.push(r);
    else { if (cur.length > 1) out.push(cur); cur = ok(r, i) ? [r] : []; }
  });
  if (cur.length > 1) out.push(cur);
  return out;
}
const speed = (rows: Row[], i: number) => {
  const j = i + 1 < rows.length ? i + 1 : i - 1; if (j < 0) return 0;
  const a = rows[i], b = rows[j];
  return Math.hypot((b.ra - a.ra + 540) % 360 - 180, b.dec - a.dec) / Math.abs(b.jd - a.jd);
};

/* ===== СБОРКА ===== */
type Body = { id: string; kind: Kind; ru: string; name: string; tracks: Track[] };
const bodies: Body[] = [];

for (const t of FIXED) {
  let { name, rows } = await horizons(t.cmd);
  if (t.after && rows.length && rows[rows.length - 1].jd < JD0 + DAYS - 1) {
    // траектория кончилась — зонд у цели: дальше положение цели
    const from = new Date((rows[rows.length - 1].jd + 1 - 2440587.5) * DAY).toISOString().slice(0, 10);
    const rest = await horizons(t.after, from);
    rows = rows.concat(rest.rows.map(r => ({ ...r, mag: null })));
    console.error(`  ${t.ru}: с ${from} — у цели (${rest.name})`);
  }
  if (t.kind === 'probe') rows = rows.map(r => ({ ...r, mag: null }));
  // быстрые пролёты у Земли таблицей не описать — эти дни зонд не показываем
  const tracks = runs(rows, (_, i) => speed(rows, i) < FAST).map(pack);
  bodies.push({ id: t.id, kind: t.kind, ru: t.ru, name, tracks });
  console.error(`${t.ru}: ${tracks.map(x => `${x.ra.length} точек × ${x.step} дн.`).join(', ')}`);
}

const cands = await cometCandidates();
console.error(`кометы: кандидатов ${cands.length}`);
for (const pdes of cands) {
  const cmd = /^\d+P$/.test(pdes) ? `DES=${pdes};CAP;NOFRAG` : `DES=${/^\d{4} /.test(pdes) ? 'C/' + pdes : pdes};CAP`;
  let res;
  try { res = await horizons(cmd); } catch (e) { console.error(`  ${pdes}: ${(e as Error).message.slice(0, 120)}`); continue; }
  const { name, rows } = res;
  const best = Math.min(...rows.filter(r => r.mag !== null && r.elong > 35).map(r => r.mag!));
  if (!(best <= COMET_MAG)) { console.error(`  ${pdes}: не ярче ${best.toFixed(1)}m — мимо`); continue; }
  const tracks = runs(rows, (r, i) => r.mag !== null && r.mag <= COMET_SHOW && speed(rows, i) < FAST).map(pack);
  const id = 'c-' + pdes.toLowerCase().replace(/[^a-z0-9]+/g, '');
  // «Комета Энке (2P)», безымянные — «Комета PANSTARRS (C/2026 O1)»
  const desig = /^\d+P$/.test(pdes) ? pdes : (name.match(/\(([CPI]\/[^)]+)\)/) || [, pdes])[1];
  const ru = `${COMET_RU[pdes] ?? 'Комета ' + name.replace(/\s*\(.*\)$/, '').replace(/^\d+P\//, '')} (${desig})`;
  bodies.push({ id, kind: 'comet', ru, name, tracks });
  console.error(`  ${name}: до ${best.toFixed(1)}m, ${tracks.map(x => `${x.ra.length}×${x.step}`).join(', ')}`);
}

writeFileSync(out, JSON.stringify({
  source: 'JPL Horizons, JPL SBDB (NASA/JPL-Caltech), общественное достояние; RA/Dec ICRF геоцентрические',
  from: FROM, jd0: JD0, days: DAYS, bodies,
}));
console.error(`${out}: тел ${bodies.length}, ${(JSON.stringify(bodies).length / 1024).toFixed(0)} КБ`);
