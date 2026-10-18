@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   LANGKAH 2 - MEMERIKSA DATABASE
echo ============================================================
echo.

if not exist ".env" (
  echo [GAGAL] File .env belum ada. Jalankan 1-INSTALL.bat lebih dulu.
  goto :selesai
)
if not exist "node_modules" (
  echo [GAGAL] Komponen belum terpasang. Jalankan 1-INSTALL.bat lebih dulu.
  goto :selesai
)

echo Gateway tidak punya migrasi sendiri.
echo Tabel auto_reply_logs dibuat oleh aplikasi laundry.
echo.
echo Jadi pastikan 2-MIGRATE.bat di folder laundry-management
echo sudah pernah dijalankan.
echo.
echo Memeriksa koneksi database dan tabel...
echo.

call node scripts/check-db.mjs
if errorlevel 1 (
  echo.
  echo [BELUM SIAP] Lihat pesan di atas.
  echo Bila tabel belum ada, jalankan 2-MIGRATE.bat di folder
  echo laundry-management lebih dulu.
  goto :selesai
)

echo.
echo [SELESAI] Database siap dipakai gateway.
echo Langkah berikutnya: jalankan 3-JALANKAN.bat

:selesai
echo.
pause
endlocal
