/**
 * WhatsApp Gateway — REST API self-hosted.
 *
 * Endpoint:
 *   GET  /health    - cek hidup (tanpa API key)
 *   GET  /          - halaman status + QR (tanpa API key)
 *   GET  /status    - status koneksi (butuh API key)
 *   GET  /qr        - QR dalam bentuk data URL (butuh API key)
 *   GET  /autoreply - status balasan otomatis harian (butuh API key)
 *   POST /send      - kirim pesan (butuh API key, kompatibel Fonnte)
 *   POST /logout    - putus tautan perangkat (butuh API key)
 */
import express from "express";
import { assertConfig, config } from "./config.js";
import { requireApiKey } from "./auth.js";
import { renderStatusPage } from "./statusPage.js";
import { getAutoReplyState } from "./autoReply.js";
import { getAutoReplyStore, verifyAutoReplyTable } from "./autoReplyStore.js";
import { closePool } from "./db.js";
import { installSafetyNet } from "./safetyNet.js";
import { connect, getStatus, logout, sendText, shutdown } from "./whatsapp.js";

assertConfig();

// Pasang jaring pengaman SEBELUM apa pun berjalan, agar error async dari Baileys
// tidak mematikan gateway (lihat src/safetyNet.js).
installSafetyNet();

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: true, service: "whatsapp-gateway" });
});

app.get("/", async (req, res) => {
  const autoReply = await getAutoReplyState(getAutoReplyStore());
  // Lewat tunnel seperti ngrok, permintaan dari luar tetap tampak berasal dari
  // localhost, jadi alamat IP tidak bisa dipakai sebagai penentu. Kehadiran
  // header proxy (x-forwarded-for / forwarded) dipakai sebagai penanda akses
  // dari luar, dan pada kondisi itu QR tidak ditampilkan.
  const proxied = Boolean(req.get("x-forwarded-for") || req.get("forwarded"));
  res
    .type("html")
    .send(renderStatusPage(getStatus(), autoReply, { allowQr: !proxied }));
});

app.get("/status", requireApiKey, (_req, res) => {
  res.json({ status: true, ...getStatus() });
});

app.get("/qr", requireApiKey, (_req, res) => {
  const status = getStatus();
  res.json({ status: true, connected: status.connected, qr: status.qr });
});

app.get("/autoreply", requireApiKey, async (_req, res) => {
  const state = await getAutoReplyState(getAutoReplyStore());
  res.json({ status: true, ...state });
});

/**
 * Kirim pesan. Bentuk request sengaja mengikuti kontrak Fonnte:
 *   POST /send
 *   Authorization: <API_KEY>
 *   Content-Type: application/x-www-form-urlencoded
 *   target=<nomor>&message=<teks>
 * Respons: { "status": true, "id": "..." } atau { "status": false, "reason": "..." }
 */
app.post("/send", requireApiKey, async (req, res) => {
  const body = req.body ?? {};
  const target = typeof body.target === "string" ? body.target : "";
  const message = typeof body.message === "string" ? body.message : "";

  if (!target.trim()) {
    return res.json({ status: false, reason: "Parameter 'target' wajib diisi." });
  }
  if (!message.trim()) {
    return res.json({ status: false, reason: "Parameter 'message' wajib diisi." });
  }

  try {
    const result = await sendText(target, message);
    if (!result.ok) {
      return res.json({ status: false, reason: result.reason });
    }
    return res.json({ status: true, id: result.id, requestid: result.id });
  } catch (error) {
    console.error("[send] Gagal mengirim pesan:", error?.message || error);
    return res.json({ status: false, reason: "Gateway gagal mengirim pesan." });
  }
});

app.post("/logout", requireApiKey, async (_req, res) => {
  const result = await logout();
  if (!result.ok) {
    return res.json({ status: false, reason: result.reason });
  }
  return res.json({ status: true });
});

app.use((_req, res) => {
  res.status(404).json({ status: false, reason: "Endpoint tidak ditemukan." });
});

// Penangan error terakhir, misalnya body JSON yang tidak valid.
app.use((error, _req, res, _next) => {
  console.error("[server] Kesalahan:", error?.message || error);
  res.status(400).json({ status: false, reason: "Permintaan tidak valid." });
});

const server = app.listen(config.port, config.host, () => {
  console.log("=================================================");
  console.log("  WhatsApp Gateway (Baileys)");
  console.log(`  URL   : http://${config.host}:${config.port}`);
  console.log(`  Mode  : ${config.mockMode ? "MOCK (simulasi, tanpa WhatsApp)" : "NYATA"}`);
  console.log(`  Sesi  : ${config.sessionDir}`);
  console.log("=================================================");
});

connect().catch((error) => {
  console.error("[whatsapp] Gagal memulai koneksi:", error?.message || error);
});

// Pastikan tabel penyimpanan auto-reply tersedia (tidak menghalangi server).
if (config.autoReplyEnabled) {
  verifyAutoReplyTable().then((check) => {
    if (check.ok) {
      console.log(`[config] Balasan otomatis aktif (penyimpanan: ${check.store}).`);
    } else {
      console.error(`[config] Balasan otomatis NONAKTIF: ${check.message}`);
    }
  });
}

let shuttingDown = false;
async function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[server] Menerima ${signal}, menutup dengan rapi...`);
  await shutdown();
  await closePool();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
