@echo off
title OneShopPOS Startup
echo ================================
echo   Starting OneShopPOS...
echo ================================

echo [1/2] Starting backend server...
start "OneShopPOS Backend" cmd /k "cd /d d:\newprojects\oneshoppos\backend && node index.js"

timeout /t 2 /nobreak > nul

echo [2/2] Starting frontend dev server...
start "OneShopPOS Frontend" cmd /k "cd /d d:\newprojects\oneshoppos\frontend && npm run dev"

timeout /t 3 /nobreak > nul

echo.
echo ================================
echo   Both servers are starting!
echo   Open: http://localhost:5173
echo ================================
start "" "http://localhost:5173"
