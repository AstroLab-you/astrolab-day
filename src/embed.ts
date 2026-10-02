/* ===== ДАННЫЕ КАРТЫ → СТРАНИЦА СХЕМЫ =====
 *
 *   node src/cli.ts --date 1990-05-14 --time 14:30 --lat 55.7558 \
 *     --lon 37.6173 --tz Europe/Moscow --json \
 *     | node src/embed.ts wheel.html "Натальная карта" "Москва"
 *
 * Кладёт JSON расчёта в блок #chart-data страницы — между метками
 * CHART-DATA:BEGIN и CHART-DATA:END, остальное не трогает. Подпись
 * и город попадают в центр круга: в самом расчёте их нет.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [file, title = 'Натальная карта', placeName = ''] = process.argv.slice(2);
if (!file) {
  console.error('Нужен путь к странице: node src/embed.ts wheel.html [подпись] [город]');
  process.exit(2);
}

const chart = JSON.parse(readFileSync(0, 'utf8'));
chart.display = { title, place: placeName };

const begin = '<!-- CHART-DATA:BEGIN -->', end = '<!-- CHART-DATA:END -->';
const html = readFileSync(file, 'utf8');
const a = html.indexOf(begin), b = html.indexOf(end);
if (a < 0 || b < a) {
  console.error(`В ${file} нет меток ${begin} … ${end}`);
  process.exit(1);
}

// «</» внутри JSON закрыл бы тег script раньше времени
const json = JSON.stringify(chart).replaceAll('</', '<\\/');
const block = `${begin}\n<script id="chart-data" type="application/json">${json}</script>\n`;
writeFileSync(file, html.slice(0, a) + block + html.slice(b));
console.log(`${file}: данные карты обновлены (${chart.time.local}, ${placeName || 'без города'})`);
