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
 *   2. каждый час местного дня — положения 10 планет (Луна по эфемериде,
 *      остальные от полудня по скорости);
 *   3. контакты: аспект транзитной планеты к натальной точке в пределах
 *      орбиса; сила K = w_тр · w_нат · (1 − орбис/макс) · (1 или 0.7);
 *   4. сферы: контакт засчитывается сфере, если натальная точка —
 *      управитель её дома или планета-показатель; Луна в доме добавляет
 *      силу без тона; часы сводятся в 3-часовые отрезки, сила отрезка —
 *      процентиль среди всех отрезков 365 своих дней.
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
  onStep?: (step: 'natal' | 'distribution365' | 'days7', ms: number) => void;
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

// традиционные управители знаков (решение 1)
const RULER: P[] = ['mars', 'venus', 'mercury', 'moon', 'sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn', 'saturn', 'jupiter'];
// Второй хозяин у Скорпиона, Водолея и Рыб (решение 20.11.2026, как в разборах —
// «одно правило школ», п. 12 каркаса натала): засчитывается с тем же весом,
// что и традиционный, в строке «почему» — «второго хозяина сферы …».
// Статус сравнивает сферу с её же днями, поэтому лишние касания не делают
// такую сферу «громче» других.
const RULER_MODERN: Partial<Record<number, P>> = { 7: 'pluto', 10: 'uranus', 11: 'neptune' };

// Сферы (решение 20.11.2026): главный дом считается полностью, второй —
// вполовину, плюс планеты-показатели. Главные дома не повторяются: каждый
// из 12 домов — главный ровно у одной полосы или второй у какой-то, все 12
// участвуют. Второй дом — только где он естественен по смыслу (у «Радости»
// его нет). Порядок — по интересу людей: отношения, деньги, работа.
// id 'family' больше нет (влит в 'inner'); 'joy' и 'friends' — новые,
// их же должен принимать сервер статистики (backend/src/modules/app/routes.ts)
const SPHERES: { id: string; name: string; main: number; sec: number | null; sig: P[]; about: string }[] = [
  { id: 'love', name: 'Отношения', main: 7, sec: 5, sig: ['venus'], about: 'Партнёр, романы, свидания, то, как складывается близость.' },
  { id: 'money', name: 'Деньги', main: 2, sec: 8, sig: ['jupiter'], about: 'Свои деньги и общие: доходы, траты, долги.' },
  { id: 'career', name: 'Работа', main: 10, sec: 6, sig: ['saturn'], about: 'Дело, статус, будни и рабочий ритм.' },
  { id: 'health', name: 'Энергия и самочувствие', main: 1, sec: 6, sig: ['sun', 'mars'], about: 'Силы, самочувствие, режим.' },
  { id: 'inner', name: 'Эмоции и семья', main: 4, sec: 12, sig: ['moon'], about: 'Настроение, дом и семья, потребность побыть наедине с собой.' },
  { id: 'joy', name: 'Радость и творчество', main: 5, sec: null, sig: ['venus'], about: 'Удовольствия, хобби, творчество, отдых.' },
  { id: 'talk', name: 'Общение и учёба', main: 3, sec: 9, sig: ['mercury'], about: 'Разговоры, переписка, учёба, поездки, новые идеи.' },
  { id: 'friends', name: 'Друзья и замыслы', main: 11, sec: 3, sig: [], about: 'Друзья, приятели, сообщества, планы на будущее.' },
];

/* ===== ТЕКСТЫ (черновые шаблоны из вкладки «Словарь») ===== */

