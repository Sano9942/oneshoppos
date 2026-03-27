@echo off
title SanoPOS - Local Dev (Multi-Tenant)
echo ================================================
echo   SanoPOS - Local Dev Server
echo   Mode: MULTI-TENANT (Store Code login)
echo ================================================
echo.
echo   *** WARNING ***
echo   Your backend/.env points to SUPABASE PRODUCTION.
echo   Any data you create locally GOES INTO THE LIVE DB.
echo   To use an isolated local DB instead, run Docker
echo   Postgres and swap DATABASE_URL in backend/.env.
echo ================================================
echo.
pause

echo [1/4] Killing any existing node processes...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/4] Clearing Vite cache...
if exist "d:\newprojects\oneshoppos\frontend\node_modules\.vite" (
    rmdir /s /q "d:\newprojects\oneshoppos\frontend\node_modules\.vite"
    echo      Cache cleared.
) else (
    echo      No cache found, skipping.
)

echo [3/4] Starting backend (Express + Postgres, MULTI_TENANT=1)...
start "SanoPOS Backend" cmd /k "cd /d d:\newprojects\oneshoppos\backend && node index.js"
timeout /t 3 /nobreak >nul

echo [4/4] Starting frontend (Vite HMR)...
start "SanoPOS Frontend" cmd /k "cd /d d:\newprojects\oneshoppos\frontend && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo ================================================
echo   Both servers running!
echo.
echo   App:    http://localhost:5173
echo   Login:  Store Code + Username + Password
echo   API:    http://localhost:5000/api/health
echo.
echo   Frontend source changes = instant HMR reload
echo   Backend source changes  = restart Backend window
echo ================================================
start "" "http://localhost:5173"
