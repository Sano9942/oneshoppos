@echo off
title OneShopPOS - Fresh Start
echo ================================
echo   OneShopPOS - Fresh Start
echo   (clears Vite cache first)
echo ================================

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

echo [3/4] Starting backend server...
start "OneShopPOS Backend" cmd /k "cd /d d:\newprojects\oneshoppos\backend && node index.js"
timeout /t 3 /nobreak >nul

echo [4/4] Starting frontend dev server...
start "OneShopPOS Frontend" cmd /k "cd /d d:\newprojects\oneshoppos\frontend && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo ================================
echo   Both servers starting fresh!
echo   Open: http://localhost:5173
echo ================================
start "" "http://localhost:5173"
