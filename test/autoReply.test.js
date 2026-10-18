/**
 * Uji unit logika balasan otomatis.
 * Tidak memerlukan WhatsApp, database, maupun jaringan.
 *
 * Jalankan: npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Konfigurasi HARUS diatur sebelum modul config dimuat.
process.env.AUTO_REPLY_ENABLED = "true";
process.env.AUTO_REPLY_MESSAGE =
  "Halo {{name}}, terima kasih telah menghubungi Zahra Laundry. {{tidakDikenal}}";
// Jeda 0 agar pengujian cepat; jeda sesungguhnya diuji secara khusus di bawah.
process.env.AUTO_REPLY_DELAY_MS = "0";

const {
  decideAutoReply,
  getAutoReplyState,
  processIncomingMessage,
  renderAutoReply,
  senderKeyFromJid,
  todayKey,
} = await import("../src/autoReply.js");
const { createMemoryStore } = await import("../src/autoReplyStore.js");

const DAY_1 = new Date("2026-10-15T03:00:00Z"); // 10:00 WIB
const DAY_2 = new Date("2026-10-16T03:00:00Z"); // hari berikutnya

const DESCRIPTOR = {
  remoteJid: "628111@s.whatsapp.net",
  hasContent: true,
  contentType: "conversation",
  pushName: "Budi",
};

/** Pengirim palsu yang merekam pesan yang benar-benar dikirim. */
function makeSender() {
  const sent = [];
  return {
    sent,
    send: async (jid, text) => {
      sent.push({ jid, text });
      return { id: `MSG-${sent.length}` };
    },
  };
}

describe("todayKey", () => {
  it("memakai zona waktu Asia/Jakarta, bukan UTC", () => {
    // 17:30 UTC = 00:30 keesokan harinya di Jakarta (UTC+7).
    assert.equal(todayKey(new Date("2026-10-15T17:30:00Z")), "2026-10-16");
    assert.equal(todayKey(new Date("2026-10-15T16:30:00Z")), "2026-10-15");
  });
});

describe("renderAutoReply", () => {
  it("hanya mengganti variabel yang dikenal", () => {
    assert.equal(
      renderAutoReply("Hai {{name}} pada {{tanggal}}", { name: "Budi" }),
      "Hai Budi pada {{tanggal}}",
    );
  });

  it("mengabaikan variabel yang tidak diberikan", () => {
    assert.equal(renderAutoReply("A {{x}} B", {}), "A {{x}} B");
  });
});

describe("senderKeyFromJid", () => {
  it("menghasilkan kunci per nomor, bukan per perangkat", () => {
    assert.equal(senderKeyFromJid("628123456789@s.whatsapp.net"), "628123456789");
    assert.equal(senderKeyFromJid("628123456789:12@s.whatsapp.net"), "628123456789");
  });

  it("memberi awalan khusus untuk pengirim LID", () => {
    assert.equal(senderKeyFromJid("51222350405853@lid"), "lid:51222350405853");
  });
});

describe("decideAutoReply", () => {
  const base = {
    remoteJid: "628111@s.whatsapp.net",
    hasContent: true,
    contentType: "conversation",
  };

  it("menerima percakapan pribadi biasa", () => {
    const result = decideAutoReply(base);
    assert.equal(result.eligible, true);
    assert.equal(result.targetJid, "628111@s.whatsapp.net");
    assert.equal(result.senderKey, "628111");
  });

  it("menolak pesan dari perangkat sendiri", () => {
    assert.equal(decideAutoReply({ ...base, fromMe: true }).eligible, false);
  });

  it("menolak grup, status, dan broadcast", () => {
    assert.equal(decideAutoReply({ ...base, remoteJid: "123@g.us" }).eligible, false);
    assert.equal(decideAutoReply({ ...base, remoteJid: "status@broadcast" }).eligible, false);
    assert.equal(decideAutoReply({ ...base, remoteJid: "x@broadcast" }).eligible, false);
    assert.equal(decideAutoReply({ ...base, remoteJid: "x@newsletter" }).eligible, false);
  });

  it("menolak pesan non-percakapan (react, edit, polling)", () => {
    assert.equal(decideAutoReply({ ...base, contentType: "protocolMessage" }).eligible, false);
    assert.equal(decideAutoReply({ ...base, contentType: "reactionMessage" }).eligible, false);
    assert.equal(decideAutoReply({ ...base, contentType: "pollUpdateMessage" }).eligible, false);
  });

  it("menolak pesan tanpa konten", () => {
    assert.equal(decideAutoReply({ ...base, hasContent: false }).eligible, false);
  });

  it("memakai nomor telepon (senderPn) bila pengirim dikenali lewat LID", () => {
    const result = decideAutoReply({
      remoteJid: "51222350405853@lid",
      senderPn: "628999@s.whatsapp.net",
      hasContent: true,
      contentType: "conversation",
    });
    assert.equal(result.eligible, true);
    assert.equal(result.targetJid, "628999@s.whatsapp.net");
    assert.equal(result.senderKey, "628999");
  });

  it("tetap membalas lewat LID bila nomor telepon tidak tersedia", () => {
    const result = decideAutoReply({
      remoteJid: "51222350405853@lid",
      hasContent: true,
      contentType: "conversation",
    });
    assert.equal(result.eligible, true);
    assert.equal(result.targetJid, "51222350405853@lid");
    assert.equal(result.senderKey, "lid:51222350405853");
  });
});

