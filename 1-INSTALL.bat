@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo   LANGKAH 1 - INSTALASI GATEWAY WHATSAPP
echo ============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] Node.js belum terpasang di komputer ini.
  echo.
  echo Unduh di https://nodejs.org lalu pilih versi LTS.
  echo Setelah terpasang, tutup dan buka lagi jendela ini.
  goto :selesai
)

for /f "delims=" %%v in ('node -v') do set NODEVER=%%v
echo Node.js terdeteksi: %NODEVER%
echo.

if exist "node_modules" (
  echo Komponen sudah terpasang sebelumnya, langkah ini dilewati.
) else (
  echo Memasang komponen. Perlu internet, bisa beberapa menit.
  echo Mohon tunggu dan jangan tutup jendela ini.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [GAGAL] Pemasangan komponen gagal. Periksa koneksi internet.
    goto :selesai
  )
)

echo.
if exist ".env" (
  echo File pengaturan .env sudah ada, dilewati.
) else (
  if exist ".env.example" (
    copy ".env.example" ".env" >nul
    echo File pengaturan .env sudah dibuat dari contoh.
    echo.
    echo PENTING: buka file .env dengan Notepad, lalu sesuaikan:
    echo   - DATABASE_URL  : sama dengan di aplikasi laundry
    echo   - API_KEY       : harus sama dengan FONNTE_TOKEN di aplikasi laundry
    echo.
    echo Untuk membuat API_KEY acak, jalankan perintah ini di jendela
    echo Command Prompt di folder ini:
    echo   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
    echo.
  ) else (
    echo [PERINGATAN] File .env.example tidak ditemukan.
  )
)

echo.
echo [SELESAI] Instalasi berhasil.
echo Langkah berikutnya: jalankan 2-MIGRATE.bat

:selesai
echo.
pause
endlocal
