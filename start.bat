@echo off
rem Starts the app on http://localhost:8000 (API and web app together). Run setup.bat once first.
rem "start.bat --dev" also opens the frontend dev server on http://localhost:5173, which reloads as you edit.
setlocal
cd /d "%~dp0"

if not exist backend\.venv\Scripts\uvicorn.exe (
  echo Run setup.bat first.
  pause
  exit /b 1
)

set "RELOAD="
if "%~1"=="--dev" (
  start "Second-Look frontend" cmd /k "cd /d frontend && npm run dev"
  echo Frontend dev server: http://localhost:5173
  set "RELOAD=--reload"
)

echo Starting the app on http://localhost:8000  (press Ctrl+C to stop)
cd backend
.venv\Scripts\uvicorn.exe app.main:app --port 8000 %RELOAD%
