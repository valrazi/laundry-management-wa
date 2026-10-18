/**
 * Jaring pengaman agar gateway tetap hidup.
 *
 * Baileys dapat melempar error dari jalur async internalnya TANPA penangkap.
 * Contoh nyata yang pernah terjadi:
 *
 *   Error: Connection Closed (Boom, statusCode 428)
 *     at sendRawMessage (Socket/socket.js:56)
 *     at sendRetryRequest (Socket/messages-recv.js:100)
 *     at Socket/messages-recv.js:661   <- di dalam retryMutex.mutex(async () => ...)
 *
 * Rantainya: koneksi putus -> kita menjadwalkan reconnect -> bersamaan dengan itu
 * ada pesan masuk yang gagal didekripsi -> Baileys mencoba sendRetryRequest ->
 * soket sudah tertutup -> throw. Karena tidak ada yang menangkap, di Node modern
 * promise yang ditolak mematikan proses.
 *
 * Gateway ini bertugas menemani operasional seharian, jadi lebih baik mencatat
 * error tersebut lalu tetap berjalan daripada mati diam-diam.
 *
 * Catatan: menangani `uncaughtException` memang berisiko menyembunyikan bug
 * serius, dan itu disengaja di sini — lihat README bagian 11.
 */
export function installSafetyNet(logger = console) {
  process.on("unhandledRejection", (reason) => {
    logger.error(
      "[safety] Promise ditolak tanpa penangkap — diabaikan agar gateway tetap hidup:",
      reason?.message || reason,
    );
  });

  process.on("uncaughtException", (error) => {
    logger.error(
      "[safety] Exception tak tertangani — diabaikan agar gateway tetap hidup:",
      error?.message || error,
    );
  });
}
