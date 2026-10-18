/**
 * Konfigurasi gateway, seluruhnya bersumber dari environment variable (.env).
 */
import "dotenv/config";

function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value).trim().toLowerCase() === "true";
}

function toNonNegativeInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

export const config = {
  host: (process.env.HOST || "127.0.0.1").trim(),
  port: Number(process.env.PORT) || 3001,
  apiKey: (process.env.API_KEY || "").trim(),
  sessionDir: (process.env.SESSION_DIR || "auth_state").trim(),
  logLevel: (process.env.LOG_LEVEL || "warn").trim(),
  mockMode: toBool(process.env.MOCK_MODE, false),

  // --- Balasan otomatis untuk chat masuk ---
  autoReplyEnabled: toBool(process.env.AUTO_REPLY_ENABLED, false),
  autoReplyMessage: (
    process.env.AUTO_REPLY_MESSAGE ||
    "Terima kasih telah menghubungi Zahra Laundry. Admin akan segera membalas pesan Anda."
  ).trim(),
  // Jeda sebelum membalas, agar terasa wajar dan tidak seperti bot instan.
  autoReplyDelayMs: toNonNegativeInt(process.env.AUTO_REPLY_DELAY_MS, 3000),
  // --- Database (sama dengan aplikasi laundry) ---
  // Dipakai untuk menyimpan riwayat balasan otomatis di tabel auto_reply_logs.
  databaseUrl: (process.env.DATABASE_URL || "").trim(),
};

/** Memastikan konfigurasi wajib terisi sebelum server dijalankan. */
export function assertConfig() {
  if (!config.apiKey) {
    console.error(
      "[config] API_KEY belum diatur. Salin .env.example menjadi .env lalu isi API_KEY."
    );
    process.exit(1);
  }
  if (config.apiKey.length < 16) {
    console.warn(
      "[config] Peringatan: API_KEY terlalu pendek. Gunakan nilai acak minimal 16 karakter."
    );
  }
}
