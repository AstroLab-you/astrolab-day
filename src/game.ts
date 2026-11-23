/* ===== ИГРА «ПОЛЁТ К ПЛАНЕТАМ»: ПРАВИЛА =====
 *
 * Чистая функция без сети и файлов: по шагам и выбору на остановках
 * восстанавливает, где сейчас корабль. Её вызывает телефон — и для
 * одиночки (шаги свои, всё в телефоне), и для экипажа (шаги экипажа по
 * дням приходят с сервера). Сервер правил не считает: он хранит шаги
 * и выбор, а одинаковый результат у всех в экипаже гарантирует то, что
 * расчёт детерминирован — одни и те же данные дают одно и то же небо.
 *
 * Правила утверждены Никитой 2026-10-09 (Claude Doc «Приложение Astrolab:
 * игра, воронка и этапы»):
 *   • шаги экипажа складываются; человеку засчитывается до 10 000 в день,
 *     лишнее идёт в запасной бак и тратится в слабые дни;
 *   • старт — развилка на Земле: одноместный корабль за 7 000 шагов или
 *     корабль на 3 места за 50 000 (строится с друзьями);
 *   • одноместный лёгкий — летит вдвое дальше на каждый шаг;
 *   • на каждой планете стоянка, но что на ней можно улучшить, у каждой
 *     планеты своё (MENU): двигатель ×2 (6 ступеней), каюта 3 → 5, бак
 *     (две ступени), радар — или лететь дальше без апгрейда; одиночка
 *     везде может пересесть в корабль на 3 места;
 *   • у Марса, Юпитера и Сатурна развилка: прямо или крюк к базе на
 *     спутнике (Фобос, Европа, Титан). Крюк на 30% длиннее, зато база
 *     доливает бак и дарит запечатанный контейнер — что в нём, видно
 *     только радару (уточнения 2026-10-09, вторая половина дня);
 *   • Юпитер разгоняет бесплатно: после него всё летит вдвое быстрее;
 *   • цена перегона — реальное расстояние между планетами на 9 октября
 *     2026 года, в а.е. × 615 000. Расстояния зафиксированы, а не живые:
 *     ближние перегоны за год меняются в разы, и игрок, начавший в
 *     неудачный месяц, получил бы первый перегон на месяц вместо недели.
 *
 * Эталон — 7 000 шагов на человека: экипаж из трёх (с каютой на Марсе)
 * проходит путь за ~60 дней, одиночка — за ~85.
 */