const NAME: Record<P, string> = { sun: 'Солнце', moon: 'Луна', mercury: 'Меркурий', venus: 'Венера', mars: 'Марс', jupiter: 'Юпитер', saturn: 'Сатурн', uranus: 'Уран', neptune: 'Нептун', pluto: 'Плутон' };
// «к вашему Солнцу», «с вашим Солнцем»
const DAT: Record<N, string> = { sun: 'вашему Солнцу', moon: 'вашей Луне', mercury: 'вашему Меркурию', venus: 'вашей Венере', mars: 'вашему Марсу', jupiter: 'вашему Юпитеру', saturn: 'вашему Сатурну', uranus: 'вашему Урану', neptune: 'вашему Нептуну', pluto: 'вашему Плутону', asc: 'вашему Асценденту', mc: 'вашему MC' };
const INS: Record<N, string> = { sun: 'вашим Солнцем', moon: 'вашей Луной', mercury: 'вашим Меркурием', venus: 'вашей Венерой', mars: 'вашим Марсом', jupiter: 'вашим Юпитером', saturn: 'вашим Сатурном', uranus: 'вашим Ураном', neptune: 'вашим Нептуном', pluto: 'вашим Плутоном', asc: 'вашим Асцендентом', mc: 'вашим MC' };
const ASP_PHRASE: Record<AspectType, string> = { conjunction: 'в соединении с', sextile: 'в секстиле к', square: 'в квадрате к', trine: 'в трине к', opposition: 'в оппозиции к' };
/* ===== СТРОКИ ВЛИЯНИЙ ВНУТРИ ПОЛОСЫ (решение 20.11.2026) =====
 * Строка = что происходит (планета неба и тон) + где (по полосе, в которой
 * строка стоит), под ней мелко — почему (какую точку карты задело и чем
 * она связана со сферой). Раньше «где» бралось из общего значения задетой
 * планеты, и в «Отношениях» стояло «в работе и обязательствах», если
 * Сатурн — хозяин дома партнёрства. Фразы «что» — без привязки к теме,
 * чтобы читались в любой полосе. */

// что приносит планета неба: [помогает, мешает, соединение без явного тона]
const EFFECT: Record<P, [string, string, string]> = {
  sun: ['уверенность и признание', 'задетое самолюбие', 'желание внимания'],
  moon: ['лёгкое настроение', 'раздражительность', 'обострённые чувства'],
  mercury: ['ясные разговоры и договорённости', 'путаница в словах и планах', 'много мыслей и переписки'],
  venus: ['тепло и лёгкость', 'мелкие обиды', 'тяга к приятному'],
  mars: ['энергия и решительность', 'спешка и споры', 'напор и нетерпение'],
  jupiter: ['удача и новые возможности', 'перебор и лишние обещания', 'подъём и щедрость'],
  saturn: ['устойчивость и порядок', 'больше нагрузки, меньше отдачи', 'серьёзность и обязательства'],
  uranus: ['приятные неожиданности', 'внезапные перемены планов', 'неожиданные повороты'],
  neptune: ['вдохновение и чуткость', 'туман и усталость', 'мечтательность'],
  pluto: ['сила глубоко что-то изменить', 'борьба за контроль', 'сильные чувства'],
};
// где — по полосе. У «Энергии и самочувствия» пусто: «спешка и споры
// в самочувствии» не по-русски, а заголовок полосы и так над строкой
const SPHERE_WHERE: Record<string, string> = {
  love: 'в отношениях', money: 'в денежных делах', career: 'в работе', health: '',
  inner: 'дома и с близкими', joy: 'в отдыхе и увлечениях', talk: 'в разговорах и учёбе', friends: 'с друзьями',
};
// почему — роль задетой точки в сфере
const PLANET_ACC: Record<P, string> = { sun: 'Солнце', moon: 'Луну', mercury: 'Меркурий', venus: 'Венеру', mars: 'Марс', jupiter: 'Юпитер', saturn: 'Сатурн', uranus: 'Уран', neptune: 'Нептун', pluto: 'Плутон' };
// Значения домов — те же, что HOUSE_ABOUT в day.html, wheel.html и sky.html:
// «хозяйку 2-го дома (свои деньги, вещи)». Менять во всех четырёх местах сразу
const HOUSE_ABOUT: string[] = ['', 'характер, внешность', 'свои деньги, вещи', 'общение, учёба', 'дом, семья, корни', 'влюблённость, дети, творчество',
  'работа, быт, здоровье', 'партнёр, брак, договоры', 'общие деньги, долги, близость', 'поездки, мировоззрение', 'карьера, статус, репутация', 'друзья, общие планы', 'подсознание, уединение'];
