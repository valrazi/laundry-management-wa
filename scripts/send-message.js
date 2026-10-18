/**
 * Skrip uji kirim pesan.
 *
 * Meniru persis cara aplikasi laundry memanggil gateway (kontrak Fonnte),
 * sehingga berguna untuk memastikan integrasi berjalan sebelum dipakai
 * dari aplikasi Next.js.
 *
 * Pemakaian:
 *   npm run test:send
 *   npm run test:send -- "isi pesan kustom"
 */
import "dotenv/config";

const baseUrl = (
  process.env.GATEWAY_URL || `http://127.0.0.1:${process.env.PORT || 3001}`
).replace(/\/$/, "");
const apiKey = (process.env.API_KEY || "").trim();
const target = (process.env.TEST_TARGET || "").trim();
const message =
  process.argv.slice(2).join(" ").trim() ||
  "Pesan uji dari WhatsApp Gateway lokal.";

if (!apiKey) {
  console.error("API_KEY belum diatur di .env");
  process.exit(1);
}
if (!target) {
  console.error("TEST_TARGET belum diatur di .env (contoh: 6281234567890)");
  process.exit(1);
}

const body = new URLSearchParams({ target, message });

try {
  const response = await fetch(`${baseUrl}/send`, {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const text = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(text);
} catch (error) {
  console.error("Gagal menghubungi gateway:", error?.message || error);
  process.exit(1);
}
