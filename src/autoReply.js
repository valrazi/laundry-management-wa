/**
 * Logika balasan otomatis (auto-reply) untuk chat masuk.
 *
 * Aturan:
 * - Hanya membalas SATU KALI per nomor pengirim per hari.
 * - Hitungan direset setiap hari menurut zona waktu Asia/Jakarta.
 * - Hanya untuk percakapan pribadi; grup/status/broadcast diabaikan.
 *
 * Riwayat disimpan di tabel `auto_reply_logs` (lihat `autoReplyStore.js`).
 * Modul ini sengaja tidak mengimpor Baileys maupun mysql2 agar logikanya dapat
 * diuji tanpa koneksi WhatsApp maupun database.
 */
import { config } from "./config.js";

/** Tipe konten yang BUKAN percakapan nyata sehingga tidak memicu balasan. */
export const NON_CONVERSATION_TYPES = new Set([
  "protocolMessage", // edit, hapus, perubahan pesan sementara
  "reactionMessage", // reaksi emoji
  "pollUpdateMessage", // pembaruan suara polling
  "keepInChatMessage", // notifikasi simpan pesan
]);

const JAKARTA_TIME_ZONE = "Asia/Jakarta";

/** Tanggal (YYYY-MM-DD) menurut zona waktu Asia/Jakarta. */
export function todayKey(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: JAKARTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Mengganti variabel template yang dikenal saja.
 * Placeholder yang tidak dikenal dibiarkan apa adanya agar salah ketik terlihat.
 * Tidak memakai `eval` atau mengeksekusi kode apa pun.
 */
export function renderAutoReply(template, variables = {}) {
  return String(template ?? "").replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (match, key) =>
      Object.prototype.hasOwnProperty.call(variables, key)
        ? String(variables[key] ?? "")
        : match,
  );
}

/**
 * Kunci unik per pengirim untuk pembatasan harian.
 * Pengirim ber-alamat LID (tanpa nomor telepon) diberi awalan "lid:"
 * agar tidak pernah tertukar dengan kunci berbasis nomor telepon.
 */
export function senderKeyFromJid(jid) {
  const raw = String(jid ?? "");
  const [userPart = "", domain = ""] = raw.split("@");
  const user = userPart.split(":")[0];
  if (domain === "lid") return user ? `lid:${user}` : raw;
  const digits = user.replace(/\D/g, "");
  return digits || raw;
}

/**
 * Menentukan apakah sebuah chat masuk layak dibalas otomatis.
 * Fungsi murni: tidak menyentuh disk, database, maupun jaringan.
 *
 * @param {{fromMe?: boolean, remoteJid?: string, senderPn?: string,
 *          contentType?: string|null, hasContent?: boolean}} input
 * @returns {{eligible: boolean, reason?: string, targetJid?: string, senderKey?: string}}
 */
export function decideAutoReply(input) {
  const {
    fromMe = false,
    remoteJid = "",
    senderPn = "",
    contentType = null,
    hasContent = false,
  } = input ?? {};

  if (!remoteJid) return { eligible: false, reason: "remoteJid kosong." };
  if (fromMe) return { eligible: false, reason: "Pesan dari perangkat sendiri." };
  if (remoteJid === "status@broadcast") {
    return { eligible: false, reason: "Status broadcast." };
  }
  if (remoteJid.endsWith("@g.us")) return { eligible: false, reason: "Pesan grup." };
  if (remoteJid.endsWith("@broadcast")) {
    return { eligible: false, reason: "Siaran broadcast." };
  }
  if (remoteJid.endsWith("@newsletter")) {
    return { eligible: false, reason: "Kanal newsletter." };
  }
  if (!hasContent) return { eligible: false, reason: "Pesan kosong." };
  if (contentType && NON_CONVERSATION_TYPES.has(contentType)) {
    return { eligible: false, reason: `Tipe "${contentType}" bukan percakapan.` };
  }

  // Utamakan nomor telepon; sebagian pengirim hanya dikenali melalui LID.
  const targetJid =
    typeof senderPn === "string" && senderPn.includes("@") ? senderPn : remoteJid;

  return {
    eligible: true,
    targetJid,
    senderKey: senderKeyFromJid(targetJid),
  };
}

