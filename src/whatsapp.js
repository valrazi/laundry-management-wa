/**
 * Modul koneksi WhatsApp berbasis Baileys (WhatsApp Web multi-device).
 *
 * Tanggung jawab:
 * - Membuka koneksi ke WhatsApp dan menampilkan QR untuk menautkan perangkat.
 * - Menyimpan sesi agar tidak perlu scan QR setiap kali server dijalankan.
 * - Menyambung ulang otomatis saat koneksi terputus.
 * - Mengirim pesan teks dan mengembalikan hasil yang konsisten ke pemanggil.
 *
 * Modul ini hanya berjalan di server. Tidak ada kredensial yang dikirim ke klien.
 */
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  getContentType,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";
import { rm } from "node:fs/promises";
import { config } from "./config.js";
import { processIncomingMessage } from "./autoReply.js";
import { getAutoReplyStore } from "./autoReplyStore.js";

const logger = pino({ level: config.logLevel });

let sock = null;
let saveCreds = null;
let stopping = false;

const state = {
  connected: false,
  connecting: false,
  me: null,
  qrDataUrl: null,
  lastError: null,
  reconnectAttempts: 0,
  startedAt: Date.now(),
  lastConnectedAt: null,
};

/** Status koneksi terkini, aman untuk ditampilkan ke admin. */
export function getStatus() {
  return {
    connected: state.connected,
    connecting: state.connecting,
    mock: config.mockMode,
    user: state.me,
    hasQr: Boolean(state.qrDataUrl),
    qr: state.qrDataUrl,
    lastError: state.lastError,
    lastConnectedAt: state.lastConnectedAt,
    reconnectAttempts: state.reconnectAttempts,
    uptimeSeconds: Math.floor((Date.now() - state.startedAt) / 1000),
  };
}

export function isConnected() {
  return state.connected;
}

/**
 * Cache pesan terakhir (yang dikirim maupun diterima).
 *
 * Baileys memanggil `getMessage` ketika perangkat lain (mis. HP yang tertaut
 * pada akun yang sama) gagal mendekripsi sebuah pesan lalu meminta dikirim
 * ulang. Tanpa cache ini permintaan tersebut tidak bisa dilayani, dan HP akan
 * menampilkan "Waiting for this message. This may take a while."
 */
const MESSAGE_CACHE_LIMIT = 1000;
const messageCache = new Map();

function messageCacheKey(key) {
  return `${key?.remoteJid ?? ""}\u0000${key?.id ?? ""}`;
}

function cacheMessage(key, message) {
  if (!key?.id || !message) return;
  const cacheKey = messageCacheKey(key);
  messageCache.delete(cacheKey); // pindahkan ke posisi terbaru
  messageCache.set(cacheKey, message);
  if (messageCache.size > MESSAGE_CACHE_LIMIT) {
    messageCache.delete(messageCache.keys().next().value);
  }
}

function getCachedMessage(key) {
  if (!key?.id) return undefined;
  const exact = messageCache.get(messageCacheKey(key));
  if (exact) return exact;
  // Cadangan: cocokkan lewat ID pesan saja bila bentuk remoteJid berbeda.
  const suffix = `\u0000${key.id}`;
  for (const [cacheKey, message] of messageCache) {
    if (cacheKey.endsWith(suffix)) return message;
  }
  return undefined;
}

/** Mengubah nomor menjadi JID WhatsApp, mis. "628123..." -> "628123...@s.whatsapp.net". */
function toJid(target) {
  const digits = String(target ?? "").replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return null;
  return `${digits}@s.whatsapp.net`;
}

/**
 * Membuka (atau membuka ulang) koneksi ke WhatsApp.
 * Aman dipanggil berulang kali; setiap pemanggilan membuat socket baru.
 */
