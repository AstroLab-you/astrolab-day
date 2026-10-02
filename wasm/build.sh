#!/usr/bin/env bash
# ===== СБОРКА SWISS EPHEMERIS В WEBASSEMBLY =====
# Тот же C-код 2.10.03, что считает в Node (из пакета sweph), — чтобы
# телефон и сервер давали одинаковые числа. Файлы эфемерид (1800–2400 гг.)
# вшиты в модуль, а сам .wasm — в .js (SINGLE_FILE): один файл, без
# загрузок по сети, работает и по file://.
# Нужен Emscripten: source ~/.local/opt/emsdk/emsdk_env.sh
set -euo pipefail
cd "$(dirname "$0")/.."
SRC=node_modules/sweph/swisseph
emcc -O3 \
  $SRC/sweph.c $SRC/swephlib.c $SRC/swejpl.c $SRC/swemmoon.c $SRC/swemplan.c \
  $SRC/swedate.c $SRC/swehouse.c $SRC/swecl.c $SRC/swehel.c \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createSweph -s SINGLE_FILE=1 \
  -s ENVIRONMENT=web,worker,node -s ALLOW_MEMORY_GROWTH=1 -s FILESYSTEM=1 \
  -s EXPORTED_FUNCTIONS='["_swe_calc_ut","_swe_houses_ex2","_swe_utc_to_jd","_swe_set_ephe_path","_swe_set_sid_mode","_swe_get_ayanamsa_ut","_swe_version","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","getValue","setValue","UTF8ToString","stringToUTF8","HEAPF64"]' \
  --embed-file ephe/sepl_18.se1@/ephe/sepl_18.se1 \
  --embed-file ephe/semo_18.se1@/ephe/semo_18.se1 \
  --embed-file ephe/seas_18.se1@/ephe/seas_18.se1 \
  -o wasm/sweph.mjs
ls -la wasm/sweph.mjs
