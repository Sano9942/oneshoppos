@echo off
echo ===================================================
echo           Starting OneShopPOS System
echo ===================================================

:: Check if Node is installed (Silent check)
node -v >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed. Please install Node.js from https://nodejs.org/
    pause
    exit
)

echo.
echo [1/3] Starting Backend API Server (Port 5000)...
start "OneShopPOS Backend API" cmd /c "cd backend && npm start"

:: Give backend 3 seconds to spin up
timeout /t 3 /nobreak >nul

echo.
echo [2/3] Starting Frontend Terminal UI (Port 5173)...
start "OneShopPOS Terminal UI" cmd /c "cd frontend && npm run dev"

:: Give frontend 3 seconds to spin up
timeout /t 3 /nobreak >nul

echo.
echo [3/3] Launching System...
echo Opening POS in default browser...
start http://localhost:5173/

echo.
echo ===================================================
echo  OneShopPOS is running!
echo  Please DO NOT close the two black command windows 
echo  that were just opened. Closing them will stop 
echo  the application.
echo ===================================================
echo Press any key to safely shut down the system later.
pause >nul

:: Cleanup: Kill the node processes when the user presses a key on this main script
echo Shutting down OneShopPOS...
taskkill /f /im node.exe >nul 2>&1
echo Done. You can close this window.
pause
