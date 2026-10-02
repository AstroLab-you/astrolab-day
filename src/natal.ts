/* ===== НАТАЛЬНАЯ КАРТА ПО SWISS EPHEMERIS =====
 *
 * Чистый численный расчёт, без толкований: где стояли планеты в момент
 * рождения, где проходили оси и куспиды домов, какие планеты в аспектах.
 * Толкование и раскладка по жизненным сферам строятся поверх этого.
 *
 * Конвейер:
 *   местное время + пояс → UTC (time.ts)
 *   UTC → юлианская дата UT1 и TT (swe_utc_to_jd: високосные секунды и ΔT)
 *   TT → видимые геоцентрические долготы планет (swe_calc_ut)
 *   UT1 + широта/долгота → звёздное время → ARMC → Асцендент, MC, куспиды
 *   (swe_houses_ex2)
 *   долготы → знаки, дома, аспекты (здесь)
 *
 * Положения — «видимые»: со световым временем, аберрацией, отклонением
 * света и нутацией, на истинный экватор и равноденствие даты. Так считают
 * все астрологические программы, и так же отдаёт JPL Horizons, с которым
 * идёт сверка (validate.ts).
 */

import { eph, constants as c } from './eph.ts';
import { localToUtc, fmtOffset, type LocalBirthTime } from './time.ts';

/* ===== ВХОДНЫЕ ДАННЫЕ ===== */

export type HouseSystem = 'P' | 'K' | 'O' | 'R' | 'C' | 'E' | 'W' | 'B' | 'M' | 'T';

export type NatalInput = {
  birth: LocalBirthTime;
  timeKnown?: boolean;          // false — время неизвестно: карта на полдень, без домов и осей
  place: {
    latitude: number;           // северная +, южная −
    longitude: number;          // восточная +, западная −
    timeZone?: string;          // IANA, например 'Europe/Moscow'
    utcOffset?: number;         // явное смещение в часах, приоритет над timeZone
    name?: string;
  };
  settings?: {
    houseSystem?: HouseSystem;  // по умолчанию Плацидус
    zodiac?: 'tropical' | 'sidereal';
    ayanamsa?: number;          // константа SE_SIDM_*, по умолчанию Лахири
    node?: 'true' | 'mean';     // по умолчанию истинный узел
    orbs?: Partial<Record<AspectName, number>>;
  };
};

/* ===== ВЫХОДНЫЕ ДАННЫЕ ===== */

export type Position = {
  longitude: number;            // эклиптическая долгота, 0–360°
  sign: string;
  signIndex: number;            // 0 = Овен … 11 = Рыбы
  degreeInSign: number;
  formatted: string;            // «14°27′05″ Рыб»
};

export type Body = Position & {
  id: BodyId;
  name: string;
  latitude: number;
  distanceAu: number;
  speed: number;                // °/сутки по долготе
  retrograde: boolean;
  house: number | null;
};

export type Aspect = {
  a: BodyId | AngleId;
  b: BodyId | AngleId;
  type: AspectName;
  exactAngle: number;
  actualAngle: number;
  orb: number;
  applying: boolean | null;     // null — у одной из точек нет скорости (оси)
};

export type NatalChart = {
  input: NatalInput;
  time: {
    local: string;
    utcOffset: string;
    offsetSource: 'tzdb' | 'manual';
    utc: string;
    jdUT: number;
    jdTT: number;
    deltaTSeconds: number;
  };
  settings: { houseSystem: string; zodiac: string; ayanamsa: number | null; node: string };
  bodies: Body[];
  angles: Record<AngleId, Position> | null;
  houses: (Position & { house: number })[] | null;
  aspects: Aspect[];
  meta: { swissEphemeris: string; ephemeris: string; warnings: string[] };
};

/* ===== СПРАВОЧНИКИ ===== */

export const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
const SIGNS_GEN = ['Овна', 'Тельца', 'Близнецов', 'Рака', 'Льва', 'Девы', 'Весов', 'Скорпиона', 'Стрельца', 'Козерога', 'Водолея', 'Рыб'];

export type BodyId = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn'
  | 'uranus' | 'neptune' | 'pluto' | 'northNode' | 'southNode' | 'lilith' | 'chiron';
export type AngleId = 'asc' | 'mc' | 'dsc' | 'ic' | 'vertex';

