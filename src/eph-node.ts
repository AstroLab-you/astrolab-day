/* ===== ЭФЕМЕРИДЫ В NODE ===== нативный пакет sweph и файлы из ../ephe.
 * Импортировать первым в точках входа (cli.ts, day.ts, validate.ts). */

import { fileURLToPath } from 'node:url';
import sweph from 'sweph';
import { useEphemeris } from './eph.ts';

// Файлы эфемерид лежат рядом с модулем. Без них библиотека молча падает
// на аналитическую теорию Мошье (точность ~1″ вместо ~0.001″) — это
// ловится проверкой флага в natal.ts и попадает в предупреждения.
sweph.set_ephe_path(fileURLToPath(new URL('../ephe', import.meta.url)));
useEphemeris(sweph);
