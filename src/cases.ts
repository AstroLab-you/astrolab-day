/* ===== КОНТРОЛЬНЫЕ КАРТЫ ДЛЯ СВЕРКИ =====
 *
 * Подобраны так, чтобы задеть места, где расчёт обычно ломается:
 * летнее время СССР, полярный круг, южное и западное полушарие,
 * местное среднее время до введения поясов, конец века и недавние даты.
 * Все рождения вымышленные, кроме Эйнштейна — его данные публичны
 * и есть в базе Астродинамики с рейтингом AA.
 */

import type { NatalInput } from './natal.ts';

export type Case = { label: string; input: NatalInput };

export const CASES: Case[] = [
  {
    label: 'Москва, 1990, летнее время СССР (UTC+4)',
    input: { birth: { year: 1990, month: 5, day: 14, hour: 14, minute: 30 }, place: { latitude: 55.7558, longitude: 37.6173, timeZone: 'Europe/Moscow' } },
  },
  {
    label: 'Санкт-Петербург, 1975, зима (UTC+3)',
    input: { birth: { year: 1975, month: 11, day: 3, hour: 7, minute: 45 }, place: { latitude: 59.9386, longitude: 30.3141, timeZone: 'Europe/Moscow' } },
  },
  {
    label: 'Новосибирск, 2003, поздний вечер',
    input: { birth: { year: 2003, month: 2, day: 20, hour: 23, minute: 10 }, place: { latitude: 55.0302, longitude: 82.9204, timeZone: 'Asia/Novosibirsk' } },
  },
  {
    label: 'Владивосток, 1968',
    input: { birth: { year: 1968, month: 8, day: 8, hour: 5, minute: 5 }, place: { latitude: 43.1155, longitude: 131.8855, timeZone: 'Asia/Vladivostok' } },
  },
  {
    label: 'Мурманск, 1985, за полярным кругом (Плацидус → Порфирий)',
    input: { birth: { year: 1985, month: 12, day: 21, hour: 3, minute: 15 }, place: { latitude: 68.9585, longitude: 33.0827, timeZone: 'Europe/Moscow' } },
  },
  {
    label: 'Буэнос-Айрес, 2001, южное и западное полушарие',
    input: { birth: { year: 2001, month: 1, day: 1, hour: 0, minute: 0, second: 30 }, place: { latitude: -34.6037, longitude: -58.3816, timeZone: 'America/Argentina/Buenos_Aires' } },
  },
  {
    label: 'Казань, 2024',
    input: { birth: { year: 2024, month: 7, day: 15, hour: 9, minute: 0 }, place: { latitude: 55.7963, longitude: 49.1088, timeZone: 'Europe/Moscow' } },
  },
  {
    // До 1893 года в Германии жили по местному среднему времени города.
    // tzdb для Europe/Berlin дало бы берлинское (+0:53:28), а родился он
    // в Ульме (+0:39:56) — поэтому смещение задано вручную от долготы.
    label: 'Эйнштейн, Ульм, 1879, местное среднее время',
    input: { birth: { year: 1879, month: 3, day: 14, hour: 11, minute: 30 }, place: { latitude: 48.4, longitude: 9.9833, utcOffset: 9.9833 / 15 } },
  },
];