export const STOPS = ['earth', 'moon', 'venus', 'mercury', 'mars', 'ceres', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'] as const
export type StopId = typeof STOPS[number]
export const FINAL = STOPS.length - 1
const JUPITER = STOPS.indexOf('jupiter')

/** Расстояние между соседними остановками, а.е., на 2026-10-09 (Swiss Ephemeris). */
const AU = [0, 0.3043, 0.7475, 1.9878, 1.106, 3.9506, 12.9736, 15.4771, 26.2822, 32.3629]

export const RULES = {
  stepCap: 10_000,       // засчитывается человеку за день
  norm: 7_000,           // эталон шагов на человека; стоянка = день шагов экипажа
  soloBuild: 7_000,      // одноместный корабль на Земле
  crewBuild: 50_000,     // корабль на 3 места — на Земле и при пересадке на планете
  light: 2,              // одноместный летит вдвое дальше на шаг
  engineMax: 6,          // ступеней двигателя, каждая ×2
  jupiterBoost: 2,       // гравитационный манёвр
  weakShare: 0.5,        // слабый день — меньше половины нормы на место
  tankPerSeat: 10_000,   // встроенный бак на одно место; ступень бака добавляет ещё столько же
  tankMax: 2,            // ступени бака: запасной, большой
  hookExtra: 0.3,        // крюк к базе длиннее перегона на 30%
  /** Цена перегона i (от остановки i к i + 1) в единицах пути. Земля → Луна — отдельно. */
  legs: [154_000, ...AU.slice(1).map(au => Math.round(au * 615_000))],
} as const

export type Choice = 'solo' | 'crew' | 'engine' | 'cabin' | 'tank' | 'radar' | 'skip'
type Upgrade = 'engine' | 'cabin' | 'tank' | 'radar'

/*
 * Что улучшают на какой планете. Первые три учат двигателю; дальше
 * двигатель соперничает с каютой (Марс, Юпитер) и баком (Церера),
 * а на Сатурне выбирают между баком и радаром. Двигатель предлагают
 * семь планет на шесть ступеней: взявший каюту или радар отстаёт, но
 * на Уране догоняет. Нептун — последний шанс позвать ещё двоих перед
 * самым длинным перегоном. Что на планете впереди, скрыто туманом.
 */
export const MENU: Readonly<Record<number, readonly Upgrade[]>> = {
  1: ['engine'], 2: ['engine'], 3: ['engine', 'radar'], 4: ['engine', 'cabin'], 5: ['engine', 'tank'],
  6: ['engine', 'cabin'], 7: ['tank', 'radar'], 8: ['engine'], 9: ['tank', 'cabin'],
}

/** Развилки: у какой планеты база на спутнике по пути к следующей. */
export const BASES: Readonly<Record<number, string>> = { 4: 'phobos', 6: 'europa', 7: 'titan' }

/** Что можно выбрать на остановке и сколько это стоит в шагах. */
export function options(s: Pick<GameState, 'stop' | 'seats' | 'engine' | 'tankLevel' | 'radar'>): { choice: Choice; cost: number }[] {
  const day = s.seats * RULES.norm
  if (s.stop === 0) return [{ choice: 'solo', cost: RULES.soloBuild }, { choice: 'crew', cost: RULES.crewBuild }]
  if (s.stop >= FINAL) return []
  const menu = MENU[s.stop] ?? []
  const open: Record<Upgrade, boolean> = {
    engine: s.engine < RULES.engineMax, cabin: s.seats === 3, tank: s.tankLevel < RULES.tankMax, radar: !s.radar,
  }
  const o: { choice: Choice; cost: number }[] = menu
    .filter(u => open[u])
    .map(u => ({ choice: u, cost: u === 'cabin' ? day * 2 : day }))
  if (s.seats === 1) o.push({ choice: 'crew', cost: RULES.crewBuild })
  o.push({ choice: 'skip', cost: 0 })
  return o
}

/* ===== КОНТЕЙНЕР БАЗЫ ===== */

export type Gift = 'engine' | 'boost' | 'tank' | 'radar'

/** Доли подарков: двигатель — джекпот, разгон — частый, бак и радар — поровну. */
const GIFTS: readonly [Gift, number][] = [['engine', 0.2], ['boost', 0.4], ['tank', 0.2], ['radar', 0.2]]

/** Число 0…1 из строки: FNV-1a. Не криптография — лишь бы у всех одинаково. */
function unit(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193)
  return (h >>> 0) / 2 ** 32
}

/**
 * Что лежит в контейнере базы у развилки stop. Тянется один раз по
 * зерну корабля, поэтому весь экипаж видит одно и то же, а пересчёт не
 * меняет подарок. Чего кораблю уже не нужно (седьмой двигатель, третий
 * бак, второй радар), превращается в разгон — пустых контейнеров нет.
 * Телефон с радаром зовёт эту же функцию, чтобы показать подарок заранее.
 */
export function gift(seed: string, stop: number, s: Pick<Snapshot, 'engine' | 'tankLevel' | 'radar'>): Gift {
  let u = unit(`${seed}:${BASES[stop] ?? stop}`), g: Gift = 'boost'
  for (const [k, p] of GIFTS) { if (u < p) { g = k; break } u -= p }
  if (g === 'engine' && s.engine >= RULES.engineMax) return 'boost'
  if (g === 'tank' && s.tankLevel >= RULES.tankMax) return 'boost'
  if (g === 'radar' && s.radar) return 'boost'
  return g
}

/** Шаги корабля за день: сумма по экипажу, уже разложенная сервером или телефоном. */
export type GameDay = { day: string; counted: number; overflow: number }

