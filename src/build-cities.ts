/* ===== СПРАВОЧНИК ГОРОДОВ ДЛЯ ПРИЛОЖЕНИЯ =====
 *
 *   node src/build-cities.ts <папка с файлами GeoNames> app/cities.json
 *
 * Из выгрузки GeoNames (download.geonames.org/export/dump: cities1000.txt,
 * alternateNamesV2.txt, admin1CodesASCII.txt, countryInfo.txt) собирает
 * компактный список мест для поиска места рождения без интернета:
 * русское название, регион и страна по-русски, координаты и часовой пояс.
 *
 * Россия и соседи — все места от 1000 жителей (рождаются и в райцентрах),
 * остальной мир — от 15 000. Данные GeoNames — CC BY 4.0, ссылка на
 * источник есть в приложении.
 */

import { createReadStream, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const [dir, outPath] = process.argv.slice(2);
if (!dir || !outPath) { console.error('Нужны: папка GeoNames и путь к выходному JSON'); process.exit(2); }

const NEAR = new Set(['RU', 'UA', 'BY', 'KZ', 'UZ', 'KG', 'TJ', 'AM', 'AZ', 'GE', 'MD', 'LV', 'LT', 'EE', 'TM']);
const lines = (f: string) => readFileSync(`${dir}/${f}`, 'utf8').split('\n').filter(l => l && !l.startsWith('#'));

type City = { id: number; name: string; ascii: string; lat: number; lon: number; cc: string; adm: string; pop: number; tz: string };
const cities: City[] = [];
for (const l of lines('cities1000.txt')) {
  const f = l.split('\t');
  const pop = +f[14], cc = f[8];
  if (!f[17] || (!NEAR.has(cc) && pop < 15000)) continue;
  cities.push({ id: +f[0], name: f[1], ascii: f[2], lat: +f[4], lon: +f[5], cc, adm: `${cc}.${f[10]}`, pop, tz: f[17] });
}

const admins = new Map<string, { id: number; name: string }>();
for (const l of lines('admin1CodesASCII.txt')) { const f = l.split('\t'); admins.set(f[0], { id: +f[3], name: f[1] }); }
const countries = new Map<string, { id: number; name: string }>();
for (const l of lines('countryInfo.txt')) { const f = l.split('\t'); countries.set(f[0], { id: +f[16], name: f[4] }); }

// русские названия: предпочтительное, иначе первое не историческое и не разговорное
const want = new Set<number>([...cities.map(c => c.id), ...[...admins.values()].map(a => a.id), ...[...countries.values()].map(c => c.id)]);
const ru = new Map<number, { name: string; pref: boolean }>();
const rl = createInterface({ input: createReadStream(`${dir}/alternateNamesV2.txt`) });
for await (const l of rl) {
  const f = l.split('\t');
  if (f[2] !== 'ru') continue;
  const id = +f[1];
  if (!want.has(id) || f[6] === '1' || f[7] === '1') continue;
  const pref = f[4] === '1', prev = ru.get(id);
  if (!prev || (pref && !prev.pref)) ru.set(id, { name: f[3], pref });
}
const ruName = (id: number, fallback: string) => ru.get(id)?.name ?? fallback;

// часовые пояса и подписи «регион, страна» — отдельными списками, в записи только номер
const tzs: string[] = [], tzIdx = new Map<string, number>();
const where: string[] = [], whereIdx = new Map<string, number>();
const idx = (list: string[], map: Map<string, number>, v: string) => { let i = map.get(v); if (i === undefined) { i = list.length; list.push(v); map.set(v, i); } return i; };

// порядок поиска: крупнее — выше, но Россия и соседи с весом ×10 — приложение
// русскоязычное, и «Кир» должен найти Киров раньше Киркука
const rank = (c: City) => c.pop * (NEAR.has(c.cc) ? 10 : 1);
cities.sort((a, b) => rank(b) - rank(a));
const rows = cities.map(c => {
  const a = admins.get(c.adm), k = countries.get(c.cc);
  // GeoNames пишет «Кировская Область» — служебные слова со строчной
  const label = [a && ruName(a.id, a.name), k && ruName(k.id, k.name)].filter(Boolean).join(', ')
    .replace(/ (Область|Край|Округ|Район|Автономный)/g, m => m.toLowerCase());
  const name = ruName(c.id, c.name);
  // латиница — для поиска «Moscow»; если совпадает с русским, не дублируем
  return [name, c.ascii === name ? '' : c.ascii, idx(where, whereIdx, label), Math.round(c.lat * 1e4) / 1e4, Math.round(c.lon * 1e4) / 1e4, idx(tzs, tzIdx, c.tz)];
});
const out = { source: 'GeoNames, CC BY 4.0 — geonames.org', fields: ['name', 'latin', 'where', 'lat', 'lon', 'tz'], tz: tzs, where, rows };
writeFileSync(outPath, JSON.stringify(out));
console.error(`${outPath}: ${rows.length} мест, русские названия у ${cities.filter(c => ru.has(c.id)).length}`);
