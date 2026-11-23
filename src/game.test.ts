/* ===== ПРАВИЛА ИГРЫ: ПРОВЕРКА ПО УТВЕРЖДЁННОЙ ТАБЛИЦЕ =====
 * Эталон 7 000 шагов на человека: экипаж ~60 дней, одиночка ~85
 * (таблицы, утверждённые Никитой 2026-10-09). Если правка правил сдвинет
 * эти числа, тест упадёт — и это повод пересогласовать, а не подогнать тест. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { replay, split, options, snapshot, leaveSnapshot, daysToNext, gift, legLength, ring, EARTH, FINAL, STOPS, MENU, BASES, RULES, type Choice, type GameDay, type Gift } from './game.ts'

const day = (i: number) => new Date(Date.UTC(2026, 9, 10 + i)).toISOString().slice(0, 10)

/** Прогнать игру до финала: людей на корабле — по функции от дня и мест. */
function play(choices: Partial<Record<number, Choice>>, people: (d: number, seats: number) => number, perPerson = 7000,
  hooks: Partial<Record<number, boolean>> = {}, seed = '') {
  const days: GameDay[] = []
  const arrive: Record<string, number> = {}
  for (let d = 1; d <= 400; d++) {
    const s = replay({ days, choices, hooks, seed })
    days.push({ day: day(d), ...split(0), counted: people(d, s.seats) * perPerson })
    const now = replay({ days, choices, hooks, seed })
    for (let k = 1; k <= now.stop; k++) arrive[STOPS[k]] ??= d
    if (now.phase === 'finished') return { days: d, arrive }
  }
  throw new Error('не долетели за 400 дней')
}

const TEAM: Partial<Record<number, Choice>> = { 0: 'crew', 1: 'engine', 2: 'engine', 3: 'engine', 4: 'cabin', 5: 'engine', 6: 'engine', 7: 'tank', 8: 'engine', 9: 'tank' }
const SOLO: Partial<Record<number, Choice>> = { 0: 'solo', 1: 'engine', 2: 'engine', 3: 'engine', 4: 'engine', 5: 'engine', 6: 'engine', 7: 'tank', 8: 'skip', 9: 'tank' }
const crewPeople = (d: number, seats: number) => seats === 5 ? 5 : Math.min(3, d)

test('экипаж: Луна на 10–12-й день, весь путь ~60 дней', () => {
  // друзья садятся на 2-й и 3-й день, после каюты на Марсе экипаж — пятеро
  const r = play(TEAM, crewPeople)
  assert.ok(r.arrive.moon >= 10 && r.arrive.moon <= 12, `Луна на ${r.arrive.moon}-й день`)
  assert.ok(Math.abs(r.days - 60) <= 2, `весь путь ${r.days} дней`)
})

test('одиночка: Луна на ~12-й день, весь путь ~85 дней', () => {
  const r = play(SOLO, () => 1)
  assert.ok(Math.abs(r.arrive.moon - 12) <= 1, `Луна на ${r.arrive.moon}-й день`)
  assert.ok(Math.abs(r.days - 85) <= 2, `весь путь ${r.days} дней`)
})

test('экипаж быстрее одиночки, но не втрое', () => {
  const team = play(TEAM, crewPeople).days
  const solo = play(SOLO, () => 1).days
  assert.ok(team < solo && solo < team * 1.6)
})

test('без выбора корабль стоит, а шаги не сгорают', () => {
  const days = [1, 2, 3].map(i => ({ day: day(i), counted: 7000, overflow: 0 }))
  const wait = replay({ days, choices: {} })
  assert.equal(wait.phase, 'stop'); assert.equal(wait.stop, 0); assert.equal(wait.credit, 21000)
  const go = replay({ days, choices: { 0: 'solo' } })
  assert.equal(go.phase, 'leg'); assert.equal(go.seats, 1)
  // одноместный за 7 000, остальные 14 000 шагов — уже в пути, вдвое дальше
  assert.equal(go.flown, 14000 * 2)
})