/** Шаги одного человека за день → засчитанное и лишнее (в бак). */
export function split(steps: number): { counted: number; overflow: number } {
  const s = Math.max(0, Math.floor(steps))
  return { counted: Math.min(s, RULES.stepCap), overflow: Math.max(0, s - RULES.stepCap) }
}

/** Снимок, с которого начинается расчёт. По умолчанию — Земля, ничего не построено. */
export type Snapshot = {
  stop: number          // остановка, на которой стоит корабль (ждёт выбора)
  seats: 1 | 3 | 5
  engine: number
  tankLevel: number     // ступеней бака: 0 — только встроенный, 1 — запасной, 2 — большой
  radar: boolean
  tank: number          // шагов в запасном баке
  credit: number        // шагов, накопленных на стоянке до выбора
  flown?: number        // ушёл из экипажа посреди перегона: пройдено единиц пути
  hook?: boolean        // …и перегон этот — крюк к базе
  docked?: boolean      // …и база уже позади
  boost?: number        // …и разгон из контейнера ещё действует
}
export const EARTH: Snapshot = { stop: 0, seats: 1, engine: 0, tankLevel: 0, radar: false, tank: 0, credit: 0 }

export type GameInput = {
  start?: Snapshot
  days: GameDay[]                          // по порядку, начиная с дня старта
  choices: Partial<Record<number, Choice>> // выбор на остановке № (0 — Земля)
  hooks?: Partial<Record<number, boolean>> // на развилке № — крюк к базе
  seed?: string                            // зерно контейнеров: у экипажа — с сервера, у одиночки — своё
}

export type GameState = Snapshot & {
  phase: 'stop' | 'leg' | 'finished'
  /** На стоянке: сколько шагов уже вложено в выбранный апгрейд. На перегоне — 0. */
  paid: number
  /** На перегоне: пройдено единиц пути из legLength(). */
  flown: number
  /** Перегон — крюк к базе; база на середине крюка. */
  hook: boolean
  docked: boolean
  /** Множитель разгона из контейнера: 2 — до следующей планеты, потом 1. */
  boost: number
  /** Что выдали базы: номер развилки → подарок. Для карты и истории. */
  gifts: Partial<Record<number, Gift>>
  /** Положение для карты: номер остановки + доля перегона (2.5 — полпути от Венеры к Меркурию). */
  at: number
  /** Положение в конце каждого дня — след на карте. */
  track: { day: string; at: number }[]
  /** До какой остановки видно маршрут: дальше туман. */
  visible: number
}

/** Сколько единиц пути даёт один шаг на перегоне от остановки leg. */
export function power(s: Pick<Snapshot, 'seats' | 'engine'>, leg: number): number {
  return 2 ** s.engine * (leg >= JUPITER ? RULES.jupiterBoost : 1) * (s.seats === 1 ? RULES.light : 1)
}

/** Длина перегона от остановки stop — прямо или крюком. */
export function legLength(stop: number, hook = false): number {
  return RULES.legs[stop] * (hook ? 1 + RULES.hookExtra : 1)
}

const capOf = (s: Pick<Snapshot, 'seats' | 'tankLevel'>) => RULES.tankPerSeat * s.seats * (1 + s.tankLevel)

/*
 * Выбор, которого на остановке нет, — пропуск. Так бывает законно:
 * экипаж проголосовал за двигатель, а контейнер базы уже довёл его до
 * шестой ступени. Сервер правил не считает и такой голос не отсечёт.
 */
const valid = (s: GameState, c: Choice): Choice => (options(s).some(x => x.choice === c) ? c : 'skip')
const costOf = (s: GameState, c: Choice): number => options(s).find(x => x.choice === c)!.cost

function apply(s: GameState, c: Choice): void {
  if (c === 'solo') s.seats = 1
  else if (c === 'crew') s.seats = 3
  else if (c === 'cabin') s.seats = 5
  else if (c === 'engine') s.engine++
  else if (c === 'tank') s.tankLevel++
  else if (c === 'radar') s.radar = true
}