const HOUSE_ROLE = (n: number) => `${n}-го дома (${HOUSE_ABOUT[n]})`;
const SIG_ROLE: Record<string, string> = {
  'love:venus': 'планету любви', 'joy:venus': 'планету удовольствий', 'money:jupiter': 'планету достатка', 'career:saturn': 'планету обязательств',
  'health:sun': 'планету жизненных сил', 'health:mars': 'планету энергии', 'inner:moon': 'планету чувств', 'talk:mercury': 'планету общения',
};
/* ===== ФРАЗА ДНЯ В ЦЕНТРЕ КОЛЕСА =====
 * Две части. Фон — сфера карты, через которую идёт Луна, и знак Луны:
 * сфера держится 2–4 дня, знак — около 2,5, меняются они в разное время,
 * поэтому фон обновляется почти каждый день (12 × 12 сочетаний).
 * Событие — самое сильное касание Луны к точке карты за день, с часами:
 * Луна задевает одну-две точки в день, поэтому событие своё каждый день.
 * Медленные планеты в событие не берём: их касание держится неделями,
 * и подпись снова застыла бы.
 * Тексты без «вы» и «ты» и без рода: подходят и к нынешнему экрану
 * на «вы», и к будущему переводу на «ты». */

// сфера, через которую идёт Луна
const MOON_BG_HOUSE: string[] = [
  '',
  'День про себя',
  'День для денег и вещей',
  'День разговоров и мелких дел',
  'Тянет домой, к своим',
  'Время для радости',
  'День будних дел и режима',
  'День для пары и договоров',
  'День для близости и общих денег',
  'Тянет к новому и далёкому',
  'На виду работа и репутация',
  'День для друзей и общих планов',
  'Время тишины и отдыха',
];
// как это ощущается — по знаку Луны
const MOON_BG_SIGN: string[] = [
  'горячо, с азартом',         // Овен
  'не спеша, с удовольствием', // Телец
  'легко и на бегу',           // Близнецы
  'по-домашнему, с заботой',   // Рак
  'щедро, от души',            // Лев
  'по пунктам, без суеты',     // Дева
  'вдвоём и красиво',          // Весы
  'всерьёз, до глубины',       // Скорпион
  'широко, с размахом',        // Стрелец
  'сдержанно, с пользой',      // Козерог
  'по-своему, без правил',     // Водолей
  'мягко, по настроению',      // Рыбы
];
// Луна касается точки карты: [гармония — трин, секстиль; напряжение — квадрат,
// оппозиция; соединение]
const MOON_EVENT: Record<N, [string, string, string]> = {
  sun: ['Легко быть собой: силы и настроение заодно', 'Хочется одного, а чувствуется другое: не давить на себя', 'Что внутри, то и снаружи: настроение на виду'],
  moon: ['Спокойно внутри, хорошо с близкими', 'Чувства через край: отношения лучше не выяснять', 'Всё ощущается острее: стоит прислушаться к себе'],
  mercury: ['Слова находятся легко: хорошо договариваться и писать', 'Легко не понять друг друга: важное лучше перечитать', 'Голова полна мыслей, много переписки'],
  venus: ['Тепло в отношениях: хорошее время для свидания', 'Мелкие обиды и лишние траты: стоит притормозить', 'Хочется приятного: красоты, вкусного, ласки'],
  mars: ['Есть запал: хорошо браться за трудное', 'Легко вспылить: споры лучше отложить', 'Энергии много, терпения мало'],
  jupiter: ['Щедрое настроение: хорошо просить и предлагать', 'Тянет на перебор в обещаниях, тратах и еде', 'Настроение на подъёме, всё кажется возможным'],
  saturn: ['Получается собранно: время для скучных дел', 'Тяжелее обычного: лишнего лучше не взваливать', 'Серьёзный настрой, тянет навести порядок'],
  uranus: ['Тянет на новое: хорошо менять привычное', 'Нервно и непредсказуемо: нужен запас времени', 'Хочется свободы и чего-то неожиданного'],
  neptune: ['Чуткость и вдохновение: время для творчества', 'Туман в голове: важные решения подождут', 'Мечтательно и рассеянно, тянет уйти в себя'],
  pluto: ['Хватает сил на глубокий разговор или перемену', 'Сильные чувства, тянет всё контролировать', 'Всё всерьёз: эмоции глубже обычного'],
  asc: ['Легко с людьми: хорошо знакомиться и показываться', 'Внутри неспокойно, и это видно со стороны', 'Чувства на лице: настроение считывают сразу'],
  mc: ['Настроение помогает в работе: хорошо показать результат', 'Дом и работа тянут в разные стороны', 'Мысли о работе и о том, куда всё движется'],
};
// часы события: «с 13:00 до 19:00», «до 11:00», «с 20:00», «весь день»
function hoursText(from: number, to: number): string {
  if (from <= 0 && to >= 24) return 'весь день';
  if (from <= 0) return `до ${to}:00`;
  if (to >= 24) return `с ${from}:00`;
  return `с ${from}:00 до ${to}:00`;
}
const SIGN_IN = ['Овне', 'Тельце', 'Близнецах', 'Раке', 'Льве', 'Деве', 'Весах', 'Скорпионе', 'Стрельце', 'Козероге', 'Водолее', 'Рыбах'];
const SIGN_NOM = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];

