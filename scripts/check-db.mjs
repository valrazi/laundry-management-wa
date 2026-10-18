/**
 * Memeriksa kesiapan database untuk gateway.
 *
 * Gateway TIDAK punya migrasi sendiri: tabel `auto_reply_logs` dibuat oleh
 * migrasi Prisma di aplikasi laundry. Skrip ini memastikan koneksi berhasil
 * dan tabel tersebut sudah ada, supaya kesalahannya jelas sebelum gateway jalan.
 */
const { config } = await import("../src/config.js");
const { closePool, getPool } = await import("../src/db.js");

let ok = true;

if (!config.databaseUrl) {
  console.error("[GAGAL] DATABASE_URL belum diisi di file .env gateway.");
  console.error(
    'Contoh: DATABASE_URL="mysql://root:PASSWORD@127.0.0.1:3306/laundry_db"',
  );
  process.exit(1);
}

try {
  const pool = getPool();

  const [tables] = await pool.query(
    "SELECT COUNT(*) AS n FROM information_schema.tables " +
      "WHERE table_schema = DATABASE() AND table_name = 'auto_reply_logs'",
  );

  if (Number(tables[0].n) === 0) {
    console.error("[BELUM SIAP] Tabel auto_reply_logs belum ada di database.");
    console.error("Tabel ini dibuat oleh aplikasi laundry.");
    console.error(
      "Jalankan 2-MIGRATE.bat di folder laundry-management lebih dahulu.",
    );
    ok = false;
  } else {
    const [rows] = await pool.query("SELECT COUNT(*) AS n FROM `auto_reply_logs`");
    console.log("[OK] Koneksi database berhasil.");
    console.log("[OK] Tabel auto_reply_logs tersedia.");
    console.log(`     Jumlah riwayat balasan otomatis: ${rows[0].n}`);
  }
} catch (error) {
  console.error("[GAGAL] Tidak bisa terhubung ke database.");
  console.error(`Pesan: ${error?.message || error}`);
  console.error("Periksa: MySQL sudah menyala dan DATABASE_URL benar.");
  ok = false;
}

await closePool();
process.exitCode = ok ? 0 : 1;
