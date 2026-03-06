@echo off
title OneShopPOS - Super Admin Panel
echo ================================
echo   OneShopPOS - Super Admin Panel
echo ================================

echo [1/4] Killing any existing node processes...
taskkill /f /im node.exe >nul 2>&1
timeout /t 1 /nobreak >nul

echo [2/4] Seeding super-admin (if not already created)...
cd /d d:\newprojects\oneshoppos\backend
node seed-admin.js --email admin@example.com --password secret123 2>nul
timeout /t 1 /nobreak >nul

echo [3/4] Starting backend server...
start "OneShopPOS Backend" cmd /k "cd /d d:\newprojects\oneshoppos\backend && node index.js"
timeout /t 3 /nobreak >nul

echo [4/4] Starting frontend dev server...
start "OneShopPOS Frontend" cmd /k "cd /d d:\newprojects\oneshoppos\frontend && npm run dev"
timeout /t 4 /nobreak >nul

echo.
echo ================================
echo   Super Admin Panel ready!
echo   Open: http://localhost:5173/admin/login
echo.
echo   Email:    admin@example.com
echo   Password: secret123
echo ================================
start "" "http://localhost:5173/admin/login"