describe("processIncomingMessage", () => {
  it("membalas sekali untuk pesan pertama, lalu diam di hari yang sama", async () => {
    const store = createMemoryStore();
    const { sent, send } = makeSender();

    const first = await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store });
    assert.equal(first.replied, true);
    assert.equal(sent.length, 1);
    assert.match(sent[0].text, /Budi/);
    assert.match(sent[0].text, /Zahra Laundry/);

    const second = await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store });
    assert.equal(second.replied, false);
    assert.equal(second.reason, "Nomor ini sudah dibalas hari ini.");
    assert.equal(sent.length, 1);
  });

  it("membalas nomor berbeda secara terpisah", async () => {
    const store = createMemoryStore();
    const { sent, send } = makeSender();

    await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store });
    await processIncomingMessage(
      { ...DESCRIPTOR, remoteJid: "628222@s.whatsapp.net" },
      send,
      { now: DAY_1, store },
    );
    assert.equal(sent.length, 2);
  });

  it("mengirim balasan lagi setelah ganti hari", async () => {
    const store = createMemoryStore();
    const { sent, send } = makeSender();

    assert.equal(
      (await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store })).replied,
      true,
    );
    assert.equal(
      (await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store })).replied,
      false,
    );
    assert.equal(
      (await processIncomingMessage(DESCRIPTOR, send, { now: DAY_2, store })).replied,
      true,
    );
    assert.equal(sent.length, 2);
  });

  it("tetap hanya satu balasan walau pesan datang hampir bersamaan", async () => {
    const store = createMemoryStore();
    const { sent, send } = makeSender();

    const [r1, r2] = await Promise.all([
      processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store }),
      processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store }),
    ]);

    assert.equal([r1.replied, r2.replied].filter(Boolean).length, 1);
    assert.equal(sent.length, 1);
  });

  it("melepas klaim bila pengiriman gagal, sehingga bisa dicoba lagi", async () => {
    const store = createMemoryStore();
    const failing = async () => {
      throw new Error("jaringan putus");
    };

    await assert.rejects(() =>
      processIncomingMessage(DESCRIPTOR, failing, { now: DAY_1, store }),
    );

    // Klaim harus dilepas: nomor ini belum tercatat dibalas.
    const state = await getAutoReplyState(store, DAY_1);
    assert.equal(state.count, 0);

    const { sent, send } = makeSender();
    const retry = await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store });
    assert.equal(retry.replied, true);
    assert.equal(sent.length, 1);
  });

  it("menunggu jeda sebelum mengirim balasan", async () => {
    const store = createMemoryStore();
    const { sent, send } = makeSender();

    const startedAt = Date.now();
    const result = await processIncomingMessage(DESCRIPTOR, send, {
      now: DAY_1,
      store,
      delayMs: 150,
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(result.replied, true);
    assert.equal(sent.length, 1);
    assert.ok(elapsed >= 140, `balasan terkirim terlalu cepat: ${elapsed} ms`);
  });

  it("jeda satu pengirim tidak menahan pengirim lain", async () => {
    const store = createMemoryStore();
    const sentAt = [];
    const send = async (jid) => {
      sentAt.push({ jid, at: Date.now() });
      return { id: `MSG-${sentAt.length}` };
    };

    await Promise.all([
      processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store, delayMs: 300 }),
      processIncomingMessage(
        { ...DESCRIPTOR, remoteJid: "628222@s.whatsapp.net" },
        send,
        { now: DAY_1, store, delayMs: 300 },
      ),
    ]);

    assert.equal(sentAt.length, 2);
    const spread = Math.abs(sentAt[1].at - sentAt[0].at);
    // Bila jeda ikut diserialkan, selisihnya akan ~300 ms.
    assert.ok(spread < 120, `pengiriman tampak diserialkan (selisih ${spread} ms)`);
  });

  it("menyimpan ID pesan penyedia setelah pengiriman berhasil", async () => {
    const store = createMemoryStore();
    const { send } = makeSender();

    await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store });

    const rows = await store.listByDay(todayKey(DAY_1), 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].providerMessageId, "MSG-1");
    assert.equal(rows[0].senderKey, "628111");
    assert.equal(rows[0].pushName, "Budi");
  });

  it("getAutoReplyState melaporkan jumlah nomor yang dibalas hari ini", async () => {
    const store = createMemoryStore();
    const { send } = makeSender();

    await processIncomingMessage(DESCRIPTOR, send, { now: DAY_1, store });
    await processIncomingMessage(
      { ...DESCRIPTOR, remoteJid: "628222@s.whatsapp.net" },
      send,
      { now: DAY_1, store },
    );

    const today = await getAutoReplyState(store, DAY_1);
    assert.equal(today.enabled, true);
    assert.equal(today.date, "2026-10-15");
    assert.equal(today.count, 2);
    assert.equal(today.entries.length, 2);

    const tomorrow = await getAutoReplyState(store, DAY_2);
    assert.equal(tomorrow.date, "2026-10-16");
    assert.equal(tomorrow.count, 0);
  });

  it("melaporkan nonaktif dan tidak mengirim bila store tidak tersedia", async () => {
    const { sent, send } = makeSender();
    const result = await processIncomingMessage(DESCRIPTOR, send, {
      now: DAY_1,
      store: null,
    });
    assert.equal(result.replied, false);
    assert.equal(sent.length, 0);

    const state = await getAutoReplyState(null, DAY_1);
    assert.equal(state.enabled, false);
    assert.equal(state.count, 0);
  });
});
