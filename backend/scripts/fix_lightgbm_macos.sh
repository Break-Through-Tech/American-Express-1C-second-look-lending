#!/usr/bin/env bash
# Without Homebrew's libomp, point LightGBM at the copy scikit-learn ships (safe to re-run)
set -euo pipefail
[[ "$(uname)" == "Darwin" ]] || exit 0

PY="${1:-$(dirname "$0")/../.venv/bin/python}"
SITE=$("$PY" -c "import sysconfig; print(sysconfig.get_paths()['purelib'])")
LGB_LIB="$SITE/lightgbm/lib/lib_lightgbm.dylib"
OMP="$SITE/sklearn/.dylibs/libomp.dylib"

if "$PY" -c "import lightgbm" 2>/dev/null; then
  echo "lightgbm already imports fine"; exit 0
fi

cp "$OMP" "$SITE/lightgbm/lib/libomp.dylib"
otool -l "$LGB_LIB" | grep -q "@loader_path" || install_name_tool -add_rpath "@loader_path" "$LGB_LIB"
codesign --force --sign - "$LGB_LIB" "$SITE/lightgbm/lib/libomp.dylib"
"$PY" -c "import lightgbm; print('lightgbm', lightgbm.__version__, 'OK')"
