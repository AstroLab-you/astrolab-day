/* ===== ДВИЖОК ПРИЛОЖЕНИЯ: РАСЧЁТ В ФОНОВОМ ПОТОКЕ =====
 *
 * Собирается в app/www/engine.js (app/build.sh, esbuild) и запускается
 * экраном дня как модульный Web Worker: расчёт идёт ~0,5 с на десктопе
 * и дольше на телефоне, а в главном потоке он подвесил бы анимацию колеса.
 *
 * Вход:  { natal: NatalInput, nowTz, today?, title?, place? }
 * Выход: { type: 'step', step, ms } по ходу и { type: 'done', forecast }
 *        или { type: 'error', message }.
 */

// @ts-expect-error — модуль Emscripten без типов, лежит рядом с engine.js
import createSweph from './sweph.mjs';
import { loadWasmEphemeris } from './eph-wasm.ts';
import { buildForecast, type ForecastInput } from './forecast.ts';

const ready = loadWasmEphemeris(createSweph);

self.onmessage = async (e: MessageEvent<Omit<ForecastInput, 'onStep'>>) => {
  try {
    await ready;
    const forecast = buildForecast({ ...e.data, onStep: (step, ms) => self.postMessage({ type: 'step', step, ms }) });
    self.postMessage({ type: 'done', forecast });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
