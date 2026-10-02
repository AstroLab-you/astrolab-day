/* ===== ЭФЕМЕРИДЫ В WEBASSEMBLY =====
 * Тот же C-код Swiss Ephemeris 2.10.03, собранный wasm/build.sh, с файлами
 * эфемерид внутри модуля. Обёртка повторяет форму ответов пакета sweph:
 * память под выходные массивы выделяется на куче модуля и сразу освобождается. */

import { useEphemeris, type Ephemeris } from './eph.ts';

const SERR = 256; // AS_MAXCH: буфер текста ошибки

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadWasmEphemeris(createSweph: (opts?: object) => Promise<any>): Promise<Ephemeris> {
  const M = await createSweph();
  const pathPtr = M._malloc(16);
  M.stringToUTF8('/ephe', pathPtr, 16);
  M._swe_set_ephe_path(pathPtr);

  const doubles = (ptr: number, n: number) => Array.from(M.HEAPF64.subarray(ptr >> 3, (ptr >> 3) + n)) as number[];
  const withBufs = <T>(sizes: number[], fn: (...ptrs: number[]) => T): T => {
    const ptrs = sizes.map(s => M._malloc(s));
    try { return fn(...ptrs); } finally { ptrs.forEach(p => M._free(p)); }
  };

  const e: Ephemeris = {
    calc_ut: (jd, ipl, flags) => withBufs([6 * 8, SERR], (xx, serr) => {
      M.setValue(serr, 0, 'i8');
      const flag = M._swe_calc_ut(jd, ipl, flags, xx, serr);
      return { flag, error: M.UTF8ToString(serr), data: doubles(xx, 6) };
    }),
    houses_ex2: (jd, flags, lat, lon, hsys) => withBufs([37 * 8, 10 * 8, 37 * 8, 10 * 8, SERR], (cusps, pts, cs, ps, serr) => {
      M.setValue(serr, 0, 'i8');
      const flag = M._swe_houses_ex2(jd, flags, lat, lon, hsys.charCodeAt(0), cusps, pts, cs, ps, serr);
      return { flag, error: M.UTF8ToString(serr), data: { houses: doubles(cusps + 8, 12), points: doubles(pts, 8) } };
    }),
    utc_to_jd: (y, m, d, h, min, sec, greg) => withBufs([2 * 8, SERR], (dret, serr) => {
      M.setValue(serr, 0, 'i8');
      const flag = M._swe_utc_to_jd(y, m, d, h, min, sec, greg, dret, serr);
      return { flag, error: M.UTF8ToString(serr), data: doubles(dret, 2) };
    }),
    set_sid_mode: (mode, t0, ayan) => M._swe_set_sid_mode(mode, t0, ayan),
    get_ayanamsa_ut: jd => M._swe_get_ayanamsa_ut(jd),
    version: () => withBufs([SERR], buf => { M._swe_version(buf); return M.UTF8ToString(buf); }),
  };
  useEphemeris(e);
  return e;
}