const BODIES: { id: BodyId; name: string; se: number | 'node' | 'southNode' }[] = [
  { id: 'sun', name: 'Солнце', se: c.SE_SUN },
  { id: 'moon', name: 'Луна', se: c.SE_MOON },
  { id: 'mercury', name: 'Меркурий', se: c.SE_MERCURY },
  { id: 'venus', name: 'Венера', se: c.SE_VENUS },
  { id: 'mars', name: 'Марс', se: c.SE_MARS },
  { id: 'jupiter', name: 'Юпитер', se: c.SE_JUPITER },
  { id: 'saturn', name: 'Сатурн', se: c.SE_SATURN },
  { id: 'uranus', name: 'Уран', se: c.SE_URANUS },
  { id: 'neptune', name: 'Нептун', se: c.SE_NEPTUNE },
  { id: 'pluto', name: 'Плутон', se: c.SE_PLUTO },
  { id: 'northNode', name: 'Северный узел', se: 'node' },
  { id: 'southNode', name: 'Южный узел', se: 'southNode' },
  { id: 'lilith', name: 'Лилит (ср.)', se: c.SE_MEAN_APOG },
  { id: 'chiron', name: 'Хирон', se: c.SE_CHIRON },
];

export const ANGLE_NAMES: Record<AngleId, string> = {
  asc: 'Асцендент', mc: 'MC', dsc: 'Десцендент', ic: 'IC', vertex: 'Вертекс',
};

export type AspectName = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';
export const ASPECTS: { type: AspectName; name: string; angle: number }[] = [
  { type: 'conjunction', name: 'соединение', angle: 0 },
  { type: 'sextile', name: 'секстиль', angle: 60 },
  { type: 'square', name: 'квадрат', angle: 90 },
  { type: 'trine', name: 'трин', angle: 120 },
  { type: 'opposition', name: 'оппозиция', angle: 180 },
];

// Орбисы — не астрономия, а школа. Здесь распространённые значения;
// к Солнцу и Луне добавляется +2°, у фиктивных точек и осей орбис узкий.
const DEFAULT_ORBS: Record<AspectName, number> = {
  conjunction: 8, opposition: 8, trine: 7, square: 7, sextile: 5,
};
const LUMINARY_BONUS = 2;
const POINT_ORB = 3;     // узлы, Лилит, Хирон
const ANGLE_ORB = 5;     // Асцендент, MC

/* ===== ВСПОМОГАТЕЛЬНОЕ ===== */

const norm = (x: number) => ((x % 360) + 360) % 360;

// Градусы обрезаются до секунды, а не округляются: 29°59′59.7″ Овна
// не должно превратиться в 0° Тельца — знак решает больше, чем секунда.
export function position(longitude: number): Position {
  const lon = norm(longitude);
  const signIndex = Math.floor(lon / 30);
  const inSign = lon - signIndex * 30;
  const total = Math.floor(inSign * 3600 + 1e-7);
  const d = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return {
    longitude: lon,
    sign: SIGNS[signIndex],
    signIndex,
    degreeInSign: inSign,
    formatted: `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″ ${SIGNS_GEN[signIndex]}`,
  };
}

// Дом точки — по долготе, между соседними куспидами (как в большинстве
// программ; трёхмерное положение с учётом широты здесь не используется).
export function houseOf(lon: number, cusps: number[]): number {
  for (let i = 0; i < 12; i++) {
    const from = cusps[i], to = cusps[(i + 1) % 12];
    const span = norm(to - from);
    if (norm(lon - from) < span) return i + 1;
  }
  return 12;
}

const HOUSE_NAMES: Record<string, string> = {
  P: 'Плацидус', K: 'Кох', O: 'Порфирий', R: 'Региомонтан', C: 'Кампанус',
  E: 'Равнодомная (от Асц.)', W: 'Целые знаки', B: 'Алькабитий', M: 'Морин', T: 'Топоцентрическая',
};

/* ===== РАСЧЁТ ===== */

