/* ===== ДВИЖОК ПРИЛОЖЕНИЯ: РАСЧЁТ В ФОНОВОМ ПОТОКЕ =====
 *
 * Собирается в app/www/engine.js (app/build.sh, esbuild) и запускается
 * экраном дня как модульный Web Worker: расчёт идёт ~0,5 с на десктопе
 * и дольше на телефоне, а в главном потоке он подвесил бы анимацию колеса.
 *
 * Вход:  { natal: NatalInput, nowTz, today?, title?, place? }
 * Выход: { type: 'step', step, ms } по ходу и { type: 'done', forecast }
 *        или { type: 'error', message }.
 *
 * Экран «Небо» (sky.html) спрашивает положения планет на момент:
 * Вход:  { type: 'sky', ms }    Выход: { type: 'sky', jd, bodies }
 */

// @ts-expect-error — модуль Emscripten без типов, лежит рядом с engine.js
import createSweph from './sweph.mjs';
import { loadWasmEphemeris } from './eph-wasm.ts';
import { buildForecast, type ForecastInput } from './forecast.ts';
import { skyNow } from './sky-now.ts';

const ready = loadWasmEphemeris(createSweph);

self.onmessage = async (e: MessageEvent<Omit<ForecastInput, 'onStep'> | { type: 'sky'; ms: number }>) => {
  try {
    await ready;
    if ('type' in e.data && e.data.type === 'sky') { self.postMessage({ type: 'sky', ...skyNow(e.data.ms) }); return; }
    const forecast = buildForecast({ ...(e.data as Omit<ForecastInput, 'onStep'>), onStep: (step, ms) => self.postMessage({ type: 'step', step, ms }) });
    self.postMessage({ type: 'done', forecast });
  } catch (err) {
    self.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
