@echo off
rem One-time setup for Windows: Python packages and the built web app.
rem Double-click it, or run "setup.bat" in Command Prompt from the project folder. Safe to run again.
setlocal
cd /d "%~dp0"

echo.
echo ==^> Checking Python (3.9 or newer)
set "PYTHON="
where py >nul 2>nul && set "PYTHON=py -3"
if not defined PYTHON where python >nul 2>nul && set "PYTHON=python"
if not defined PYTHON (
  echo Python not found. Install it from https://www.python.org/downloads/ and tick "Add python.exe to PATH".
  goto :failed
)
%PYTHON% -c "import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)"
if errorlevel 1 (
  echo Python 3.9 or newer is needed.
  goto :failed
)
%PYTHON% --version

echo.
echo ==^> Checking Node.js (18 or newer)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install the LTS version from https://nodejs.org
  echo ^(or run: winget install OpenJS.NodeJS.LTS^), then open a new Command Prompt.
  goto :failed
)
node -e "process.exit(parseInt(process.versions.node) >= 18 ? 0 : 1)"
if errorlevel 1 (
  echo Node.js 18 or newer is needed.
  goto :failed
)
node --version

echo.
echo ==^> Installing the backend (Python packages in backend\.venv)
if not exist backend\.venv %PYTHON% -m venv backend\.venv
backend\.venv\Scripts\python.exe -m pip install --upgrade pip --quiet
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --quiet
if errorlevel 1 goto :failed

rem LightGBM needs the Microsoft C++ runtime; most PCs already have it
backend\.venv\Scripts\python.exe -c "import lightgbm" 2>nul
if errorlevel 1 (
  echo LightGBM could not load. Install the "Microsoft Visual C++ Redistributable" ^(x64^) from
  echo https://learn.microsoft.com/cpp/windows/latest-supported-vc-redist and run setup.bat again.
  goto :failed
)

echo.
echo ==^> Installing and building the frontend
pushd frontend
call npm install --no-fund --no-audit
if errorlevel 1 (popd & goto :failed)
call npm run build
if errorlevel 1 (popd & goto :failed)
popd

echo.
echo ==^> Checking the dataset
set "DATA_DIR=data\synth_home_credit"
if exist "%DATA_DIR%\csv_files" (
  echo Found the dataset in %DATA_DIR%
) else (
  echo Dataset not found in %DATA_DIR%.
  echo Put the synth_home_credit folder ^(with csv_files and solution.csv inside^) at data\synth_home_credit.
)

echo.
echo ==^> Done. Start the app with start.bat, then open http://localhost:8000
pause
exit /b 0

:failed
echo.
echo Setup stopped. Fix the problem above and run setup.bat again.
pause
exit /b 1