/* ===== АСТРОНОМИЯ ===== */

const norm = (x: number) => ((x % 360) + 360) % 360;
const sep = (a: number, b: number) => { const d = norm(a - b); return d > 180 ? 360 - d : d; };
const jdOfMs = (ms: number) => ms / 86400000 + 2440587.5;

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
  const lap = (name: 'natal' | 'distribution365' | 'days7', from: number) => {
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
  // У каждой точки запоминается и роль — для строки «почему»: при равном
  // весе остаётся первая: хозяин главного дома, потом показатель («планету
  // любви» понятнее, чем «хозяйку сферы радости» в «Отношениях»), потом второй дом
  const sphereWeight: Record<string, Partial<Record<N, number>>> = {};
  const sphereRole: Record<string, Partial<Record<N, string>>> = {};
  const holder = (p: P) => (p === 'moon' || p === 'venus' ? 'хозяйку ' : 'хозяина ');
  for (const s of SPHERES) {
    const w: Partial<Record<N, number>> = {}, role: Partial<Record<N, string>> = {};
    const put = (n: N, x: number, why: string) => { if (x > (w[n] ?? 0)) { w[n] = x; role[n] = why; } };
    const mainSign = natal.houses[s.main - 1].signIndex, mainRuler = RULER[mainSign];
    put(mainRuler, 1, holder(mainRuler) + HOUSE_ROLE(s.main));
    const mainModern = RULER_MODERN[mainSign];
    if (mainModern) put(mainModern, 1, 'второго хозяина ' + HOUSE_ROLE(s.main));
    for (const p of s.sig) put(p, 0.5, SIG_ROLE[s.id + ':' + p] ?? 'планету этой сферы');
    if (s.sec !== null) {
      const secSign = natal.houses[s.sec - 1].signIndex, r = RULER[secSign], m = RULER_MODERN[secSign];
      put(r, 0.5, holder(r) + HOUSE_ROLE(s.sec));
      if (m) put(m, 0.5, 'второго хозяина ' + HOUSE_ROLE(s.sec));
    }
    if (s.main === 1) put('asc', 1, 'то, каким видят со стороны'); if (s.sec === 1) put('asc', 0.5, 'то, каким видят со стороны');
    if (s.main === 10) put('mc', 1, 'точку карьеры'); if (s.sec === 10) put('mc', 0.5, 'точку карьеры');
    sphereWeight[s.id] = w; sphereRole[s.id] = role;
  }
  lap('natal', t);

  /* ===== 2–4. СИЛА ПО 3-ЧАСОВЫМ ОТРЕЗКАМ =====
   * Сила считается по часам местного дня (на середину часа) и сводится
   * в восемь отрезков: 0–3, 3–6 … 21–24; сфера на отрезке — среднее её
   * силы за три часа. Так видно, когда влияние начинается, достигает
   * пика и уходит, а не «сумма лучших моментов дня», как было раньше.
   *
   * Положения: Луна — по эфемериде каждый час (за час она проходит
   * ~0,5°); остальные планеты — от полудня по скорости: за полсуток они
   * смещаются меньше чем на градус, и ошибка линейной поправки — угловые
   * секунды. Дни перевода часов считаются как 24 часа — сдвиг на час
   * дважды в год для прототипа неважен. */

  const SLOTS = 8;
  type Contrib = { transit: P; natal: N; aspect: AspectType; tone: number; orb: number; slots: number[] };
  type SphereDay = { S: number[]; toned: number[]; own: Map<string, Contrib> };

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

  // какие натальные точки входят хоть в одну сферу — остальные не считаем
  const USED = NATAL_POINTS.filter(n => SPHERES.some(s => sphereWeight[s.id][n]));

  // касание Луны к точке карты по часам дня — для события в центре колеса
  type MoonHit = { natal: N; aspect: AspectType; k: number[] };

  function dayCalc(ymd: string, withEvent = false) {
    const jdNoon = noonJd(ymd), noon = skyAt(jdNoon);
    const sp: Record<string, SphereDay> = Object.fromEntries(SPHERES.map(s => [s.id, { S: new Array(SLOTS).fill(0), toned: new Array(SLOTS).fill(0), own: new Map() }]));
    const moonHits = new Map<string, MoonHit>();
    const moonByHour: number[] = [];   // долгота Луны на середину каждого часа — плашка «сейчас»
    for (let h = 0; h < 24; h++) {
      const dt = (h + 0.5 - 12) / 24, slot = Math.floor(h / 3);
      const moon = planet(jdNoon + dt, 'moon');
      if (withEvent) moonByHour.push(moon.lon);
      // событие дня: все точки карты, не только те, что входят в сферы;
      // сила — по той же формуле, что у полос
      if (withEvent) for (const n of NATAL_POINTS) {
        const s = sep(moon.lon, natalLon[n]);
        for (const [a, ang] of ASPECTS) {
          const orb = Math.abs(s - ang);
          if (orb > T_ORB.moon) continue;
          const applying = Math.abs(sep(moon.lon + moon.speed * 0.01, natalLon[n]) - ang) < orb;
          const k = T_W.moon * N_W[n] * (1 - orb / T_ORB.moon) * (applying ? 1 : 0.7);
          let m = moonHits.get(a + n);
          if (!m) moonHits.set(a + n, m = { natal: n, aspect: a, k: new Array(24).fill(0) });
          m.k[h] = Math.max(m.k[h], k);
        }
      }
      for (const p of PLANETS) {
        const lon = p === 'moon' ? moon.lon : noon[p].lon + noon[p].speed * dt;
        const speed = p === 'moon' ? moon.speed : noon[p].speed;
        for (const n of USED) {
          const s = sep(lon, natalLon[n]);
          for (const [a, ang] of ASPECTS) {
            const orb = Math.abs(s - ang);
            if (orb > T_ORB[p]) continue;
            const applying = Math.abs(sep(lon + speed * 0.01, natalLon[n]) - ang) < orb;
            const k = T_W[p] * N_W[n] * (1 - orb / T_ORB[p]) * (applying ? 1 : 0.7);
            const tone = toneOf(p, a);
            for (const s2 of SPHERES) {
              const w = sphereWeight[s2.id][n]; if (!w) continue;
              const kw = k * w / 3, d = sp[s2.id], key = p + a + n;   // /3: среднее за три часа отрезка
              d.S[slot] += kw; d.toned[slot] += tone * kw;
              let c = d.own.get(key);
              if (!c) d.own.set(key, c = { transit: p, natal: n, aspect: a, tone, orb, slots: new Array(SLOTS).fill(0) });
              c.slots[slot] += kw; c.orb = Math.min(c.orb, orb);
            }
          }
        }
      }
      // Луна в доме сферы: сила без тона
      const mh = houseOf(moon.lon, cusps);
      for (const s2 of SPHERES) sp[s2.id].S[slot] += (mh === s2.main ? 0.5 : mh === s2.sec ? 0.25 : 0) / 3;
    }
    return { ymd, jdNoon, noon, sp, moonHits, moonByHour };
  }

  // Самое сильное касание Луны за день и его часы: от первого до последнего
  // часа, где сила не меньше половины пиковой. Нет касаний — события нет,
  // в центре остаётся один фон.
  function dayEvent(hits: Map<string, MoonHit>) {
    let best: MoonHit | null = null, peak = 0;
    for (const m of hits.values()) { const p = Math.max(...m.k); if (p > peak) { peak = p; best = m; } }
    if (!best) return null;
    const hrs = best.k.flatMap((x, i) => x >= peak / 2 ? [i] : []);
    const from = hrs[0], to = hrs[hrs.length - 1] + 1;
    const tone = toneOf('moon', best.aspect);
    return {
      natal: best.natal, aspect: best.aspect, tone, from, to,
      text: MOON_EVENT[best.natal][tone > 0 ? 0 : tone < 0 ? 1 : 2],
      when: hoursText(from, to),
      label: `${NAME.moon} ${ASP_PHRASE[best.aspect]} ${best.aspect === 'conjunction' ? INS[best.natal] : DAT[best.natal]}`,
    };
  }

  // «Энергия и решительность в отношениях.» — что + где по полосе
  function textOf(ct: Contrib, sphereId: string): string {
    const eff = EFFECT[ct.transit][ct.tone > 0 ? 0 : ct.tone < 0 ? 1 : 2];
    const where = SPHERE_WHERE[sphereId];
    return `${eff[0].toUpperCase()}${eff.slice(1)}${where ? ' ' + where : ''}.`;
  }

  // «Марс задевает Сатурн в карте — хозяина 7-го дома (партнёр, договоры)»: строка
  // «почему» показывает, что считается по личной карте, а не общий гороскоп
  function whyOf(ct: Contrib, sphereId: string): string {
    const role = sphereRole[sphereId][ct.natal] ?? '';
    const target = ct.natal === 'asc' ? 'восход карты' : ct.natal === 'mc' ? 'вершину карты' : `${PLANET_ACC[ct.natal as P]} в карте`;
    return `${NAME[ct.transit]} задевает ${target}${role ? ' — ' + role : ''}`;
  }

  // «Луна в трине к вашему Сатурну» — для экранного диктора
  function labelOf(ct: Contrib): string {
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

  // распределение силы по 365 своим дням вокруг сегодня — для процентилей:
  // 8 отрезков × 365 дней на сферу; семь показываемых дней берутся отсюда же
  t = performance.now();
  const dist: Record<string, number[]> = Object.fromEntries(SPHERES.map(s => [s.id, [] as number[]]));
  const shown = new Map<string, ReturnType<typeof dayCalc>>();
  for (let i = -182; i <= 182; i++) {
    const dc = dayCalc(addDays(todayYmd, i), i >= -6 && i <= 0);
    for (const s of SPHERES) dist[s.id].push(...dc.sp[s.id].S);
    if (i >= -6 && i <= 0) shown.set(dc.ymd, dc);
  }
  for (const k in dist) dist[k].sort((a, b) => a - b);
  // Процентиль «по середине группы»: если у человека 15% отрезков без
  // влияний на сферу, такой отрезок получает ~7, а не 0 — пустая полоса
  // читается как ошибка, а это просто тихие часы
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
  const r2 = (x: number) => Math.round(x * 100) / 100, r3 = (x: number) => Math.round(x * 1000) / 1000;
  const days = [];
  for (let i = -6; i <= 0; i++) {
    const { ymd, noon: pos, sp, moonHits, moonByHour } = shown.get(addDays(todayYmd, i))!;
    const moonHouse = houseOf(pos.moon.lon, cusps);
    const moonSign = Math.floor(norm(pos.moon.lon) / 30);
    const lines = new Map<string, Contrib>();
    const spheres = SPHERES.map(def => {
      const d = sp[def.id];
      // причины — влияния, заметные хоть в одном отрезке; сильные выше
      // одинаковый текст в одной полосе — только самая сильная строка:
      // «Лёгкое настроение в денежных делах» дважды подряд читается как сбой
      const seen = new Set<string>();
      const own = [...d.own.values()].filter(c => Math.max(...c.slots) > 0.005)
        .sort((a, b) => Math.max(...b.slots) - Math.max(...a.slots))
        .filter(c => { const k = textOf(c, def.id); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, 5);
      own.forEach(c => lines.set(c.transit + c.aspect + c.natal, c));
      return {
        id: def.id, name: def.name, about: def.about,
        slots: d.S.map((S, j) => ({ strength: percentile(def.id, S), tone: S ? r2(d.toned[j] / S) : 0 })),
        drivers: own.map(c => ({ transit: c.transit, aspect: c.aspect, natal: c.natal, tone: c.tone,
          text: textOf(c, def.id), why: whyOf(c, def.id), label: labelOf(c), slots: c.slots.map(r3) })),
      };
    });
    days.push({
      date: ymd,
      moon: { sign: SIGN_NOM[moonSign], signIn: SIGN_IN[moonSign], natalHouse: moonHouse, phase: moonPhase(pos.sun.lon, pos.moon.lon),
              text: `${MOON_BG_HOUSE[moonHouse]} — ${MOON_BG_SIGN[moonSign]}`,
              // то же по часам: у сегодняшнего дня плашка и фон — на текущий час,
              // у прошлых — на полдень (решение 20.11.2026: утром до смены знака
              // плашка на полдень расходилась с лунным календарём)
              hourly: moonByHour.map(lon => {
                const sg = Math.floor(norm(lon) / 30), hs = houseOf(lon, cusps);
                return { sign: SIGN_NOM[sg], signIn: SIGN_IN[sg], natalHouse: hs, text: `${MOON_BG_HOUSE[hs]} — ${MOON_BG_SIGN[sg]}` };
              }) },
      // событие дня в центре колеса; null — Луна за день ничего не задела
      event: dayEvent(moonHits),
      // небо дня для колеса (на полдень): планеты в натальных домах
      sky: PLANETS.map(p => ({ id: p, name: NAME[p], ...position(pos[p].lon), speed: pos[p].speed, retrograde: pos[p].speed < 0, house: houseOf(pos[p].lon, cusps) })),
      // линии на колесе — все причины дня, чтобы подсветка строки нашла свою пару
      contacts: [...lines.values()].map(c => ({ transit: c.transit, natal: c.natal, aspect: c.aspect, orb: r2(c.orb), tone: c.tone })),
      spheres,
    });
  }
  lap('days7', t);
  timing.total = Math.round((performance.now() - t0) * 10) / 10;

  const out = {
    person: { title: inp.title ?? 'Натальная карта', place: inp.place ?? '', wheelUrl: 'wheel.html' },
    draft: true,   // методика транзитов ещё не утверждена
    generated: { today: todayYmd, tz: nowTz, ms: timing },
    natal: {
      angles: natal.angles, houses: natal.houses,
      points: NATAL_POINTS.map(n => ({ id: n, lon: natalLon[n] })),
      // для «Персональной натальной карты» в меню: только расчёт, без толкований.
      // system: P — Плацидус, O — Порфирий (за полярным кругом)
      system: natal.settings.houseSystem.charAt(0),
      bodies: natal.bodies.filter(b => b.id !== 'southNode').map(b => ({ id: b.id, name: b.name, sign: b.signIndex,
        deg: Math.floor(b.degreeInSign), min: Math.floor((b.degreeInSign % 1) * 60), house: b.house, retro: b.retrograde })),
      aspects: natal.aspects.map(a => ({ a: a.a, b: a.b, type: a.type, orb: r2(a.orb) })),
    },
    days,
  };

  return out;
}

export type Forecast = ReturnType<typeof buildForecast>;
