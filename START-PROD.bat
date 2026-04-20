@echo off
title SanoPOS - PRODUCTION Supabase (DANGER)
color 4F
echo ================================================
echo.
echo    !!!  PRODUCTION SUPABASE MODE  !!!
echo.
echo   This backend will connect to the LIVE customer database.
echo   Every query touches real merchant records.
echo.
echo   Use this ONLY to:
echo     - Reproduce a specific tenant's bug
echo     - Inspect real data that can't be faked locally
echo     - Verify a migration ran correctly after deploy
echo.
echo   For normal dev work: CLOSE THIS and run START-FRESH.bat
echo.
echo ================================================
echo.
echo   Are you SURE? Press Ctrl+C now to abort.
pause

echo [1/3] Killing any existing node processes...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/3] Starting backend against PRODUCTION Supabase...
echo      (Look for RED banner in Backend window)
start "SanoPOS Backend (PROD)" cmd /k "cd /d d:\newprojects\oneshoppos\backend && npm run dev:prod -- --yes-really"
timeout /t 4 /nobreak >nul

echo [3/3] Starting frontend (Vite HMR)...
start "SanoPOS Frontend" cmd /k "cd /d d:\newprojects\oneshoppos\frontend && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo ================================================
echo   Running against PRODUCTION Supabase.
echo.
echo   App:  http://localhost:5173
echo.
echo   Close both terminal windows when done,
echo   then re-run START-FRESH.bat to return to local mode.
echo ================================================
start "" "http://localhost:5173"