test('передумать на Земле без потерь: одиночка от тех же шагов', () => {
  const days = [1, 2, 3, 4].map(i => ({ day: day(i), counted: 7000, overflow: 0 }))
  const crew = replay({ days, choices: { 0: 'crew' } })
  assert.equal(crew.phase, 'stop')                    // 28 000 из 50 000 — ещё строим
  const solo = replay({ days, choices: { 0: 'solo' } })
  assert.equal(solo.flown, (28000 - 7000) * 2)
})

test('лишние шаги — в бак, бак выручает в слабый день', () => {
  const days: GameDay[] = [
    { day: day(1), ...split(16000) },               // 10 000 засчитано, 6 000 в бак
    { day: day(2), ...split(1000) },                // слабый день: бак добирает до 3 500
  ]
  const s = replay({ days, choices: { 0: 'solo' } })
  assert.equal(s.tank, 6000 - 2500)
  assert.equal(s.flown, (10000 + 3500 - 7000) * 2)
})

test('бак не больше 10 000 на место', () => {
  const s = replay({ days: [{ day: day(1), ...split(60000) }], choices: {} })
  assert.equal(s.tank, 10000)
})

test('что можно выбрать: у каждой планеты своё', () => {
  const at = (stop: number, seats: 1 | 3 | 5, engine = 0, tankLevel = 0, radar = false) =>
    options({ stop, seats, engine, tankLevel, radar }).map(o => o.choice)
  assert.deepEqual(at(0, 1), ['solo', 'crew'])
  assert.deepEqual(at(1, 3), ['engine', 'skip'])                    // Луна — только двигатель
  assert.deepEqual(at(1, 1), ['engine', 'crew', 'skip'])            // одиночка везде может пересесть
  assert.deepEqual(at(3, 3), ['engine', 'radar', 'skip'])           // Меркурий
  assert.deepEqual(at(4, 3), ['engine', 'cabin', 'skip'])           // Марс
  assert.deepEqual(at(4, 5), ['engine', 'skip'])                    // каюта уже есть
  assert.deepEqual(at(5, 3), ['engine', 'tank', 'skip'])            // Церера
  assert.deepEqual(at(7, 3), ['tank', 'radar', 'skip'])             // Сатурн
  assert.deepEqual(at(7, 3, 6, 2, true), ['skip'])                  // всё уже есть
  assert.deepEqual(at(9, 3), ['tank', 'cabin', 'skip'])             // Нептун
  assert.deepEqual(at(FINAL, 5), [])
  // двигатель предлагают семь планет на шесть ступеней
  assert.equal(Object.values(MENU).filter(m => m.includes('engine')).length, 7)
  // стоянка стоит день шагов всего экипажа, каюта — два
  const cost = (stop: number, c: Choice, seats: 1 | 3 | 5) => options({ stop, seats, engine: 0, tankLevel: 0, radar: false }).find(o => o.choice === c)!.cost
  assert.equal(cost(3, 'engine', 1), 7000); assert.equal(cost(3, 'engine', 3), 21000); assert.equal(cost(4, 'cabin', 3), 42000)
})

test('пересадка: снимок одиночки на планете — старт корабля экипажа', () => {
  const days = Array.from({ length: 30 }, (_, i) => ({ day: day(i), counted: 7000, overflow: 0 }))
  const at = replay({ days, choices: { 0: 'solo', 1: 'engine' } })
  assert.equal(at.phase, 'stop'); assert.equal(at.stop, 2)   // ждёт выбора на Венере
  const snap = snapshot(at)
  assert.equal(snap.engine, 1); assert.equal(snap.credit, at.credit)
  // корабль на 3 места строится из накопленного и шагов экипажа
  const crew = replay({ start: snap, days: [{ day: day(31), counted: 50000, overflow: 0 }], choices: { 2: 'crew' } })
  assert.equal(crew.seats, 3); assert.equal(crew.engine, 1); assert.equal(crew.phase, 'leg')
})

test('Юпитер разгоняет, туман и радар', () => {
  const s = replay({ start: { ...EARTH, stop: 6, seats: 3 }, days: [], choices: {} })
  assert.equal(s.visible, 7)
  const r = replay({ start: { ...EARTH, stop: 6, seats: 3, radar: true }, days: [], choices: {} })
  assert.equal(r.visible, 8)
  const fly = replay({ start: { ...EARTH, stop: 6, seats: 3 }, days: [{ day: day(1), counted: 21000, overflow: 0 }], choices: { 6: 'skip' } })
  assert.equal(fly.flown, 21000 * 2)
  assert.ok(daysToNext(fly, 21000)! > 0)
})

