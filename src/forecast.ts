/* ===== ПРОГНОЗ НА ДЕНЬ: ТРАНЗИТЫ К НАТАЛЬНОЙ КАРТЕ =====
 *
 * buildForecast() — чистая функция без файлов и аргументов командной
 * строки: её вызывают и CLI (day.ts, в Node), и приложение в телефоне
 * (через WebAssembly). Эфемериды подключает вызывающий — см. eph.ts.
 *
 * Считает семь дней — сегодня и шесть предыдущих (вперёд не показываем) —
 * по правилам из документа «Методика натального профиля», разделы
 * «Транзиты» и «Полоса сферы на день». Все числа ниже — те же, что там;
 * пока астролог их не утвердил, это черновые значения.
 *
 * Шаги:
 *   1. натальная карта — как в cli.ts;
 *   2. на 12:00 местного времени каждого дня — положения 10 планет;
 *      Луна — по часам за весь день (за сутки она проходит ~13°);
 *   3. контакты: аспект транзитной планеты к натальной точке в пределах
 *      орбиса; сила K = w_тр · w_нат · (1 − орбис/макс) · (1 или 0.7);
 *   4. сферы: контакт засчитывается сфере, если натальная точка —
 *      управитель её дома или планета-показатель; Луна в доме добавляет
 *      силу без тона; сила полосы — процентиль среди 365 своих дней;
 *   5. для причин дня — до какого момента контакт держится.
 *
 * Время каждого шага возвращается в generated.ms, а onStep сообщает
 * о каждом законченном шаге: расчёт потом будет анимирован, и важно
 * понимать, сколько он длится на самом деле.
 */

import { eph, constants as c } from './eph.ts';
import { calculateNatal, position, houseOf, type NatalChart, type NatalInput } from './natal.ts';
import { localToUtc } from './time.ts';

export type ForecastInput = {
  natal: NatalInput;
  nowTz: string;         // пояс, в котором живёт «сегодня» пользователя
  today?: string;        // ГГГГ-ММ-ДД; по умолчанию — сегодня в nowTz
  title?: string;
  place?: string;
  onStep?: (step: 'natal' | 'distribution365' | 'days7_with_until', ms: number) => void;
};

/* ===== СПРАВОЧНИКИ (из документа методики) ===== */

type P = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto';
type N = P | 'asc' | 'mc';
type AspectType = 'conjunction' | 'sextile' | 'square' | 'trine' | 'opposition';

const PLANETS: P[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
const IPL: Record<P, number> = {
  sun: c.SE_SUN, moon: c.SE_MOON, mercury: c.SE_MERCURY, venus: c.SE_VENUS, mars: c.SE_MARS,
  jupiter: c.SE_JUPITER, saturn: c.SE_SATURN, uranus: c.SE_URANUS, neptune: c.SE_NEPTUNE, pluto: c.SE_PLUTO,
};
const ASPECTS: [AspectType, number][] = [['conjunction', 0], ['sextile', 60], ['square', 90], ['trine', 120], ['opposition', 180]];

// транзитная планета: орбис, вес
const T_ORB: Record<P, number> = { moon: 3, mars: 2, sun: 2, mercury: 2, venus: 2, saturn: 1.5, jupiter: 1.5, uranus: 1, neptune: 1, pluto: 1 };
const T_W: Record<P, number> = { moon: 1, mars: 1, sun: 0.8, mercury: 0.8, venus: 0.8, saturn: 0.8, jupiter: 0.6, uranus: 0.4, neptune: 0.4, pluto: 0.4 };
// натальная точка: вес
const N_W: Record<N, number> = { sun: 1, moon: 1, asc: 1, mc: 1, mercury: 0.8, venus: 0.8, mars: 0.8, jupiter: 0.6, saturn: 0.6, uranus: 0.3, neptune: 0.3, pluto: 0.3 };
const FAST = new Set<P>(['moon', 'sun', 'mercury', 'venus', 'mars']);

// традиционные управители знаков (решение 1)
const RULER: P[] = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];