export async function connect() {
  if (config.mockMode) {
    state.connected = true;
    state.connecting = false;
    state.me = { id: "mock@s.whatsapp.net", name: "Mode Simulasi" };
    console.log(
      "[whatsapp] MOCK_MODE=true — tidak menyentuh WhatsApp, pengiriman disimulasikan."
    );
    return;
  }

  state.connecting = true;

  const { state: authState, saveCreds: persist } = await useMultiFileAuthState(
    config.sessionDir
  );
  saveCreds = persist;

  let version;
  try {
    ({ version } = await fetchLatestBaileysVersion());
  } catch {
    console.warn(
      "[whatsapp] Tidak bisa mengambil versi terbaru WhatsApp; memakai versi bawaan Baileys."
    );
  }

  sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: {
      creds: authState.creds,
      keys: makeCacheableSignalKeyStore(authState.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: Browsers.ubuntu("Chrome"),
    markOnlineOnConnect: false,
    syncFullHistory: false,
    generateHighQualityLinkPreview: false,
    // Melayani permintaan kirim ulang dari perangkat lain milik akun yang sama,
    // supaya tidak muncul "Waiting for this message" di HP.
    // Log "TIDAK terlayani" berguna untuk mendiagnosa: bila muncul terus, berarti
    // ada perangkat yang meminta ulang pesan yang tidak ada di cache kita.
    getMessage: async (key) => {
      const cached = getCachedMessage(key);
      if (!cached) {
        console.warn(
          `[cache] Permintaan kirim ulang TIDAK terlayani: ${key?.remoteJid ?? "?"} / ${key?.id ?? "?"}`,
        );
      } else if (config.logLevel === "debug") {
        console.log(`[cache] Kirim ulang dilayani untuk pesan ${key?.id}.`);
      }
      return cached;
    },
    // CATATAN: JANGAN pasang `shouldIgnoreJid` di sini. Fitur balasan otomatis
    // membutuhkan pesan masuk, termasuk dari pengirim ber-alamat "LID" (@lid)
    // yang kini umum dipakai WhatsApp. Menyaringnya akan mematikan auto-reply.
  });

  sock.ev.on("creds.update", saveCreds);

  // Pesan masuk -> pemicu balasan otomatis (maks. sekali per nomor per hari).
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    // "notify" = pesan baru; "append" = riwayat lama, tidak perlu dibalas.
    if (type !== "notify") return;
    for (const msg of messages) {
      cacheMessage(msg?.key, msg?.message);
      handleIncomingMessage(msg).catch((error) =>
        console.error(
          "[autoreply] Gagal memproses pesan masuk:",
          error?.message || error,
        ),
      );
    }
  });

  sock.ev.on("connection.update", (update) => {
    handleConnectionUpdate(update).catch((error) => {
      console.error(
        "[whatsapp] Kesalahan saat menangani update koneksi:",
        error?.message || error
      );
    });
  });
}

async function handleConnectionUpdate({ connection, lastDisconnect, qr }) {
  if (qr) {
    state.qrDataUrl = await QRCode.toDataURL(qr, {
      margin: 1,
      width: 320,
    }).catch(() => null);
    console.log(
      "\n[whatsapp] Buka WhatsApp > Perangkat Tertaut > Tautkan perangkat, lalu scan QR berikut:"
    );
    console.log(
      `[whatsapp] Atau buka http://127.0.0.1:${config.port} untuk melihat QR di browser.\n`
    );
    qrcodeTerminal.generate(qr, { small: true });
  }

  if (connection === "open") {
    state.connected = true;
    state.connecting = false;
    state.qrDataUrl = null;
    state.lastError = null;
    state.reconnectAttempts = 0;
    state.lastConnectedAt = new Date().toISOString();
    const id = sock?.user?.id ?? "";
    state.me = { id, name: sock?.user?.name ?? sock?.user?.verifiedName ?? null };
    console.log(`[whatsapp] Terhubung sebagai ${id}`);
  }

  if (connection === "close") {
    state.connected = false;
    state.connecting = false;

    const statusCode = lastDisconnect?.error?.output?.statusCode;
    const loggedOut = statusCode === DisconnectReason.loggedOut;
    state.lastError =
      lastDisconnect?.error?.message ||
      `Koneksi terputus (kode ${statusCode ?? "tidak diketahui"}).`;
    console.warn(`[whatsapp] Koneksi terputus: ${state.lastError}`);

    if (stopping) return;

    if (loggedOut) {
      // Sesi tidak lagi valid. Hapus agar QR baru dibuat saat menyambung ulang.
      console.warn(
        "[whatsapp] Perangkat di-logout. Menghapus sesi; akan dibuat QR baru."
      );
      await rm(config.sessionDir, { recursive: true, force: true }).catch(() => {});
      state.me = null;
      setTimeout(() => {
        connect().catch((error) =>
          console.error("[whatsapp] Gagal menyambung ulang:", error?.message || error)
        );
      }, 2000);
      return;
    }

    // Nomor yang sama dipakai instance lain. Jangan langsung reconnect:
    // dua instance akan saling menendang tanpa henti.
    if (statusCode === DisconnectReason.connectionReplaced) {
      console.error(
        "[whatsapp] Nomor ini sedang dipakai instance gateway LAIN (connection replaced). " +
          "Pastikan hanya satu gateway berjalan untuk nomor ini. Mencoba lagi dalam 60 detik.",
      );
      setTimeout(() => {
        connect().catch((error) =>
          console.error("[whatsapp] Gagal menyambung ulang:", error?.message || error),
        );
      }, 60000);
      return;
    }

    // Disconnect sementara: coba sambung ulang dengan jeda bertingkat (bounded).
    state.reconnectAttempts += 1;
    const delay = Math.min(3000 * state.reconnectAttempts, 30000);
    console.warn(
      `[whatsapp] Menyambung ulang dalam ${delay} ms (percobaan ke-${state.reconnectAttempts}).`
    );
    setTimeout(() => {
      connect().catch((error) =>
        console.error("[whatsapp] Gagal menyambung ulang:", error?.message || error)
      );
    }, delay);
  }
}

