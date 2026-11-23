#!/usr/bin/env bash
# ===== СБОРКА ПРИЛОЖЕНИЯ ДЛЯ ANDROID =====
#
#   ./build.sh                  → dist/astrolab-day-<версия>.apk (для GitHub)
#   CHANNEL=rustore ./build.sh  → dist/astrolab-day-<версия>-rustore.apk (для RuStore)
#   ./build.sh www              → только www/ — проверить страницы в браузере без Gradle
#   BETA=1 ./build.sh           → dist/astrolab-day-<версия>-beta.apk — для своих телефонов:
#                                 в игре кнопка «+500 шагов» для проверки. Не для релиза:
#                                 release.sh с BETA откажется
#
# 1. www/: экран дня (index.html) и колесо без вшитых данных — так
#    страница понимает, что она приложение, и считает сама; движок
#    (engine.js, esbuild из src/app-engine.ts), Swiss Ephemeris в WASM
#    (../wasm/sweph.mjs), справочник городов (cities.json), экран «Небо»
#    (sky.html), его звёздный справочник (sky.json) и таблица «ещё в
#    космосе» — кометы, астероиды, зонды (bodies.json), экран игры
#    (game.html) с правилами (game-rules.js, esbuild из src/game.ts)
#    и картинками (game/, у арта своя лицензия — game/LICENSE).
# 2. Capacitor переносит www/ в Android-проект, Gradle собирает APK,
#    подписанный ключом из ~/.config/astrolab-day/keystore.properties.
#
# Нужны JDK 17+ и Android SDK: JAVA_HOME и ANDROID_HOME (см. README).
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./package.json').version")
# канал: github — обновления из релизов GitHub; rustore — обновляет RuStore,
# ссылок на APK со стороны нет (правила магазина). APK — …-rustore.apk
CHANNEL=${CHANNEL:-github}
case "$CHANNEL" in github) SUFFIX="" ;; rustore) SUFFIX="-rustore" ;; *) echo "CHANNEL: github или rustore" >&2; exit 1 ;; esac
# бета — флаг игры, а не канал: обновляется так же, как выбранный канал
BETA=${BETA:-}
[ -n "$BETA" ] && SUFFIX="$SUFFIX-beta"
IFS=. read -r MA MI PA <<<"$VERSION"
CODE=$((MA * 10000 + MI * 100 + PA))

rm -rf www && mkdir -p www dist
node - "$VERSION" "$CHANNEL" "$BETA" <<'JS'
const fs = require('fs');
const version = process.argv[2], channel = process.argv[3], beta = process.argv[4] ? '1' : '0';
// вшитые данные прототипа заменяются на null: дальше считает приложение
const strip = (src, dst, begin, end, id) => {
  const html = fs.readFileSync(src, 'utf8'), a = html.indexOf(begin), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`${src}: нет меток ${begin} … ${end}`);
  const out = html.slice(0, a) + `${begin}\n<script id="${id}" type="application/json">null</script>\n` + html.slice(b);
  fs.writeFileSync(dst, out.replace("'__APP_VERSION__'", JSON.stringify(version)).replace("'__APP_CHANNEL__'", JSON.stringify(channel)));
};
strip('../day.html', 'www/index.html', '<!-- DAY-DATA:BEGIN -->', '<!-- DAY-DATA:END -->', 'day-data');
strip('../wheel.html', 'www/wheel.html', '<!-- CHART-DATA:BEGIN -->', '<!-- CHART-DATA:END -->', 'chart-data');
fs.writeFileSync('www/sky.html', fs.readFileSync('../sky.html', 'utf8'));
const game = fs.readFileSync('../game.html', 'utf8');
if (!game.includes("'__GAME_BETA__'")) throw new Error('game.html: нет метки __GAME_BETA__');
fs.writeFileSync('www/game.html', game.replace("'__GAME_BETA__'", `'${beta}'`));
JS
(cd .. && npx esbuild src/app-engine.ts --bundle --format=esm --platform=browser --target=chrome90 \
   --external:./sweph.mjs --log-level=warning --outfile=app/www/engine.js)
# отпечаток движка — в ключ кэша прогноза (day.html): новый расчёт
# сбрасывает сохранённый прогноз, даже если номер версии не поднят
ENGINE_HASH=$(sha256sum www/engine.js | cut -c1-12)
grep -q "'__ENGINE_HASH__'" www/index.html || { echo "day.html: нет метки __ENGINE_HASH__" >&2; exit 1; }
sed -i "s/'__ENGINE_HASH__'/'$ENGINE_HASH'/" www/index.html
(cd .. && npx esbuild src/game.ts --bundle --format=esm --platform=browser --target=chrome90 \
   --log-level=warning --outfile=app/www/game-rules.js)
cp ../wasm/sweph.mjs cities.json sky.json bodies.json www/
cp -R ../game www/
[ "${1:-}" = www ] && { echo "www/ собран, версия $VERSION, канал $CHANNEL${BETA:+, бета}"; exit 0; }

npx cap sync android >/dev/null
(cd android && ./gradlew -q assembleRelease -PappVersionCode="$CODE" -PappVersionName="$VERSION")
APK=android/app/build/outputs/apk/release/app-release.apk
[ -f "$APK" ] || { echo "Нет подписанного APK: проверьте ключ в ~/.config/astrolab-day/keystore.properties" >&2; exit 1; }
cp "$APK" "dist/astrolab-day-$VERSION$SUFFIX.apk"
echo "dist/astrolab-day-$VERSION$SUFFIX.apk ($(du -h "dist/astrolab-day-$VERSION$SUFFIX.apk" | cut -f1)), версия $VERSION, код $CODE, канал $CHANNEL${BETA:+, бета}"
