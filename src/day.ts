/* ===== ПРОГНОЗ НА ДЕНЬ: КОМАНДНАЯ СТРОКА =====
 *
 *   node src/day.ts --date 1990-05-14 --time 14:30 --lat 55.7558 \
 *     --lon 37.6173 --tz Europe/Moscow [--today 2026-10-02] \
 *     [--now-tz Europe/Moscow] [--place Москва] [--write day.html]
 *
 * Сам расчёт — в forecast.ts (тот же код считает в телефоне). Здесь только
 * разбор аргументов и запись результата в блок #day-data страницы.
 * Время шагов печатается в stderr.
 */

import './eph-node.ts';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildForecast } from './forecast.ts';

const { values: v } = parseArgs({
  options: {
    date: { type: 'string' }, time: { type: 'string', default: '12:00' },
    lat: { type: 'string' }, lon: { type: 'string' },
    tz: { type: 'string' }, offset: { type: 'string' },
    today: { type: 'string' }, 'now-tz': { type: 'string' },
    place: { type: 'string', default: '' }, title: { type: 'string', default: 'Натальная карта' },
    write: { type: 'string' },
  },
});
if (!v.date || v.lat === undefined || v.lon === undefined || (!v.tz && v.offset === undefined)) {
  console.error('Нужны --date, --time, --lat, --lon и --tz (или --offset). См. шапку src/day.ts.');
  process.exit(2);
}
const [year, month, day] = v.date.split('-').map(Number);
const [hour, minute] = v.time.split(':').map(Number);

const out = buildForecast({
  natal: {
    birth: { year, month, day, hour, minute },
    place: { latitude: Number(v.lat), longitude: Number(v.lon), timeZone: v.tz, utcOffset: v.offset !== undefined ? Number(v.offset) : undefined },
  },
  nowTz: v['now-tz'] ?? v.tz ?? 'UTC',
  today: v.today, title: v.title, place: v.place,
});

console.error(`Время расчёта, мс: ${JSON.stringify(out.generated.ms)}`);
if (v.write) {
  const begin = '<!-- DAY-DATA:BEGIN -->', end = '<!-- DAY-DATA:END -->';
  const html = readFileSync(v.write, 'utf8');
  const a = html.indexOf(begin), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`В ${v.write} нет меток ${begin} … ${end}`);
  const json = JSON.stringify(out).replaceAll('</', '<\\/');
  writeFileSync(v.write, html.slice(0, a) + `${begin}\n<script id="day-data" type="application/json">${json}</script>\n` + html.slice(b));
  console.error(`${v.write}: данные дня обновлены (${out.days[0].date} … ${out.days.at(-1)!.date})`);
} else {
  console.log(JSON.stringify(out, null, 2));
}
