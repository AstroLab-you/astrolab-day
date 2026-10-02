/* ===== WEBASSEMBLY СЧИТАЕТ ТАК ЖЕ, КАК NODE =====
 * Телефон считает через wasm/sweph.mjs, сервер — через нативный sweph.
 * Тест гоняет контрольные карты и прогноз дня через обе реализации
 * и требует совпадения. Модуль собирается wasm/build.sh; если его нет,
 * тест пропускается. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import sweph from 'sweph';
import { fileURLToPath } from 'node:url';
import { useEphemeris } from './eph.ts';
import { loadWasmEphemeris } from './eph-wasm.ts';
import { calculateNatal } from './natal.ts';
import { buildForecast } from './forecast.ts';
import { CASES } from './cases.ts';

const wasmPath = new URL('../wasm/sweph.mjs', import.meta.url);
const skip = !existsSync(fileURLToPath(wasmPath)) && 'нет wasm/sweph.mjs — соберите wasm/build.sh';
sweph.set_ephe_path(fileURLToPath(new URL('../ephe', import.meta.url)));

async function both<T>(fn: () => T): Promise<[T, T]> {
  useEphemeris(sweph);
  const native = fn();
  const { default: createSweph } = await import(wasmPath.href);
  await loadWasmEphemeris(createSweph);
  const wasm = fn();
  return [native, wasm];
}

test('натальные карты: WASM = нативный', { skip }, async () => {
  for (const cs of CASES) {
    const [a, b] = await both(() => calculateNatal(cs.input));
    assert.equal(b.meta.ephemeris, a.meta.ephemeris, cs.label);
    for (let i = 0; i < a.bodies.length; i++)
      assert.ok(Math.abs(a.bodies[i].longitude - b.bodies[i].longitude) < 1e-9, `${cs.label}: ${a.bodies[i].id}`);
    for (let i = 0; i < (a.houses?.length ?? 0); i++)
      assert.ok(Math.abs(a.houses![i].longitude - b.houses![i].longitude) < 1e-9, `${cs.label}: дом ${i + 1}`);
  }
});

test('прогноз на семь дней: WASM = нативный', { skip }, async () => {
  const inp = { natal: CASES[0].input, nowTz: 'Europe/Moscow', today: '2026-10-02' };
  const [a, b] = await both(() => buildForecast(inp));
  // числа — с допуском 1e-9: порядок операций с плавающей точкой у
  // компиляторов разный, и последние знаки могут не совпасть
  const diffs: string[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    if (typeof x === 'number' && typeof y === 'number') { if (Math.abs(x - y) > 1e-9) diffs.push(`${path}: ${x} ≠ ${y}`); return; }
    if (typeof x !== 'object' || x === null) { if (x !== y) diffs.push(`${path}: ${x} ≠ ${y}`); return; }
    for (const k of new Set([...Object.keys(x), ...Object.keys((y ?? {}) as object)]))
      walk((x as Record<string, unknown>)[k], (y as Record<string, unknown> | undefined)?.[k], `${path}.${k}`);
  };
  walk({ ...a, generated: null }, { ...b, generated: null }, '');
  assert.deepEqual(diffs.slice(0, 10), []);
  console.log(`время: нативный ${a.generated.ms.total} мс, WASM ${b.generated.ms.total} мс`);
});
