/* ===== ЛУННЫЙ КАЛЕНДАРЬ: СВЕРКА С КАТАЛОГОМ ЗАТМЕНИЙ И ФАЗ =====
 * Затмения 2026–2027 — по каталогу NASA (eclipse.gsfc.nasa.gov): тип и дата
 * по всемирному времени. Фазы — по тому же каталогу фаз Луны, допуск 2 мин.
 * Луна без курса проверяется по смыслу: период кончается переходом Луны
 * в следующий знак и начинается не раньше входа в текущий. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import './eph-node.ts';
import { moonCalendar } from './moon-calendar.ts';

const NASA_ECLIPSES = [
  ['2026-02-17', 'solar'], ['2026-03-03', 'lunar'], ['2026-08-12', 'solar'], ['2026-08-28', 'lunar'],
  ['2027-02-06', 'solar'], ['2027-02-20', 'penumbral'], ['2027-07-18', 'penumbral'], ['2027-08-02', 'solar'], ['2027-08-17', 'penumbral'],
];

test('затмения 2026–2027 совпадают с каталогом NASA', () => {
  const found = new Map<string, string>();
  for (let i = 0; i < 24; i++) {
    const y = 2026 + Math.floor(i / 12), m = i % 12 + 1;
    for (const p of moonCalendar({ ms: Date.UTC(y, m - 1, 15), tz: 'UTC', year: y, month: m }).phases)
      if (p.eclipse && new Date(p.ms).getUTCFullYear() === y && new Date(p.ms).getUTCMonth() === m - 1) found.set(new Date(p.ms).toISOString().slice(0, 10), p.eclipse);
  }
  assert.deepEqual([...found].sort(), NASA_ECLIPSES.slice().sort());
});

test('фазы Луны — с точностью до пары минут', () => {
  // NASA, фазы Луны 2026 (UT): новолуние 10 окт 15:50, полнолуние 26 окт 04:12
  const r = moonCalendar({ ms: Date.UTC(2026, 9, 4, 12), tz: 'Europe/Moscow', year: 2026, month: 10 });
  const at = (kind: number, iso: string) => {
    const p = r.phases.find(x => x.kind === kind && Math.abs(x.ms - Date.parse(iso)) < 6 * 3600_000);
    assert.ok(p, `нет фазы ${kind} около ${iso}`);
    assert.ok(Math.abs(p.ms - Date.parse(iso)) < 2 * 60_000, `${kind}: ${new Date(p.ms).toISOString()} против ${iso}`);
  };
  at(0, '2026-10-10T15:50:00Z');
  at(2, '2026-10-26T04:12:00Z');
});

test('Луна без курса кончается переходом в следующий знак', () => {
  const r = moonCalendar({ ms: Date.UTC(2026, 9, 4, 12), tz: 'Europe/Moscow', year: 2026, month: 10 });
  assert.ok(r.voc.length >= 3);
  for (const v of r.voc) {
    assert.ok(v.from < v.to);
    assert.ok(v.to - v.from < 3 * 86_400_000, 'период короче трёх суток');
    const next = r.days.find(d => d.ingress && Math.abs(d.ingress.ms - v.to) < 60_000);
    if (next) assert.equal(next.ingress!.sign, (v.sign + 1) % 12);
  }
  assert.equal(r.days.length, 31);
});