/** Потратить накопленные шаги: достроить апгрейд, пролететь, сколько хватит. */
/** Пролететь до отметки target на перегоне; false — шаги кончились раньше. */
function fly(s: GameState, target: number): boolean {
  const k = power(s, s.stop) * s.boost, need = target - s.flown
  if (s.credit * k < need) { s.flown += s.credit * k; s.credit = 0; return false }
  s.credit -= need / k; s.flown = target
  return true
}

/** Стыковка с базой: бак доверху и контейнер. */
function dock(s: GameState, seed: string): void {
  const g = gift(seed, s.stop, s)
  if (g === 'engine') s.engine++
  else if (g === 'tank') s.tankLevel++
  else if (g === 'radar') s.radar = true
  else s.boost = 2
  s.tank = capOf(s)
  s.gifts[s.stop] = g
  s.docked = true
}

/** Потратить накопленные шаги: достроить апгрейд, пролететь, сколько хватит. */
function advance(s: GameState, inp: GameInput): void {
  for (;;) {
    if (s.phase === 'finished') return
    if (s.phase === 'stop') {
      const picked = inp.choices[s.stop]
      if (!picked) return                             // ждём выбора, шаги копятся
      const c = valid(s, picked)
      const need = costOf(s, c) - s.paid
      const take = Math.min(s.credit, need)
      s.paid += take; s.credit -= take
      if (s.paid < costOf(s, c)) return
      apply(s, c)
      s.phase = 'leg'; s.paid = 0; s.flown = 0; s.boost = 1; s.docked = false
      s.hook = !!inp.hooks?.[s.stop] && s.stop in BASES
      continue
    }
    const len = legLength(s.stop, s.hook)
    if (s.hook && !s.docked) {
      if (!fly(s, len / 2)) return
      dock(s, inp.seed ?? '')
      continue
    }
    if (!fly(s, len)) return
    s.stop++; s.flown = 0; s.hook = false; s.docked = false; s.boost = 1
    s.phase = s.stop >= FINAL ? 'finished' : 'stop'
  }
}

function position(s: GameState): number {
  return s.phase === 'leg' ? s.stop + s.flown / legLength(s.stop, s.hook) : s.stop
}

/** Где корабль после всех дней. */
export function replay(inp: GameInput): GameState {
  const st0 = inp.start ?? EARTH
  const phase = st0.stop >= FINAL ? 'finished' : st0.flown !== undefined ? 'leg' : 'stop'
  const s: GameState = {
    ...st0, phase, paid: 0, flown: st0.flown ?? 0, hook: !!st0.hook, docked: !!st0.docked, boost: st0.boost ?? 1,
    gifts: {}, at: st0.stop, track: [], visible: 0,
  }
  advance(s, inp)
  for (const d of inp.days) {
    s.tank = Math.min(capOf(s), s.tank + d.overflow)
    let fuel = d.counted
    const weak = s.seats * RULES.norm * RULES.weakShare
    if (fuel < weak && s.tank > 0) { const draw = Math.min(s.tank, weak - fuel); fuel += draw; s.tank -= draw }
    s.credit += fuel
    advance(s, inp)
    s.track.push({ day: d.day, at: position(s) })
  }
  s.at = position(s)
  s.visible = Math.min(FINAL, Math.floor(s.at) + 1 + (s.radar ? 1 : 0))
  return s
}

/**
 * Сколько дней до следующей остановки при таком темпе (шагов на корабль
 * в день). Только в полёте: на стоянке время зависит от выбора.
 */
export function daysToNext(s: GameState, perDay: number): number | null {
  if (s.phase !== 'leg' || perDay <= 0) return null
  return (legLength(s.stop, s.hook) - s.flown) / power(s, s.stop) / s.boost / perDay
}

/** Снимок для пересадки: состояние на стоянке становится стартом нового корабля. */
export function snapshot(s: GameState): Snapshot {
  if (s.phase !== 'stop') throw new Error('Снимок берётся только на стоянке')
  return { stop: s.stop, seats: s.seats, engine: s.engine, tankLevel: s.tankLevel, radar: s.radar, tank: s.tank, credit: s.credit + s.paid }
}

