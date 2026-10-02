#!/usr/bin/env bash
# Файлы эфемерид Swiss Ephemeris на 1800–2400 годы (~2 МБ):
# планеты, Луна, астероиды (нужны для Хирона). Без них библиотека
# считает по теории Мошье — точность ~1″ вместо ~0.001″.
# Источник — официальный репозиторий Astrodienst.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p ephe
base=https://raw.githubusercontent.com/aloistr/swisseph/master/ephe
for f in sepl_18.se1 semo_18.se1 seas_18.se1; do
  [ -s "ephe/$f" ] && { echo "есть: $f"; continue; }
  curl -fsSL -o "ephe/$f.part" "$base/$f" && mv "ephe/$f.part" "ephe/$f"
  echo "скачан: $f"
done
