/* ===== ВРЕМЯ РОЖДЕНИЯ → ВСЕМИРНОЕ ВРЕМЯ =====
 *
 * Клиент называет местное гражданское время: «14:30 по Москве». Эфемериде
 * нужно всемирное. Между ними — смещение пояса, и именно здесь ошибаются
 * чаще всего: в СССР декретное время, летнее время 1981–1991 и 1997–2010,
 * «вечное лето» 2011–2014, переезды регионов между поясами. Ошибка на час
 * сдвигает Асцендент примерно на знак, Луну — на полградуса.
 *
 * Смещение берётся из базы часовых поясов IANA (tzdb), которая встроена
 * в Node через ICU, вместе со всей историей переходов. До введения поясов
 * tzdb даёт среднее местное время (LMT) с точностью до секунды.
 *
 * Если астролог знает смещение точнее (из свидетельства о рождении, из
 * атласа), его можно задать явно — оно имеет приоритет над tzdb.
 */

export type LocalBirthTime = {
  year: number;
  month: number;   // 1–12
  day: number;
  hour: number;
  minute: number;
  second?: number;
};

export type UtcResolution = {
  utc: { year: number; month: number; day: number; hour: number; minute: number; second: number };
  offsetSeconds: number;        // местное − UTC
  source: 'tzdb' | 'manual';
  warnings: string[];
};

// Смещение пояса в заданный момент: раскладываем момент на местные
// поля и смотрим, насколько они «убежали» от UTC. Секунды сохраняются,
// поэтому LMT вроде +2:30:17 у Москвы до 1919 года выходит точным.
function offsetAt(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p: Record<string, number> = {};
  for (const x of parts) if (x.type !== 'literal') p[x.type] = Number(x.value);
  // Date.UTC трактует годы 0–99 как 1900-е — для рождений не актуально
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - utcMs) / 1000);
}

export function localToUtc(t: LocalBirthTime, timeZone?: string, manualOffsetHours?: number): UtcResolution {
  const warnings: string[] = [];
  const sec = t.second ?? 0;
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, Math.floor(sec)) + (sec % 1) * 1000;
  let offset: number;
  let source: UtcResolution['source'];

  if (manualOffsetHours !== undefined) {
    offset = Math.round(manualOffsetHours * 3600);
    source = 'manual';
  } else if (timeZone) {
    // Ищем такое смещение, при котором «местное − смещение» само имеет
    // это смещение. Два кандидата — смещения за сутки до и после: если
    // подходят оба, время неоднозначно (осенний перевод часов), если
    // ни один — такого времени не существовало (весенний перевод).
    const candidates = new Set([offsetAt(timeZone, wall - 86400_000), offsetAt(timeZone, wall + 86400_000), offsetAt(timeZone, wall)]);
    const valid = [...candidates].filter(o => offsetAt(timeZone, wall - o * 1000) === o).sort((a, b) => b - a);
    if (valid.length === 0) {
      // как Temporal 'compatible': часы ещё не переведены, смещение прежнее
      offset = offsetAt(timeZone, wall - 86400_000);
      warnings.push(`Местного времени ${fmtLocal(t)} в поясе ${timeZone} не существовало — часы переводили вперёд. Взято смещение ${fmtOffset(offset)}; уточните время у клиента.`);
    } else {
      offset = valid[0];
      if (valid.length > 1) {
        warnings.push(`Местное время ${fmtLocal(t)} в поясе ${timeZone} неоднозначно — часы переводили назад, такой момент был дважды (${valid.map(fmtOffset).join(' и ')}). Взято ${fmtOffset(offset)}, летнее; уточните у клиента.`);
      }
    }
    source = 'tzdb';
  } else {
    throw new Error('Нужен часовой пояс IANA (например, Europe/Moscow) или явное смещение utcOffset');
  }

  const u = new Date(wall - offset * 1000);
  return {
    utc: {
      year: u.getUTCFullYear(), month: u.getUTCMonth() + 1, day: u.getUTCDate(),
      hour: u.getUTCHours(), minute: u.getUTCMinutes(),
      second: u.getUTCSeconds() + u.getUTCMilliseconds() / 1000,
    },
    offsetSeconds: offset,
    source,
    warnings,
  };
}

export function fmtOffset(seconds: number): string {
  const s = seconds < 0 ? '−' : '+';
  const a = Math.abs(seconds);
  const h = Math.floor(a / 3600), m = Math.floor((a % 3600) / 60), r = a % 60;
  return `${s}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}${r ? ':' + String(r).padStart(2, '0') : ''}`;
}

function fmtLocal(t: LocalBirthTime): string {
  const z = (n: number) => String(n).padStart(2, '0');
  return `${t.year}-${z(t.month)}-${z(t.day)} ${z(t.hour)}:${z(t.minute)}`;
}
