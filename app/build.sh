#!/usr/bin/env bash
# ===== СБОРКА ПРИЛОЖЕНИЯ ДЛЯ ANDROID =====
#
#   ./build.sh            → dist/astrolab-day-<версия>.apk
#   ./build.sh www        → только www/ — проверить страницы в браузере без Gradle
#
# 1. www/: экран дня (index.html) и колесо без вшитых данных — так
#    страница понимает, что она приложение, и считает сама; движок
#    (engine.js, esbuild из src/app-engine.ts), Swiss Ephemeris в WASM
#    (../wasm/sweph.mjs), справочник городов (cities.json), экран «Небо»
#    (sky.html) и его звёздный справочник (sky.json).
# 2. Capacitor переносит www/ в Android-проект, Gradle собирает APK,
#    подписанный ключом из ~/.config/astrolab-day/keystore.properties.
#
# Нужны JDK 17+ и Android SDK: JAVA_HOME и ANDROID_HOME (см. README).
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./package.json').version")
IFS=. read -r MA MI PA <<<"$VERSION"
CODE=$((MA * 10000 + MI * 100 + PA))

rm -rf www && mkdir -p www dist
node - "$VERSION" <<'JS'
const fs = require('fs');
const version = process.argv[2];
// вшитые данные прототипа заменяются на null: дальше считает приложение
const strip = (src, dst, begin, end, id) => {
  const html = fs.readFileSync(src, 'utf8'), a = html.indexOf(begin), b = html.indexOf(end);
  if (a < 0 || b < a) throw new Error(`${src}: нет меток ${begin} … ${end}`);
  const out = html.slice(0, a) + `${begin}\n<script id="${id}" type="application/json">null</script>\n` + html.slice(b);
  fs.writeFileSync(dst, out.replace("'__APP_VERSION__'", JSON.stringify(version)));
};
strip('../day.html', 'www/index.html', '<!-- DAY-DATA:BEGIN -->', '<!-- DAY-DATA:END -->', 'day-data');
strip('../wheel.html', 'www/wheel.html', '<!-- CHART-DATA:BEGIN -->', '<!-- CHART-DATA:END -->', 'chart-data');
fs.writeFileSync('www/sky.html', fs.readFileSync('../sky.html', 'utf8'));
JS
(cd .. && npx esbuild src/app-engine.ts --bundle --format=esm --platform=browser --target=chrome90 \
   --external:./sweph.mjs --log-level=warning --outfile=app/www/engine.js)
cp ../wasm/sweph.mjs cities.json sky.json www/
[ "${1:-}" = www ] && { echo "www/ собран, версия $VERSION"; exit 0; }

npx cap sync android >/dev/null
(cd android && ./gradlew -q assembleRelease -PappVersionCode="$CODE" -PappVersionName="$VERSION")
APK=android/app/build/outputs/apk/release/app-release.apk
[ -f "$APK" ] || { echo "Нет подписанного APK: проверьте ключ в ~/.config/astrolab-day/keystore.properties" >&2; exit 1; }
cp "$APK" "dist/astrolab-day-$VERSION.apk"
echo "dist/astrolab-day-$VERSION.apk ($(du -h "dist/astrolab-day-$VERSION.apk" | cut -f1)), версия $VERSION, код $CODE"
