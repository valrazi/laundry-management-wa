/**
 * Koneksi MySQL untuk gateway.
 *
 * Gateway memakai database yang SAMA dengan aplikasi laundry, tetapi mengaksesnya
 * langsung lewat mysql2 (bukan Prisma) agar tetap ringan dan mandiri.
 * Tabel `auto_reply_logs` dibuat oleh migrasi Prisma di aplikasi laundry —
 * gateway TIDAK membuat tabel sendiri supaya Prisma tidak mendeteksi drift.
 */
import mysql from "mysql2/promise";
import { config } from "./config.js";

/** Mengurai DATABASE_URL menjadi opsi koneksi mysql2. */
export function parseDatabaseUrl(url) {
  const parsed = new URL(String(url));
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
  };
}

let pool = null;

export function getPool() {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL belum diatur di .env gateway.");
  }
  if (!pool) {
    pool = mysql.createPool({
      ...parseDatabaseUrl(config.databaseUrl),
      waitForConnections: true,
      connectionLimit: 5,
      charset: "utf8mb4",
      // Prisma menyimpan DateTime sebagai UTC; samakan agar nilai waktu konsisten.
      timezone: "Z",
    });
  }
  return pool;
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end().catch(() => {});
}