export function calculateNatal(input: NatalInput): NatalChart {
  const warnings: string[] = [];
  const timeKnown = input.timeKnown !== false;
  const s = input.settings ?? {};
  const houseSystem = s.houseSystem ?? 'P';
  const sidereal = s.zodiac === 'sidereal';
  const ayanamsa = s.ayanamsa ?? c.SE_SIDM_LAHIRI;
  const nodeKind = s.node ?? 'true';

  const { latitude: lat, longitude: lon } = input.place;
  if (!(lat >= -90 && lat <= 90) || !(lon >= -180 && lon <= 180)) {
    throw new Error(`Координаты вне диапазона: широта ${lat}, долгота ${lon}`);
  }

  // Без времени карта считается на местный полдень: так Луна ошибается
  // не больше чем на ±6.5°, а дома и оси не имеют смысла вовсе.
  const birth: LocalBirthTime = timeKnown ? input.birth : { ...input.birth, hour: 12, minute: 0, second: 0 };
  if (!timeKnown) warnings.push('Время рождения неизвестно: карта на 12:00 местного, дома и оси не считаются, Луна — с точностью ±6.5°.');

  // 1. Местное → UTC
  const tz = localToUtc(birth, input.place.timeZone, input.place.utcOffset);
  warnings.push(...tz.warnings);

  // 2. UTC → юлианские даты. swe_utc_to_jd учитывает високосные секунды
  // (после 1972) и ΔT = TT − UT1 по модели Swiss Ephemeris.
  const u = tz.utc;
  const jd = eph().utc_to_jd(u.year, u.month, u.day, u.hour, u.minute, u.second, c.SE_GREG_CAL);
  if (jd.flag !== c.OK) throw new Error(`swe_utc_to_jd: ${jd.error}`);
  const [jdTT, jdUT] = jd.data;

  // 3. Флаги расчёта
  let flags = c.SEFLG_SWIEPH | c.SEFLG_SPEED;
  if (sidereal) {
    eph().set_sid_mode(ayanamsa, 0, 0);
    flags |= c.SEFLG_SIDEREAL;
  }

  // 4. Дома и оси. Плацидус и Кох не определены за полярным кругом —
  // Swiss Ephemeris тогда возвращает ошибку и куспиды по Порфирию.
  let cusps: number[] | null = null;
  let angles: NatalChart['angles'] = null;
  let houseSystemUsed: string = houseSystem;
  if (timeKnown) {
    const h = eph().houses_ex2(jdUT, sidereal ? c.SEFLG_SIDEREAL : 0, lat, lon, houseSystem);
    if (h.flag !== c.OK) {
      houseSystemUsed = 'O';
      warnings.push(`Система домов «${HOUSE_NAMES[houseSystem] ?? houseSystem}» не определена на широте ${lat}° (полярный круг) — куспиды по Порфирию. ${h.error}`.trim());
    }
    cusps = h.data.houses.slice(0, 12);
    const [asc, mc, , vertex] = h.data.points;
    angles = {
      asc: position(asc), mc: position(mc),
      dsc: position(asc + 180), ic: position(mc + 180),
      vertex: position(vertex),
    };
  }

  // 5. Планеты и точки
  let ephemerisUsed = 'Swiss Ephemeris (сжатая DE441)';
  const bodies: Body[] = [];
  let northNode: { lon: number; lat: number; dist: number; speed: number } | null = null;

  for (const b of BODIES) {
    let lonB: number, latB: number, distB: number, speedB: number;
    if (b.se === 'southNode') {
      if (!northNode) continue;
      lonB = norm(northNode.lon + 180); latB = -northNode.lat; distB = northNode.dist; speedB = northNode.speed;
    } else {
      const ipl = b.se === 'node' ? (nodeKind === 'mean' ? c.SE_MEAN_NODE : c.SE_TRUE_NODE) : b.se;
      const r = eph().calc_ut(jdUT, ipl, flags);
      if (r.flag < 0) {
        // Хирон, например, считается только для 675–4650 гг.
        warnings.push(`${b.name}: не рассчитан — ${r.error}`);
        continue;
      }
      if (r.flag & c.SEFLG_MOSEPH) ephemerisUsed = 'Moshier (аналитическая, файлы эфемерид не найдены)';
      [lonB, latB, distB, speedB] = r.data;
      if (b.se === 'node') northNode = { lon: lonB, lat: latB, dist: distB, speed: speedB };
    }
    bodies.push({
      id: b.id,
      name: b.name + (b.id === 'northNode' ? (nodeKind === 'mean' ? ' (ср.)' : ' (ист.)') : ''),
      ...position(lonB),
      latitude: latB,
      distanceAu: distB,
      speed: speedB,
      retrograde: speedB < 0,
      house: cusps ? houseOf(lonB, cusps) : null,
    });
  }
  if (ephemerisUsed.startsWith('Moshier')) {
    warnings.push('Файлы эфемерид не найдены в ephe/ — расчёт по теории Мошье (~1″). Запустите ./fetch-ephe.sh.');
  }

  // 6. Аспекты
  const aspects = findAspects(bodies, angles, s.orbs);

  const z = (n: number) => String(n).padStart(2, '0');
  const bt = birth;
  return {
    input,
    time: {
      local: `${bt.year}-${z(bt.month)}-${z(bt.day)} ${z(bt.hour)}:${z(bt.minute)}:${z(Math.floor(bt.second ?? 0))}`,
      utcOffset: fmtOffset(tz.offsetSeconds),
      offsetSource: tz.source,
      utc: `${u.year}-${z(u.month)}-${z(u.day)} ${z(u.hour)}:${z(u.minute)}:${u.second.toFixed(3).padStart(6, '0')}`,
      jdUT,
      jdTT,
      deltaTSeconds: (jdTT - jdUT) * 86400,
    },
    settings: {
      houseSystem: timeKnown ? `${houseSystemUsed} — ${HOUSE_NAMES[houseSystemUsed] ?? houseSystemUsed}` : '—',
      zodiac: sidereal ? 'сидерический' : 'тропический',
      ayanamsa: sidereal ? eph().get_ayanamsa_ut(jdUT) : null,
      node: nodeKind === 'mean' ? 'средний' : 'истинный',
    },
    bodies,
    angles,
    houses: cusps ? cusps.map((x, i) => ({ house: i + 1, ...position(x) })) : null,
    aspects,
    meta: { swissEphemeris: eph().version(), ephemeris: ephemerisUsed, warnings },
  };
}