// ---------------------------------------------------------------------------
// Pemrosesan pesan masuk
// ---------------------------------------------------------------------------

/** Jeda sederhana. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fase keputusan + klaim diserialkan agar pesan yang datang hampir bersamaan
// tidak menghasilkan lebih dari satu balasan untuk nomor yang sama.
// Fase jeda + pengiriman sengaja TIDAK diserialkan: jeda beberapa detik untuk
// satu pengirim tidak boleh menahan balasan pengirim lain.
let claimChain = Promise.resolve();

async function claimIncoming(descriptor, now, store) {
  if (!config.autoReplyEnabled) {
    return { replied: false, reason: "Auto-reply sedang dinonaktifkan." };
  }
  if (!store) {
    return { replied: false, reason: "Penyimpanan auto-reply tidak tersedia." };
  }

  const decision = decideAutoReply(descriptor);
  if (!decision.eligible) {
    return { replied: false, reason: decision.reason };
  }

  const dayKey = todayKey(now);
  const message = renderAutoReply(config.autoReplyMessage, {
    name: descriptor.pushName || "Pelanggan",
    date: dayKey,
  }).trim();
  if (!message) {
    return { replied: false, reason: "Template balasan kosong." };
  }

  // Klaim lebih dahulu. Unique index (senderKey, dayKey) pada tabel
  // `auto_reply_logs` menjamin satu balasan per nomor per hari — bahkan bila
  // nanti ada lebih dari satu proses gateway.
  const claim = await store.claim({
    senderKey: decision.senderKey,
    senderJid: decision.targetJid,
    pushName: descriptor.pushName || null,
    dayKey,
    messageSnapshot: message,
  });
  if (!claim.claimed) {
    return { replied: false, reason: "Nomor ini sudah dibalas hari ini." };
  }

  return {
    replied: true,
    claimId: claim.id,
    senderKey: decision.senderKey,
    targetJid: decision.targetJid,
    message,
  };
}

async function deliverReply(claimed, sendFn, store, delayMs) {
  if (!claimed.replied) return claimed;

  if (delayMs > 0) await delay(delayMs);

  try {
    const sent = await sendFn(claimed.targetJid, claimed.message);
    await store.confirm(claimed.claimId, sent?.id ?? null);
  } catch (error) {
    // Lepaskan klaim agar pengirim masih bisa dibalas saat mengirim pesan lagi.
    await store.release(claimed.claimId).catch(() => {});
    throw error;
  }

  return {
    replied: true,
    senderKey: claimed.senderKey,
    targetJid: claimed.targetJid,
    message: claimed.message,
  };
}

/**
 * Memproses satu chat masuk dan mengirim balasan bila memenuhi syarat.
 *
 * @param {object} descriptor hasil normalisasi pesan (lihat whatsapp.js)
 * @param {(jid: string, text: string) => Promise<{id?: string}|unknown>} sendFn
 * @param {{now?: Date, store: object, delayMs?: number}} options
 *        `store` wajib disertakan. `delayMs` diambil dari konfigurasi
 *        (AUTO_REPLY_DELAY_MS, bawaan 3000 ms) bila tidak diberikan.
 */
export function processIncomingMessage(descriptor, sendFn, options = {}) {
  const { now = new Date(), store, delayMs = config.autoReplyDelayMs } = options;

  const claimed = claimChain.then(() => claimIncoming(descriptor, now, store));
  claimChain = claimed.catch(() => {});

  return claimed.then((result) => deliverReply(result, sendFn, store, delayMs));
}

/** Ringkasan status harian untuk ditampilkan ke admin. */
export async function getAutoReplyState(store, now = new Date()) {
  const dayKey = todayKey(now);
  const enabled = config.autoReplyEnabled && Boolean(store);

  if (!store) {
    return { enabled: false, date: dayKey, count: 0, entries: [], store: null };
  }

  const [count, entries] = await Promise.all([
    store.countByDay(dayKey),
    store.listByDay(dayKey, 10),
  ]);

  return { enabled, date: dayKey, count, entries, store: store.kind ?? "custom" };
}
