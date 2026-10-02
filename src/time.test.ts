/* ===== ТЕСТЫ ПЕРЕВОДА ВРЕМЕНИ =====
 *
 *   node --test src/*.test.ts
 *
 * Сверяют вывод с историей поясов, которую легко проверить по
 * timeanddate.com: летнее время СССР, «вечное лето» 2011–2014,
 * смена пояса Новосибирска в 2016-м, LMT до введения поясов.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localToUtc } from './time.ts';

const at = (y: number, mo: number, d: number, h: number, mi: number) => ({ year: y, month: mo, day: d, hour: h, minute: mi });
const hours = (r: ReturnType<typeof localToUtc>) => r.offsetSeconds / 3600;

test('Москва: зима и лето 1985 года', () => {
  assert.equal(hours(localToUtc(at(1985, 1, 15, 12, 0), 'Europe/Moscow')), 3);
  assert.equal(hours(localToUtc(at(1985, 7, 15, 12, 0), 'Europe/Moscow')), 4);
});

test('Москва: «вечное лето» 2011–2014 и возврат на UTC+3', () => {
  assert.equal(hours(localToUtc(at(2012, 1, 15, 12, 0), 'Europe/Moscow')), 4);
  assert.equal(hours(localToUtc(at(2015, 1, 15, 12, 0), 'Europe/Moscow')), 3);
});

test('Новосибирск перешёл с UTC+6 на UTC+7 24 июля 2016', () => {
  assert.equal(hours(localToUtc(at(2016, 7, 20, 12, 0), 'Asia/Novosibirsk')), 6);
  assert.equal(hours(localToUtc(at(2016, 7, 25, 12, 0), 'Asia/Novosibirsk')), 7);
});

test('Москва до 1919 года — местное среднее время +2:30:17', () => {
  assert.equal(localToUtc(at(1900, 6, 1, 12, 0), 'Europe/Moscow').offsetSeconds, 2 * 3600 + 30 * 60 + 17);
});

test('весенний перевод: несуществующее время даёт предупреждение', () => {
  const r = localToUtc(at(1985, 3, 31, 2, 30), 'Europe/Moscow');
  assert.equal(hours(r), 3);
  assert.equal(r.warnings.length, 1);
});

test('осенний перевод: неоднозначное время даёт предупреждение', () => {
  const r = localToUtc(at(1985, 9, 29, 2, 30), 'Europe/Moscow');
  assert.equal(r.warnings.length, 1);
});

test('явное смещение важнее пояса', () => {
  const r = localToUtc(at(1985, 7, 15, 12, 0), 'Europe/Moscow', 3);
  assert.equal(r.source, 'manual');
  assert.deepEqual([r.utc.hour, r.utc.minute], [9, 0]);
});

test('переход через полночь и дату', () => {
  const r = localToUtc(at(2003, 1, 1, 2, 0), 'Asia/Vladivostok');
  assert.deepEqual([r.utc.year, r.utc.month, r.utc.day, r.utc.hour], [2002, 12, 31, 16]);
});