/**
 * Mengirim pesan ke JID apa adanya (dipakai balasan otomatis).
 * Berbeda dari `sendText`, JID di sini sudah final — misalnya
 * "62812...@s.whatsapp.net" atau "...@lid" — sehingga tidak diubah lagi.
 */
async function sendToJid(jid, text) {
  if (config.mockMode) return { ok: true, id: `MOCK-${Date.now()}` };
  if (!state.connected || !sock) {
    throw new Error("WhatsApp belum terhubung.");
  }
  const sent = await sock.sendMessage(jid, { text });
  cacheMessage(sent?.key, sent?.message);
  return { ok: true, id: sent?.key?.id ?? null };
}

/** Menormalkan pesan masuk Baileys menjadi deskriptor sederhana untuk auto-reply. */
export function describeIncomingMessage(msg) {
  const key = msg?.key ?? {};
  const message = msg?.message ?? null;
  return {
    fromMe: Boolean(key.fromMe),
    remoteJid: key.remoteJid ?? "",
    senderPn: key.senderPn ?? "",
    contentType: message ? getContentType(message) : null,
    hasContent: Boolean(message && Object.keys(message).length > 0),
    pushName: msg?.pushName ?? "",
  };
}

async function handleIncomingMessage(msg) {
  if (!config.autoReplyEnabled) return;

  const store = getAutoReplyStore();
  if (!store) return;

  const outcome = await processIncomingMessage(
    describeIncomingMessage(msg),
    sendToJid,
    { store },
  );

  if (outcome.replied) {
    console.log(
      `[autoreply] Balasan otomatis terkirim ke ${outcome.targetJid} (kunci: ${outcome.senderKey}).`,
    );
  } else if (config.logLevel === "debug") {
    console.log(`[autoreply] Dilewati: ${outcome.reason}`);
  }
}

/**
 * Mengirim satu pesan teks.
 *
 * @param {string} target Nomor tujuan (format apa pun yang mengandung digit).
 * @param {string} message Isi pesan.
 * @returns {Promise<{ok: boolean, id?: string|null, reason?: string}>}
 */
export async function sendText(target, message) {
  const jid = toJid(target);
  if (!jid) {
    return { ok: false, reason: "Nomor tujuan tidak valid." };
  }

  if (config.mockMode) {
    return { ok: true, id: `MOCK-${Date.now()}` };
  }

  if (!state.connected || !sock) {
    return {
      ok: false,
      reason: "WhatsApp belum terhubung. Scan QR terlebih dahulu.",
    };
  }

  // Pengecekan opsional: beri pesan kesalahan yang lebih jelas bila nomor
  // tidak terdaftar. Kegagalan pengecekan tidak menghalangi pengiriman.
  try {
    const results = await sock.onWhatsApp(jid);
    const info = Array.isArray(results) ? results[0] : null;
    if (info && info.exists === false) {
      return { ok: false, reason: "Nomor tujuan tidak terdaftar di WhatsApp." };
    }
  } catch {
    // diabaikan dengan sengaja
  }

  const sent = await sock.sendMessage(jid, { text: message });
  cacheMessage(sent?.key, sent?.message);
  return { ok: true, id: sent?.key?.id ?? null };
}

/** Memutus tautan perangkat dan menghapus sesi lokal. */
export async function logout() {
  if (config.mockMode) {
    state.connected = false;
    state.me = null;
    return { ok: true };
  }
  if (!sock) {
    return { ok: false, reason: "Belum ada koneksi yang bisa di-logout." };
  }

  stopping = true;
  try {
    await sock.logout();
  } catch {
    // diabaikan: sesi tetap dihapus di bawah
  }
  await rm(config.sessionDir, { recursive: true, force: true }).catch(() => {});
  state.connected = false;
  state.me = null;
  state.qrDataUrl = null;
  stopping = false;

  setTimeout(() => {
    connect().catch((error) =>
      console.error("[whatsapp] Gagal menyambung ulang:", error?.message || error)
    );
  }, 1000);

  return { ok: true };
}

/** Menutup koneksi dengan rapi saat server dihentikan. */
export async function shutdown() {
  stopping = true;
  try {
    sock?.end(undefined);
  } catch {
    // diabaikan
  }
}
