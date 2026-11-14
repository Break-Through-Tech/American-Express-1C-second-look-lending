#!/usr/bin/env bash
# Starts the app on http://localhost:8000 (API and web app together). Run ./setup.sh once first.
# ./start.sh --dev also starts the frontend dev server on http://localhost:5173, which reloads as you edit.
set -euo pipefail
cd "$(dirname "$0")"

[[ -x backend/.venv/bin/uvicorn ]] || { echo "Run ./setup.sh first."; exit 1; }

if [[ "${1:-}" == "--dev" ]]; then
  (cd frontend && npm run dev) &
  trap 'kill %1 2>/dev/null' EXIT
  echo "Frontend dev server: http://localhost:5173"
fi

echo "Starting the app on http://localhost:8000  (press Ctrl+C to stop)"
cd backend
.venv/bin/uvicorn app.main:app --port 8000 ${1:+--reload}
