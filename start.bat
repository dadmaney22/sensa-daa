@echo off
REM ============================================================
REM  Sensa - pull latest, then launch backend + frontend
REM ============================================================
setlocal

REM Always run from the directory this script lives in (repo root)
cd /d "%~dp0"

echo.
echo === Pulling latest from git ===
REM Pull the current branch from origin. Continue even if the pull
REM fails (e.g. offline) so the app still starts on the local copy.
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
echo Current branch: %BRANCH%
git pull origin %BRANCH%
if errorlevel 1 (
    echo.
    echo [warning] git pull failed - starting with the local version.
)

echo.
echo === Starting backend (FastAPI / uvicorn) ===
REM Install/refresh Python deps first (fast no-op once installed), then run.
start "Sensa Backend" cmd /k "cd /d "%~dp0sensa-ui\backend" && python -m pip install -q -r requirements.txt && python -m uvicorn main:app --reload"

echo.
echo === Starting frontend (Vite) ===
start "Sensa Frontend" cmd /k "cd /d "%~dp0sensa-ui" && npm run dev"

echo.
echo Backend and frontend launched in separate windows.
endlocal
