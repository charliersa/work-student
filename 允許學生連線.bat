@echo off
chcp 65001 > nul
cd /d "%~dp0"
title 允許學生連線 - 防火牆設定

REM 需要系統管理員權限才能改防火牆，沒有的話自己重新以管理員身分啟動
net session > nul 2>&1
if errorlevel 1 (
    echo 需要系統管理員權限，正在重新啟動...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ============================================================
echo   允許學生電腦連線（防火牆設定）
echo ============================================================
echo.

REM 從 .env 讀 PORT，讀不到就用 3000
set "PORT=3000"
if exist ".env" (
    for /f "tokens=2 delims==" %%p in ('findstr /r "^PORT=" ".env"') do set "PORT=%%p"
)
echo 使用連接埠：%PORT%
echo.

REM 先移除舊規則，避免重複執行時越加越多
powershell -NoProfile -Command ^
  "Remove-NetFirewallRule -DisplayName '學生作業繳交系統' -ErrorAction SilentlyContinue"

REM 只開放私人網路（校內），不開放公用網路
powershell -NoProfile -Command ^
  "New-NetFirewallRule -DisplayName '學生作業繳交系統' -Direction Inbound -Protocol TCP -LocalPort %PORT% -Action Allow -Profile Private,Domain | Out-Null"

if errorlevel 1 (
    echo [錯誤] 防火牆規則建立失敗。
    echo.
    pause
    exit /b 1
)

echo [完成] 已允許學生從校內網路連到連接埠 %PORT%。
echo.

REM 檢查有沒有「封鎖 Node」的舊規則 —— 通常是之前在跳出視窗按了「取消」留下的
powershell -NoProfile -Command ^
  "$b = Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue | Where-Object { $_.Action -eq 'Block' } | ForEach-Object { $p = ($_ | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue).Program; if ($p -like '*\nodejs\node.exe') { $_ } };" ^
  "if ($b) { Write-Host '[注意] 偵測到封鎖 Node.js 的舊規則，正在移除：' -ForegroundColor Yellow; $b | ForEach-Object { Write-Host ('  ' + $_.DisplayName); Remove-NetFirewallRule -Name $_.Name } } else { Write-Host '沒有發現封鎖 Node.js 的規則，正常。' }"

echo.
echo 接下來請執行「啟動伺服器.bat」，並把畫面上顯示的網址給學生。
echo.
pause
