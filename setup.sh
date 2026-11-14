#!/usr/bin/env bash
# One-time setup for macOS and Linux: Python packages, the LightGBM fix on macOS, and the built web app.
# Run from anywhere:  ./setup.sh      (safe to run again)
set -euo pipefail
cd "$(dirname "$0")"

say() { printf "\n\033[1;32m==> %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31mSetup stopped: %s\033[0m\n" "$1"; exit 1; }

say "Checking Python (3.9 or newer)"
PYTHON=$(command -v python3 || command -v python || true)
[[ -n "$PYTHON" ]] || fail "Python 3 not found. Install it from https://www.python.org/downloads/ (or: brew install python)."
"$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
  || fail "Python 3.9+ is needed; found $("$PYTHON" --version 2>&1)."
echo "Using $("$PYTHON" --version 2>&1)"

say "Checking Node.js (18 or newer)"
command -v node >/dev/null || fail "Node.js not found. Install the LTS version from https://nodejs.org (or: brew install node), then open a new Terminal."
node -e 'process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)' || fail "Node.js 18+ is needed; found $(node --version)."
echo "Using Node $(node --version)"

say "Installing the backend (Python packages in backend/.venv)"
[[ -d backend/.venv ]] || "$PYTHON" -m venv backend/.venv
backend/.venv/bin/python -m pip install --upgrade pip --quiet
backend/.venv/bin/python -m pip install -r backend/requirements.txt --quiet

if [[ "$(uname)" == "Darwin" ]]; then
  say "Making sure LightGBM loads on macOS"
  backend/scripts/fix_lightgbm_macos.sh backend/.venv/bin/python
fi

say "Installing and building the frontend"
(cd frontend && npm install --no-fund --no-audit && npm run build)

say "Checking the dataset"
DATA_DIR="data/synth_home_credit"
if [[ -d "$DATA_DIR/csv_files" ]]; then
  echo "Found the dataset in $DATA_DIR"
else
  echo "Dataset not found in $DATA_DIR."
  echo "Put the synth_home_credit folder (with csv_files/ and solution.csv inside) at data/synth_home_credit."
fi

say "Done. Start the app with ./start.sh, then open http://localhost:8000"
