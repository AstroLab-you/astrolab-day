/* ===== СПРАВОЧНИК ЗВЁЗДНОГО НЕБА ДЛЯ ПРИЛОЖЕНИЯ =====
 *
 *   node src/build-sky.ts <папка с данными d3-celestial> app/sky.json
 *
 * Из открытых данных d3-celestial (github.com/ofrohn/d3-celestial, BSD-3:
 * stars.6.json, starnames.json, constellations.json, constellations.lines.json,
 * constellations.bounds.json) собирает компактный файл для экрана «Небо»:
 *
 *   stars  — звёзды до 5,5m (их видно глазом за городом): RA, Dec, блеск, цвет;
 *   names  — русские имена самых ярких звёзд (до 2,5m);
 *   cons   — 88 созвездий: русское название, место подписи, линии фигуры
 *            и граница — по границе экран говорит, в каком созвездии планета.
 *
 * Координаты — J2000, прямое восхождение 0…360° (в исходнике −180…180).
 */

import { readFileSync, writeFileSync } from 'node:fs';

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error('Нужны: папка d3-celestial и путь к выходному JSON'); process.exit(2); }
const read = (f: string) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
const ra = (x: number) => Math.round(((x % 360) + 360) % 360 * 100) / 100;
const r2 = (x: number) => Math.round(x * 100) / 100;

const MAG = 5.5, NAMED_MAG = 2.5;
// цвет звезды по показателю B−V: 0 голубая … 4 красная — пять оттенков хватает глазу
const colorOf = (bv: number) => (Number.isNaN(bv) ? 2 : bv < 0 ? 0 : bv < 0.3 ? 1 : bv < 0.7 ? 2 : bv < 1.2 ? 3 : 4);

type StarF = { id: number; properties: { mag: number; bv: string }; geometry: { coordinates: [number, number] } };
const starsSrc = (read('stars.6.json').features as StarF[]).filter(f => f.properties.mag <= MAG).sort((a, b) => a.properties.mag - b.properties.mag);
const starNames = read('starnames.json') as Record<string, { ru?: string }>;
const stars: number[][] = [], names: [number, string][] = [];
for (const f of starsSrc) {
  const [x, y] = f.geometry.coordinates;
  if (f.properties.mag <= NAMED_MAG && starNames[f.id]?.ru) names.push([stars.length, starNames[f.id].ru!]);
  stars.push([ra(x), r2(y), Math.round(f.properties.mag * 10) / 10, colorOf(parseFloat(f.properties.bv))]);
}

type ConF = { id: string; properties: { ru: string; rank: string }; geometry: { coordinates: [number, number] } };
const lines = new Map((read('constellations.lines.json').features as { id: string; geometry: { coordinates: [number, number][][] } }[]).map(f => [f.id, f.geometry.coordinates]));
const bounds = new Map((read('constellations.bounds.json').features as { id: string; geometry: { type: string; coordinates: unknown } }[]).map(f => [f.id, f.geometry]));
const flat = (pts: [number, number][]) => pts.flatMap(([x, y]) => [ra(x), r2(y)]);
const cons = (read('constellations.json').features as ConF[]).map(f => {
  const b = bounds.get(f.id)!;
  // Polygon → [кольцо], MultiPolygon → [[кольцо]…]; берём внешние кольца
  const rings = (b.type === 'Polygon' ? [(b.coordinates as [number, number][][])[0]] : (b.coordinates as [number, number][][][]).map(p => p[0]));
  return {
    id: f.id, ru: f.properties.ru, rank: +f.properties.rank,
    label: [ra(f.geometry.coordinates[0]), r2(f.geometry.coordinates[1])],
    lines: (lines.get(f.id) ?? []).map(flat),
    bounds: rings.map(flat),
  };
});

writeFileSync(out, JSON.stringify({ source: 'd3-celestial (Olaf Frohn), BSD-3-Clause; J2000', stars, names, cons }));
console.error(`${out}: звёзд ${stars.length}, с именами ${names.length}, созвездий ${cons.length}`);