function findAspects(bodies: Body[], angles: NatalChart['angles'], orbsOverride?: Partial<Record<AspectName, number>>): Aspect[] {
  const orbs = { ...DEFAULT_ORBS, ...orbsOverride };
  type P = { id: BodyId | AngleId; lon: number; speed: number | null; kind: 'luminary' | 'planet' | 'point' | 'angle' };
  const pts: P[] = bodies
    .filter(b => b.id !== 'southNode')   // её аспекты зеркальны северному узлу
    .map(b => ({
      id: b.id, lon: b.longitude, speed: b.speed,
      kind: b.id === 'sun' || b.id === 'moon' ? 'luminary'
        : b.id === 'northNode' || b.id === 'lilith' || b.id === 'chiron' ? 'point' : 'planet',
    }));
  if (angles) pts.push({ id: 'asc', lon: angles.asc.longitude, speed: null, kind: 'angle' }, { id: 'mc', lon: angles.mc.longitude, speed: null, kind: 'angle' });

  const orbFor = (p: P, base: number) =>
    p.kind === 'luminary' ? base + LUMINARY_BONUS : p.kind === 'point' ? Math.min(base, POINT_ORB) : p.kind === 'angle' ? Math.min(base, ANGLE_ORB) : base;

  const out: Aspect[] = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const a = pts[i], b = pts[j];
      if (a.kind === 'angle' && b.kind === 'angle') continue;
      const sep = (lonA: number, lonB: number) => { const d = norm(lonA - lonB); return d > 180 ? 360 - d : d; };
      const actual = sep(a.lon, b.lon);
      for (const asp of ASPECTS) {
        // орбис пары — меньший из двух: широкий орбис Солнца не должен
        // «дотягивать» аспект до узкой фиктивной точки
        const orbLimit = Math.min(orbFor(a, orbs[asp.type]), orbFor(b, orbs[asp.type]));
        const orb = Math.abs(actual - asp.angle);
        if (orb > orbLimit) continue;
        // Сходящийся — орбис уменьшается со временем. Смотрим на 0.01 сут. вперёд.
        let applying: boolean | null = null;
        if (a.speed !== null && b.speed !== null) {
          const dt = 0.01;
          const later = Math.abs(sep(a.lon + a.speed * dt, b.lon + b.speed * dt) - asp.angle);
          applying = later < orb;
        }
        out.push({ a: a.id, b: b.id, type: asp.type, exactAngle: asp.angle, actualAngle: actual, orb, applying });
      }
    }
  }
  return out.sort((x, y) => x.orb - y.orb);
}