// сферы: главный дом, дополнительный, планеты-показатели (решение 5)
const SPHERES: { id: string; name: string; main: number; sec: number; sig: P[]; about: string }[] = [
  { id: 'love', name: 'Отношения', main: 7, sec: 5, sig: ['venus'], about: 'Партнёрство, романы, то, как вы сближаетесь с людьми.' },
  { id: 'career', name: 'Карьера', main: 10, sec: 6, sig: ['sun', 'saturn'], about: 'Работа, статус, то, как вас видят в профессии.' },
  { id: 'money', name: 'Деньги', main: 2, sec: 8, sig: ['jupiter', 'venus'], about: 'Доходы, траты, ощущение опоры и ресурсов.' },
  { id: 'health', name: 'Здоровье и энергия', main: 6, sec: 1, sig: ['sun', 'mars'], about: 'Силы, режим, самочувствие.' },
  { id: 'inner', name: 'Внутренний мир', main: 12, sec: 4, sig: ['moon'], about: 'Настроение, чувства, то, что происходит внутри.' },
  { id: 'family', name: 'Семья и дом', main: 4, sec: 10, sig: ['moon'], about: 'Дом, родные, чувство корней.' },
  { id: 'talk', name: 'Общение и учёба', main: 3, sec: 9, sig: ['mercury'], about: 'Разговоры, переписка, поездки, новое знание.' },
];

/* ===== ТЕКСТЫ (черновые шаблоны из вкладки «Словарь») ===== */

const NAME: Record<P, string> = { sun: 'Солнце', moon: 'Луна', mercury: 'Меркурий', venus: 'Венера', mars: 'Марс', jupiter: 'Юпитер', saturn: 'Сатурн', uranus: 'Уран', neptune: 'Нептун', pluto: 'Плутон' };
// «к вашему Солнцу», «с вашим Солнцем»
const DAT: Record<N, string> = { sun: 'вашему Солнцу', moon: 'вашей Луне', mercury: 'вашему Меркурию', venus: 'вашей Венере', mars: 'вашему Марсу', jupiter: 'вашему Юпитеру', saturn: 'вашему Сатурну', uranus: 'вашему Урану', neptune: 'вашему Нептуну', pluto: 'вашему Плутону', asc: 'вашему Асценденту', mc: 'вашему MC' };
const INS: Record<N, string> = { sun: 'вашим Солнцем', moon: 'вашей Луной', mercury: 'вашим Меркурием', venus: 'вашей Венерой', mars: 'вашим Марсом', jupiter: 'вашим Юпитером', saturn: 'вашим Сатурном', uranus: 'вашим Ураном', neptune: 'вашим Нептуном', pluto: 'вашим Плутоном', asc: 'вашим Асцендентом', mc: 'вашим MC' };
const ASP_PHRASE: Record<AspectType, string> = { conjunction: 'в соединении с', sextile: 'в секстиле к', square: 'в квадрате к', trine: 'в трине к', opposition: 'в оппозиции к' };
// что приносит транзитная планета: [поддерживает, мешает, нейтрально]
const EFFECT: Record<P, [string, string, string]> = {
  sun: ['уверенность и признание', 'давление на самолюбие', 'больше внимания к себе'],
  moon: ['лёгкое настроение', 'раздражительность', 'обострённые чувства'],
  mercury: ['ясные разговоры и договорённости', 'путаница в словах и планах', 'много мыслей и переписки'],
  venus: ['тепло и лёгкость', 'мелкие обиды и лишние траты', 'тепло и лёгкость'],
  mars: ['энергия и решительность', 'спешка и споры', 'спешка и споры'],
  jupiter: ['удача и новые возможности', 'лишние обещания и перебор', 'удача и новые возможности'],
  saturn: ['устойчивость и порядок', 'больше ответственности, меньше признания', 'больше ответственности, меньше признания'],
  uranus: ['приятные неожиданности', 'внезапные перемены планов', 'неожиданные повороты'],
  neptune: ['вдохновение и чуткость', 'туман и усталость', 'мечтательность'],
  pluto: ['сила менять глубоко', 'борьба за контроль', 'сильные чувства'],
};
// чего касается натальная точка
const AREA: Record<N, string> = {
  sun: 'в самоощущении', moon: 'в настроении и с близкими', mercury: 'в общении и делах', venus: 'в отношениях и деньгах',
  mars: 'в делах, где нужен напор', jupiter: 'в планах на рост', saturn: 'в работе и обязательствах', uranus: 'в жажде перемен',
  neptune: 'в мечтах и творчестве', pluto: 'в глубоких переживаниях', asc: 'в том, как вас воспринимают', mc: 'в карьере и репутации',
};
// совет по дому, через который идёт Луна
const MOON_HOUSE: string[] = [
  '', 'на первом плане вы сами: хорошо начинать своё и показываться людям.',
  'день для денег и вещей: посчитать, купить нужное, отложить лишнее.',
  'много разговоров и мелких дел: хорошо договариваться и писать.',
  'тянет домой: побыть с родными, навести порядок у себя.',
  'время для радости: свидание, хобби, творчество.',
  'день будней: разобрать дела, позаботиться о режиме и здоровье.',
  'всё решается через других: партнёр, переговоры, совместные дела.',
  'день для того, чтобы разобраться с общими деньгами и тем, что давно откладывали.',
  'тянет к новому — дороге, книгам, планам.',
  'на виду работа и репутация: хорошо показать результат.',
  'день для друзей и единомышленников: встречи, общие планы.',
  'время тишины: отдохнуть, выспаться, побыть одному.',
];
const SIGN_IN = ['Овне', 'Тельце', 'Близнецах', 'Раке', 'Льве', 'Деве', 'Весах', 'Скорпионе', 'Стрельце', 'Козероге', 'Водолее', 'Рыбах'];
const SIGN_NOM = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];
const MONTH_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/* ===== АСТРОНОМИЯ ===== */

