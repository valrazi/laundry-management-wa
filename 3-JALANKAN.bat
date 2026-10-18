@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   LANGKAH 3 - MENJALANKAN GATEWAY WHATSAPP
echo ============================================================
echo.

if not exist "node_modules" (
  echo [GAGAL] Komponen belum terpasang. Jalankan 1-INSTALL.bat lebih dulu.
  goto :selesai
)
if not exist ".env" (
  echo [GAGAL] File .env belum ada. Jalankan 1-INSTALL.bat lebih dulu.
  goto :selesai
)

if exist "auth_state\creds.json" (
  echo Perangkat WhatsApp sudah pernah ditautkan. Tidak perlu scan QR lagi.
) else (
  echo [PERHATIAN] Gateway belum tertaut ke WhatsApp.
  echo Setelah QR muncul, buka WhatsApp di HP lalu pilih:
  echo    Pengaturan - Perangkat Tertaut - Tautkan perangkat
)

echo.
echo Halaman status akan terbuka otomatis di browser:
echo    http://127.0.0.1:3001
echo.
echo JANGAN tutup jendela ini selama gateway dipakai.
echo Untuk menghentikan, tekan Ctrl+C.
echo.

start "" /min powershell -NoProfile -Command "Start-Sleep -Seconds 8; Start-Process 'http://127.0.0.1:3001'"
call npm start

:selesai
echo.
pause
endlocal
