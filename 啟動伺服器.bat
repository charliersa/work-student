@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 學生作業繳交系統

echo ============================================================
echo   學生作業繳交系統
echo ============================================================
echo.

where node > nul 2>&1
if errorlevel 1 (
    echo [錯誤] 找不到 Node.js。
    echo.
    echo 請先到 https://nodejs.org 下載安裝 LTS 版本（20 以上），
    echo 安裝完把這個視窗關掉，重新執行一次本檔案。
    echo.
    pause
    exit /b 1
)

if not exist ".env" (
    echo [設定] 第一次執行，正在建立設定檔 .env ...
    copy ".env.production.example" ".env" > nul
    echo.
    echo   已建立 .env，但裡面的 JWT_SECRET 還沒設定。
    echo   請用記事本打開 .env，把 JWT_SECRET 那一行換成一組隨機字串後再執行一次。
    echo.
    echo   產生隨機字串的指令（可直接複製到這個視窗執行）：
    echo     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
    echo.
    pause
    exit /b 1
)

findstr /c:"請換掉這一行" ".env" > nul 2>&1
if not errorlevel 1 (
    echo [錯誤] .env 裡的 JWT_SECRET 還沒換掉。
    echo.
    echo 請用記事本打開 .env，把 JWT_SECRET 換成下面這行指令產生的字串：
    echo     node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [安裝] 第一次執行，正在安裝相依套件，需要幾分鐘 ...
    call npm install
    if errorlevel 1 goto failed
)

if not exist "apps\web\dist\index.html" (
    echo [建置] 正在建置程式 ...
    call npm run build
    if errorlevel 1 goto failed
)

if not exist "apps\api\.data" (
    echo [資料庫] 第一次執行，正在建立資料庫與範例帳號 ...
    call npm run db:migrate
    if errorlevel 1 goto failed
    call npm run db:seed
    if errorlevel 1 goto failed
)

echo.
echo ============================================================
echo   啟動中... 學生要連的網址會顯示在下面
echo   要關閉伺服器：直接關掉這個視窗，或按 Ctrl+C
echo ============================================================
echo.

call npm start
goto end

:failed
echo.
echo [錯誤] 上一個步驟失敗了，請把畫面訊息截圖回報。
echo.
pause
exit /b 1

:end
pause