const norm = (x: number) => ((x % 360) + 360) % 360;
const sep = (a: number, b: number) => { const d = norm(a - b); return d > 180 ? 360 - d : d; };
const jdOfMs = (ms: number) => ms / 86400000 + 2440587.5;
const msOfJd = (jd: number) => (jd - 2440587.5) * 86400000;

function planet(jd: number, p: P) {
  const r = eph().calc_ut(jd, IPL[p], c.SEFLG_SWIEPH | c.SEFLG_SPEED);
  if (r.flag < 0) throw new Error(`${p}: ${r.error}`);
  return { lon: r.data[0], speed: r.data[3] };
}

// полдень местного времени дня ymd в поясе nowTz → юлианская дата UT

export function buildForecast(inp: ForecastInput) {
  const nowTz = inp.nowTz;
  const t0 = performance.now();
  const timing: Record<string, number> = {};
  const lap = (name: 'natal' | 'distribution365' | 'days7_with_until', from: number) => {
    timing[name] = Math.round((performance.now() - from) * 10) / 10;
    inp.onStep?.(name, timing[name]);
  };

  function noonJd(ymd: string): number {
    const [y, m, d] = ymd.split('-').map(Number);
    const u = localToUtc({ year: y, month: m, day: d, hour: 12, minute: 0 }, nowTz).utc;
    return jdOfMs(Date.UTC(u.year, u.month - 1, u.day, u.hour, u.minute, u.second));
  }

  function localParts(ms: number) {
    const f = new Intl.DateTimeFormat('en-CA', { timeZone: nowTz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const o: Record<string, string> = {};
    for (const x of f.formatToParts(new Date(ms))) o[x.type] = x.value;
    return { ymd: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour}:${o.minute}`, y: +o.year, m: +o.month, d: +o.day };
  }

  /* ===== 1. НАТАЛЬНАЯ КАРТА ===== */

  let t = performance.now();
  const natal: NatalChart = calculateNatal(inp.natal);
  if (!natal.houses || !natal.angles) throw new Error('Для прогноза нужно время рождения: без домов сферы не считаются');
  const cusps = natal.houses.map(h => h.longitude);
  const natalLon: Record<N, number> = { asc: natal.angles.asc.longitude, mc: natal.angles.mc.longitude } as Record<N, number>;
  for (const p of PLANETS) natalLon[p] = natal.bodies.find(b => b.id === p)!.longitude;
  const NATAL_POINTS = Object.keys(natalLon) as N[];

  // вес натальной точки в каждой сфере: управитель главного дома — 1,
  // управитель дополнительного или показатель — 0.5; Асцендент и MC —
  // это сами куспиды 1-го и 10-го домов
  const sphereWeight: Record<string, Partial<Record<N, number>>> = {};
  for (const s of SPHERES) {
    const w: Partial<Record<N, number>> = {};
    const put = (n: N, x: number) => { w[n] = Math.max(w[n] ?? 0, x); };
    put(RULER[natal.houses[s.main - 1].signIndex], 1);
    put(RULER[natal.houses[s.sec - 1].signIndex], 0.5);
    for (const p of s.sig) put(p, 0.5);
    if (s.main === 1) put('asc', 1); if (s.sec === 1) put('asc', 0.5);
    if (s.main === 10) put('mc', 1); if (s.sec === 10) put('mc', 0.5);
    sphereWeight[s.id] = w;
  }
  lap('natal', t);

  /* ===== 2–4. КОНТАКТЫ И СФЕРЫ НА МОМЕНТ ===== */

  type Contact = { transit: P; natal: N; aspect: AspectType; orb: number; applying: boolean; tone: number; k: number; jd?: number };

  function toneOf(p: P, a: AspectType): number {
    if (a === 'trine' || a === 'sextile') return 1;
    if (a === 'square' || a === 'opposition') return -1;
    return p === 'venus' || p === 'jupiter' ? 1 : p === 'mars' || p === 'saturn' ? -1 : 0;
  }

  function skyAt(jd: number) {
    const pos = {} as Record<P, { lon: number; speed: number }>;
    for (const p of PLANETS) pos[p] = planet(jd, p);
    return pos;
  }

  function contactsAt(pos: Record<P, { lon: number; speed: number }>, skip?: P): Contact[] {
    const out: Contact[] = [];
    for (const p of PLANETS) {
      if (p === skip) continue;
      const { lon, speed } = pos[p];
      for (const n of NATAL_POINTS) {
        const s = sep(lon, natalLon[n]);
        for (const [a, ang] of ASPECTS) {
          const orb = Math.abs(s - ang);
          if (orb > T_ORB[p]) continue;
          const later = Math.abs(sep(lon + speed * 0.01, natalLon[n]) - ang);
          const applying = later < orb;
          const k = T_W[p] * N_W[n] * (1 - orb / T_ORB[p]) * (applying ? 1 : 0.7);
          out.push({ transit: p, natal: n, aspect: a, orb, applying, tone: toneOf(p, a), k });
        }
      }
    }
    return out.sort((x, y) => y.k - x.k);
  }

  // Луна за сутки проходит ~13°, и снимок в полдень пропускает её аспекты
  // утром и вечером — отсюда пустые полосы в тихие дни. Поэтому Луна
  // считается по часам за весь местный день: аспект засчитывается, если
  // был хоть в какой-то час, а сила — по самому точному часу. Остальные
  // планеты за сутки сдвигаются на градус-два — для них хватает полудня.
  function moonContactsOverDay(jdNoon: number): Contact[] {
    const best = new Map<string, Contact>();
    for (let h = -12; h < 12; h++) {
      const jd = jdNoon + h / 24;
      const { lon, speed } = planet(jd, 'moon');
      for (const n of NATAL_POINTS) {
        const s = sep(lon, natalLon[n]);
        for (const [a, ang] of ASPECTS) {
          const orb = Math.abs(s - ang);
          if (orb > T_ORB.moon) continue;
          const key = n + a, prev = best.get(key);
          if (prev && prev.orb <= orb) continue;
          const applying = Math.abs(sep(lon + speed * 0.01, natalLon[n]) - ang) < orb;
          const k = T_W.moon * N_W[n] * (1 - orb / T_ORB.moon) * (applying ? 1 : 0.7);
          best.set(key, { transit: 'moon', natal: n, aspect: a, orb, applying, tone: toneOf('moon', a), k, jd });
        }
      }
    }
    return [...best.values()];
  }

  function dayContacts(jdNoon: number, pos: Record<P, { lon: number; speed: number }>): Contact[] {
    return [...contactsAt(pos, 'moon'), ...moonContactsOverDay(jdNoon)].sort((x, y) => y.k - x.k);
  }

  function spheresAt(pos: Record<P, { lon: number; speed: number }>, contacts: Contact[]) {
    const moonHouse = houseOf(pos.moon.lon, cusps);
    return SPHERES.map(s => {
      let S = 0, toned = 0;
      const own: (Contact & { kw: number })[] = [];
      for (const ct of contacts) {
        const w = sphereWeight[s.id][ct.natal];
        if (!w) continue;
        const kw = ct.k * w;
        S += kw; toned += ct.tone * kw;
        own.push({ ...ct, kw });
      }
      // Луна в доме сферы: сила без тона
      if (moonHouse === s.main) S += 0.5; else if (moonHouse === s.sec) S += 0.25;
      return { id: s.id, S, tone: S ? toned / S : 0, own: own.sort((a, b) => b.kw - a.kw) };
    });
  }

  /* ===== 5. ДО КАКОГО МОМЕНТА ДЕРЖИТСЯ КОНТАКТ ===== */

  function untilMs(ct: Contact, jd0: number): number | null {
    const ang = ASPECTS.find(a => a[0] === ct.aspect)![1];
    const inside = (jd: number) => Math.abs(sep(planet(jd, ct.transit).lon, natalLon[ct.natal]) - ang) <= T_ORB[ct.transit];
    // шаг под скорость планеты; предел поиска — два года
    const step = ct.transit === 'moon' ? 1 / 24 : FAST.has(ct.transit) ? 0.5 : 4;
    let a = jd0, b = jd0 + step;
    for (let i = 0; i < 730 / step && inside(b); i++) { a = b; b += step; }
    if (inside(b)) return null;
    for (let i = 0; i < 24; i++) { const m = (a + b) / 2; if (inside(m)) a = m; else b = m; }
    return msOfJd(a);
  }

  function untilText(ms: number | null, dayYmd: string, p: P): string {
    if (ms === null) return 'надолго';
    const l = localParts(ms);
    const sameYear = l.y === +dayYmd.slice(0, 4);
    const date = `${l.d} ${MONTH_GEN[l.m - 1]}${sameYear ? '' : ' ' + l.y}`;
    // кончается в тот же день — важнее время; Луна — всегда со временем
    if (l.ymd === dayYmd) return `до ${l.hm}`;
    return p === 'moon' ? `до ${date}, ${l.hm}` : `до ${date}`;
  }

  // Только смысл: «Лёгкое настроение в работе и обязательствах.» Кто к кому
  // и каким аспектом — видно по значкам строки и подсветке на колесе, в
  // тексте это лишний для неастролога слой. Полная фраза — в aria-label.
  function textOf(ct: Contact): string {
    const eff = EFFECT[ct.transit][ct.tone > 0 ? 0 : ct.tone < 0 ? 1 : 2];
    // планета к самой себе: «в настроении» после «настроение» звучит дважды
    const area = ct.transit === ct.natal ? '' : ' ' + AREA[ct.natal];
    return `${eff[0].toUpperCase()}${eff.slice(1)}${area}.`;
  }

  // «Луна в трине к вашему Сатурну» — для экранного диктора
  function labelOf(ct: Contact): string {
    const target = ct.aspect === 'conjunction' ? INS[ct.natal] : DAT[ct.natal];
    return `${NAME[ct.transit]} ${ASP_PHRASE[ct.aspect]} ${target}`;
  }

  function moonPhase(sun: number, moon: number): string {
    const e = norm(moon - sun);
    return e < 22.5 || e >= 337.5 ? 'новолуние' : e < 67.5 ? 'растущий серп' : e < 112.5 ? 'первая четверть'
      : e < 157.5 ? 'растущая' : e < 202.5 ? 'полнолуние' : e < 247.5 ? 'убывающая' : e < 292.5 ? 'последняя четверть' : 'убывающий серп';
  }

  /* ===== ДНИ ===== */

  const todayYmd = inp.today ?? localParts(Date.now()).ymd;
  const addDays = (ymd: string, n: number) => {
    const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // распределение силы по 365 своим дням вокруг сегодня — для процентилей
  t = performance.now();
  const dist: Record<string, number[]> = Object.fromEntries(SPHERES.map(s => [s.id, [] as number[]]));
  for (let i = -182; i <= 182; i++) {
    const jd = noonJd(addDays(todayYmd, i));
    const pos = skyAt(jd);
    for (const sp of spheresAt(pos, dayContacts(jd, pos))) dist[sp.id].push(sp.S);
  }
  for (const k in dist) dist[k].sort((a, b) => a - b);
  // Процентиль «по середине группы»: если у человека 15% дней без влияний
  // на сферу, такой день получает ~7, а не 0 — пустая полоса читается как
  // ошибка, а это просто тихий день
  const bound = (a: number[], S: number, strict: boolean) => {
    let lo = 0, hi = a.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (strict ? a[m] < S : a[m] <= S) lo = m + 1; else hi = m; }
    return lo;
  };
  const percentile = (id: string, S: number) => {
    const a = dist[id], below = bound(a, S, true), same = bound(a, S, false) - below;
    return Math.max(1, Math.round((below + same / 2) / a.length * 100));
  };
  lap('distribution365', t);

  t = performance.now();
  let untilCalls = 0;
  const days = [];
  for (let i = -6; i <= 0; i++) {
    const ymd = addDays(todayYmd, i);
    const jd = noonJd(ymd);
    const pos = skyAt(jd);
    const contacts = dayContacts(jd, pos);
    const moonHouse = houseOf(pos.moon.lon, cusps);
    const moonSign = Math.floor(norm(pos.moon.lon) / 30);
    const spheres = spheresAt(pos, contacts).map(sp => {
      const def = SPHERES.find(s => s.id === sp.id)!;
      const drivers = sp.own.slice(0, 3).map(ct => {
        untilCalls++;
        return {
          transit: ct.transit, aspect: ct.aspect, natal: ct.natal, tone: ct.tone,
          speed: FAST.has(ct.transit) ? 'fast' : 'slow',
          until: untilText(untilMs(ct, ct.jd ?? jd), ymd, ct.transit),
          text: textOf(ct),
          label: labelOf(ct),
        };
      });
      return { id: sp.id, name: def.name, about: def.about, tone: Math.round(sp.tone * 100) / 100, strength: percentile(sp.id, sp.S), drivers };
    });
    days.push({
      date: ymd,
      moon: { sign: SIGN_NOM[moonSign], signIn: SIGN_IN[moonSign], natalHouse: moonHouse, phase: moonPhase(pos.sun.lon, pos.moon.lon),
              text: `Луна в вашем ${moonHouse}-м доме: ${MOON_HOUSE[moonHouse]}` },
      // небо дня для колеса: планеты в натальных домах
      sky: PLANETS.map(p => ({ id: p, name: NAME[p], ...position(pos[p].lon), speed: pos[p].speed, retrograde: pos[p].speed < 0, house: houseOf(pos[p].lon, cusps) })),
      contacts: contacts.map(ct => ({ transit: ct.transit, natal: ct.natal, aspect: ct.aspect, orb: Math.round(ct.orb * 100) / 100, tone: ct.tone })),
      spheres,
    });
  }
  lap('days7_with_until', t);
  timing.untilSearches = untilCalls;
  timing.total = Math.round((performance.now() - t0) * 10) / 10;

  const out = {
    person: { title: inp.title ?? 'Натальная карта', place: inp.place ?? '', wheelUrl: 'wheel.html' },
    draft: true,   // методика транзитов ещё не утверждена
    generated: { today: todayYmd, tz: nowTz, ms: timing },
    natal: {
      angles: natal.angles, houses: natal.houses,
      points: NATAL_POINTS.map(n => ({ id: n, lon: natalLon[n] })),
    },
    days,
  };

  return out;
}

export type Forecast = ReturnType<typeof buildForecast>;
