@echo off
setlocal
cd /d "%~dp0"

set PORT=%~1
if "%PORT%"=="" set PORT=3001

echo ============================================================
echo   NGROK - MEMBUKA GATEWAY WHATSAPP KE INTERNET
echo ============================================================
echo.
echo Port lokal yang dibuka: %PORT%
echo.
echo [PERHATIAN] Gateway biasanya TIDAK perlu di-ngrok.
echo Aplikasi laundry memanggil gateway lewat localhost, jadi cukup
echo aplikasi laundry saja yang dibuka dengan 5-NGROK.bat di folder
echo laundry-management.
echo.
echo Bila gateway tetap dibuka ke internet, halaman status di
echo http://127.0.0.1:%PORT% ikut terbuka. QR tetap disembunyikan
echo untuk akses dari luar, tetapi informasi status tetap terlihat.
echo.

where ngrok >nul 2>nul
if errorlevel 1 (
  echo [GAGAL] ngrok belum terpasang di komputer ini.
  echo.
  echo Cara memasang:
  echo   1. Daftar gratis di https://ngrok.com
  echo   2. Unduh ngrok untuk Windows
  echo   3. Simpan ngrok.exe di folder ini atau masukkan ke PATH
  echo   4. Buka Command Prompt, jalankan sekali:
  echo        ngrok config add-authtoken TOKEN_ANDA
  echo.
  goto :selesai
)

echo Untuk berhenti, tekan Ctrl+C.
echo.

ngrok http %PORT%

:selesai
echo.
pause
endlocal
