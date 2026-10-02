/* ===== КАРТА ИЗ КОМАНДНОЙ СТРОКИ =====
 *
 *   node src/cli.ts --date 1990-05-14 --time 14:30 \
 *     --lat 55.7558 --lon 37.6173 --tz Europe/Moscow [--json]
 *
 * Необязательные: --offset 3 (вместо --tz), --house K, --sidereal,
 * --mean-node, --no-time (время неизвестно).
 *
 * Отрицательные значения — только через «=»: --lon=-0.1278, --offset=-5.
 * Иначе parseArgs примет «-0.1278» за отдельный флаг.
 */

import './eph-node.ts';
import { parseArgs } from 'node:util';
import { calculateNatal, ASPECTS, ANGLE_NAMES, type HouseSystem, type NatalChart } from './natal.ts';

const { values: v } = parseArgs({
  options: {
    date: { type: 'string' },
    time: { type: 'string', default: '12:00' },
    lat: { type: 'string' },
    lon: { type: 'string' },
    tz: { type: 'string' },
    offset: { type: 'string' },
    house: { type: 'string', default: 'P' },
    sidereal: { type: 'boolean', default: false },
    'mean-node': { type: 'boolean', default: false },
    'no-time': { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

if (!v.date || v.lat === undefined || v.lon === undefined || (!v.tz && v.offset === undefined)) {
  console.error('Нужны --date ГГГГ-ММ-ДД, --lat, --lon и --tz (IANA) или --offset (часы). См. шапку src/cli.ts.');
  process.exit(2);
}

const [year, month, day] = v.date.split('-').map(Number);
const [hour, minute, second = 0] = v.time.split(':').map(Number);

const chart = calculateNatal({
  birth: { year, month, day, hour, minute, second },
  timeKnown: !v['no-time'],
  place: { latitude: Number(v.lat), longitude: Number(v.lon), timeZone: v.tz, utcOffset: v.offset !== undefined ? Number(v.offset) : undefined },
  settings: {
    houseSystem: v.house as HouseSystem,
    zodiac: v.sidereal ? 'sidereal' : 'tropical',
    node: v['mean-node'] ? 'mean' : 'true',
  },
});

if (v.json) {
  console.log(JSON.stringify(chart, null, 2));
} else {
  printChart(chart);
}

function printChart(ch: NatalChart) {
  const t = ch.time;
  console.log(`Местное время  ${t.local}  (UTC${t.utcOffset}, ${t.offsetSource === 'tzdb' ? 'по tzdb' : 'задано вручную'})`);
  console.log(`UTC            ${t.utc}`);
  console.log(`JD (UT1 / TT)  ${t.jdUT.toFixed(6)} / ${t.jdTT.toFixed(6)}   ΔT = ${t.deltaTSeconds.toFixed(2)} с`);
  console.log(`Настройки      дома: ${ch.settings.houseSystem}; зодиак: ${ch.settings.zodiac}; узел: ${ch.settings.node}`);
  console.log(`Эфемерида      ${ch.meta.ephemeris}, Swiss Ephemeris ${ch.meta.swissEphemeris}\n`);

  console.log('Планеты и точки');
  for (const b of ch.bodies) {
    console.log(`  ${b.name.padEnd(20)} ${b.longitude.toFixed(6).padStart(11)}°  ${b.formatted.padEnd(22)} ${b.retrograde ? 'R' : ' '}  ${b.house ? 'дом ' + String(b.house).padStart(2) : ''}`);
  }
  if (ch.angles) {
    console.log('\nОси');
    for (const [id, p] of Object.entries(ch.angles)) {
      console.log(`  ${ANGLE_NAMES[id as keyof typeof ANGLE_NAMES].padEnd(20)} ${p.longitude.toFixed(6).padStart(11)}°  ${p.formatted}`);
    }
  }
  if (ch.houses) {
    console.log('\nКуспиды домов');
    for (const h of ch.houses) console.log(`  ${String(h.house).padStart(2)}  ${h.longitude.toFixed(6).padStart(11)}°  ${h.formatted}`);
  }
  const nameOf = (id: string) => ch.bodies.find(b => b.id === id)?.name ?? ANGLE_NAMES[id as keyof typeof ANGLE_NAMES] ?? id;
  console.log('\nАспекты (по точности)');
  for (const a of ch.aspects) {
    const asp = ASPECTS.find(x => x.type === a.type)!;
    const dir = a.applying === null ? '' : a.applying ? 'сходящийся' : 'расходящийся';
    console.log(`  ${nameOf(a.a).padEnd(20)} ${asp.name.padEnd(11)} ${nameOf(a.b).padEnd(20)} орбис ${a.orb.toFixed(2).padStart(5)}°  ${dir}`);
  }
  if (ch.meta.warnings.length) {
    console.log('\nПредупреждения');
    for (const w of ch.meta.warnings) console.log(`  ! ${w}`);
  }
}