test('уход из экипажа: то же место, одноместный, апгрейды как у одиночки', () => {
  // экипаж на перегоне Марс → Церера: позади Луна, Венера, Меркурий, Марс
  const crew = replay({ start: { ...EARTH, stop: 4, seats: 5, engine: 3, radar: true, tank: 9000 }, days: [{ day: day(1), counted: 35000, overflow: 0 }], choices: { 4: 'skip' } })
  assert.equal(crew.phase, 'leg')
  const me = leaveSnapshot(crew, 3)
  assert.equal(me.seats, 1); assert.equal(me.stop, 4); assert.equal(me.flown, crew.flown)
  assert.equal(me.engine, 4)                      // одиночка к этому месту — 4 ступени
  assert.equal(me.radar, false); assert.equal(me.tank, 3000)
  const solo = replay({ start: me, days: [{ day: day(2), counted: 7000, overflow: 0 }], choices: {} })
  assert.ok(Math.abs(solo.flown - (crew.flown + 7000 * 2 ** 4 * 2)) < 1e-6)
  // ушёл на стоянке Сатурна: бак уже как у одиночки, радара ещё нет
  const atSaturn = leaveSnapshot(replay({ start: { ...EARTH, stop: 7, seats: 3, engine: 5 }, days: [], choices: {} }), 3)
  assert.equal(atSaturn.engine, 6); assert.equal(atSaturn.tankLevel, 0); assert.equal(atSaturn.flown, undefined)
})

/* ===== РАЗВИЛКИ И КОНТЕЙНЕРЫ ===== */

/** Зерно, при котором контейнер у развилки stop — нужный подарок (для пустого корабля). */
const seedFor = (stop: number, want: Gift) => {
  for (let i = 0; ; i++) if (gift(`s${i}`, stop, EARTH) === want) return `s${i}`
}

test('контейнер: доли подарков и одинаков для всего экипажа', () => {
  const n: Record<string, number> = {}
  for (let i = 0; i < 20000; i++) { const g = gift(`ship-${i}`, 4, EARTH); n[g] = (n[g] ?? 0) + 1 }
  assert.ok(Math.abs(n.engine / 20000 - 0.2) < 0.02 && Math.abs(n.boost / 20000 - 0.4) < 0.02, JSON.stringify(n))
  assert.ok(Math.abs(n.tank / 20000 - 0.2) < 0.02 && Math.abs(n.radar / 20000 - 0.2) < 0.02, JSON.stringify(n))
  assert.equal(gift('abc', 6, EARTH), gift('abc', 6, EARTH))
  // разные базы одного корабля — разные жребии
  assert.ok(new Set(Array.from({ length: 50 }, (_, i) => [4, 6, 7].map(b => gift(`x${i}`, b, EARTH)).join())).size > 10)
  // ненужное превращается в разгон: пустых контейнеров нет
  const full = { engine: 6, tankLevel: 2, radar: true }
  for (let i = 0; i < 200; i++) assert.equal(gift(`y${i}`, 7, full), 'boost')
})

test('крюк: на 30% длиннее, база на середине, бак доверху и подарок', () => {
  const start = { ...EARTH, stop: 4, seats: 3 as const, engine: 3 }
  const leg = legLength(4)                                 // Марс → Церера
  assert.equal(legLength(4, true), leg * 1.3)
  const per = 2 ** 3                                       // единиц пути на шаг: двигатель 3, без лёгкости
  const toBase = Math.ceil(leg * 1.3 / 2 / per)
  const seed = seedFor(4, 'radar')
  const days = [{ day: day(1), counted: toBase, overflow: 0 }]
  const s = replay({ start, days, choices: { 4: 'skip' }, hooks: { 4: true }, seed })
  assert.ok(s.hook && s.docked); assert.equal(s.radar, true); assert.deepEqual(s.gifts, { 4: 'radar' })
  assert.equal(s.tank, RULES.tankPerSeat * 3)              // бак доверху
  assert.ok(Math.abs(s.at - (4 + (toBase * per) / (leg * 1.3))) < 1e-9)
  // прямо — тот же путь ближе к Церере, и никакой базы
  const d = replay({ start, days, choices: { 4: 'skip' }, seed })
  assert.ok(!d.hook && d.at > s.at); assert.equal(d.radar, false)
  // крюк не у развилки не бывает
  assert.equal(replay({ start: { ...start, stop: 5 }, days, choices: { 5: 'skip' }, hooks: { 5: true } }).hook, false)
})