/**
 * Ушёл из экипажа: летит дальше один с того же места (решение Никиты
 * 2026-10-09). Апгрейды — не экипажа, а усреднённые для этого места
 * пути: как у одиночки, который брал двигатель на каждой планете до
 * Юпитера и бак на Сатурне и Нептуне, а к базам не сворачивал, — иначе
 * уход из большого экипажа с прокачанным кораблём был бы выгоднее игры
 * одному. Шаги в баке и на стоянке делятся поровну, своя доля уходит
 * с ним. Ушёл посреди крюка — долетает крюк с того же места: база и
 * разгон остаются такими, какими были у экипажа.
 */
export function leaveSnapshot(s: GameState, crew: number): Snapshot {
  const passed = s.phase === 'stop' ? s.stop - 1 : s.stop     // планет, где уже выбрали апгрейд
  const share = (x: number) => Math.floor(x / Math.max(1, crew))
  const tankLevel = (passed >= STOPS.indexOf('saturn') ? 1 : 0) + (passed >= STOPS.indexOf('neptune') ? 1 : 0)
  const base = {
    seats: 1 as const,
    engine: Math.max(0, Math.min(RULES.engineMax, passed)),
    tankLevel,
    radar: false,
    tank: Math.min(share(s.tank), capOf({ seats: 1, tankLevel })),
    credit: share(s.credit + s.paid),
  }
  if (s.phase !== 'leg') return { ...base, stop: s.stop }
  return { ...base, stop: s.stop, flown: s.flown, ...(s.hook ? { hook: true, docked: s.docked, boost: s.boost } : {}) }
}

/* ===== КРУЖОК ИГРЫ НА ЭКРАНЕ ДНЯ =====
 * Кнопка игры на экране дня заполняется, как полоса в панели игры: доля
 * нынешнего перегона или вложенного в апгрейд (постройку). Экран дня
 * считает её сам по памяти игры (localStorage astrolab_game) и свежим
 * шагам телефона — игру ради этого открывать не нужно, кружок растёт
 * по мере ходьбы. У экипажа — по последнему ответу сервера, какой игра
 * запомнила. wait — игра ждёт решения игрока: стоянка без выбора. */

/** Память игры — ровно те поля, что нужны кружку (полная — в game.html). */
export type GameSave = {
  start?: string | null
  snap?: Snapshot | null
  seed?: string | null
  choices?: Partial<Record<number, Choice>>
  hooks?: Partial<Record<number, boolean>>
  steps?: Record<string, number>
  bonus?: Record<string, number>
  crew?: { view?: { ship?: { start?: Snapshot | null; days: GameDay[]; choices: Partial<Record<number, Choice>>; hooks: number[]; seed: string } | null } | null } | null
}

const nextDay = (d: string) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10)

export function ring(save: GameSave | null, phone: Record<string, number>, today: string): { value: number; wait: boolean; finished: boolean } | null {
  if (!save) return null
  let s: GameState, choices: Partial<Record<number, Choice>>
  const ship = save.crew?.view?.ship
  if (ship) {
    choices = ship.choices
    s = replay({ start: ship.start || undefined, days: ship.days, choices, hooks: Object.fromEntries(ship.hooks.map(k => [k, true])), seed: ship.seed })
  } else {
    if (!save.start || !save.choices || save.choices[0] === undefined) return null
    choices = save.choices
    const days: GameDay[] = []
    for (let d = save.start; d <= today; d = nextDay(d)) {
      const n = Math.max(save.steps?.[d] ?? 0, (phone[d] ?? 0) + (save.bonus?.[d] ?? 0))
      days.push({ day: d, ...split(n) })
    }
    s = replay({ start: save.snap || undefined, days, choices, hooks: save.hooks ?? {}, seed: save.seed ?? '' })
  }
  if (s.phase === 'finished') return { value: 1, wait: false, finished: true }
  if (s.phase === 'leg') return { value: s.at - s.stop, wait: false, finished: false }
  const c = choices[s.stop]
  if (!c) return { value: 1, wait: true, finished: false }
  const cost = options(s).find(o => o.choice === c)?.cost ?? 0
  return { value: cost ? Math.min(1, s.paid / cost) : 1, wait: false, finished: false }
}
