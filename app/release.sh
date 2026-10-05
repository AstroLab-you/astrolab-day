#!/usr/bin/env bash
# ===== РЕЛИЗ ПРИЛОЖЕНИЯ =====
#
#   ./release.sh ["что нового"]
#
# 1. Собирает APK (build.sh) с версией из app/package.json.
# 2. Кладёт в публичный репозиторий AstroLab-you/astrolab-day снимок
#    закоммиченных файлов tools/natal-calc — исходники ровно той версии,
#    что в APK (этого требует AGPL). История приватного репозитория туда
#    не попадает: только снимки по версиям.
# 3. Создаёт релиз v<версия> с APK — его находит кнопка «Проверить
#    обновление» в приложении.
# 4. Собирает ту же версию для RuStore (dist/…-rustore.apk) — её загружают
#    в консоль RuStore.
#
# Незакоммиченные правки в tools/natal-calc — отказ: иначе исходники
# в релизе разойдутся со сборкой.
set -euo pipefail
cd "$(dirname "$0")"
REPO=AstroLab-you/astrolab-day
PUB=${ASTROLAB_PUBLIC_DIR:-$HOME/.cache/astrolab-day-public}
VERSION=$(node -p "require('./package.json').version")
NOTES=${1:-"Версия $VERSION"}

if [ -n "$(git status --porcelain -- ..)" ]; then
  echo "В tools/natal-calc есть незакоммиченные правки — сначала коммит:" >&2
  git status --short -- .. >&2; exit 1
fi
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo "Релиз v$VERSION уже есть — поднимите версию в app/package.json" >&2; exit 1
fi

./build.sh
APK="dist/astrolab-day-$VERSION.apk"

# снимок исходников: ровно то, что в git, без node_modules, эфемерид и сборок
if [ -d "$PUB/.git" ]; then git -C "$PUB" pull -q --ff-only || true
else gh repo clone "$REPO" "$PUB" -- -q; git -C "$PUB" symbolic-ref HEAD refs/heads/main; fi
find "$PUB" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
(cd .. && git ls-files -z | tar --null -T - -cf -) | tar -xf - -C "$PUB"
SRC_SHA=$(git rev-parse --short HEAD)
git -C "$PUB" add -A
git -C "$PUB" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "Версия $VERSION" -m "$NOTES" || echo "исходники не менялись"
git -C "$PUB" push -q origin HEAD:main
gh release create "v$VERSION" "$APK" --repo "$REPO" --title "Версия $VERSION" --notes "$NOTES" --target "$(git -C "$PUB" rev-parse HEAD)"
echo "Готово: https://github.com/$REPO/releases/tag/v$VERSION (исходники из $SRC_SHA)"

# та же версия для RuStore: без ссылок на APK со стороны, обновляет магазин.
# Загружается в консоль RuStore (Приложения → Astrolab → Загрузить версию):
# версия в RuStore не должна отставать от GitHub — правило магазина
CHANNEL=rustore ./build.sh