test('разгон из контейнера — вдвое быстрее до следующей планеты', () => {
  const start = { ...EARTH, stop: 4, seats: 3 as const, engine: 3 }
  const half = legLength(4, true) / 2, per = 2 ** 3
  const days = [{ day: day(1), counted: half / per + 1000, overflow: 0 }]
  const s = replay({ start, days, choices: { 4: 'skip' }, hooks: { 4: true }, seed: seedFor(4, 'boost') })
  assert.equal(s.boost, 2); assert.ok(Math.abs(s.flown - (half + 1000 * per * 2)) < 1e-6)
  // долетели до Цереры — разгон кончился
  const far = replay({ start, days: [{ day: day(1), counted: 200000, overflow: 0 }], choices: { 4: 'skip', 5: 'skip' }, hooks: { 4: true }, seed: seedFor(4, 'boost') })
  assert.equal(far.stop, 5); assert.equal(far.boost, 1)
})

test('двигатель из контейнера: голос за седьмую ступень становится пропуском', () => {
  const start = { ...EARTH, stop: 4, seats: 3 as const, engine: 5 }
  const days = [{ day: day(1), counted: 3_000_000, overflow: 0 }]
  const s = replay({ start, days, choices: { 4: 'skip', 5: 'engine' }, hooks: { 4: true }, seed: seedFor(4, 'engine') })
  assert.equal(s.gifts[4], 'engine'); assert.equal(s.engine, 6); assert.ok(s.stop > 5)
})

test('крюки не ломают баланс: от минус пары дней до плюс недели', () => {
  const direct = play(TEAM, crewPeople).days
  const hooks = { 4: true, 6: true, 7: true }
  const res = (['engine', 'boost', 'tank', 'radar'] as Gift[]).map(g => play(TEAM, crewPeople, 7000, hooks, seedFor(4, g)).days)
  for (const r of res) assert.ok(r >= direct - 8 && r <= direct + 2, `с крюками ${r} против ${direct}`)
})

test('ушёл посреди крюка — долетает крюк с того же места', () => {
  const start = { ...EARTH, stop: 6, seats: 5 as const, engine: 5 }
  const crew = replay({ start, days: [{ day: day(1), counted: 120000, overflow: 0 }], choices: { 6: 'skip' }, hooks: { 6: true }, seed: seedFor(6, 'boost') })
  assert.ok(crew.docked && crew.phase === 'leg')
  const me = leaveSnapshot(crew, 5)
  assert.equal(me.hook, true); assert.equal(me.docked, true); assert.equal(me.boost, crew.boost); assert.equal(me.flown, crew.flown)
  const solo = replay({ start: me, days: [], choices: {} })
  assert.ok(solo.hook && solo.docked && Math.abs(solo.at - crew.at) < 1e-9)
  assert.equal(Object.keys(BASES).length, 3)
})

test('кружок на экране дня: постройка, перегон и ожидание выбора', () => {
  const today = day(0)
  // одиночка в день старта: 4 000 шагов телефона из 7 000 на постройку
  const solo = { start: today, choices: { 0: 'solo' as Choice }, hooks: {}, steps: {}, seed: 'x' }
  assert.equal(ring(solo, { [today]: 4000 }, today)?.value, 4000 / 7000)
  // прибавка беты идёт сверху шагов телефона
  assert.equal(ring({ ...solo, bonus: { [today]: 500 } }, { [today]: 4000 }, today)?.value, 4500 / 7000)
  // построен — летит: доля перегона
  const r = ring(solo, { [today]: 9000 }, today)!
  assert.ok(r.value > 0 && r.value < 1 && !r.wait)
  // нет старта — кружок пустой
  assert.equal(ring({}, {}, today), null)
})
